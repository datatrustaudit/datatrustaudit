"""A aba de Consent Mode só pode afirmar o que a varredura mediu.

O defeito: `ConsentModeChecker.tsx` recebia um único booleano — `hasConsentTool`,
que responde apenas por "há assinatura de CMP no HTML" — e derivava dele o
diagnóstico inteiro. Afirmava "Consent Mode Detectado — seu site está
configurado com Google Consent Mode v2", inventava a versão ("v2"), o estado
padrão ("denied") e uma tabela de **sete** sinais com valores concretos
(`analytics_storage: Permitido`, `ad_storage: Negado`…). Três desses sete
(`functionality_storage`, `personalization_storage`, `security_storage`) o motor
nunca leu em varredura nenhuma. O "Compliance Score" era calculado sobre esse
objeto derivado, ou seja: uma porcentagem de si mesmo.

O motor mede de verdade — `consent.consentModeV2`, `consent.consentSignals`,
`consent.hasDefaultDenied`, `consent.hasRejectAll` — e nada disso chegava ao
componente, porque `DeepAnalysisPanel` passava só `url`, `detectedTags` e
`hasConsentTool`.

No laudo de exemplo (terra.com.br) a contradição era total: `cmpDetected=true`
levava a tela a declarar Consent Mode v2 configurado, enquanto a medição dizia
`consentModeV2=false`, `consentSignals={}` e o motor havia emitido o achado
`consent_mode_missing` com status **critical**. A aba paga afirmava exatamente o
contrário do que a varredura observou.

Num laudo levado a um DPO esse é o defeito mais caro que existe: ele afirma
conformidade. Erro para mais o cliente confere e reclama; "conforme" por engano
ele publica.

Os testes de tela leem o texto do arquivo `.tsx` — mesmo caminho de
`tests/test_relogio_do_servidor.py`, pelo mesmo motivo: o componente só carrega
dentro do empacotador, e a reintrodução da fabricação é uma linha, que é
exatamente a linha que se procura aqui.
"""
import json
import re
from pathlib import Path

import pytest

from api.audit import _normalize_audit_response
from audit_engine.consent_auditor import _CM_SIGNALS
from audit_engine.orchestrator import run_audit
from tests.test_campos_das_visoes import _Scan

RAIZ = Path(__file__).resolve().parents[1]
CHECKER = RAIZ / "static/src/components/ConsentModeChecker.tsx"
PAINEL = RAIZ / "static/src/components/DeepAnalysisPanel.tsx"
RESULTADO = RAIZ / "static/src/components/NewAuditResults.tsx"
AMOSTRA = RAIZ / "static/src/dev/laudo-de-exemplo.json"


@pytest.fixture(scope="module")
def resposta():
    resultado = run_audit("https://loja.com.br", _Scan())
    return _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)


@pytest.fixture(scope="module")
def fonte_do_checker():
    return CHECKER.read_text(encoding="utf-8")


class TestAMedicaoChegaAResposta:
    """Sem esses campos a tela não tem o que mostrar — e foi por isso que a
    versão anterior passou a inventar."""

    def test_a_resposta_traz_o_bloco_de_consentimento(self, resposta):
        assert "consent" in resposta, "sem o bloco `consent` a aba não tem medição alguma"

    def test_os_quatro_campos_que_a_tela_exibe_existem(self, resposta):
        consent = resposta["consent"]
        for campo in ("consentModeV2", "consentModeVersion", "hasDefaultDenied", "consentSignals"):
            assert campo in consent, f"`{campo}` sumiu da resposta — a tela volta a supor"

    def test_recusar_tudo_e_tri_estado(self, resposta):
        """`None` significa "o HTML não permite concluir". Rebaixar para `False`
        acusa o site de algo que ninguém mediu."""
        assert "hasRejectAll" in resposta["consent"]
        assert resposta["consent"]["hasRejectAll"] in (True, False, None)

    def test_os_achados_do_motor_chegam(self, resposta):
        achados = resposta["consent"].get("findings")
        assert isinstance(achados, list) and achados, "nenhum achado de consentimento na resposta"
        assert all(a.get("check") and a.get("label") and a.get("status") for a in achados)

    def test_site_sem_consent_mode_produz_o_achado_critico(self, resposta):
        """O cenário tem GA4 e nenhuma chamada `gtag('consent','default')`.
        É este achado que a tela precisa exibir em vez de declarar v2."""
        checks = {a["check"]: a for a in resposta["consent"]["findings"]}
        assert "consent_mode_missing" in checks
        assert checks["consent_mode_missing"]["status"] == "critical"
        assert resposta["consent"]["consentModeV2"] is False


class TestATelaNaoDerivaDeHasConsentTool:
    """`hasConsentTool` responde por banner, não por Consent Mode. Todo
    condicional sobre ele dentro desta aba já produziu afirmação inventada."""

    def test_nenhum_ternario_sobre_hasConsentTool(self, fonte_do_checker):
        derivacoes = re.findall(r"hasConsentTool\s*\?[^\n]*", fonte_do_checker)
        assert not derivacoes, (
            "a aba voltou a derivar diagnóstico de consentimento de um booleano "
            "sobre CMP:\n" + "\n".join(derivacoes)
        )

    def test_nao_ha_versao_nem_estado_padrao_montados_na_tela(self, fonte_do_checker):
        """A versão e o estado padrão nasciam como campos de um objeto local
        (`version: …`, `defaultState: …`). Quem os mede é o motor, e os nomes
        que ele usa são `consentModeVersion` e `hasDefaultDenied` — qualquer
        campo local com esses papéis é diagnóstico remontado na tela."""
        assert not re.search(r"\bversion\s*:", fonte_do_checker), (
            "a versão do Consent Mode voltou a ser decidida na tela"
        )
        assert not re.search(r"\bdefaultState\s*:", fonte_do_checker), (
            "o estado padrão do Consent Mode voltou a ser decidido na tela"
        )

    def test_nao_ha_mapa_de_sinais_com_valor_fixo(self, fonte_do_checker):
        """A tabela de sete sinais nascia de um objeto literal `signals: {…}`
        montado na tela."""
        assert not re.search(r"signals\s*:\s*\{", fonte_do_checker), (
            "voltou a existir um mapa de sinais montado na tela"
        )
        assert "not_set" not in fonte_do_checker, (
            "'not_set' é o valor de preenchimento da tabela fabricada"
        )

    def test_a_tela_le_os_campos_medidos(self, fonte_do_checker):
        for campo in ("consentModeV2", "consentModeVersion", "hasDefaultDenied",
                      "consentSignals", "hasRejectAll", "tagsBeforeConsent"):
            assert campo in fonte_do_checker, (
                f"a aba não lê `{campo}` — só afirma o que consegue ler"
            )

    def test_a_tela_exibe_os_achados_do_motor(self, fonte_do_checker):
        assert re.search(r"consent\??\.\s*findings", fonte_do_checker), (
            "sem exibir `findings`, o achado `consent_mode_missing` não aparece "
            "na aba que fala justamente de Consent Mode"
        )

    def test_a_ausencia_de_medicao_e_dita(self, fonte_do_checker):
        """Campo ausente é dito, não preenchido."""
        assert "não medido" in fonte_do_checker or "não verificad" in fonte_do_checker


class TestSoAparecemOsSinaisQueOMotorLe:
    """A varredura procura quatro sinais dentro de `gtag('consent','default')`.
    Exibir mais do que isso é inventar linha de tabela."""

    def test_a_lista_da_tela_bate_com_a_do_motor(self, fonte_do_checker):
        bloco = re.search(
            r"SINAIS_LIDOS_PELO_MOTOR\s*=\s*\[(.*?)\]", fonte_do_checker, re.S
        )
        assert bloco, "a lista de sinais lidos sumiu do componente"
        na_tela = set(re.findall(r"['\"]([a-z_]+)['\"]", bloco.group(1)))
        assert na_tela == set(_CM_SIGNALS), (
            "a tela e o motor discordam sobre quais sinais são lidos: "
            f"tela={sorted(na_tela)} motor={sorted(_CM_SIGNALS)}"
        )


class TestOPainelEntregaAMedicao:
    """De nada adianta o componente saber ler se ninguém lhe passa o dado."""

    def test_o_painel_passa_consent_para_a_aba(self):
        fonte = PAINEL.read_text(encoding="utf-8")
        assert re.search(r"<ConsentModeChecker[\s\S]{0,400}?consent=\{consent\}", fonte), (
            "DeepAnalysisPanel voltou a chamar a aba sem o bloco `consent`"
        )

    def test_o_laudo_passa_consent_para_o_painel(self):
        """Duas chamadas: a aba "IA PRO" e o Deep Scan multi-página. Uma só
        corrigida deixa a outra fabricando."""
        fonte = RESULTADO.read_text(encoding="utf-8")
        chamadas = re.findall(
            r"<DeepAnalysisPanel[\s\S]{0,800}?consent=\{result\.consentAudit\}", fonte
        )
        assert len(chamadas) == 2, (
            f"{len(chamadas)} de 2 chamadas de DeepAnalysisPanel entregam o bloco `consent`"
        )


class TestAAmostraDeConferenciaContradizATelaAntiga:
    """Regressão do caso concreto: é este laudo que `/dev/laudo` abre."""

    def test_a_amostra_tem_cmp_mas_nao_tem_consent_mode(self):
        amostra = json.loads(AMOSTRA.read_text(encoding="utf-8"))
        consent = amostra["consent"]
        assert consent["cmpDetected"] is True
        assert consent["consentModeV2"] is False
        assert consent["consentSignals"] == {}
        checks = {a["check"]: a["status"] for a in consent["findings"]}
        assert checks.get("consent_mode_missing") == "critical", (
            "a amostra deixou de cobrir o caso em que a tela afirmava o "
            "contrário da medição — regenere-a ou ajuste este teste"
        )
