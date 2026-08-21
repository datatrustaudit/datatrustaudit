"""
audit_engine.duplicate_detector — Tag, pixel, and event duplication detection.

Identifies:
- Same vendor loaded N times from source
- Duplicate GA4 config() calls
- Duplicate page_view events in source
- Hardcoded + GTM overlap inference (medium confidence)
"""
import re
from collections import Counter
from typing import Dict, List
from .models import DuplicateFinding, TagFinding, EventFinding, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM

_GA4_CONFIG_RE  = re.compile(r"gtag\s*\(\s*['\"]config['\"]\s*,\s*['\"]G-[A-Z0-9]+['\"]", re.IGNORECASE)
_GA4_SCRIPT_RE  = re.compile(r"googletagmanager\.com/gtag/js\?id=G-([A-Z0-9]+)", re.IGNORECASE)
_GTM_SNIPPET_RE = re.compile(r"googletagmanager\.com/gtm\.js", re.IGNORECASE)
_META_INIT_RE   = re.compile(r"fbq\s*\(\s*['\"]init['\"]", re.IGNORECASE)
_HOTJAR_RE      = re.compile(r"static\.hotjar\.com", re.IGNORECASE)
# `tid` é a propriedade GA4 de destino na requisição de coleta. É o que separa
# "o mesmo evento disparou duas vezes" de "o evento foi enviado a duas
# propriedades" — dois achados diferentes, com correções opostas.
_TID_RE         = re.compile(r"[?&]tid=([^&\s]+)", re.IGNORECASE)


def _destinos_ga4(ocorrencias: List[EventFinding]) -> List[str]:
    """Propriedades GA4 que receberam o evento, lidas da URL observada.

    Só olha o que a varredura capturou: o `tid` da requisição interceptada.
    Evento sem URL (dataLayer, HTML) não tem destino conhecido e devolve lista
    vazia — o que mantém o caminho normal de duplicata.
    """
    destinos: List[str] = []
    for ev in ocorrencias:
        alvo = _TID_RE.search(str(getattr(ev, "source_snippet", "") or ""))
        if alvo and alvo.group(1) not in destinos:
            destinos.append(alvo.group(1))
    return destinos


def _procedencia(ocorrencias: List[EventFinding]) -> str:
    """De onde veio a prova da repetição.

    O texto era fixo — "Detected in static HTML source only" — e ia junto com
    todo achado de evento duplicado, inclusive os observados na rede. Num laudo,
    afirmar o método de coleta errado derruba o achado inteiro: quem confere o
    HTML não acha nada e conclui que a varredura inventou.
    """
    metodos = {str(getattr(ev, "detection_method", "") or "") for ev in ocorrencias}
    if metodos == {"network_request"}:
        return ("Observado em requisição de rede durante a visita — cada disparo "
                "corresponde a uma chamada capturada.")
    if "network_request" in metodos:
        return ("Observado em parte por requisição de rede, em parte no conteúdo "
                "servido da página.")
    return ("Detectado no conteúdo servido da página. Disparo duplicado gerado no "
            "servidor ou por aplicação de página única não é observável por esta "
            "varredura.")


def detect_duplicates(
    html: str,
    tags: List[TagFinding],
    events: List[EventFinding],
) -> List[DuplicateFinding]:

    findings: List[DuplicateFinding] = []

    # ── 1. Tag occurrences by vendor ID ──────────────────────────────────────
    # Use the occurrence_count already on each TagFinding
    for tag in tags:
        if tag.occurrence_count > 1:
            findings.append(DuplicateFinding(
                entity_type="tag",
                name=tag.name,
                occurrence_count=tag.occurrence_count,
                severity="critical" if tag.occurrence_count > 2 else "warning",
                recommendation=f"Consolidate {tag.name} to a single implementation. "
                               f"Multiple instances cause duplicate data collection and can inflate metrics.",
                confidence=CONFIDENCE_HIGH,
            ))

    # ── 2. GTM snippet count ──────────────────────────────────────────────────
    gtm_count = len(_GTM_SNIPPET_RE.findall(html))
    if gtm_count > 1:
        findings.append(DuplicateFinding(
            entity_type="tag",
            name="Google Tag Manager Snippet",
            occurrence_count=gtm_count,
            severity="critical",
            recommendation="Remove duplicate GTM script tags. Only one GTM snippet should appear in the page source.",
            confidence=CONFIDENCE_HIGH,
        ))

    # ── 3. GA4 config() calls ─────────────────────────────────────────────────
    ga4_configs = _GA4_CONFIG_RE.findall(html)
    if len(ga4_configs) > 1:
        findings.append(DuplicateFinding(
            entity_type="ga4_config",
            name="GA4 Configuration Call",
            occurrence_count=len(ga4_configs),
            severity="critical",
            recommendation=f"GA4 config() is called {len(ga4_configs)} times. "
                           "This causes duplicate page_view events and inflated session counts. "
                           "Keep a single gtag('config', 'G-XXXXXXXX') call.",
            confidence=CONFIDENCE_HIGH,
        ))

    # ── 4. GA4 script src duplicates ─────────────────────────────────────────
    ga4_ids = _GA4_SCRIPT_RE.findall(html)
    id_counts = Counter(ga4_ids)
    for ga4_id, count in id_counts.items():
        if count > 1:
            findings.append(DuplicateFinding(
                entity_type="tag",
                name=f"GA4 Script (G-{ga4_id})",
                occurrence_count=count,
                severity="critical",
                recommendation=f"GA4 tracking script for G-{ga4_id} is loaded {count} times. "
                               "Deduplicate to avoid double-counting all analytics data.",
                confidence=CONFIDENCE_HIGH,
            ))

    # ── 5. Meta Pixel init() calls ────────────────────────────────────────────
    meta_inits = len(_META_INIT_RE.findall(html))
    if meta_inits > 1:
        findings.append(DuplicateFinding(
            entity_type="pixel",
            name="Meta Pixel (fbq init)",
            occurrence_count=meta_inits,
            severity="warning",
            recommendation=f"Meta Pixel fbq('init') is called {meta_inits} times. "
                           "Multiple init calls can cause duplicate pixel fires and inflated conversion data.",
            confidence=CONFIDENCE_HIGH,
        ))

    # ── 6. Hotjar duplicates ──────────────────────────────────────────────────
    hotjar_count = len(_HOTJAR_RE.findall(html))
    if hotjar_count > 1:
        findings.append(DuplicateFinding(
            entity_type="tag",
            name="Hotjar",
            occurrence_count=hotjar_count,
            severity="warning",
            recommendation="Hotjar script appears to load multiple times. This may cause duplicate session recordings.",
            confidence=CONFIDENCE_HIGH,
        ))

    # ── 7. Duplicate events (from event auditor) ──────────────────────────────
    # Eventos que disparam várias vezes POR DESIGN não são duplicata: scroll a
    # 25/50/75/100%, cada clique, cada temporizador. Reportá-los como problema
    # enche o laudo de alarme falso e faz o cliente duvidar do resto.
    EVENTOS_REPETIDOS_POR_DESIGN = {
        # disparam a cada interação do usuário
        "gtm.scrollDepth", "gtm.click", "gtm.linkClick", "gtm.timer",
        "gtm.formSubmit", "gtm.elementVisibility", "gtm.video", "gtm.historyChange",
        "scroll", "click", "video_progress", "timer", "user_engagement",
        "form_start", "view_item_list", "view_promotion", "select_promotion",
        # ciclo de vida do container: um por container carregado. Vários
        # containers já são apontados como duplicata de tag ("GTM x3") —
        # repetir aqui é o mesmo achado contado duas vezes.
        "gtm.dom", "gtm.load", "gtm.js", "gtm.init", "gtm.init_consent",
    }

    por_nome: Dict[str, List[EventFinding]] = {}
    for ev in events:
        por_nome.setdefault(ev.name, []).append(ev)

    for event_name, ocorrencias in por_nome.items():
        count = len(ocorrencias)
        if event_name in EVENTOS_REPETIDOS_POR_DESIGN or count <= 1:
            continue

        destinos = _destinos_ga4(ocorrencias)
        procedencia = _procedencia(ocorrencias)

        # Um disparo por propriedade GA4 não é disparo duplicado: é o mesmo
        # evento enviado a dois destinos — tagueamento duplo, comum em site que
        # mantém a propriedade antiga no ar. Foi o que aconteceu com o
        # `page_view` da terra.com.br: dois hits, `G-7Y8JPEF9M3` e
        # `G-FJBH1GT2QG`, e o laudo mandava procurar um `dataLayer.push()`
        # repetido que não existe. Alarme falso faz o cliente duvidar dos
        # achados verdadeiros — o fato continua no laudo, com o nome certo e a
        # pergunta que de fato importa para a LGPD: por que dois destinos
        # recebem o dado do mesmo titular.
        if len(destinos) > 1 and len(destinos) == count:
            findings.append(DuplicateFinding(
                entity_type="event",
                name=event_name,
                occurrence_count=count,
                severity="low",
                recommendation=(
                    f"'{event_name}' foi enviado {count} vezes, uma para cada propriedade GA4 "
                    f"({', '.join(destinos)}). Não é disparo duplicado — cada propriedade recebeu "
                    "um evento. Confirme se todas ainda são necessárias: cada uma recebe os dados "
                    "do mesmo titular e precisa constar do registro de tratamento."
                ),
                confidence=CONFIDENCE_HIGH,
                note=procedencia,
            ))
            continue

        severity = "critical" if event_name in ("purchase", "begin_checkout") else "warning"
        findings.append(DuplicateFinding(
            entity_type="event",
            name=event_name,
            occurrence_count=count,
            severity=severity,
            recommendation=(
                f"'{event_name}' disparou {count} vezes nesta varredura. "
                + (
                    "Em evento de compra ou de início de checkout, disparo repetido infla a "
                    "conversão e distorce o faturamento apurado — é problema crítico de "
                    "qualidade de dado."
                    if event_name in ("purchase", "begin_checkout") else
                    "Verifique se há mais de um dataLayer.push() ou gtag() disparando o mesmo evento."
                )
            ),
            confidence=CONFIDENCE_HIGH,
            note=procedencia,
        ))

    # ── 8. Hardcoded + GTM overlap inference ─────────────────────────────────
    # If both a hardcoded GA4 script AND GTM are present, likely loading GA4 twice
    has_gtm = any(t.id == "gtm" for t in tags)
    has_hardcoded_ga4 = bool(re.search(
        r"<script[^>]+googletagmanager\.com/gtag/js", html, re.IGNORECASE
    ))
    has_gtm_with_ga4 = has_gtm and bool(re.search(r"G-[A-Z0-9]{10}", html))

    if has_hardcoded_ga4 and has_gtm_with_ga4:
        findings.append(DuplicateFinding(
            entity_type="tag",
            name="GA4 — Hardcoded + GTM Overlap (Inferred)",
            occurrence_count=2,
            severity="warning",
            recommendation="GA4 appears to be loaded both as a hardcoded script tag and potentially managed via GTM. "
                           "If GTM is also configured with GA4, this may cause duplicate analytics data. "
                           "Audit your GTM container to confirm.",
            confidence=CONFIDENCE_MEDIUM,
            note="Medium-confidence finding — inferred from co-existence of hardcoded gtag/js and GTM container. "
                 "Requires GTM container audit to confirm.",
        ))

    return findings
