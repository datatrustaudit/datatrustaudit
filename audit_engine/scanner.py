import asyncio
import json
import logging
import os
from typing import Dict, Any, List
from playwright.async_api import async_playwright

from audit_engine.url_guard import validate_public_url, is_public_url, UnsafeURLError

logger = logging.getLogger(__name__)

# Sandbox do Chromium: --no-sandbox desliga a barreira que separa o processo que
# renderiza a página do resto da máquina — e aqui o conteúdo renderizado é
# atacante em potencial (qualquer site que o usuário mandar auditar).
# Só é aceitável quando o contêiner já isola o processo. Mantenha
# CHROMIUM_NO_SANDBOX=0 (padrão) sempre que o ambiente permitir.
_NO_SANDBOX = os.getenv("CHROMIUM_NO_SANDBOX", "0") == "1"

_LAUNCH_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-gpu",
]
if _NO_SANDBOX:
    _LAUNCH_ARGS += ["--no-sandbox", "--disable-setuid-sandbox"]


class PlaywrightAuditScanner:
    def __init__(self, timeout_ms: int = 30000):
        self.timeout_ms = timeout_ms

    async def scan(self, url: str) -> Dict[str, Any]:
        """
        Executa um scan completo usando Playwright, capturando HTML,
        requições de rede (tags), dataLayer e console.
        """
        # Revalida aqui também: este método é chamado de vários pontos, e o
        # `https://` + url às cegas de antes deixava passar 169.254.169.254.
        url = validate_public_url(url)

        results = {
            "url": url,
            "html": "",
            "network_requests": [],
            "console_messages": [],
            "dataLayer": [],
            "error": None
        }

        async with async_playwright() as p:
            # Lançar browser (desabilitar headless para dev/debug se quiser, mas em prod = headless)
            browser = await p.chromium.launch(headless=True, args=_LAUNCH_ARGS)
            
            context = await browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 GTMAuditBot/2.0",
                ignore_https_errors=True
            )
            
            page = await context.new_page()

            # Bloqueio de SSRF no momento da conexão. Validar a URL na entrada
            # não basta: o site pode responder 302 para http://169.254.169.254/
            # (metadados da nuvem), e a página seguiria o redirect. Aqui a
            # checagem acontece a cada request, inclusive nos redirecionados —
            # e fecha também a janela de DNS rebinding, em que o domínio resolve
            # público na validação e interno na hora de conectar.
            async def _bloquear_destino_interno(route, request):
                # to_thread: getaddrinfo é síncrono e travaria o event loop a
                # cada recurso da página (o url_guard ainda cacheia por host).
                if await asyncio.to_thread(is_public_url, request.url):
                    await route.continue_()
                else:
                    logger.warning("SSRF bloqueado durante o scan de %s: %s", url, request.url)
                    await route.abort()

            await page.route("**/*", _bloquear_destino_interno)

            # Listeners
            page.on("request", lambda req: results["network_requests"].append({
                "url": req.url,
                "method": req.method,
                "resource_type": req.resource_type,
                "post_data": req.post_data
            }))

            page.on("console", lambda msg: results["console_messages"].append({
                "type": msg.type,
                "text": msg.text
            }))

            try:
                # Go to URL networkidle
                await page.goto(url, wait_until="networkidle", timeout=self.timeout_ms)
                
                # Scroll the page slightly to trigger lazy loading
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight/2)")
                await page.wait_for_timeout(2000)
                await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
                await page.wait_for_timeout(1000)

                # Capture final HTML
                results["html"] = await page.content()

                # Extract dataLayer
                dataLayer_js = "window.dataLayer || []"
                raw_dl = await page.evaluate(dataLayer_js)
                if isinstance(raw_dl, list):
                    results["dataLayer"] = raw_dl

            except Exception as e:
                logger.error(f"Erro no Playwright scan para {url}: {str(e)}")
                results["error"] = str(e)
                
                # fallback HTML capture if we failed partially
                try:
                    results["html"] = await page.content()
                except:
                    pass
            finally:
                await browser.close()

        return results
