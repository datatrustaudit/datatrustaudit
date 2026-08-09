"""
audit_engine.tag_detector — Multi-method tracking tag detection engine.

Detection methods (in order of confidence):
1. script_url   → exact domain/path match in <script src="..."> (HIGH)
2. source       → regex pattern in raw HTML (MEDIUM-HIGH based on specificity)
3. script_pattern → inline JS code signature (MEDIUM)
4. network      → intercepted network request to vendor domain (HIGH — tag actually fired)
5. window_key   → JS global present in window object (MEDIUM)
"""
import re
from typing import List, Optional, TYPE_CHECKING
from bs4 import BeautifulSoup
from .models import TagFinding, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, CONFIDENCE_LOW, DETECT_SOURCE, DETECT_SCRIPT_URL, DETECT_PATTERN

if TYPE_CHECKING:
    from .browser_fetcher import BrowserScanResult

DETECT_NETWORK = "network_request"
DETECT_WINDOW  = "window_global"


# ─────────────────────────────────────────────
# Vendor catalog
# Each entry defines the vendor and its detection signatures.
# "url_patterns" → checked against external script src attrs → HIGH confidence
# "source_patterns" → checked in raw HTML → MEDIUM confidence
# "id_pattern" → regex to extract the vendor's tracking ID
# ─────────────────────────────────────────────

VENDOR_CATALOG = {
    "gtm": {
        "name": "Google Tag Manager",
        "vendor": "Google",
        "type": "tag_manager",
        "privacy_risk": "medium",
        "data_collected": ["Custom events", "User interactions", "E-commerce data"],
        "url_patterns": [r"googletagmanager\.com/gtm\.js"],
        "source_patterns": [r"GTM-[A-Z0-9]{6,8}", r"google_tag_manager"],
        "id_pattern": r"GTM-[A-Z0-9]{6,8}",
    },
    "ga4": {
        "name": "Google Analytics 4",
        "vendor": "Google",
        "type": "analytics",
        "privacy_risk": "high",
        "data_collected": ["IP address", "Browsing behaviour", "Geographic location", "Demographics"],
        "url_patterns": [r"googletagmanager\.com/gtag/js", r"google-analytics\.com/g/collect"],
        "source_patterns": [r"G-[A-Z0-9]{10,12}", r"gtag\s*\(\s*['\"]config['\"]"],
        "id_pattern": r"G-[A-Z0-9]{10,12}",
    },
    "ua": {
        "name": "Universal Analytics (Deprecated)",
        "vendor": "Google",
        "type": "analytics",
        "privacy_risk": "critical",
        "data_collected": ["IP address", "Browsing behaviour", "Persistent cookies"],
        "url_patterns": [r"google-analytics\.com/analytics\.js"],
        "source_patterns": [r"UA-\d{6,10}-\d{1,3}", r"ga\s*\(\s*['\"]create['\"]"],
        "id_pattern": r"UA-\d{6,10}-\d{1,3}",
    },
    "meta_pixel": {
        "name": "Meta Pixel (Facebook)",
        "vendor": "Meta",
        "type": "advertising",
        "privacy_risk": "critical",
        "data_collected": ["Browser fingerprint", "Purchase behaviour", "Cross-site remarketing"],
        "url_patterns": [r"connect\.facebook\.net.*fbevents\.js", r"facebook\.com/tr"],
        "source_patterns": [r"fbq\s*\(\s*['\"]init['\"]", r"facebook\.net/en_US/fbevents"],
        "id_pattern": r"fbq\s*\(\s*['\"]init['\"][\s\S]*?['\"](\d{15,16})['\"]",
    },
    "google_ads": {
        "name": "Google Ads Conversion",
        "vendor": "Google",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["Conversions", "Remarketing data", "Custom audiences"],
        "url_patterns": [r"googleads\.g\.doubleclick\.net", r"googleadservices\.com", r"google\.com/pagead"],
        "source_patterns": [r"AW-\d{9,11}", r"gtag\s*\(\s*['\"]event['\"][\s\S]*?['\"]conversion['\"]"],
        "id_pattern": r"AW-\d{9,11}",
    },
    "floodlight": {
        "name": "Google Floodlight",
        "vendor": "Google",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["Conversions", "Remarketing"],
        "url_patterns": [r"fls\.doubleclick\.net", r"ad\.doubleclick\.net/ddm"],
        "source_patterns": [r"DC-\d{7,12}", r"doubleclick\.net/pagead/conversion"],
        "id_pattern": r"DC-\d{7,12}",
    },
    "hotjar": {
        "name": "Hotjar",
        "vendor": "Hotjar",
        "type": "heatmap",
        "privacy_risk": "critical",
        "data_collected": ["Session recordings", "Heatmaps", "Form data"],
        "url_patterns": [r"static\.hotjar\.com", r"vars\.hotjar\.com", r"insights\.hotjar\.com"],
        "source_patterns": [r"hjid\s*:", r"hj\s*\(\s*['\"]trigger['\"]", r"hotjar\.com"],
        "id_pattern": r"hjid\s*:\s*(\d{5,})",
    },
    "clarity": {
        "name": "Microsoft Clarity",
        "vendor": "Microsoft",
        "type": "heatmap",
        "privacy_risk": "high",
        "data_collected": ["Session recordings", "Click maps", "Scroll depth"],
        "url_patterns": [r"clarity\.ms/tag", r"clarity\.ms/collect"],
        "source_patterns": [r"clarity\s*\(\s*['\"]set['\"]", r"clarity\.ms"],
        "id_pattern": r"clarity\s*\(\s*['\"]set['\"][\s\S]*?['\"]([a-z0-9]{10,})['\"]",
    },
    "tiktok_pixel": {
        "name": "TikTok Pixel",
        "vendor": "TikTok",
        "type": "advertising",
        "privacy_risk": "critical",
        "data_collected": ["Conversion events", "Remarketing", "Audiences"],
        "url_patterns": [r"analytics\.tiktok\.com", r"analytics\.tiktok\.com/api"],
        "source_patterns": [r"ttq\.track", r"ttq\.identify", r"ttq\.load"],
        "id_pattern": None,
    },
    "linkedin_insight": {
        "name": "LinkedIn Insight Tag",
        "vendor": "LinkedIn",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["B2B conversions", "Professional remarketing"],
        "url_patterns": [r"snap\.licdn\.com", r"linkedin\.com/px", r"px\.ads\.linkedin\.com"],
        "source_patterns": [r"_linkedin_partner_id"],
        "id_pattern": r"_linkedin_partner_id\s*=\s*['\"]?(\d+)",
    },
    "pinterest": {
        "name": "Pinterest Tag",
        "vendor": "Pinterest",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["Conversions", "Remarketing", "Interest audiences"],
        "url_patterns": [r"s\.pinimg\.com/ct/core\.js", r"ct\.pinterest\.com"],
        "source_patterns": [r"pintrk\s*\(", r"pinterest\.com/ct/"],
        "id_pattern": None,
    },
    "twitter_x_pixel": {
        "name": "Twitter/X Pixel",
        "vendor": "Twitter/X",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["Conversions", "Tailored audiences", "Remarketing"],
        "url_patterns": [r"static\.ads-twitter\.com", r"t\.co/i/adsct", r"analytics\.twitter\.com"],
        "source_patterns": [r"twq\s*\(", r"twitter\.com/i/adsct"],
        "id_pattern": None,
    },
    "snapchat_pixel": {
        "name": "Snapchat Pixel",
        "vendor": "Snapchat",
        "type": "advertising",
        "privacy_risk": "high",
        "data_collected": ["Conversions", "Remarketing", "Snapchat audiences"],
        "url_patterns": [r"sc-static\.net/scevent\.min\.js", r"tr\.snapchat\.com"],
        "source_patterns": [r"snaptr\s*\(", r"tr\.snapchat\.com"],
        "id_pattern": None,
    },
    "segment": {
        "name": "Segment",
        "vendor": "Twilio",
        "type": "analytics",
        "privacy_risk": "high",
        "data_collected": ["Custom events", "User identity", "Navigation properties"],
        "url_patterns": [r"cdn\.segment\.com", r"api\.segment\.io"],
        "source_patterns": [r"analytics\.identify\s*\(", r"analytics\.track\s*\(", r"analytics\.load\s*\(", r"analytics\.page\s*\("],
        "id_pattern": None,
    },
    "amplitude": {
        "name": "Amplitude",
        "vendor": "Amplitude",
        "type": "analytics",
        "privacy_risk": "high",
        "data_collected": ["Product events", "Cohorts", "User journey"],
        "url_patterns": [r"cdn\.amplitude\.com", r"api\.amplitude\.com", r"api2\.amplitude\.com"],
        "source_patterns": [r"amplitude\.getInstance", r"amplitude\.logEvent"],
        "id_pattern": None,
    },
    "mixpanel": {
        "name": "Mixpanel",
        "vendor": "Mixpanel",
        "type": "analytics",
        "privacy_risk": "high",
        "data_collected": ["Product events", "User profile", "Funnels"],
        "url_patterns": [r"cdn\.mxpnl\.com", r"api\.mixpanel\.com"],
        "source_patterns": [r"mixpanel\.init\s*\(", r"mixpanel\.track\s*\("],
        "id_pattern": None,
    },
    "fullstory": {
        "name": "FullStory",
        "vendor": "FullStory",
        "type": "heatmap",
        "privacy_risk": "critical",
        "data_collected": ["High-fidelity session recordings", "Console logs"],
        "url_patterns": [r"fullstory\.com/s/fs\.js", r"edge\.fullstory\.com"],
        "source_patterns": [r"FS\.identify\s*\(", r"_fs_debug"],
        "id_pattern": None,
    },
    "mouseflow": {
        "name": "Mouseflow",
        "vendor": "Mouseflow",
        "type": "heatmap",
        "privacy_risk": "critical",
        "data_collected": ["Screen recording", "Mouse movement", "Keystrokes"],
        "url_patterns": [r"cdn\.mouseflow\.com"],
        "source_patterns": [r"mouseflow\s*\(", r"_mfq\.push"],
        "id_pattern": None,
    },
    "heap": {
        "name": "Heap Analytics",
        "vendor": "Heap",
        "type": "analytics",
        "privacy_risk": "critical",
        "data_collected": ["Auto-tracking of all events", "Sessions", "User behaviour"],
        "url_patterns": [r"heapanalytics\.com"],
        "source_patterns": [r"heap\.load\s*\(", r"heap-analytics\.com"],
        "id_pattern": None,
    },
    "hubspot": {
        "name": "HubSpot",
        "vendor": "HubSpot",
        "type": "marketing",
        "privacy_risk": "high",
        "data_collected": ["Leads", "Forms", "Email tracking", "Chat"],
        "url_patterns": [r"js\.hs-scripts\.com", r"js\.hs-analytics\.net"],
        "source_patterns": [r"hbspt\.forms", r"hubspot"],
        "id_pattern": None,
    },
    "intercom": {
        "name": "Intercom",
        "vendor": "Intercom",
        "type": "support",
        "privacy_risk": "high",
        "data_collected": ["Chat messages", "Email", "User name", "Navigation data"],
        "url_patterns": [r"widget\.intercom\.io"],
        "source_patterns": [r"Intercom\s*\(", r"intercomSettings"],
        "id_pattern": None,
    },
    "cookiebot": {
        "name": "Cookiebot",
        "vendor": "Usercentrics",
        "type": "consent",
        "privacy_risk": "none",
        "data_collected": ["Consent preferences"],
        "url_patterns": [r"consent\.cookiebot\.com"],
        "source_patterns": [r"Cookiebot", r"CookieConsent"],
        "id_pattern": None,
    },
    "onetrust": {
        "name": "OneTrust",
        "vendor": "OneTrust",
        "type": "consent",
        "privacy_risk": "none",
        "data_collected": ["Consent preferences"],
        "url_patterns": [r"cdn\.cookielaw\.org", r"optanon\.net"],
        "source_patterns": [r"OptanonWrapper", r"OneTrust"],
        "id_pattern": None,
    },
    "didomi": {
        "name": "Didomi",
        "vendor": "Didomi",
        "type": "consent",
        "privacy_risk": "none",
        "data_collected": ["Consent preferences"],
        "url_patterns": [r"sdk\.privacy-center\.org"],
        "source_patterns": [r"Didomi\.ready", r"didomiConfig"],
        "id_pattern": None,
    },
    "usercentrics": {
        "name": "Usercentrics",
        "vendor": "Usercentrics",
        "type": "consent",
        "privacy_risk": "none",
        "data_collected": ["Consent preferences"],
        "url_patterns": [r"app\.usercentrics\.eu"],
        "source_patterns": [r"UC_UI", r"usercentrics\.eu"],
        "id_pattern": None,
    },
    "vwo": {
        "name": "VWO (Visual Website Optimizer)",
        "vendor": "Wingify",
        "type": "ab_testing",
        "privacy_risk": "high",
        "data_collected": ["Test variations", "Click recordings", "Visitor ID"],
        "url_patterns": [r"dev\.visualwebsiteoptimizer\.com"],
        "source_patterns": [r"_vwo_uuid", r"vwo\.event"],
        "id_pattern": None,
    },
    "optimizely": {
        "name": "Optimizely",
        "vendor": "Optimizely",
        "type": "ab_testing",
        "privacy_risk": "high",
        "data_collected": ["Experiments", "Event data", "User attributes"],
        "url_patterns": [r"cdn\.optimizely\.com"],
        "source_patterns": [r"optimizely\s*\(", r"window\.optimizely"],
        "id_pattern": None,
    },
    "crazyegg": {
        "name": "Crazy Egg",
        "vendor": "Crazy Egg",
        "type": "heatmap",
        "privacy_risk": "high",
        "data_collected": ["Heatmaps", "Session recordings"],
        "url_patterns": [r"script\.crazyegg\.com"],
        "source_patterns": [r"crazyegg"],
        "id_pattern": None,
    },
    "adobe_analytics": {
        "name": "Adobe Analytics",
        "vendor": "Adobe",
        "type": "analytics",
        "privacy_risk": "high",
        "data_collected": ["Pageviews", "Events", "eVars", "Props"],
        "url_patterns": [r"omtrdc\.net", r"sc\.omtrdc\.net"],
        "source_patterns": [r"AppMeasurement", r"s\.t\s*\(\)"],
        "id_pattern": None,
    },
    "zendesk": {
        "name": "Zendesk",
        "vendor": "Zendesk",
        "type": "support",
        "privacy_risk": "medium",
        "data_collected": ["Support tickets", "Email", "Chat history"],
        "url_patterns": [r"static\.zdassets\.com"],
        "source_patterns": [r"zE\s*\(", r"zESettings"],
        "id_pattern": None,
    },
    "criteo": {
        "name": "Criteo",
        "vendor": "Criteo",
        "type": "advertising",
        "privacy_risk": "critical",
        "data_collected": ["Retargeting", "Purchase behaviour", "Products viewed"],
        "url_patterns": [r"static\.criteo\.net", r"criteo\.com", r"sslwidget\.criteo\.com", r"dis\.criteo\.com"],
        "source_patterns": [r"criteo_q\.push", r"Criteo\.events"],
        "id_pattern": None,
    },
    "rd_station": {
        "name": "RD Station",
        "vendor": "RD Station",
        "type": "marketing",
        "privacy_risk": "high",
        "data_collected": ["Lead identification", "Email", "Navigation behaviour", "Conversion forms"],
        "url_patterns": [r"d335luupugsy2\.cloudfront\.net", r"rdstation\.com\.br", r"rd-station"],
        "source_patterns": [r"RDStationForms", r"rdstation", r"_rdsts"],
        "id_pattern": None,
    },
    "klaviyo": {
        "name": "Klaviyo",
        "vendor": "Klaviyo",
        "type": "marketing",
        "privacy_risk": "high",
        "data_collected": ["E-commerce data", "Purchase behaviour tracking"],
        "url_patterns": [r"static\.klaviyo\.com"],
        "source_patterns": [r"klaviyo\s*\(", r"_learnq\.push"],
        "id_pattern": None,
    },
    "braze": {
        "name": "Braze",
        "vendor": "Braze",
        "type": "marketing",
        "privacy_risk": "high",
        "data_collected": ["Push notifications", "User attributes", "App events"],
        "url_patterns": [r"sdk\.braze\.com", r"braze\.com/api"],
        "source_patterns": [r"appboy\.initialize", r"braze\.initialize"],
        "id_pattern": None,
    },
    "pardot": {
        "name": "Salesforce Pardot",
        "vendor": "Salesforce",
        "type": "marketing",
        "privacy_risk": "high",
        "data_collected": ["B2B leads", "Scoring", "Email tracking"],
        "url_patterns": [r"pi\.pardot\.com"],
        "source_patterns": [r"piAId", r"pardot\.com/pd\.js"],
        "id_pattern": None,
    },
    "drift": {
        "name": "Drift",
        "vendor": "Drift",
        "type": "support",
        "privacy_risk": "high",
        "data_collected": ["Chat conversations", "Company identification (IP)"],
        "url_patterns": [r"js\.driftt\.com"],
        "source_patterns": [r"driftt\.push", r"drift\.on"],
        "id_pattern": None,
    },
}


def _extract_id(html: str, pattern: Optional[str]) -> Optional[str]:
    """Extract a vendor tracking ID from HTML using the vendor's ID pattern."""
    if not pattern:
        return None
    m = re.search(pattern, html, re.IGNORECASE | re.DOTALL)
    if m:
        try:
            return m.group(1)
        except IndexError:
            return m.group(0)[:40]
    return None


def _find_line_number(html: str, position: int) -> int:
    return html[:position].count("\n") + 1


def _extract_source_block(html_lines: List[str], line_number: int, context: int = 3) -> Optional[str]:
    """Extract ± context lines around a given line number. Returns None if not possible."""
    if not html_lines or line_number < 1:
        return None
    start = max(0, line_number - 1 - context)
    end   = min(len(html_lines), line_number + context)
    return "\n".join(html_lines[start:end])


# ─────────────────────────────────────────────
# Rastreamento em domínio próprio (server-side / first-party)
#
# GA4 server-side e o gateway da CAPI da Meta rodam em subdomínio do próprio
# cliente (metrics.loja.com.br), justamente para escapar de bloqueadores — e
# escapavam também desta auditoria, que casa por domínio do fornecedor.
# A identificação aqui é pelo FORMATO do payload, que a plataforma não muda:
# é o mesmo protocolo, só o host é outro.
# ─────────────────────────────────────────────
ASSINATURAS_DE_PAYLOAD = [
    {
        "vendor_id": "ga4",
        "nome": "Google Analytics 4 (server-side / domínio próprio)",
        "caminho": re.compile(r"/(g|mp|j)/collect", re.IGNORECASE),
        "exigidos": [re.compile(r"[?&]v=2(&|$)"), re.compile(r"[?&]tid=G-", re.IGNORECASE)],
    },
    {
        "vendor_id": "meta_pixel",
        "nome": "Meta Pixel (CAPI gateway / domínio próprio)",
        "caminho": re.compile(r"/tr/?(\?|$)", re.IGNORECASE),
        "exigidos": [re.compile(r"[?&]id=\d{10,}"), re.compile(r"[?&]ev=", re.IGNORECASE)],
    },
    {
        # O container em si, servido pelo servidor do cliente. É a assinatura
        # mais direta de sGTM: o arquivo que só o googletagmanager.com deveria
        # servir vem de um subdomínio do próprio site.
        "vendor_id": "gtm",
        "nome": "Google Tag Manager server-side (container em domínio próprio)",
        "caminho": re.compile(r"/gtm\.js(\?|$)", re.IGNORECASE),
        "exigidos": [re.compile(r"[?&]id=GTM-", re.IGNORECASE)],
    },
    {
        "vendor_id": "ga4",
        "nome": "Google Analytics 4 (carregador em domínio próprio)",
        "caminho": re.compile(r"/gtag/js(\?|$)", re.IGNORECASE),
        "exigidos": [re.compile(r"[?&]id=(G|AW|DC)-", re.IGNORECASE)],
    },
]

# Hosts oficiais: se o pedido saiu para cá, já foi detectado pelo caminho normal
_HOSTS_OFICIAIS = re.compile(
    r"(google-analytics|googletagmanager|analytics\.google|facebook\.com|facebook\.net)",
    re.IGNORECASE,
)

#: Cookies que só um servidor de tagueamento grava.
#:
#: A diferença importa para o laudo: `_ga` é escrito pelo JavaScript no
#: navegador e some quando o script é bloqueado; `FPID` é gravado pelo servidor
#: via Set-Cookie, sobrevive a bloqueador de anúncio e às restrições de vida
#: útil que o Safari impõe a cookie de script. É a marca de que o cliente montou
#: infraestrutura para não ser bloqueado — e, num laudo, isso muda a conversa:
#: não é configuração descuidada, é decisão de arquitetura.
COOKIES_DE_SERVIDOR = {
    "FPID": "Identificador first-party do GA4 server-side, gravado pelo servidor",
    "FPLC": "Cookie de ligação do GA4 server-side entre domínios",
    "FPGSID": "Identificador de sessão do GA4 server-side",
    "FPGCLAW": "Identificador de clique do Google Ads em first-party",
    "FPGCLGB": "Identificador de clique do Google Ads em first-party",
    "_sst_session": "Sessão de tagueamento server-side",
}


def detectar_cookies_de_servidor(scan) -> List[dict]:
    """Cookies que denunciam tagueamento server-side, mesmo sem requisição visível.

    Um sGTM com carregador personalizado (o produto que Stape e concorrentes
    vendem) usa caminho aleatório justamente para não casar com padrão nenhum —
    não há URL para reconhecer. O cookie, porém, precisa manter o nome que o
    GA4 espera ler.
    """
    achados: List[dict] = []
    vistos = set()
    for cookie in (getattr(scan, "cookies", None) or []):
        if not isinstance(cookie, dict):
            continue
        nome = str(cookie.get("name") or "")
        descricao = COOKIES_DE_SERVIDOR.get(nome)
        if not descricao or nome in vistos:
            continue
        vistos.add(nome)
        achados.append({
            "nome": nome,
            "descricao": descricao,
            "dominio": cookie.get("domain") or "",
            "http_only": bool(cookie.get("httpOnly")),
        })
    return achados


def detectar_rastreamento_em_dominio_proprio(scan) -> List[dict]:
    """Requisições com assinatura de rastreador, mas em host que não é do fornecedor."""
    achados: List[dict] = []
    vistos = set()

    for req in (getattr(scan, "intercepted_requests", None) or []):
        url = getattr(req, "url", "") or ""
        if not url or _HOSTS_OFICIAIS.search(url):
            continue
        for assinatura in ASSINATURAS_DE_PAYLOAD:
            if not assinatura["caminho"].search(url):
                continue
            if all(padrao.search(url) for padrao in assinatura["exigidos"]):
                from urllib.parse import urlparse as _parse
                host = _parse(url).netloc
                chave = (assinatura["vendor_id"], host)
                if chave in vistos:
                    continue
                vistos.add(chave)
                achados.append({
                    "vendor_id": assinatura["vendor_id"],
                    "nome": assinatura["nome"],
                    "host": host,
                    "url": url[:200],
                })
    return achados


def detect_tags(html: str, scan=None) -> List[TagFinding]:
    """
    Multi-method tag detection engine.
    Returns de-duplicated list of TagFinding objects ordered by source position.

    Layers:
      1. HTML script src URL match (HIGH)
      2. HTML source pattern match (MEDIUM)
      3. Network request interception (HIGH) — from BrowserScanResult
      4. Window global key detection (MEDIUM) — from BrowserScanResult
    """
    if not html:
        html = ""

    soup = BeautifulSoup(html, "html.parser")
    html_lines = html.split("\n")

    # Collect all external script src attributes
    # A busca avança o offset a cada script: com re.search a partir do início,
    # dois <script> de mesmo src recebiam a MESMA posição — o relatório
    # apontava sempre a primeira linha, e o mesmo snippet colado duas vezes
    # (que carrega a tag duas vezes) era contado como uma instalação só.
    script_srcs: List[tuple] = []  # (src, position_in_html, line_number)
    _offset_por_src: dict = {}
    for script in soup.find_all("script", src=True):
        src = script.get("src", "")
        escaped = re.escape(src[:50])
        inicio = _offset_por_src.get(src, 0)
        m = re.search(escaped, html[inicio:]) if inicio < len(html) else None
        if m:
            pos = inicio + m.start()
            _offset_por_src[src] = pos + max(1, len(src[:50]))
        else:
            pos = 0
        line = _find_line_number(html, pos)
        script_srcs.append((src, pos, line))

    # Also add browser-captured script URLs (loaded dynamically)
    if scan and hasattr(scan, "all_script_urls"):
        for src in scan.all_script_urls:
            script_srcs.append((src, 0, None))

    findings: dict[str, TagFinding] = {}   # keyed by vendor id

    for vendor_id, vendor in VENDOR_CATALOG.items():
        best_confidence = None
        best_method = None
        best_position = 0
        best_line = None
        best_block = None
        best_pattern_matched = None
        # Instalações distintas, não número de padrões que casaram. Somar os
        # três níveis contava a MESMA tag várias vezes: o snippet padrão do GA4
        # casa por URL do script e por padrão no código, o que dava
        # occurrence_count=2 para uma única instalação correta — e o
        # duplicate_detector acusava "GA4 duplicado, consolide" num site que
        # não tinha duplicata nenhuma.
        # Conta elementos <script> distintos do HTML — por posição, não por URL:
        # o mesmo snippet colado duas vezes carrega a tag duas vezes e é
        # duplicata de verdade.
        posicoes_de_script = set()
        ids_distintos = set()    # IDs de conta distintos no HTML (G-…, GTM-…, AW-…)

        # ── 1. URL-based detection (HIGH confidence) ─────────────────────────
        for url_pat in vendor.get("url_patterns", []):
            for src, pos, line in script_srcs:
                if re.search(url_pat, src, re.IGNORECASE):
                    posicoes_de_script.add((src, pos))
                    if best_confidence != CONFIDENCE_HIGH:
                        best_confidence = CONFIDENCE_HIGH
                        best_method = DETECT_SCRIPT_URL
                        best_position = pos
                        best_line = line
                        best_block = _extract_source_block(html_lines, line) if line else None
                        best_pattern_matched = src[:80]

        # ── 2. Source pattern detection (MEDIUM confidence) ───────────────────
        for src_pat in vendor.get("source_patterns", []):
            matches = list(re.finditer(src_pat, html, re.IGNORECASE))
            if matches:
                for m in matches:
                    pos = m.start()
                    line = _find_line_number(html, pos)
                    if best_confidence is None:
                        best_confidence = CONFIDENCE_MEDIUM
                        best_method = DETECT_SOURCE
                        best_position = pos
                        best_line = line
                        best_block = _extract_source_block(html_lines, line)
                        best_pattern_matched = m.group(0)[:80]

        # ── 3. Network request detection (HIGH confidence) ────────────────────
        if scan and hasattr(scan, "intercepted_requests"):
            for req in scan.intercepted_requests:
                for url_pat in vendor.get("url_patterns", []):
                    if re.search(url_pat, req.url, re.IGNORECASE):
                        # A rede prova que a tag disparou, mas NÃO é uma
                        # instalação a mais: uma única tag gera dezenas de
                        # requisições. Contá-las inflava a duplicata.
                        best_confidence = CONFIDENCE_HIGH
                        best_method = DETECT_NETWORK
                        if not best_pattern_matched:
                            best_pattern_matched = req.url[:80]
                        break

        # Skip if no match found at all
        if best_confidence is None:
            continue

        # Extract tag ID from HTML
        tag_id = _extract_id(html, vendor.get("id_pattern"))

        # Quantas contas distintas deste vendor aparecem na página. Dois IDs
        # diferentes (dois G-…) são duplicata de verdade; o mesmo ID repetido
        # no src e no gtag('config') é uma instalação só.
        id_pattern = vendor.get("id_pattern")
        if id_pattern:
            ids_distintos = {m.group(0) for m in re.finditer(id_pattern, html, re.IGNORECASE)}

        # Se a tag foi vista só pela rede, o ID está na URL da requisição — era
        # procurado apenas no HTML, e o relatório saía sem dizer qual conta.
        if not tag_id and id_pattern and scan and hasattr(scan, "intercepted_requests"):
            for req in scan.intercepted_requests:
                for url_pat in vendor.get("url_patterns", []):
                    if re.search(url_pat, req.url, re.IGNORECASE):
                        achado = re.search(id_pattern, req.url, re.IGNORECASE)
                        if achado:
                            tag_id = achado.group(0)
                            ids_distintos.add(tag_id)
                        break
                if tag_id:
                    break

        occurrence_count = max(len(posicoes_de_script), len(ids_distintos), 1)

        finding = TagFinding(
            id=vendor_id,
            name=vendor["name"],
            vendor=vendor["vendor"],
            type=vendor["type"],
            confidence=best_confidence,
            detection_method=best_method,
            occurrence_count=occurrence_count,
            line_number=best_line,
            source_block=best_block,
            matched_pattern=best_pattern_matched,
            tag_id=tag_id,
            data_collected=vendor["data_collected"],
            privacy_risk=vendor["privacy_risk"],
            position=best_position,
        )

        findings[vendor_id] = finding

    # ── 4. Rastreamento em domínio próprio (server-side / CAPI gateway) ──────
    # Detectado pela assinatura do payload: o host é do cliente, mas o
    # protocolo é o do fornecedor. Sem isto, a auditoria dava o site como
    # limpo justamente onde o rastreamento foi montado para não ser visto.
    for achado in detectar_rastreamento_em_dominio_proprio(scan) if scan else []:
        vendor_id = achado["vendor_id"]
        vendor = VENDOR_CATALOG.get(vendor_id, {})
        ja_detectada = findings.get(vendor_id)
        if ja_detectada is not None:
            # a mesma tag já apareceu pelo caminho normal: registra o host próprio
            ja_detectada.matched_pattern = (
                f"{ja_detectada.matched_pattern or ''} | first-party: {achado['host']}"
            )[:200]
            continue

        findings[vendor_id] = TagFinding(
            id=vendor_id,
            name=achado["nome"],
            vendor=vendor.get("vendor", "Desconhecido"),
            type=vendor.get("type", "analytics"),
            confidence=CONFIDENCE_HIGH,   # payload no formato do fornecedor
            detection_method=DETECT_NETWORK,
            occurrence_count=1,
            line_number=None,
            source_block=None,
            matched_pattern=achado["url"],
            tag_id=None,
            data_collected=vendor.get("data_collected", ["Dados de navegação"]),
            privacy_risk=vendor.get("privacy_risk", "high"),
            position=10_000_000,   # sem posição no HTML: vai para o fim da lista
        )

    # ── 5. Tagueamento server-side denunciado por cookie ─────────────────────
    # Último recurso, e o que fecha o buraco mais caro: com carregador
    # personalizado o caminho da requisição é aleatório de propósito, então não
    # há URL para reconhecer. O cookie precisa manter o nome que o GA4 espera
    # ler — e é gravado pelo servidor, não pelo script.
    cookies_de_servidor = detectar_cookies_de_servidor(scan) if scan else []
    if cookies_de_servidor:
        nomes = ", ".join(c["nome"] for c in cookies_de_servidor)
        dominios = {c["dominio"] for c in cookies_de_servidor if c["dominio"]}
        evidencia = f"Cookies gravados pelo servidor: {nomes}"
        if dominios:
            evidencia += f" (domínio {', '.join(sorted(dominios))})"

        ja = findings.get("gtm")
        if ja is not None and "server-side" in (ja.name or ""):
            ja.matched_pattern = f"{ja.matched_pattern or ''} | {evidencia}"[:200]
        else:
            vendor = VENDOR_CATALOG.get("ga4", {})
            findings["sgtm_first_party"] = TagFinding(
                id="sgtm_first_party",
                name="Tagueamento server-side em domínio próprio",
                vendor=vendor.get("vendor", "Google"),
                type="analytics",
                confidence=CONFIDENCE_HIGH,
                detection_method=DETECT_NETWORK,
                occurrence_count=1,
                line_number=None,
                source_block=None,
                matched_pattern=evidencia[:200],
                tag_id=None,
                data_collected=[
                    "Identificador persistente gravado pelo servidor",
                    "Dados de navegação encaminhados a partir do servidor do site",
                ],
                # Alto e não crítico: server-side é técnica legítima. O que a
                # torna grave é a combinação com ausência de consentimento, e
                # isso quem avalia é o privacy_analyzer.
                privacy_risk="high",
                position=10_000_001,
            )

    # Sort by source position (network-intercepted go after HTML-detected)
    return sorted(findings.values(), key=lambda f: f.position)

