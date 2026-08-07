"""audit_engine.storage_auditor — cookies, storage e ordem real de disparo.

Tudo aqui parte de um fato do scanner: **ele nunca clica em "aceitar"**. Logo,
qualquer cookie gravado, qualquer chave de storage e qualquer requisição a
endpoint de rastreamento observados durante a visita aconteceram SEM
consentimento. Isso é evidência direta, não indício por posição no HTML.

Três verificações que faltavam:

1. Cookies e localStorage de rastreamento gravados antes de qualquer aceite.
   O produto auditava "cookies" sem ler um cookie sequer.
2. Ordem REAL de disparo, pelo timestamp das requisições — o dado era coletado
   e descartado. Com ele dá para dizer "o pixel disparou aos 380ms".
3. `gtag('consent','default')` declarado DEPOIS do `gtag('config')`. O motor
   só checava se o Consent Mode existia; declarado fora de ordem ele não
   protege nada, e as tags disparam liberadas.
"""
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

# Cookies de rastreamento conhecidos → (dono, o que identificam)
COOKIES_DE_RASTREIO = {
    "_ga":        ("Google Analytics", "Identificador persistente do visitante"),
    "_gid":       ("Google Analytics", "Identificador de sessão"),
    "_gat":       ("Google Analytics", "Controle de taxa de envio"),
    "_gcl_au":    ("Google Ads", "Atribuição de conversão"),
    "_fbp":       ("Meta", "Identificador de navegador para remarketing"),
    "_fbc":       ("Meta", "Clique de anúncio atribuído"),
    "fr":         ("Meta", "Identificador de publicidade"),
    "_hjSession": ("Hotjar", "Sessão de gravação de tela"),
    "_hjid":      ("Hotjar", "Identificador persistente do usuário"),
    "_clck":      ("Microsoft Clarity", "Identificador do usuário"),
    "_clsk":      ("Microsoft Clarity", "Sessão de gravação"),
    "_ttp":       ("TikTok", "Identificador de publicidade"),
    "_tt_enable_cookie": ("TikTok", "Habilitação de rastreamento"),
    "li_sugr":    ("LinkedIn", "Identificador probabilístico"),
    "bcookie":    ("LinkedIn", "Identificador de navegador"),
    "_pin_unauth": ("Pinterest", "Identificador de visitante"),
    "_scid":      ("Snapchat", "Identificador de publicidade"),
    "IDE":        ("Google DoubleClick", "Publicidade direcionada"),
    "test_cookie": ("Google DoubleClick", "Teste de suporte a cookie"),
    "MUID":       ("Microsoft", "Identificador entre serviços"),
    "personalization_id": ("Twitter/X", "Personalização de anúncios"),
    "__rdtrk":    ("RD Station", "Identificador persistente de lead"),
    "_rdtrk":     ("RD Station", "Identificador persistente de lead"),
}

# Prefixos de chave de localStorage usados por rastreadores
STORAGE_DE_RASTREIO = {
    "_ga":         "Google Analytics",
    "amplitude":   "Amplitude",
    "mp_":         "Mixpanel",
    "ajs_":        "Segment",
    "__hstc":      "HubSpot",
    "hjActiveViewportIds": "Hotjar",
    "_hjid":       "Hotjar",
    "clarity":     "Microsoft Clarity",
    "intercom":    "Intercom",
}

DURACAO_LONGA_DIAS = 180  # acima disso, conservação questionável sob LGPD/GDPR


@dataclass
class AchadoDeArmazenamento:
    tipo: str               # cookie | localStorage | sessionStorage
    nome: str
    dono: str
    finalidade: str
    severidade: str         # critical | high | medium
    detalhe: str
    duracao_dias: Optional[float] = None
    http_only: bool = False
    dominio: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "type": self.tipo,
            "name": self.nome,
            "owner": self.dono,
            "purpose": self.finalidade,
            "severity": self.severidade,
            "detail": self.detalhe,
            "durationDays": self.duracao_dias,
            "httpOnly": self.http_only,
            "domain": self.dominio,
        }


@dataclass
class EventoDeRede:
    ordem: int
    ms_desde_o_inicio: int
    url: str
    dono: str

    def to_dict(self) -> Dict[str, Any]:
        return {
            "order": self.ordem,
            "msSincePageStart": self.ms_desde_o_inicio,
            "url": self.url,
            "owner": self.dono,
        }


@dataclass
class ResultadoDeArmazenamento:
    cookies_sem_consentimento: List[AchadoDeArmazenamento] = field(default_factory=list)
    storage_sem_consentimento: List[AchadoDeArmazenamento] = field(default_factory=list)
    linha_do_tempo: List[EventoDeRede] = field(default_factory=list)
    primeiro_disparo_ms: Optional[int] = None
    problemas_de_ordem: List[Dict[str, Any]] = field(default_factory=list)
    # Resultado de clicar em "Recusar": ver auditar_recusa()
    achados_da_recusa: List[Dict[str, Any]] = field(default_factory=list)
    recusa: Optional[Dict[str, Any]] = None

    @property
    def total_achados(self) -> int:
        return len(self.cookies_sem_consentimento) + len(self.storage_sem_consentimento)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "cookiesWithoutConsent": [c.to_dict() for c in self.cookies_sem_consentimento],
            "storageWithoutConsent": [s.to_dict() for s in self.storage_sem_consentimento],
            "firingTimeline": [e.to_dict() for e in self.linha_do_tempo],
            "firstTrackerFiredMs": self.primeiro_disparo_ms,
            "orderIssues": self.problemas_de_ordem,
            "rejectionFindings": self.achados_da_recusa,
            "rejectionTest": self.recusa,
            "totalFindings": self.total_achados,
        }


def _identifica_cookie(nome: str):
    """(dono, finalidade) do cookie, ou None se não for de rastreamento."""
    if nome in COOKIES_DE_RASTREIO:
        return COOKIES_DE_RASTREIO[nome]
    for prefixo, info in COOKIES_DE_RASTREIO.items():
        if nome.startswith(prefixo):
            return info
    # _ga_XXXXXXX é o cookie por propriedade do GA4
    if re.match(r"^_ga_[A-Z0-9]+$", nome):
        return ("Google Analytics 4", "Identificador por propriedade")
    return None


def _duracao_em_dias(cookie: Dict[str, Any]) -> Optional[float]:
    expira = cookie.get("expires")
    if not expira or expira in (-1, 0):
        return None  # cookie de sessão
    import time
    return round((expira - time.time()) / 86400, 1)


def auditar_armazenamento(scan, tem_cmp: bool) -> ResultadoDeArmazenamento:
    """Cookies, storage e ordem de disparo observados sem nenhum aceite."""
    resultado = ResultadoDeArmazenamento()
    if scan is None:
        return resultado

    # ── 1. Cookies gravados sem consentimento ────────────────────────────────
    for cookie in (getattr(scan, "cookies", None) or []):
        nome = cookie.get("name", "")
        identificacao = _identifica_cookie(nome)
        if not identificacao:
            continue
        dono, finalidade = identificacao
        dias = _duracao_em_dias(cookie)

        detalhe = (
            "Gravado antes de qualquer manifestação de consentimento"
            if tem_cmp else
            "Gravado sem que exista mecanismo de consentimento na página"
        )
        if dias and dias > DURACAO_LONGA_DIAS:
            detalhe += f". Conservação de {dias:.0f} dias — prazo longo exige justificativa de finalidade"

        resultado.cookies_sem_consentimento.append(AchadoDeArmazenamento(
            tipo="cookie",
            nome=nome,
            dono=dono,
            finalidade=finalidade,
            severidade="critical",
            detalhe=detalhe,
            duracao_dias=dias,
            http_only=bool(cookie.get("httpOnly")),
            dominio=cookie.get("domain"),
        ))

    # ── 2. localStorage / sessionStorage ─────────────────────────────────────
    for tipo, dados in (("localStorage", getattr(scan, "local_storage", None) or {}),
                        ("sessionStorage", getattr(scan, "session_storage", None) or {})):
        for chave in dados:
            dono = next((d for p, d in STORAGE_DE_RASTREIO.items() if chave.startswith(p)), None)
            if not dono:
                continue
            resultado.storage_sem_consentimento.append(AchadoDeArmazenamento(
                tipo=tipo,
                nome=chave,
                dono=dono,
                finalidade="Identificação persistente do visitante",
                # localStorage não expira sozinho — persiste até limpeza manual
                severidade="critical" if tipo == "localStorage" else "high",
                detalhe="Gravado sem consentimento. Armazenamento local não expira automaticamente"
                        if tipo == "localStorage" else "Gravado sem consentimento",
            ))

    # ── 3. Ordem real de disparo (timestamp das requisições) ─────────────────
    from .tag_detector import VENDOR_CATALOG

    requisicoes = getattr(scan, "intercepted_requests", None) or []
    eventos = []
    for req in requisicoes:
        instante = getattr(req, "timestamp", None)
        url = getattr(req, "url", "") or ""
        if instante is None or not url:
            continue
        dono = None
        for vid, vendor in VENDOR_CATALOG.items():
            if any(re.search(p, url, re.IGNORECASE) for p in vendor.get("url_patterns", [])):
                dono = vendor["name"]
                break
        if not dono:
            # Fornecedor fora do catálogo: o host já diz mais do que "Rastreador".
            # O interceptador só registra domínios de rastreamento, então tudo
            # aqui é rastreador — o que falta é só o nome comercial.
            from urllib.parse import urlparse as _parse
            host = _parse(url).netloc
            dono = host.removeprefix("www.") if host else "Rastreador não identificado"
        eventos.append((instante, url, dono))

    if eventos:
        eventos.sort(key=lambda e: e[0])
        inicio = eventos[0][0]
        for i, (instante, url, dono) in enumerate(eventos[:60], start=1):
            resultado.linha_do_tempo.append(EventoDeRede(
                ordem=i,
                ms_desde_o_inicio=int((instante - inicio) * 1000),
                url=url[:200],
                dono=dono,
            ))
        resultado.primeiro_disparo_ms = 0

    return resultado


def auditar_recusa(recusa, tem_cmp: bool) -> List[Dict[str, Any]]:
    """Transforma o teste de recusa em achados para o laudo.

    Três situações, em ordem de gravidade:

    1. Rastreamento DEPOIS da recusa — o usuário disse não e o site coletou
       assim mesmo. Não é má configuração: é a decisão do titular ignorada.
    2. Banner sem opção de recusar, só "Aceitar" — consentimento não é livre
       se o único caminho é concordar (dark pattern vedado pela LGPD e pelo
       EDPB).
    3. Nenhum controle de consentimento encontrado.
    """
    achados: List[Dict[str, Any]] = []
    if recusa is None or not getattr(recusa, "tentado", False):
        return achados

    cookies_depois = list(getattr(recusa, "cookies_apos_recusa", None) or [])
    requisicoes_depois = list(getattr(recusa, "requisicoes_apos_recusa", None) or [])
    storage_depois = dict(getattr(recusa, "storage_apos_recusa", None) or {})

    if getattr(recusa, "conseguiu_recusar", False):
        cookies_de_rastreio = [
            c for c in cookies_depois if _identifica_cookie(c.get("name", ""))
        ]

        if cookies_de_rastreio or requisicoes_depois or storage_depois:
            partes = []
            if cookies_de_rastreio:
                nomes = ", ".join(c.get("name", "?") for c in cookies_de_rastreio[:6])
                partes.append(f"{len(cookies_de_rastreio)} cookie(s) de rastreamento gravados ({nomes})")
            if requisicoes_depois:
                dominios = sorted({r.get("domain", "?") for r in requisicoes_depois})[:6]
                partes.append(
                    f"{len(requisicoes_depois)} requisição(ões) a endpoint de rastreamento "
                    f"({', '.join(dominios)})"
                )
            if storage_depois:
                partes.append(f"{len(storage_depois)} chave(s) gravadas em armazenamento local")

            achados.append({
                "check": "tracking_after_rejection",
                "label": "Rastreamento após recusa de consentimento",
                "status": "critical",
                "description": (
                    "Após clicar em recusar"
                    + (f" ({recusa.cmp_identificado})" if getattr(recusa, "cmp_identificado", None) else "")
                    + ", o site continuou coletando: " + "; ".join(partes) + ". "
                    "A recusa do titular não foi respeitada — a coleta seguiu contra a decisão manifestada."
                ),
                "recommendation": (
                    "Bloqueie o disparo das tags até haver consentimento afirmativo. "
                    "No GTM, use gatilhos condicionados ao estado de consentimento e o "
                    "Consent Mode com todos os sinais em 'denied' por padrão."
                ),
                "evidence": {
                    "cookies": [c.get("name") for c in cookies_de_rastreio][:20],
                    "requests": [r.get("url", "")[:200] for r in requisicoes_depois][:20],
                    "storageKeys": list(storage_depois.keys())[:20],
                },
            })
        else:
            achados.append({
                "check": "rejection_respected",
                "label": "Recusa respeitada",
                "status": "ok",
                "description": (
                    "Após a recusa, não se observou gravação de cookie de rastreamento "
                    "nem requisição a endpoint de coleta. O bloqueio aparenta estar correto."
                ),
                "recommendation": "",
                "evidence": {},
            })

    elif tem_cmp and not getattr(recusa, "tem_opcao_de_aceitar", False) \
            and not getattr(recusa, "tem_opcao_de_recusar", False):
        # Caso observado em portais brasileiros de grande porte: o script da CMP
        # está na página (o detector acha a assinatura), mas nenhum controle de
        # consentimento é exibido ao visitante. Na prática é pior do que não ter
        # CMP — passa a impressão de conformidade sem nunca pedir nada.
        achados.append({
            "check": "cmp_present_no_ui",
            "label": "CMP instalado, mas nenhum controle exibido",
            "status": "critical",
            "description": (
                "A plataforma de consentimento está presente no código da página, porém "
                "nenhum botão de aceitar ou recusar foi exibido ao visitante durante a "
                "visita. Na prática o rastreamento ocorre sem que o titular tenha "
                "qualquer oportunidade de se manifestar — a CMP existe, mas não cumpre "
                "a função. Verifique se o banner está restrito por região "
                "(configuração comum: exibir apenas na União Europeia)."
            ),
            "recommendation": (
                "Configure a CMP para exibir o aviso a todos os visitantes sujeitos à "
                "LGPD, não apenas aos da União Europeia, e confirme que o banner "
                "realmente renderiza — script carregado não significa aviso exibido."
            ),
            "evidence": {"buttonLabels": list(getattr(recusa, "rotulos_encontrados", []) or [])[:12]},
        })

    elif getattr(recusa, "tem_opcao_de_aceitar", False) and not getattr(recusa, "tem_opcao_de_recusar", False):
        achados.append({
            "check": "no_reject_option",
            "label": "Banner sem opção de recusar",
            "status": "critical",
            "description": (
                "O aviso de cookies oferece apenas o caminho de aceitar; não foi encontrado "
                "controle equivalente para recusar. O consentimento precisa ser livre e "
                "inequívoco — recusar tem que ser tão fácil quanto aceitar."
            ),
            "recommendation": (
                "Inclua um botão 'Recusar' (ou 'Apenas necessários') no primeiro nível do "
                "banner, com o mesmo destaque visual do botão de aceitar."
            ),
            "evidence": {"buttonLabels": list(getattr(recusa, "rotulos_encontrados", []) or [])[:12]},
        })

    elif not tem_cmp:
        achados.append({
            "check": "no_consent_control",
            "label": "Sem controle de consentimento",
            "status": "critical",
            "description": (
                "Nenhum mecanismo de consentimento foi encontrado na página: não há como "
                "o visitante aceitar nem recusar a coleta."
            ),
            "recommendation": "Implemente uma CMP que bloqueie as tags antes do consentimento.",
            "evidence": {},
        })

    return achados


def auditar_ordem_do_consent_mode(html: str) -> List[Dict[str, Any]]:
    """`gtag('consent','default')` precisa vir ANTES de `gtag('config')`.

    O motor só verificava se o Consent Mode existia. Declarado depois do
    config, ele não protege nada: o GA4 já inicializou com o estado padrão
    liberado, e as tags disparam antes de qualquer decisão do usuário.
    É um dos erros de implementação mais comuns — e invisível numa checagem
    que só procura presença.
    """
    problemas: List[Dict[str, Any]] = []

    m_default = re.search(r"gtag\s*\(\s*['\"]consent['\"]\s*,\s*['\"]default['\"]", html, re.IGNORECASE)
    m_config = re.search(r"gtag\s*\(\s*['\"]config['\"]", html, re.IGNORECASE)

    if m_default and m_config and m_default.start() > m_config.start():
        problemas.append({
            "check": "consent_default_after_config",
            "label": "Ordem do Consent Mode",
            "status": "critical",
            "description": (
                "gtag('consent','default') está declarado DEPOIS de gtag('config'). "
                "Nessa ordem o Consent Mode não tem efeito: a tag do Google já inicializou "
                "antes de receber o estado padrão, e a coleta acontece sem restrição."
            ),
            "recommendation": (
                "Mova o bloco gtag('consent','default',{...}) para antes de qualquer "
                "chamada gtag('config',...), o mais cedo possível no <head>."
            ),
        })

    # dataLayer precisa existir antes do container do GTM
    m_gtm = re.search(r"googletagmanager\.com/gtm\.js", html, re.IGNORECASE)
    m_datalayer = re.search(r"dataLayer\s*=\s*(window\.dataLayer\s*\|\||\[)", html, re.IGNORECASE)
    if m_gtm and m_datalayer and m_datalayer.start() > m_gtm.start():
        problemas.append({
            "check": "datalayer_after_gtm",
            "label": "Ordem do dataLayer",
            "status": "high",
            "description": (
                "O dataLayer é inicializado DEPOIS do carregamento do container do GTM. "
                "Os eventos empilhados antes da inicialização se perdem."
            ),
            "recommendation": (
                "Declare window.dataLayer = window.dataLayer || [] antes do snippet do GTM."
            ),
        })

    return problemas
