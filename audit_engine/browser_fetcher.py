"""
audit_engine.browser_fetcher — Real browser-based page scanner.

Uses Playwright (headless Chromium) to:
1. Execute JavaScript like a real browser
2. Intercept network requests to tracking endpoints
3. Capture live window.dataLayer state
4. Read consent signals from JS globals
5. Return fully rendered HTML + all runtime data

Falls back to requests.get() if Playwright unavailable.
"""
import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


# ─── Tracking endpoint patterns for network interception ─────────────────────
TRACKING_DOMAINS = [
    # Google
    r"google-analytics\.com",
    r"analytics\.google\.com",
    r"googletagmanager\.com",
    r"googletagservices\.com",
    r"googleads\.g\.doubleclick\.net",
    r"doubleclick\.net",
    r"googlesyndication\.com",
    r"google\.com/pagead",
    # Meta / Facebook
    r"connect\.facebook\.net",
    r"facebook\.com/tr",
    r"facebook\.com/signals",
    # TikTok
    r"analytics\.tiktok\.com",
    r"ads\.tiktok\.com",
    # Twitter / X
    r"static\.ads-twitter\.com",
    r"t\.co/i/adsct",
    r"analytics\.twitter\.com",
    # LinkedIn
    r"snap\.licdn\.com",
    r"px\.ads\.linkedin\.com",
    # Hotjar
    r"static\.hotjar\.com",
    r"vars\.hotjar\.com",
    r"insights\.hotjar\.com",
    # Microsoft Clarity
    r"clarity\.ms",
    # Segment
    r"cdn\.segment\.com",
    r"api\.segment\.io",
    # Amplitude
    r"cdn\.amplitude\.com",
    r"api\.amplitude\.com",
    # Mixpanel
    r"cdn\.mxpnl\.com",
    r"api\.mixpanel\.com",
    # Criteo
    r"static\.criteo\.net",
    r"sslwidget\.criteo\.com",
    r"dis\.criteo\.com",
    # Taboola
    r"cdn\.taboola\.com",
    # Outbrain
    r"amplify\.outbrain\.com",
    # Snapchat
    r"sc-static\.net",
    r"tr\.snapchat\.com",
    # Pinterest
    r"s\.pinimg\.com",
    r"ct\.pinterest\.com",
    # HubSpot
    r"js\.hs-scripts\.com",
    r"js\.hs-analytics\.net",
    r"track\.hubspot\.com",
    # Intercom
    r"widget\.intercom\.io",
    r"nexus\.intercom\.io",
    # FullStory
    r"fullstory\.com",
    r"edge\.fullstory\.com",
    # Mouseflow
    r"cdn\.mouseflow\.com",
    # VWO / Optimizely
    r"dev\.visualwebsiteoptimizer\.com",
    r"cdn\.optimizely\.com",
    # Adobe
    r"omtrdc\.net",
    r"adobedtm\.com",
    # Klaviyo
    r"static\.klaviyo\.com",
    # Any beacon / collect endpoint
    r"/collect\?",
    r"/tr\?",
    r"/pixel\?",
    r"/beacon",
]

_TRACKING_RE = re.compile("|".join(TRACKING_DOMAINS), re.IGNORECASE)


@dataclass
class InterceptedRequest:
    """A captured network request to a tracking endpoint."""
    url: str
    method: str
    domain: str
    path: str
    post_data: Optional[str] = None
    resource_type: str = "unknown"
    timestamp: float = field(default_factory=time.time)


def _corpo_da_requisicao(request) -> Optional[str]:
    """Corpo da requisição como texto, sem deixar payload binário derrubar a captura.

    `request.post_data` decodifica como UTF-8 e levanta UnicodeDecodeError em
    corpo binário — que é justamente o caso dos beacons modernos (gzip,
    protobuf). A exceção estourava dentro do handler de interceptação, então a
    requisição se perdia: some a prova de que aquela tag enviou dados, que é o
    achado mais importante do laudo.
    """
    try:
        dados = request.post_data
        if dados:
            return dados[:500]
    except (UnicodeDecodeError, Exception):
        pass

    # Payload binário: registra o tamanho, que já indica que houve envio.
    try:
        bruto = request.post_data_buffer
        if bruto:
            return f"<binário: {len(bruto)} bytes>"
    except Exception:
        pass
    return None


@dataclass
class BrowserScanResult:
    """Full result from a browser-based page scan."""
    url: str
    html: str
    scan_method: str = "browser"

    # Network data
    intercepted_requests: List[InterceptedRequest] = field(default_factory=list)
    all_script_urls: List[str] = field(default_factory=list)

    # Runtime JS state
    datalayer_raw: List[Dict[str, Any]] = field(default_factory=list)
    gtag_configs: List[Dict[str, Any]] = field(default_factory=list)   # gtag('config', ...)
    fbq_calls: List[Dict[str, Any]] = field(default_factory=list)      # fbq('track', ...)
    consent_signals: Dict[str, Any] = field(default_factory=dict)

    # Armazenamento gravado no navegador SEM nenhum aceite — o scanner nunca
    # clica em "aceitar", então tudo que aparece aqui foi gravado sem
    # consentimento. É a evidência mais direta num laudo LGPD/GDPR, e não era
    # capturado: o produto auditava "cookies" sem ler um cookie sequer.
    cookies: List[Dict[str, Any]] = field(default_factory=list)
    local_storage: Dict[str, str] = field(default_factory=dict)
    session_storage: Dict[str, str] = field(default_factory=dict)

    # Meta
    page_title: str = ""
    load_time_ms: int = 0
    error: Optional[str] = None
    fallback_used: bool = False

    # Scan metadata — populated by browser_scan() orchestration
    scan_status: str = "completed"  # completed|partial|failed|blocked|protocol_error|timeout
    failure_reason: Optional[str] = None
    stages: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    final_url: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    browser_attempts: int = 0
    static_fallback_attempted: bool = False


# ─── JavaScript injected BEFORE page load to intercept calls ─────────────────
_INTERCEPT_SCRIPT = """
(function() {
    window.__auditCapture = {
        dataLayerEvents: [],
        gtagCalls: [],
        fbqCalls: [],
    };

    // Intercept dataLayer.push
    const _origDL = window.dataLayer;
    window.dataLayer = _origDL || [];
    const _origPush = window.dataLayer.push.bind(window.dataLayer);
    window.dataLayer.push = function() {
        for (var i = 0; i < arguments.length; i++) {
            try { window.__auditCapture.dataLayerEvents.push(JSON.parse(JSON.stringify(arguments[i]))); } catch(e) {}
        }
        return _origPush.apply(this, arguments);
    };

    // Intercept gtag calls
    const _origGtag = window.gtag;
    window.gtag = function() {
        try {
            var args = Array.prototype.slice.call(arguments);
            window.__auditCapture.gtagCalls.push(args);
        } catch(e) {}
        if (_origGtag) return _origGtag.apply(this, arguments);
    };

    // Intercept fbq calls
    const _origFbq = window.fbq;
    window.fbq = function() {
        try {
            var args = Array.prototype.slice.call(arguments);
            window.__auditCapture.fbqCalls.push(args);
        } catch(e) {}
        if (_origFbq) return _origFbq.apply(this, arguments);
    };
})();
"""

# ─── JavaScript evaluated AFTER page load to collect state ───────────────────
_COLLECT_SCRIPT = """
(function() {
    var result = {
        dataLayer: [],
        capturedDL: [],
        capturedGtag: [],
        capturedFbq: [],
        consentSignals: {},
        windowKeys: [],
        localStorage: {},
        sessionStorage: {},
    };

    // Armazenamento gravado sem nenhum aceite: rastreamento moderno usa
    // localStorage justamente para escapar de auditoria baseada em cookie.
    try {
        for (var i = 0; i < window.localStorage.length; i++) {
            var k = window.localStorage.key(i);
            result.localStorage[k] = String(window.localStorage.getItem(k)).slice(0, 300);
        }
    } catch (e) {}
    try {
        for (var j = 0; j < window.sessionStorage.length; j++) {
            var sk = window.sessionStorage.key(j);
            result.sessionStorage[sk] = String(window.sessionStorage.getItem(sk)).slice(0, 300);
        }
    } catch (e) {}

    // Collect whatever is in dataLayer now
    try {
        if (window.dataLayer && Array.isArray(window.dataLayer)) {
            result.dataLayer = JSON.parse(JSON.stringify(window.dataLayer.slice(0, 200)));
        }
    } catch(e) {}

    // Captured calls from our intercept script
    try {
        if (window.__auditCapture) {
            result.capturedDL   = window.__auditCapture.dataLayerEvents || [];
            result.capturedGtag = window.__auditCapture.gtagCalls || [];
            result.capturedFbq  = window.__auditCapture.fbqCalls || [];
        }
    } catch(e) {}

    // Consent signals
    try { result.consentSignals.hasTcf = typeof window.__tcfapi === 'function'; } catch(e) {}
    try { result.consentSignals.hasCmp = typeof window.__cmp === 'function'; } catch(e) {}
    try { result.consentSignals.cookiebotStatus = window.Cookiebot ? window.Cookiebot.consent : null; } catch(e) {}
    try { result.consentSignals.oneTrustLoaded = typeof window.OneTrust !== 'undefined'; } catch(e) {}
    try { result.consentSignals.didomiLoaded = typeof window.Didomi !== 'undefined'; } catch(e) {}
    try { result.consentSignals.consentModeState = window.google_tag_data ? window.google_tag_data.ics : null; } catch(e) {}

    // Top-level window keys that look like tracking
    var trackingKeywords = ['gtag','ga','fbq','ttq','twq','lintrk','_hsq','hj','clarity','amplitude','mixpanel','analytics'];
    try {
        trackingKeywords.forEach(function(k) {
            if (typeof window[k] !== 'undefined') result.windowKeys.push(k);
        });
    } catch(e) {}

    return result;
})();
"""


async def _browser_scan_async(url: str, timeout_ms: int = 30000) -> BrowserScanResult:
    """Run the actual Playwright scan asynchronously."""
    from playwright.async_api import async_playwright, TimeoutError as PwTimeout

    result = BrowserScanResult(url=url, html="")
    intercepted: List[InterceptedRequest] = []
    script_urls: List[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        )
        context = await browser.new_context(
            viewport={"width": 1440, "height": 900},
            locale="pt-BR",
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/122.0.0.0 Safari/537.36"
            ),
            extra_http_headers={
                "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            },
        )

        # Inject intercept script before any page scripts execute
        await context.add_init_script(_INTERCEPT_SCRIPT)

        page = await context.new_page()

        # ── Network request interception ──────────────────────────────────────
        def _on_request(request):
            req_url = request.url
            # Collect all external script URLs
            if request.resource_type == "script" and req_url.startswith("http"):
                script_urls.append(req_url)
            # Collect tracking requests
            if _TRACKING_RE.search(req_url):
                parsed = urlparse(req_url)
                intercepted.append(InterceptedRequest(
                    url=req_url,
                    method=request.method,
                    domain=parsed.netloc,
                    path=parsed.path,
                    post_data=_corpo_da_requisicao(request),
                    resource_type=request.resource_type,
                ))

        page.on("request", _on_request)

        # ── Navigate ──────────────────────────────────────────────────────────
        t0 = time.time()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            # Wait up to 8s for network to calm down (catches lazy-loaded tags)
            try:
                await page.wait_for_load_state("networkidle", timeout=8000)
            except PwTimeout:
                pass  # networkidle timeout is fine — we still have the page
        except PwTimeout:
            result.error = "Page load timed out — partial data collected"
            result.scan_status = "timeout"
            result.failure_reason = "navigation_timeout"
        except Exception as e:
            err_str = str(e)
            result.error = err_str
            # Detect HTTP/2 protocol failures
            if any(sig in err_str.lower() for sig in ["http2", "protocol error", "protocol_error", "err_http2", "net::err_"]):
                result.scan_status = "protocol_error"
                result.failure_reason = "http2_protocol_failure"
            elif "timeout" in err_str.lower():
                result.scan_status = "timeout"
                result.failure_reason = "navigation_timeout"
            elif any(sig in err_str.lower() for sig in ["403", "forbidden", "blocked", "access denied"]):
                result.scan_status = "blocked"
                result.failure_reason = "site_blocked_access"

        # ── Simulate scroll to trigger lazy-loaded tags ───────────────────────
        try:
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight / 2)")
            await asyncio.sleep(1.5)
            await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
            await asyncio.sleep(1.0)
        except Exception:
            pass

        # ── Collect rendered HTML ─────────────────────────────────────────────
        try:
            result.html = await page.content()
        except Exception as e:
            result.error = (result.error or "") + f" | content() error: {e}"

        # ── Collect JS runtime state ──────────────────────────────────────────
        try:
            js_state = await page.evaluate(_COLLECT_SCRIPT)
            if js_state:
                # Merge both dataLayer sources (static + captured pushes)
                dl_static   = js_state.get("dataLayer", [])
                dl_captured = js_state.get("capturedDL", [])
                # Deduplicate by JSON representation
                seen = set()
                combined = []
                for item in dl_static + dl_captured:
                    key = json.dumps(item, sort_keys=True, default=str)[:200]
                    if key not in seen:
                        seen.add(key)
                        combined.append(item)
                result.datalayer_raw = combined

                # gtag calls
                result.gtag_configs = js_state.get("capturedGtag", [])
                # fbq calls
                result.fbq_calls = js_state.get("capturedFbq", [])
                # consent signals
                result.consent_signals = js_state.get("consentSignals", {})
                result.local_storage = js_state.get("localStorage", {}) or {}
                result.session_storage = js_state.get("sessionStorage", {}) or {}
        except Exception as e:
            print(f"[browser_fetcher] JS collection error: {e}")

        # Cookies gravados sem nenhum aceite. Vem do contexto do navegador, e
        # não de document.cookie, para alcançar também os HttpOnly — que são
        # exatamente os que o JS não enxerga.
        try:
            result.cookies = await context.cookies()
        except Exception as e:
            print(f"[browser_fetcher] cookie collection error: {e}")

        result.load_time_ms = int((time.time() - t0) * 1000)
        result.page_title = await page.title()
        result.intercepted_requests = intercepted
        result.all_script_urls = list(dict.fromkeys(script_urls))  # deduplicated

        await browser.close()

    return result


def browser_scan(url: str, timeout_ms: int = 30000, deep_scan: bool = False) -> BrowserScanResult:
    """
    Public entry point. Runs browser scan with multiple fallback attempts.

    Attempt 1: Default Chromium
    Attempt 2: Retry with same config (transient failures)
    Attempt 3: Static HTML fallback

    Falls back to static HTML fetch if Playwright is unavailable or fails.
    """
    import concurrent.futures
    from datetime import datetime

    started_at = datetime.now().isoformat()

    def _run_in_thread() -> BrowserScanResult:
        """Run inside a new thread with its own fresh event loop."""
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(_browser_scan_async(url, timeout_ms))
        finally:
            loop.close()

    max_browser_attempts = 2
    last_error = None

    for attempt in range(1, max_browser_attempts + 1):
        try:
            import playwright  # noqa — just for availability check
            with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(_run_in_thread)
                result = future.result(timeout=(timeout_ms / 1000) + 15)
                result.browser_attempts = attempt
                result.started_at = started_at
                result.finished_at = datetime.now().isoformat()

                # If we got HTML content, scan succeeded (even if partial)
                if result.html and len(result.html) > 100:
                    if result.error and result.scan_status == "completed":
                        result.scan_status = "partial"
                    return result

                # If protocol error, don't retry browser — go straight to static
                if result.scan_status == "protocol_error":
                    last_error = result.failure_reason or result.error
                    break

                last_error = result.error

        except ImportError:
            print("[browser_fetcher] Playwright not installed — falling back to static fetch")
            last_error = "Playwright not installed"
            break
        except concurrent.futures.TimeoutError:
            print(f"[browser_fetcher] Browser attempt {attempt} timed out")
            last_error = f"Browser scan timed out (attempt {attempt})"
        except Exception as e:
            print(f"[browser_fetcher] Browser attempt {attempt} failed ({e})")
            last_error = str(e)

    # All browser attempts failed — try static fallback
    print(f"[browser_fetcher] All browser attempts failed — using static fallback")
    result = _static_fallback(url, error=last_error)
    result.browser_attempts = max_browser_attempts
    result.static_fallback_attempted = True
    result.started_at = started_at
    result.finished_at = datetime.now().isoformat()

    # Determine scan_status based on what static got
    if result.html and len(result.html) > 100:
        result.scan_status = "partial"
        result.failure_reason = "browser_failed_static_fallback_used"
    else:
        # Check if it was a protocol error
        if last_error and any(sig in str(last_error).lower() for sig in ["http2", "protocol"]):
            result.scan_status = "protocol_error"
            result.failure_reason = "http2_protocol_failure"
        else:
            result.scan_status = "failed"
            result.failure_reason = last_error or "all_scan_methods_failed"

    return result


def _static_fallback(url: str, error: Optional[str] = None) -> BrowserScanResult:
    """Enhanced static fallback that captures as much evidence as possible from HTTP response."""
    import requests

    _AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36",
    ]
    last_err = error
    for ua in _AGENTS:
        try:
            resp = requests.get(
                url,
                headers={
                    "User-Agent": ua,
                    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                },
                timeout=20,
                allow_redirects=True,
            )
            resp.encoding = resp.apparent_encoding or "utf-8"

            html = resp.text if resp.status_code == 200 else ""

            # Extract static evidence
            script_urls = re.findall(r'<script[^>]+src=["\']([^"\'\>]+)["\']', html, re.IGNORECASE)
            title_match = re.search(r'<title[^>]*>([^<]+)</title>', html, re.IGNORECASE)
            page_title = title_match.group(1).strip() if title_match else ""

            final_url = resp.url

            result = BrowserScanResult(
                url=url,
                html=html,
                scan_method="static_fallback",
                fallback_used=True,
                error=error,
                page_title=page_title,
                all_script_urls=script_urls[:100],
                final_url=final_url,
                static_fallback_attempted=True,
            )

            # Add warnings about static limitations
            result.warnings = [
                "Static HTML fallback — runtime behavior not verified",
                "Cookie state, dataLayer pushes, and consent interactions not captured",
            ]

            return result

        except Exception as e:
            last_err = str(e)

    return BrowserScanResult(
        url=url, html="", scan_method="static_fallback",
        fallback_used=True, error=last_err,
        scan_status="failed",
        failure_reason=last_err,
        static_fallback_attempted=True,
    )
