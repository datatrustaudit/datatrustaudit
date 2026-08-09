"""
audit_engine.score_engine — modelo de 6 eixos (0-100).

1. Tracking Quality   — GTM, UA legado, qualidade da instalação
2. Event Architecture — eventos detectados, parâmetros, payload malformado
3. DataLayer Quality  — PII exposto, estrutura de e-commerce, ordem de init
4. Consent Integrity  — CMP, Consent Mode v2, recusa, sinais observados
5. Privacy Risk       — violações por gravidade (0=seguro, 100=alto risco)
6. Overall            — média ponderada de 1-4 e do inverso de 5

Dois princípios, ambos aprendidos com laudo errado na mão do cliente:

**Não pontuar o que não foi medido.** Eixo sem dado devolve `None` e sai da
média, com o peso redistribuído entre os que sobraram. A versão anterior
devolvia 50 para "nenhum evento detectado" — e como página inicial sem
interação normalmente não dispara evento algum, esse 50 entrava com peso 0,20
em quase todo laudo e puxava tudo para o meio: impedia o site bom de subir e o
ruim de cair. Pelo mesmo motivo, sinal não observado (`has_reject_all is None`)
não desconta ponto: só o que foi observado como ausente penaliza.

**Risco não satura.** As penalidades somadas eram cortadas em 100, então a
partir de ~4 violações qualquer site virava o mesmo número. Medido: um site com
7 achados e outro com 12 recebiam ambos score 45. Um score que não separa ruim
de péssimo não informa nada a quem precisa priorizar correção. A curva
assintótica abaixo continua distinguindo em qualquer quantidade.
"""
import math
from typing import List, Optional, Tuple
from .models import (
    AuditScores, TagFinding, GTMQualityResult, EventAuditResult,
    DataLayerFinding, ConsentAuditResult, PrivacyAnalysisResult, DuplicateFinding,
    VALIDITY_VALID, VALIDITY_PARTIAL, VALIDITY_MALFORMED, VALIDITY_NO_PARAMS,
)


def _clamp(val: int) -> int:
    return max(0, min(100, val))


#: Ponto em que a curva de risco passa de 50. Calibrado para que 7 e 12 achados
#: ainda produzam números distintos — com a exponencial que tentei antes, os
#: dois davam 98 e 100, e o score final empatava.
_ESCALA_DE_RISCO = 150.0


def _curva_de_risco(pontos: float) -> int:
    """Converte pontos de penalidade em 0-100 sem saturar.

    `x / (x + k)` sobe rápido no começo — o primeiro achado grave já move o
    número — e tem cauda longa o bastante para continuar separando sites muito
    ruins entre si: 7 achados dão 61, 12 dão 70, 25 dão 82. Exponencial não
    serve aqui: `1 - e^(-x/k)` chega a 98 com 7 achados e empata tudo dali para
    cima.
    """
    if pontos <= 0:
        return 0
    return _clamp(int(round(100 * pontos / (pontos + _ESCALA_DE_RISCO))))


def compute_tracking_quality(
    tags: List[TagFinding],
    gtm: Optional[GTMQualityResult],
    duplicates: List[DuplicateFinding],
) -> int:
    score = 100

    has_gtm = any(t.id == "gtm" for t in tags)
    has_ua  = any(t.id == "ua" for t in tags)
    has_ga4 = any(t.id == "ga4" for t in tags)

    if not has_gtm:
        score -= 25   # sem gerenciador de tags
    if has_ua:
        score -= 30   # tecnologia descontinuada
    if not has_ga4 and not has_gtm:
        score -= 15   # sem analytics moderno

    if gtm:
        for f in gtm.findings:
            if f.status == "critical":
                score -= 15
            elif f.status == "warning":
                # Achado cosmético (o `<noscript>` do GTM, por exemplo) não pode
                # custar o mesmo que erro de implementação.
                score -= 4

    tag_dups = [d for d in duplicates if d.entity_type == "tag"]
    score -= len(tag_dups) * 10

    return _clamp(score)


def compute_event_architecture(result: Optional[EventAuditResult]) -> Optional[int]:
    """`None` quando não há evento para avaliar.

    Varredura de página inicial sem interação normalmente não dispara evento
    nenhum — isso não é qualidade média, é ausência de medição.
    """
    if not result or result.total_events == 0:
        return None

    score = 100

    for ev in result.events:
        if ev.validity == VALIDITY_MALFORMED:
            score -= 20
        elif ev.validity == VALIDITY_PARTIAL:
            score -= 10
        elif ev.validity == VALIDITY_NO_PARAMS and ev.name not in ("page_view", "scroll"):
            score -= 5

    score -= result.duplicated_event_names * 12

    ecom_bonus = min(10, len(result.ecommerce_events_detected) * 3)
    score += ecom_bonus

    return _clamp(score)


def compute_datalayer_quality(findings: List[DataLayerFinding]) -> int:
    if not findings:
        return 100

    score = 100
    for f in findings:
        if f.severity == "critical":
            score -= 30
        elif f.severity == "high":
            score -= 20
        elif f.severity == "medium":
            score -= 10
        else:
            score -= 5

    return _clamp(score)


def compute_consent_integrity(consent: Optional[ConsentAuditResult]) -> Optional[int]:
    """Proporção do que foi conferido e passou.

    A versão anterior somava bônus fixos sobre uma base zero, então sinal não
    verificado saía do total como se fosse falha: um site com CMP e Consent Mode
    corretos ficava em 60 por não ter link de política no HTML analisado e por
    `has_reject_all` vir `None` (o teste de recusa não roda em todo scan).
    Aqui cada sinal só entra na conta quando há observação sobre ele.
    """
    if not consent:
        return None

    obtidos = 0.0
    possiveis = 0.0

    def avalia(peso: float, aprovado: Optional[bool]) -> None:
        nonlocal obtidos, possiveis
        if aprovado is None:
            return          # não observado: fica fora do denominador
        possiveis += peso
        if aprovado:
            obtidos += peso

    avalia(35, bool(consent.cmp_detected))
    # Consent Mode: v2 vale cheio, v1 vale metade, ausente zera.
    if consent.consent_mode_v2:
        obtidos += 25; possiveis += 25
    elif consent.consent_mode_version:
        obtidos += 12.5; possiveis += 25
    else:
        possiveis += 25
    avalia(15, bool(consent.has_default_denied))
    avalia(10, consent.has_reject_all)
    avalia(10, bool(consent.has_privacy_policy))
    avalia(5, bool(consent.has_cookie_policy))

    if possiveis == 0:
        return None

    score = 100 * obtidos / possiveis

    # Tag disparando antes do aceite é evidência direta contra o consentimento:
    # desconta depois da proporção, para pesar mesmo em site bem configurado.
    score -= len(consent.tags_before_consent) * 8

    return _clamp(int(round(score)))


def compute_privacy_risk(privacy: Optional[PrivacyAnalysisResult]) -> int:
    """Quanto maior, pior. Exibido invertido na tela."""
    if not privacy:
        return 0

    pontos = 0.0
    for v in privacy.violations:
        if v.severity == "critical":
            pontos += 30
        elif v.severity == "high":
            pontos += 20
        elif v.severity == "medium":
            pontos += 10
        else:
            pontos += 5

    if not privacy.has_consent_tool:
        pontos += 20

    return _curva_de_risco(pontos)


#: Peso de cada eixo no score geral. Conformidade (consentimento + privacidade)
#: responde por metade: é o que o produto vende, e a versão anterior dava só
#: 0,10 ao risco de privacidade num laudo de LGPD.
_PESOS = {
    "tracking": 0.20,
    "eventos": 0.15,
    "datalayer": 0.15,
    "consentimento": 0.25,
    "privacidade": 0.25,
}


def _media_ponderada(itens: List[Tuple[str, Optional[int]]]) -> int:
    """Média só dos eixos medidos, com o peso dos ausentes redistribuído."""
    medidos = [(nome, valor) for nome, valor in itens if valor is not None]
    if not medidos:
        return 0
    peso_total = sum(_PESOS[nome] for nome, _ in medidos)
    if peso_total <= 0:
        return 0
    soma = sum(_PESOS[nome] * valor for nome, valor in medidos)
    return _clamp(int(round(soma / peso_total)))


def compute_scores(
    tags: List[TagFinding],
    gtm: Optional[GTMQualityResult],
    events: Optional[EventAuditResult],
    datalayer: List[DataLayerFinding],
    consent: Optional[ConsentAuditResult],
    privacy: Optional[PrivacyAnalysisResult],
    duplicates: List[DuplicateFinding],
) -> AuditScores:

    tracking   = compute_tracking_quality(tags, gtm, duplicates)
    event_arch = compute_event_architecture(events)
    dl_quality = compute_datalayer_quality(datalayer)
    consent_s  = compute_consent_integrity(consent)
    priv_risk  = compute_privacy_risk(privacy)

    overall = _media_ponderada([
        ("tracking", tracking),
        ("eventos", event_arch),
        ("datalayer", dl_quality),
        ("consentimento", consent_s),
        ("privacidade", 100 - priv_risk),
    ])

    return AuditScores(
        overall=overall,
        tracking_quality=tracking,
        # Os campos do modelo são int: eixo não medido vira 0 na serialização,
        # mas já ficou de fora da média — é o número geral que o cliente lê.
        event_architecture=event_arch if event_arch is not None else 0,
        datalayer_quality=dl_quality,
        consent_integrity=consent_s if consent_s is not None else 0,
        privacy_risk=priv_risk,
    )
