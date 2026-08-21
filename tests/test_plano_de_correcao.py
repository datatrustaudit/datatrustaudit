"""A seção "o que poderia estar melhor" não pode afirmar o que ninguém mediu.

Dois defeitos motivaram este arquivo, e os dois produziam laudo plausível — que
é o tipo que passa despercebido.

**1. O motor afirmava Consent Mode configurado a partir da CMP.**
`recommendation_engine` emitia "Consent Mode detected but signals not set to
'denied' by default" sob a condição `cmp_detected`, que só prova assinatura de
banner no HTML. Em terra.com.br a resposta trazia `consentModeV2=False` e
`consentModeVersion=None`, e o plano de correção listava, na mesma página, "CMv2
not configured" e "Google Consent Mode is configured". Duas afirmações opostas
sobre o mesmo fato derrubam tudo o que vem depois — inclusive a parte correta.

**2. A tela declarava conformidade sobre o que o plano tinha cortado.**
`api/audit` zera `recommendations` e anula `storage` inteiro quando
`showsDetail` é falso. A seção lia lista vazia como "a análise rodou e não
apontou nada" — conformidade afirmada sobre sete recomendações que o motor
tinha escrito e o plano gratuito não entrega.

Os testes de tela leem o texto do `.tsx` — mesmo caminho de
`tests/test_consent_mode_observado.py`, pelo mesmo motivo: o componente só
carrega dentro do empacotador, e a reintrodução do defeito é uma linha.
"""
from pathlib import Path

from audit_engine.models import ConsentAuditResult, TagFinding
from audit_engine.recommendation_engine import generate_recommendations

RAIZ = Path(__file__).resolve().parents[1]
SECAO = RAIZ / "static/src/components/laudo/PlanoDeCorrecao.tsx"

TITULO_DO_PADRAO_LIBERADO = "Consent Mode detected but signals not set to 'denied' by default"


def _recomendacoes(consent: ConsentAuditResult):
    """Só a parte de consentimento; o resto do motor não interessa aqui."""
    ga4 = TagFinding(
        id="ga4",
        name="Google Analytics 4",
        vendor="Google",
        type="analytics",
        confidence="high",
        detection_method="script_url",
    )
    return generate_recommendations(
        tags=[ga4],
        gtm=None,
        events=None,
        datalayer=[],
        consent=consent,
        privacy=None,
        duplicates=[],
        jurisdiction={"law": "LGPD"},
    )


def test_cmp_sem_consent_mode_nao_afirma_consent_mode_configurado():
    """O caso real de terra.com.br: banner presente, Consent Mode ausente."""
    consent = ConsentAuditResult(
        cmp_detected=True,
        cmp_name="Cookie Banner (Generic)",
        consent_mode_v2=False,
        consent_mode_version=None,
        has_default_denied=False,
    )
    titulos = [r.title for r in _recomendacoes(consent)]

    assert TITULO_DO_PADRAO_LIBERADO not in titulos, (
        "o laudo afirmou 'Consent Mode detected' sobre uma varredura que mediu "
        "consentModeVersion=None"
    )
    # A ausência continua sendo apontada — por quem de fato a mediu.
    assert any("without Google Consent Mode v2" in t for t in titulos)


def test_consent_mode_presente_com_padrao_liberado_continua_sendo_apontado():
    """A correção não pode ter emudecido o achado verdadeiro."""
    consent = ConsentAuditResult(
        cmp_detected=True,
        consent_mode_v2=True,
        consent_mode_version="v2",
        has_default_denied=False,
        consent_signals={
            "ad_storage": "granted",
            "analytics_storage": "granted",
            "ad_user_data": "granted",
            "ad_personalization": "granted",
        },
    )
    titulos = [r.title for r in _recomendacoes(consent)]
    assert TITULO_DO_PADRAO_LIBERADO in titulos


def test_consent_mode_presente_e_negado_por_padrao_nao_vira_achado():
    """Implementação correta não pode encher o laudo de alarme falso."""
    consent = ConsentAuditResult(
        cmp_detected=True,
        consent_mode_v2=True,
        consent_mode_version="v2",
        has_default_denied=True,
        consent_signals={"ad_storage": "denied", "analytics_storage": "denied"},
    )
    titulos = [r.title for r in _recomendacoes(consent)]
    assert TITULO_DO_PADRAO_LIBERADO not in titulos


# ── A tela ────────────────────────────────────────────────────────────────────

def test_secao_distingue_corte_por_plano_de_analise_vazia():
    """Lista vazia por corte de plano não pode virar 'nada a corrigir'."""
    texto = SECAO.read_text(encoding="utf-8")
    assert "detalheCortadoPeloPlano" in texto
    assert "não entregue no plano gratuito" in texto
    # As três frases precisam coexistir: são três estados diferentes, e
    # confundir dois deles é o defeito que este teste cobre.
    assert "rodou, nada a corrigir" in texto
    assert "não veio nesta varredura" in texto


def test_secao_publica_a_confianca_do_motor():
    """Achado que o motor marcou como não confirmado chega marcado na tela."""
    texto = SECAO.read_text(encoding="utf-8")
    assert "confiancaDe" in texto
    assert "Confiança baixa" in texto


def test_secao_trata_texto_de_reserva_do_backend_como_ausencia():
    """`_issue_from_recommendation` preenche impacto e correção com frase fixa.

    O fallback nunca falha, e é por isso que ele esconde o campo ausente: sem
    esta checagem a tela publica uma orientação que ninguém gerou.
    """
    texto = SECAO.read_text(encoding="utf-8")
    assert "review the implementation in gtm, ga4, cmp, and site source." in texto
    assert "may affect analytics data quality, privacy compliance, or debugging reliability." in texto
