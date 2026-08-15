"""
audit_engine.orchestrator — Main audit pipeline.

Coordinates all analyzers and assembles the final AuditResult.
Accepts a BrowserScanResult (from browser_fetcher) so every analyzer
can use both rendered HTML and runtime data (network requests, dataLayer, etc.).
"""
from typing import List, Optional

from .tempo import agora_utc_iso
from .models import AuditResult, DataQualityNote, TagFinding, ConsentFinding, CONFIDENCE_HIGH
from .browser_fetcher import BrowserScanResult
from .tag_detector import detect_tags
from .gtm_analyzer import analyze_gtm
from .event_auditor import audit_events
from .datalayer_auditor import audit_datalayer
from .consent_auditor import audit_consent
from .privacy_analyzer import detect_jurisdiction, analyze_privacy
from .duplicate_detector import detect_duplicates
from .score_engine import compute_scores
from .recommendation_engine import generate_recommendations
from .storage_auditor import auditar_armazenamento, auditar_ordem_do_consent_mode, auditar_recusa


def _build_data_quality_notes(
    scan: BrowserScanResult,
    tags: list,
    events_result,
) -> List[DataQualityNote]:
    """Emit honest limitations about what this scan cannot observe."""
    notes = []

    # Estas notas aparecem no laudo entregue ao cliente. Em português, dizendo o
    # que NÃO foi verificado — é o que separa uma auditoria honesta de uma que
    # finge ter olhado tudo.
    if scan.fallback_used:
        notes.append(DataQualityNote(
            limitation="Leitura apenas do HTML — o navegador não pôde ser usado",
            reason="O navegador automatizado falhou ou não estava disponível, então só o "
                   "HTML inicial foi analisado. Tags carregadas por JavaScript (acionadas "
                   "pelo GTM, scripts adiados, telas de aplicação) podem não ter sido "
                   "detectadas, e não foi possível ler cookies nem a ordem real de disparo. "
                   + (f"Erro do navegador: {scan.error}" if scan.error else ""),
            affected_areas=["eventos", "e-commerce", "tags dinâmicas", "consentimento"],
        ))
    else:
        notes.append(DataQualityNote(
            limitation="Varredura de uma página",
            reason="Esta auditoria abriu o endereço informado em um navegador real e "
                   "aguardou a rede se acomodar. Eventos disparados em outras páginas "
                   "(checkout, confirmação de compra), após interação do visitante ou "
                   "atrás de login não são capturados nesta varredura.",
            affected_areas=["eventos", "e-commerce", "eventos de compra"],
        ))

    notes.append(DataQualityNote(
        limitation="Coleta feita pelo servidor não é observável",
        reason="Rastreamento server-side (GTM server-side, Measurement Protocol, CAPI da "
               "Meta) parte do seu servidor, não do navegador do visitante — nenhum "
               "scanner que roda no navegador enxerga isso, este inclusive. Quando o "
               "endereço de coleta usa domínio próprio, a auditoria consegue identificá-lo "
               "pelo formato do envio; o restante fica fora do alcance.",
        affected_areas=["eventos", "ga4", "conversões"],
    ))

    # Warn if no tags were found at all
    if not tags and not scan.intercepted_requests:
        notes.append(DataQualityNote(
            limitation="Nenhum rastreador encontrado — o que pode explicar",
            reason=(
                "A varredura não encontrou tags nem requisições de rastreamento. "
                "Isso costuma acontecer quando:\n"
                "• o site bloqueia navegadores automatizados;\n"
                "• todo o rastreamento é feito pelo servidor, sem script na página;\n"
                "• os scripts só carregam depois do consentimento;\n"
                "• a página exige login;\n"
                "• os scripts só carregam após rolagem ou clique.\n"
                "Se você tem o container do GTM exportado, a aba de upload analisa "
                "o arquivo diretamente."
            ),
            affected_areas=["tags", "eventos", "consentimento", "privacidade"],
        ))

    has_gtm = any(getattr(t, "id", None) == "gtm" for t in tags)
    total_events = events_result.total_events if events_result else 0
    if has_gtm and total_events == 0:
        notes.append(DataQualityNote(
            limitation="GTM presente, mas nenhum evento visível no código",
            reason="O Google Tag Manager está instalado e os eventos parecem ser "
                   "disparados por acionadores configurados dentro dele, depois do "
                   "carregamento. Os envios do GA4 capturados pela rede aparecem na "
                   "aba de eventos quando existem.",
            affected_areas=["eventos", "dataLayer"],
        ))

    notes.append(DataQualityNote(
        limitation="Avaliação técnica — não é parecer jurídico",
        reason="Tudo aqui vem de comportamento observável da página: o que foi "
               "carregado, o que foi gravado no navegador e o que foi enviado, e em "
               "que ordem. É evidência técnica, útil para embasar decisão, mas a "
               "qualificação jurídica de cada ponto cabe a um profissional de "
               "privacidade.",
        affected_areas=["conformidade", "não conformidades", "exposição"],
    ))

    return notes


TIPOS_QUE_EXIGEM_CONSENTIMENTO = ("analytics", "advertising", "heatmap", "marketing")


def _disparou_durante_o_scan(tag: TagFinding, scan) -> bool:
    """A tag chegou a fazer requisição de rede durante a varredura?

    O scanner nunca clica em "aceitar". Então qualquer requisição a um endpoint
    de rastreamento observada durante a visita é prova de que a tag disparou
    sem consentimento — independente de existir banner na página.
    """
    import re
    from .tag_detector import VENDOR_CATALOG

    requisicoes = getattr(scan, "intercepted_requests", None) or []
    if not requisicoes:
        return False

    padroes = (VENDOR_CATALOG.get(tag.id) or {}).get("url_patterns") or []
    for req in requisicoes:
        url = getattr(req, "url", "") or ""
        for padrao in padroes:
            if re.search(padrao, url, re.IGNORECASE):
                return True
    return False


def _find_tags_before_consent(html: str, tags: List[TagFinding], scan=None) -> List[TagFinding]:
    """Tags que rodam sem consentimento válido.

    Duas correções sobre a versão anterior, que só comparava posições no HTML:

    1. Sem CMP na página, a função devolvia lista vazia — ou seja, no PIOR caso
       jurídico (nenhum consentimento, tudo disparando) o relatório não
       apontava uma tag sequer. Sem CMP, todo rastreador está irregular.

    2. Com CMP, bastava o script do banner aparecer antes das tags para o
       resultado sair limpo. Posição no HTML não prova bloqueio: o CMP pode
       carregar primeiro e não bloquear nada. Agora a evidência de rede
       (a tag disparou durante a visita, sem ninguém aceitar) também conta.
    """
    import re
    cmp_signals = [
        r"consent\.cookiebot\.com",
        r"cdn\.cookielaw\.org",
        r"sdk\.privacy-center\.org",
        r"app\.usercentrics\.eu",
        r"OptanonWrapper",
        r"CookieConsent",
        r"Didomi\.ready",
        r"gtag\s*\(\s*['\"]consent",
    ]
    cmp_pos = None
    for pat in cmp_signals:
        m = re.search(pat, html, re.IGNORECASE)
        if m and (cmp_pos is None or m.start() < cmp_pos):
            cmp_pos = m.start()

    rastreadores = [
        t for t in tags
        if t.type != "consent" and t.type in TIPOS_QUE_EXIGEM_CONSENTIMENTO
    ]

    # Sem CMP não existe consentimento a respeitar: todo rastreador é irregular.
    if cmp_pos is None:
        return rastreadores

    before = []
    for tag in rastreadores:
        # (a) declarada antes do banner no código-fonte
        posicionada_antes = tag.position is not None and tag.position < cmp_pos
        # (b) disparou de fato durante a visita, sem aceite — o banner não bloqueou
        disparou_sem_aceite = _disparou_durante_o_scan(tag, scan) if scan else False
        if posicionada_antes or disparou_sem_aceite:
            before.append(tag)
    return before


def run_audit(
    url: str,
    scan: "BrowserScanResult",  # accepts BrowserScanResult OR plain html string (backward compat)
    use_view_source: bool = False,
) -> AuditResult:
    """
    Main audit pipeline. Accepts a BrowserScanResult from browser_fetcher.
    All analyzers receive both rendered HTML and runtime data.
    Errors within individual analyzers are caught to prevent cascading failures.
    """
    # Backward compatibility: if a plain html string is passed, wrap it
    if isinstance(scan, str):
        from .browser_fetcher import BrowserScanResult as BSR
        html_str = scan
        scan = BSR(url=url, html=html_str, scan_method="html_fallback", fallback_used=True)

    html = scan.html
    # Vai para `raw_data.timestamp` e, ao reabrir um laudo pelo histórico, pode
    # virar a data do cabeçalho: precisa ser o mesmo UTC do resto da resposta.
    timestamp = agora_utc_iso()

    # ── 1. Tag detection ──────────────────────────────────────────────────────
    try:
        tags = detect_tags(html, scan=scan)
    except Exception as e:
        print(f"[audit_engine] Tag detection error: {e}")
        import traceback; traceback.print_exc()
        tags = []

    # ── 2. Tags before consent ────────────────────────────────────────────────
    try:
        tags_before_consent = _find_tags_before_consent(html, tags, scan=scan)
        # Marca o flag em cada tag. Ele existia no modelo e nunca era escrito:
        # ficava False para todo mundo, e é justamente o que alimenta a coluna
        # "Loaded Before Consent?" do Excel, a linha "Antes do Cookie" do PDF e
        # a contagem de violações do Dashboard. O relatório entregue ao cliente
        # respondia "Não" mesmo num site sem nenhum consentimento.
        irregulares = {id(t) for t in tags_before_consent}
        for tag in tags:
            tag.is_before_consent = id(tag) in irregulares
    except Exception:
        tags_before_consent = []

    # ── 3. GTM quality ────────────────────────────────────────────────────────
    try:
        gtm_quality = analyze_gtm(html)
    except Exception as e:
        print(f"[audit_engine] GTM analyzer error: {e}")
        gtm_quality = None

    # ── 4. Event auditing ─────────────────────────────────────────────────────
    try:
        events_result = audit_events(html, scan=scan)
    except Exception as e:
        print(f"[audit_engine] Event auditor error: {e}")
        import traceback; traceback.print_exc()
        events_result = None

    # ── 5. DataLayer audit ────────────────────────────────────────────────────
    try:
        datalayer_findings = audit_datalayer(html)
    except Exception as e:
        print(f"[audit_engine] DataLayer auditor error: {e}")
        datalayer_findings = []

    # ── 6. Consent audit ─────────────────────────────────────────────────────
    try:
        tags_before_consent_names = [t.name for t in tags_before_consent]
        consent_result = audit_consent(html, tags_before_consent_names, scan=scan)
    except Exception as e:
        print(f"[audit_engine] Consent auditor error: {e}")
        consent_result = None

    # ── 6b. Cookies, storage e ordem real de disparo ─────────────────────────
    # O scanner nunca clica em "aceitar": tudo observado aqui aconteceu sem
    # consentimento. É evidência direta, e não inferência por posição no HTML.
    try:
        has_cmp_para_storage = consent_result.cmp_detected if consent_result else False
        storage_result = auditar_armazenamento(scan, has_cmp_para_storage)
        storage_result.problemas_de_ordem = auditar_ordem_do_consent_mode(html)

        # Teste do "Recusar": mede o que o site faz DEPOIS de o usuário negar
        # consentimento. É a única evidência que distingui má configuração de
        # decisão do titular ignorada.
        recusa = getattr(scan, "consent_rejection", None)
        if recusa is not None:
            storage_result.achados_da_recusa = auditar_recusa(recusa, has_cmp_para_storage)
            storage_result.recusa = recusa.to_dict() if hasattr(recusa, "to_dict") else None
            if consent_result is not None:
                for achado in storage_result.achados_da_recusa:
                    consent_result.findings.append(ConsentFinding(
                        check=achado["check"],
                        label=achado["label"],
                        status=achado["status"],
                        description=achado["description"],
                        recommendation=achado.get("recommendation", ""),
                        confidence=CONFIDENCE_HIGH,
                    ))
        if consent_result is not None and storage_result.problemas_de_ordem:
            for problema in storage_result.problemas_de_ordem:
                consent_result.findings.append(ConsentFinding(
                    check=problema["check"],
                    label=problema["label"],
                    status=problema["status"],
                    description=problema["description"],
                    recommendation=problema["recommendation"],
                    confidence=CONFIDENCE_HIGH,
                ))
    except Exception as e:
        print(f"[audit_engine] Storage auditor error: {e}")
        storage_result = None

    # ── 7. Privacy / compliance analysis ─────────────────────────────────────
    try:
        jurisdiction = detect_jurisdiction(html, url)
        has_consent_tool = consent_result.cmp_detected if consent_result else False

        # Coerência do laudo: a CMP pode estar no código e não exibir controle
        # nenhum (banner restrito à União Europeia é a causa comum). Nesse caso
        # não existe consentimento a respeitar, e dizer que a tag "carregou
        # antes do sinal de consentimento" é impreciso — não há sinal. Para
        # efeito de análise, vale como ausência de consentimento.
        if storage_result is not None and any(
            achado.get("check") == "cmp_present_no_ui"
            for achado in (storage_result.achados_da_recusa or [])
        ):
            has_consent_tool = False
        privacy_result = analyze_privacy(
            tags, has_consent_tool, tags_before_consent, jurisdiction, storage=storage_result
        )
    except Exception as e:
        print(f"[audit_engine] Privacy analyzer error: {e}")
        jurisdiction = {"law": "General Privacy", "region": "Unknown", "law_full": "General Privacy"}
        privacy_result = None

    # ── 8. Duplication detection ──────────────────────────────────────────────
    try:
        events_list = events_result.events if events_result else []
        duplicates = detect_duplicates(html, tags, events_list)
    except Exception as e:
        print(f"[audit_engine] Duplicate detector error: {e}")
        duplicates = []

    # ── 9. Scoring ────────────────────────────────────────────────────────────
    try:
        scores = compute_scores(tags, gtm_quality, events_result, datalayer_findings,
                                consent_result, privacy_result, duplicates)
    except Exception as e:
        print(f"[audit_engine] Score engine error: {e}")
        scores = None

    # ── 10. Recommendations ───────────────────────────────────────────────────
    try:
        recommendations = generate_recommendations(
            tags, gtm_quality, events_result, datalayer_findings,
            consent_result, privacy_result, duplicates, jurisdiction,
        )
    except Exception as e:
        print(f"[audit_engine] Recommendation engine error: {e}")
        recommendations = []

    # ── 11. Data quality notes ────────────────────────────────────────────────
    try:
        dq_notes = _build_data_quality_notes(scan, tags, events_result)
    except Exception:
        dq_notes = []

    # `scan_method` descreve COMO a página foi coletada: navegador, HTML
    # estático ou HAR. É esse campo que a visão jurídica publica como "método"
    # na identificação da varredura.
    #
    # Ele vinha sendo sobrescrito para "view_source" sempre que a análise
    # view-source estava ligada — e ela liga para todo plano premium. O laudo
    # pago declarava então ter lido o código-fonte, ao mesmo tempo em que
    # listava cookies gravados e uma linha do tempo de requisições, que só o
    # navegador observa. Num documento que se propõe a servir de evidência, uma
    # contradição dessas derruba a peça inteira: se você só leu o HTML, como viu
    # o cookie?
    #
    # Localizar a posição exata da tag no HTML é uma análise A MAIS sobre a
    # mesma coleta — não um método de coleta.
    scan_method = scan.scan_method

    return AuditResult(
        url=url,
        timestamp=timestamp,
        tags=tags,
        gtm_quality=gtm_quality,
        events=events_result,
        datalayer_findings=datalayer_findings,
        consent=consent_result,
        privacy=privacy_result,
        duplicates=duplicates,
        storage=storage_result,
        scores=scores,
        recommendations=recommendations,
        data_quality_notes=dq_notes,
        scan_method=scan_method,
    )
