"""
audit_engine.privacy_analyzer — Jurisdiction-aware privacy compliance analysis.

Applies the correct regulatory framework based on detected site jurisdiction.
Does NOT call everything LGPD. Uses jurisdiction-specific wording.

IMPORTANT: All wording is indicative only — not legal advice.
"""
import re
from typing import List

# A mesma curva usada por todos os eixos do score. Importar em vez de repetir a
# fórmula é o que impede o produto de voltar a ter duas escalas para o mesmo
# site.
from .score_engine import _curva_de_risco
from .models import (
    PrivacyAnalysisResult, PrivacyViolation, TagFinding,
    CONFIDENCE_HIGH, CONFIDENCE_MEDIUM,
)
from urllib.parse import urlparse


# ─────────────────────────────────────────────
# Jurisdiction detection
# ─────────────────────────────────────────────

def detect_jurisdiction(html: str, url: str) -> dict:
    """
    Detect the most likely applicable privacy jurisdiction.
    Returns a dict with: region, law, law_full, consent_required, require_consent_first
    """
    parsed = urlparse(url)
    tld = parsed.netloc.split(".")[-1].lower()
    domain = parsed.netloc.lower()

    # TLD-based (high confidence)
    if tld in ("br",) or "com.br" in domain or ".br" in domain:
        return {
            "region": "Brasil",
            "law": "LGPD",
            "law_full": "Lei Geral de Proteção de Dados (Lei 13.709/2018)",
            "consent_required": True,
            "require_consent_first": True,
        }
    if tld in ("uk", "co") and ".uk" in domain:
        return {
            "region": "Reino Unido",
            "law": "UK GDPR",
            "law_full": "UK General Data Protection Regulation (UK GDPR)",
            "consent_required": True,
            "require_consent_first": True,
        }
    if tld in ("eu", "de", "fr", "it", "es", "pt", "nl", "be", "at", "pl", "se", "fi", "dk", "ie", "ch", "no"):
        return {
            "region": "União Europeia / EEE",
            "law": "GDPR",
            "law_full": "Regulamento Geral sobre a Proteção de Dados (GDPR)",
            "consent_required": True,
            "require_consent_first": True,
        }
    if tld in ("us", "gov", "edu") or ".ca.gov" in domain:
        return {
            "region": "Estados Unidos / Califórnia",
            "law": "CCPA/CPRA",
            "law_full": "California Consumer Privacy Act / CPRA",
            "consent_required": False,    # CCPA is opt-out by default
            "require_consent_first": False,
        }

    # Content-based heuristics (medium confidence)
    pt_signals = [r"\bLGPD\b", r"política de privacidade", r"aceitar cookies.*pt", r"consentimento\b"]
    gdpr_signals = [r"\bGDPR\b", r"\bRGPD\b", r"Datenschutz", r"Cookie-Einstellungen"]

    for pat in pt_signals:
        if re.search(pat, html, re.IGNORECASE):
            return {
                "region": "Brasil",
                "law": "LGPD",
                "law_full": "Lei Geral de Proteção de Dados (Lei 13.709/2018)",
                "consent_required": True,
                "require_consent_first": True,
            }
    for pat in gdpr_signals:
        if re.search(pat, html, re.IGNORECASE):
            return {
                "region": "União Europeia / EEE",
                "law": "GDPR",
                "law_full": "Regulamento Geral sobre a Proteção de Dados (GDPR)",
                "consent_required": True,
                "require_consent_first": True,
            }

    # Default: general risk assessment
    return {
        "region": "Não determinada",
        "law": "General Privacy",
        "law_full": "Avaliação geral de risco — jurisdição não determinada",
        "consent_required": None,
        "require_consent_first": None,
    }


# ─────────────────────────────────────────────
# Risk table (jurisdiction-agnostic)
# ─────────────────────────────────────────────

# O texto daqui vai direto para o laudo entregue ao cliente. Em português,
# citando o artigo, e dizendo o que foi observado — não a categoria abstrata do
# problema. "Observable tracking script loading before any consent signal" não
# diz a ninguém o que fazer na segunda-feira de manhã.
_RISK_TABLE = {
    "storage_without_consent": {
        "recommendation": (
            "Configurar o CMP para bloquear a gravação de cookies de rastreamento até o aceite, e apagar os que já foram gravados sem base legal."
        ),
        "article": "LGPD art. 7º, I e art. 16",
        "description": "Cookie de rastreamento gravado antes de qualquer consentimento",
    },
    "no_cmp": {
        "recommendation": (
            "Implantar um controle de consentimento que apresente aceitar e recusar com o mesmo destaque, e que bloqueie o rastreamento até a escolha."
        ),
        "article": "LGPD art. 7º, I",
        "description": "Rastreamento sem mecanismo de consentimento na página",
    },
    "tracking_before_consent": {
        "recommendation": (
            "Condicionar o disparo das tags ao consentimento registrado — no GTM, por gatilho vinculado ao evento do CMP, e não por ordem no HTML."
        ),
        "article": "LGPD art. 8º, §1º",
        "description": "Tag de rastreamento disparando antes da manifestação do titular",
    },
    "critical_tracker": {
        "recommendation": (
            "Suspender a gravação de sessão até o aceite e revisar se a finalidade declarada na política cobre esse tratamento."
        ),
        "article": "LGPD art. 6º, VII e art. 46",
        "description": "Ferramenta de alto impacto — gravação de sessão ou identificação persistente",
    },
    "advertising_tracker": {
        "recommendation": (
            "Bloquear as tags de publicidade até o aceite e revisar o contrato de operador com a plataforma que recebe os dados."
        ),
        "article": "LGPD art. 7º, I e art. 33",
        "description": "Compartilhamento com plataforma de publicidade sem consentimento",
    },
    "server_side_tagging": {
        "recommendation": (
            "Registrar esse tratamento no inventário de dados: nessa arquitetura o "
            "site deixa de ser só origem e passa a encaminhar dados, com dever de "
            "base legal e de contrato com quem os recebe. Declarar na política de "
            "privacidade quais dados saem do servidor e para onde."
        ),
        "article": "LGPD art. 37 e art. 39",
        "description": "Encaminhamento de dados a partir do servidor do site (tagueamento server-side)",
    },
    "obsolete_ua": {
        "recommendation": (
            "Remover o Universal Analytics: ele não recebe mais dados e mantém identificadores ativos no navegador sem finalidade."
        ),
        "article": "LGPD art. 46",
        "description": "Tecnologia descontinuada em uso (Universal Analytics)",
    },
}


# O que cada ferramenta faz, em uma frase — para o laudo dizer POR QUE aquela
# tag específica importa, em vez de repetir o mesmo texto para todas.
_O_QUE_A_FERRAMENTA_FAZ = {
    "ga4": "registra navegação, origem de tráfego e comportamento por sessão",
    "ua": "versão descontinuada do Google Analytics — não recebe mais dados",
    "meta_pixel": "identifica o visitante para remarketing e públicos da Meta",
    "google_ads": "atribui conversões e alimenta listas de remarketing",
    "tiktok_pixel": "identifica o visitante para públicos e conversões do TikTok",
    "linkedin_insight": "identifica o visitante e o vincula ao perfil profissional",
    "hotjar": "grava a sessão do usuário, incluindo movimento de mouse e cliques",
    "clarity": "grava a sessão e gera mapas de calor da navegação",
    "criteo": "monta perfil de interesse para publicidade em outros sites",
    "pinterest": "identifica o visitante para públicos do Pinterest",
    "snapchat_pixel": "identifica o visitante para públicos do Snapchat",
    "twitter_x_pixel": "identifica o visitante para públicos do X/Twitter",
    "segment": "coleta eventos e os distribui para outras ferramentas",
    "amplitude": "registra comportamento por usuário identificado",
    "mixpanel": "registra comportamento por usuário identificado",
    "rd_station": "identifica leads e registra a navegação para automação de marketing",
}


def analyze_privacy(
    tags: List[TagFinding],
    has_consent_tool: bool,
    tags_before_consent: List[TagFinding],
    jurisdiction: dict,
    storage=None,
) -> PrivacyAnalysisResult:

    law  = jurisdiction["law"]
    region = jurisdiction["region"]
    law_full = jurisdiction["law_full"]
    require_consent_first = jurisdiction.get("require_consent_first", True)

    violations: List[PrivacyViolation] = []
    consent_risks: List[str] = []
    disclosure_gaps: List[str] = []

    has_ua = any(t.id == "ua" for t in tags)

    # ── Rastreamento em domínio próprio ───────────────────────────────────────
    # Server-side tagging é técnica legítima e não é violação por si. O que a
    # torna relevante num laudo de LGPD é o efeito colateral: o dado deixa de
    # ir do navegador para o fornecedor e passa a ir do NAVEGADOR PARA O
    # SERVIDOR DO CLIENTE, que então o encaminha. Quem opera o site vira
    # controlador de um fluxo que antes não passava por ele — com dever de
    # registro e de base legal sobre um tratamento que nem sempre sabe que faz.
    #
    # É por isso que o achado precisa aparecer mesmo em site com CMP: o titular
    # não tem como observar esse encaminhamento, e nenhum bloqueador o impede.
    server_side = [
        t for t in tags
        if t.id == "sgtm_first_party" or "domínio próprio" in (t.name or "") or "server-side" in (t.name or "")
    ]
    if server_side:
        r = _RISK_TABLE["server_side_tagging"]
        nomes = ", ".join(t.name for t in server_side[:3])
        evidencias = [t.matched_pattern for t in server_side if t.matched_pattern]
        violations.append(PrivacyViolation(
            tag="Infraestrutura do site",
            violation=(
                f"O site encaminha dados de navegação a partir do próprio servidor "
                f"({nomes}). Nessa arquitetura a coleta não sai do navegador do "
                f"visitante direto para o fornecedor: ela passa pelo servidor do site, "
                f"que decide o que repassar. O visitante não tem como observar esse "
                f"encaminhamento, e bloqueador de rastreio não o alcança."
            ),
            article=r["article"],
            description=r["description"],
            # Alto, não crítico: a técnica é legal. A gravidade sobe pela
            # ausência de consentimento, que é avaliada em outra regra.
            severity="high",
            confidence=CONFIDENCE_HIGH,
            recommendation=r.get("recommendation"),
        ))
        if evidencias:
            disclosure_gaps.append(f"Tagueamento server-side: {evidencias[0][:120]}")

    # ── No CMP ────────────────────────────────────────────────────────────────
    if not has_consent_tool:
        r = _RISK_TABLE["no_cmp"]
        rastreadores = [t for t in tags if t.type in ("analytics", "advertising", "heatmap")]
        if rastreadores:
            nomes = ", ".join(t.name for t in rastreadores[:4])
            resto = f" e mais {len(rastreadores) - 4}" if len(rastreadores) > 4 else ""
            violations.append(PrivacyViolation(
                tag="Página",
                violation=(
                    f"Nenhum controle de consentimento foi encontrado, e {len(rastreadores)} "
                    f"ferramenta(s) de rastreamento estão ativas: {nomes}{resto}. "
                    f"A coleta começa assim que a página carrega — o visitante não tem "
                    f"em momento algum a chance de aceitar ou recusar."
                ),
                article=r["article"],
                description=r["description"],
                severity="critical",
                confidence=CONFIDENCE_HIGH,
                recommendation=r.get("recommendation"),
            ))
            disclosure_gaps.append("Sem controle de consentimento na página")

    # ── Tags before consent ────────────────────────────────────────────────────
    for tag in tags_before_consent:
        if tag.type == "consent":
            continue
        if tag.type in ("analytics", "advertising", "heatmap", "marketing") and require_consent_first:
            risk_key = "critical_tracker" if tag.privacy_risk == "critical" else (
                "advertising_tracker" if tag.type == "advertising" else "tracking_before_consent"
            )
            r = _RISK_TABLE.get(risk_key, _RISK_TABLE["tracking_before_consent"])
            # Cada violação diz o que AQUELA ferramenta faz e onde ela está.
            # Repetir a mesma frase para todas as tags faz o laudo parecer
            # gerado por template, e o leitor para de ler na terceira.
            o_que_faz = _O_QUE_A_FERRAMENTA_FAZ.get(tag.id)
            faz = f" — {o_que_faz}" if o_que_faz else ""

            if tag.line_number:
                onde = f"declarada na linha {tag.line_number} do código-fonte"
            elif tag.detection_method == "network_request":
                onde = "carregada dinamicamente (não aparece no código-fonte; foi vista pela requisição de rede)"
            else:
                onde = "presente na página"

            identificacao = f" [{tag.tag_id}]" if tag.tag_id else ""

            # Sem CMP não existe "antes do consentimento": não há consentimento
            # nenhum. Dizer "carregou antes do sinal" nesse caso confunde o
            # leitor do laudo e subestima a gravidade.
            if has_consent_tool:
                descricao_violacao = (
                    f"{tag.name}{identificacao}{faz}. Está {onde} e dispara antes de o "
                    f"visitante manifestar consentimento — o aviso da página existe, mas "
                    f"não bloqueia esta ferramenta."
                )
            else:
                descricao_violacao = (
                    f"{tag.name}{identificacao}{faz}. Está {onde} e coleta dados sem que "
                    f"exista qualquer controle de consentimento na página. A "
                    f"{law} exige base legal antes da coleta, não depois."
                )
            violations.append(PrivacyViolation(
                tag=tag.name,
                violation=descricao_violacao,
                article=r["article"],
                description=r["description"],
                severity=tag.privacy_risk,
                confidence=CONFIDENCE_MEDIUM,
                recommendation=r.get("recommendation"),
                data_collected=tag.data_collected,
                tag_id=tag.tag_id,
            ))
            consent_risks.append(f"{tag.name} firing before consent")

    # ── Cookies e storage gravados sem aceite ─────────────────────────────────
    # O scanner nunca clica em "aceitar": o que estiver gravado foi gravado sem
    # consentimento. É a evidência mais forte de um laudo — não depende de
    # inferir ordem por posição no HTML.
    if storage is not None:
        r = _RISK_TABLE["storage_without_consent"]
        for achado in list(getattr(storage, "cookies_sem_consentimento", []) or []):
            violations.append(PrivacyViolation(
                tag=f"{achado.dono} — cookie {achado.nome}",
                violation=(
                    f"Cookie '{achado.nome}' ({achado.dono}) gravado no navegador sem consentimento. "
                    f"{achado.detalhe}. Finalidade observada: {achado.finalidade}."
                ),
                article=r["article"],
                description=r["description"],
                severity="critical",
                confidence=CONFIDENCE_HIGH,
                recommendation=r.get("recommendation"),
            ))
            consent_risks.append(f"Cookie {achado.nome} gravado sem consentimento")

        for achado in list(getattr(storage, "storage_sem_consentimento", []) or []):
            violations.append(PrivacyViolation(
                tag=f"{achado.dono} — {achado.tipo}",
                violation=(
                    f"Chave '{achado.nome}' gravada em {achado.tipo} sem consentimento. "
                    f"{achado.detalhe}."
                ),
                article=r["article"],
                description=r["description"],
                severity=achado.severidade,
                confidence=CONFIDENCE_HIGH,
                recommendation=r.get("recommendation"),
            ))

        # Rastreamento após recusa é a violação mais grave que este produto
        # consegue provar: não é configuração errada, é a decisão do titular
        # ignorada. Por isso entra com faixa própria, acima do resto.
        for achado in list(getattr(storage, "achados_da_recusa", []) or []):
            if achado.get("status") == "ok":
                continue
            violations.append(PrivacyViolation(
                tag="Consentimento",
                violation=achado["description"],
                article="Consent Requirement",
                description=achado["label"],
                severity="critical",
                confidence=CONFIDENCE_HIGH,
            ))
            consent_risks.append(achado["label"])

        for problema in list(getattr(storage, "problemas_de_ordem", []) or []):
            violations.append(PrivacyViolation(
                tag="Ordem de carregamento",
                violation=problema["description"],
                article="Consent-First Behaviour",
                description=problema["label"],
                severity="critical" if problema["status"] == "critical" else "high",
                confidence=CONFIDENCE_HIGH,
            ))

    # ── Universal Analytics ────────────────────────────────────────────────────
    if has_ua:
        r = _RISK_TABLE["obsolete_ua"]
        violations.append(PrivacyViolation(
            tag="Universal Analytics",
            violation=(
                "O Universal Analytics foi descontinuado em julho de 2023 e não recebe "
                "mais dados: o que ele coleta hoje é descartado. Continua sendo código "
                "sem manutenção rodando na página, e não suporta Consent Mode — então "
                "fica de fora de qualquer estratégia de consentimento."
            ),
            article=r["article"],
            description=r["description"],
            severity="critical",
            confidence=CONFIDENCE_HIGH,
                recommendation=r.get("recommendation"),
        ))

    # ── Critical trackers without consent ─────────────────────────────────────
    critical_no_consent = [
        t for t in tags
        if t.privacy_risk == "critical" and t.type != "consent" and not has_consent_tool
        and t not in tags_before_consent
    ]
    for tag in critical_no_consent[:3]:   # cap at 3 to avoid spam
        r = _RISK_TABLE["critical_tracker"]
        o_que_faz = _O_QUE_A_FERRAMENTA_FAZ.get(tag.id)
        faz = f" — {o_que_faz}" if o_que_faz else ""
        coleta = ", ".join(tag.data_collected[:3]) if tag.data_collected else ""
        detalhe_coleta = f" Dados observados: {coleta}." if coleta else ""
        violations.append(PrivacyViolation(
            tag=tag.name,
            violation=(
                f"{tag.name}{faz}. É uma ferramenta de alto impacto rodando sem nenhum "
                f"controle de consentimento na página.{detalhe_coleta}"
            ),
            article=r["article"],
            description=r["description"],
            severity="critical",
            confidence=CONFIDENCE_MEDIUM,
                recommendation=r.get("recommendation"),
            data_collected=tag.data_collected,
        ))

    # ── Score ──────────────────────────────────────────────────────────────────
    # `100 - violações × 12` chegava a zero na nona violação e ficava lá. Um
    # site com 9 problemas e outro com 40 recebiam a mesma nota, e o laudo
    # exibia "0%" ao lado do índice geral do cabeçalho — dois números sobre o
    # mesmo site, em escalas que não se conciliam. É o defeito que este produto
    # já teve em três motores ao mesmo tempo, agora em duas fórmulas.
    #
    # A curva de `score_engine` é a mesma de todos os outros eixos: reage forte
    # ao primeiro achado grave e nunca satura, então continua separando sites
    # ruins entre si. Gravidade pesa — dez avisos brandos não equivalem a dez
    # rastreadores disparando sem consentimento.
    _PESO_POR_GRAVIDADE = {"critical": 34, "high": 20, "medium": 10, "low": 4}
    pontos_de_risco = sum(
        _PESO_POR_GRAVIDADE.get(getattr(v, "severity", "medium"), 10)
        for v in violations
    )
    compliance_score = 100 - _curva_de_risco(pontos_de_risco)

    # ── Risk exposure summary ──────────────────────────────────────────────────
    # A versão anterior somava valores fixos em dólar e dividia por 5 — um
    # câmbio inventado — num laudo de LGPD entregue a cliente brasileiro.
    # A LGPD não trabalha com tabela por tipo de violação: o art. 52 fala em
    # até 2% do faturamento no Brasil, limitado a R$ 50 milhões por infração.
    # Sem saber o faturamento, o honesto é dizer o critério e a gravidade —
    # não fabricar um número.
    if violations:
        criticas = sum(1 for v in violations if v.severity == "critical")
        exposure = (
            f"{len(violations)} não conformidade(s) observada(s)"
            + (f", {criticas} de gravidade crítica" if criticas else "")
            + ". A LGPD (art. 52) prevê multa de até 2% do faturamento no Brasil, "
            "limitada a R$ 50 milhões por infração — o valor efetivo depende do "
            "faturamento, da abrangência e dos agravantes do caso concreto."
        )
    else:
        exposure = "Nenhum indicador significativo de risco observado nesta página"

    return PrivacyAnalysisResult(
        jurisdiction=region,
        law=law,
        law_full=law_full,
        violations=violations,
        total_violations=len(violations),
        has_consent_tool=has_consent_tool,
        has_universal_analytics=has_ua,
        consent_risks=list(set(consent_risks)),
        disclosure_gaps=list(set(disclosure_gaps)),
        estimated_risk_exposure=exposure,
        compliance_score=compliance_score,
        confidence_level=(
            "Indicative assessment based on publicly observable page behaviour. "
            "Does not constitute legal advice. Backend-only and SPA events are not visible to this scan."
        ),
    )
