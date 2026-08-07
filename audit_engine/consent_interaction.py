"""audit_engine.consent_interaction — clica em "Recusar" e mede o que acontece depois.

Todas as ferramentas de auditoria medem um estado só: página carregada, nada
clicado. Mas a violação que as autoridades efetivamente punem é outra — o
usuário **recusa** e o rastreamento acontece assim mesmo.

O que este módulo permite afirmar, com evidência:

- se existe opção de recusar em pé de igualdade com a de aceitar
  (banner só com "Aceitar" é dark pattern vedado pela LGPD e pelo EDPB);
- o que foi gravado ou enviado DEPOIS da recusa — cookie novo ou requisição a
  endpoint de rastreio nesse ponto é violação com o consentimento negado, não
  mero indício de má configuração.

Os seletores cobrem os CMPs mais usados no Brasil e o caso mais comum de todos:
o banner caseiro, atacado por texto do botão.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Seletores de "recusar" por CMP. Ordem importa: o primeiro que existir e
# estiver visível é usado.
SELETORES_DE_RECUSA = [
    # Cookiebot
    ("Cookiebot", "#CybotCookiebotDialogBodyButtonDecline"),
    ("Cookiebot", "#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll"),
    ("Cookiebot", "#CybotCookiebotDialogBodyButtonReject"),
    # OneTrust
    ("OneTrust", "#onetrust-reject-all-handler"),
    ("OneTrust", ".ot-pc-refuse-all-handler"),
    ("OneTrust", "button.ot-sdk-button.reject-all"),
    # Didomi
    ("Didomi", "#didomi-notice-disagree-button"),
    ("Didomi", ".didomi-continue-without-agreeing"),
    ("Didomi", "button[aria-label*='Recusar' i]"),
    # Usercentrics
    ("Usercentrics", "[data-testid='uc-deny-all-button']"),
    ("Usercentrics", "#uc-btn-deny-banner"),
    ("Usercentrics", "button[data-action='deny']"),
    # Osano
    ("Osano", ".osano-cm-denyAll"),
    ("Osano", ".osano-cm-button--type_denyAll"),
    # Quantcast / IAB TCF
    ("Quantcast", ".qc-cmp2-summary-buttons button[mode='secondary']"),
    ("Quantcast", "button.css-1hy2vtq"),
    # Termly
    ("Termly", "#termly-code-snippet-support .t-declineAllButton"),
    ("Termly", "[data-tid='banner-decline']"),
    # Iubenda
    ("Iubenda", ".iubenda-cs-reject-btn"),
    ("Iubenda", "#iubFooterBtnIab"),
    # Complianz (WordPress)
    ("Complianz", ".cmplz-deny"),
    ("Complianz", "button.cmplz-btn.cmplz-deny"),
    # Cookie Notice / CookieYes (muito comum em WordPress no Brasil)
    ("CookieYes", ".cky-btn-reject"),
    ("CookieYes", "[data-cky-tag='reject-button']"),
    ("Cookie Notice", "#cn-refuse-cookie"),
    # Klaro
    ("Klaro", ".cm-btn-decline"),
    ("Klaro", ".cn-decline"),
    # Google Funding Choices
    ("Funding Choices", ".fc-cta-do-not-consent"),
]

# Banner caseiro: sem seletor conhecido, sobra o texto do botão.
TEXTOS_DE_RECUSA = [
    "recusar tudo", "rejeitar tudo", "recusar todos", "rejeitar todos",
    "continuar sem aceitar", "continuar sem concordar",
    "apenas necessários", "somente necessários", "apenas essenciais",
    "somente essenciais", "usar apenas necessários",
    "recusar", "rejeitar", "não aceito", "nao aceito", "discordo",
    "reject all", "decline all", "refuse all", "deny all",
    "reject", "decline", "only necessary", "necessary only",
    "continue without accepting", "manage preferences",
]

# Texto que indica opção de ACEITAR — usado para detectar o dark pattern de
# banner que só oferece o caminho do "sim".
TEXTOS_DE_ACEITE = [
    "aceitar tudo", "aceitar todos", "aceitar", "concordo", "permitir",
    "accept all", "allow all", "accept", "agree", "got it", "entendi", "ok",
]


@dataclass
class ResultadoDaRecusa:
    """O que se observou ao recusar — ou ao tentar recusar."""
    tentado: bool = False
    conseguiu_recusar: bool = False
    cmp_identificado: Optional[str] = None
    seletor_usado: Optional[str] = None
    metodo: Optional[str] = None          # seletor_conhecido | texto_do_botao

    # Dark pattern: banner sem caminho de recusa em pé de igualdade
    tem_opcao_de_aceitar: bool = False
    tem_opcao_de_recusar: bool = False
    rotulos_encontrados: List[str] = field(default_factory=list)

    # Estado observado DEPOIS da recusa
    cookies_apos_recusa: List[Dict[str, Any]] = field(default_factory=list)
    requisicoes_apos_recusa: List[Dict[str, Any]] = field(default_factory=list)
    storage_apos_recusa: Dict[str, str] = field(default_factory=dict)

    motivo_da_falha: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "attempted": self.tentado,
            "rejected": self.conseguiu_recusar,
            "cmp": self.cmp_identificado,
            "selector": self.seletor_usado,
            "method": self.metodo,
            "hasAcceptOption": self.tem_opcao_de_aceitar,
            "hasRejectOption": self.tem_opcao_de_recusar,
            "buttonLabels": self.rotulos_encontrados,
            "cookiesAfterRejection": self.cookies_apos_recusa,
            "requestsAfterRejection": self.requisicoes_apos_recusa,
            "storageAfterRejection": self.storage_apos_recusa,
            "failureReason": self.motivo_da_falha,
        }


def _normaliza(texto: str) -> str:
    """Minúsculas, sem acento e sem espaço sobrando — para casar rótulo de botão."""
    if not texto:
        return ""
    texto = texto.strip().lower()
    for de, para in (("á", "a"), ("à", "a"), ("ã", "a"), ("â", "a"), ("é", "e"),
                     ("ê", "e"), ("í", "i"), ("ó", "o"), ("ô", "o"), ("õ", "o"),
                     ("ú", "u"), ("ç", "c")):
        texto = texto.replace(de, para)
    return re.sub(r"\s+", " ", texto)


def _casa_termo(rotulo_normalizado: str, termo: str) -> bool:
    """O rótulo significa este termo?

    Substring solta produz desastre: "reject" casa dentro da manchete
    "Man City reject Barcelona's bid" e "ok" casa dentro de "facebook" — o
    scanner clicava numa notícia e reportava que havia recusado.

    Regra: termo de uma palavra só vale se for o rótulo inteiro (tolerando
    pontuação). Termo de duas ou mais palavras é específico o bastante para
    valer como trecho, mas ainda dentro de um rótulo curto.
    """
    termo = _normaliza(termo)
    if not termo:
        return False

    limpo = re.sub(r"[^\w\s]", "", rotulo_normalizado).strip()

    if " " in termo:
        # "continuar sem aceitar", "apenas necessarios" — específico
        return termo in rotulo_normalizado and len(rotulo_normalizado) <= 45
    # palavra única: só vale se o botão for exatamente ela
    return limpo == termo


def classifica_rotulo(texto: str) -> Optional[str]:
    """"recusar" | "aceitar" | None para o rótulo de um botão."""
    t = _normaliza(texto)
    # rótulo de botão de consentimento é curto; frase longa é conteúdo da página
    if not t or len(t) > 45:
        return None
    for termo in TEXTOS_DE_RECUSA:
        if _casa_termo(t, termo):
            return "recusar"
    for termo in TEXTOS_DE_ACEITE:
        if _casa_termo(t, termo):
            return "aceitar"
    return None


# JS que varre os botões visíveis da página e devolve os rótulos. Roda no
# contexto da página porque banner costuma viver em iframe ou shadow DOM, e o
# seletor CSS puro não alcança.
JS_COLETA_BOTOES = """
() => {
    const rotulos = [];
    const seletores = 'button, a[role="button"], [role="button"], input[type="button"], input[type="submit"], .btn, [class*="button"]';
    const visivel = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return false;
        const s = window.getComputedStyle(el);
        return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const coleta = (raiz) => {
        let nos = [];
        try { nos = raiz.querySelectorAll(seletores); } catch (e) { return; }
        for (const el of nos) {
            if (!visivel(el)) continue;
            const t = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim();
            if (t && t.length < 80) rotulos.push(t);
        }
        // shadow DOM: alguns CMPs renderizam o banner inteiro dentro dele
        try {
            for (const el of raiz.querySelectorAll('*')) {
                if (el.shadowRoot) coleta(el.shadowRoot);
            }
        } catch (e) {}
    };
    coleta(document);
    return rotulos.slice(0, 120);
}
"""


async def _clica_por_seletor(page, timeout_ms: int = 1200):
    """Tenta os seletores conhecidos, na ordem. Devolve (cmp, seletor) ou None."""
    for nome_cmp, seletor in SELETORES_DE_RECUSA:
        try:
            elemento = page.locator(seletor).first
            if await elemento.count() == 0:
                continue
            if not await elemento.is_visible(timeout=timeout_ms):
                continue
            await elemento.click(timeout=timeout_ms, force=True)
            return nome_cmp, seletor
        except Exception:
            continue
    return None


async def _clica_por_texto(page, rotulos_de_recusa: List[str], timeout_ms: int = 1200):
    """Banner caseiro: clica no botão cujo rótulo JÁ foi classificado como recusa.

    Recebe os rótulos prontos e casa por texto EXATO. A versão anterior montava
    uma regex com todos os termos e deixava o Playwright procurar: "reject"
    casava dentro da manchete "Man City reject Barcelona's bid", o scanner
    clicava na notícia, navegava para outra página e reportava recusa
    bem-sucedida — laudo errado com aparência de certo.

    Percorre também os iframes: Cookiebot, Quantcast e outros renderizam o
    banner dentro de um.
    """
    contextos = [page]
    try:
        contextos.extend(page.frames)
    except Exception:
        pass

    for rotulo in rotulos_de_recusa:
        for contexto in contextos:
            for papel in ("button", "link"):
                try:
                    elemento = contexto.get_by_role(papel, name=rotulo, exact=True).first
                    if await elemento.count() == 0:
                        continue
                    if not await elemento.is_visible(timeout=timeout_ms):
                        continue
                    await elemento.click(timeout=timeout_ms, force=True)
                    return rotulo
                except Exception:
                    continue
    return None


async def tentar_recusar(page, aguardar_ms: int = 3000) -> ResultadoDaRecusa:
    """Clica em "Recusar" e devolve o que foi observado.

    Não limpa cookie nem storage antes: o objetivo é justamente medir o que
    o site faz DEPOIS de o usuário negar consentimento.
    """
    resultado = ResultadoDaRecusa(tentado=True)

    # 1. Inventário dos botões — é o que sustenta a acusação de dark pattern
    try:
        rotulos = await page.evaluate(JS_COLETA_BOTOES)
    except Exception:
        rotulos = []

    rotulos_de_recusa: List[str] = []
    for rotulo in rotulos or []:
        classe = classifica_rotulo(rotulo)
        if classe == "recusar":
            resultado.tem_opcao_de_recusar = True
            resultado.rotulos_encontrados.append(rotulo)
            if rotulo not in rotulos_de_recusa:
                rotulos_de_recusa.append(rotulo)
        elif classe == "aceitar":
            resultado.tem_opcao_de_aceitar = True
            resultado.rotulos_encontrados.append(rotulo)

    # 2. Seletor conhecido do CMP
    achado = await _clica_por_seletor(page)
    if achado:
        resultado.cmp_identificado, resultado.seletor_usado = achado
        resultado.metodo = "seletor_conhecido"
        resultado.conseguiu_recusar = True
        resultado.tem_opcao_de_recusar = True
    else:
        # 3. Banner caseiro: pelo texto do botão já classificado como recusa
        rotulo = await _clica_por_texto(page, rotulos_de_recusa)
        if rotulo:
            resultado.seletor_usado = f"texto: {rotulo}"
            resultado.metodo = "texto_do_botao"
            resultado.conseguiu_recusar = True
            resultado.tem_opcao_de_recusar = True
        else:
            resultado.motivo_da_falha = (
                "Nenhum controle de recusa encontrado na página."
                if not resultado.tem_opcao_de_recusar
                else "Controle de recusa identificado, mas o clique não pôde ser executado."
            )

    if resultado.conseguiu_recusar:
        # Deixa o site reagir: é nessa janela que a tag mal configurada dispara.
        try:
            await page.wait_for_timeout(aguardar_ms)
        except Exception:
            pass

    return resultado
