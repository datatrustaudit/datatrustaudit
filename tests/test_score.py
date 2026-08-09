"""O score precisa ordenar sites — senão é enfeite.

Medido antes desta reforma: um site com 7 não conformidades e outro com 12
recebiam ambos 45. Um site impecável — CMP, Consent Mode com default denied,
nada disparando antes do aceite — recebia 73, reprovado junto com os outros.
O número no topo do laudo não separava nada, e é o primeiro que o cliente lê.

Duas causas:

- `privacy_risk` somava penalidades e cortava em 100. A partir de ~4 achados
  qualquer site virava o mesmo número.
- `event_architecture` devolvia 50 quando não havia evento. Página inicial sem
  interação normalmente não dispara evento algum, então esse 50 entrava com
  peso 0,20 em quase todo laudo e puxava tudo para o meio.

O que os testes abaixo garantem é a propriedade que faltava: mais problema,
menos score, sempre.
"""
import pytest

from audit_engine.score_engine import (
    _curva_de_risco,
    compute_consent_integrity,
    compute_event_architecture,
    compute_privacy_risk,
    compute_scores,
)


class _Violacao:
    def __init__(self, severity):
        self.severity = severity


class _Privacy:
    def __init__(self, violacoes, tem_cmp=True):
        self.violations = [_Violacao(s) for s in violacoes]
        self.has_consent_tool = tem_cmp


class _Consent:
    cmp_detected = True
    consent_mode_v2 = True
    consent_mode_version = "v2"
    has_default_denied = True
    has_reject_all = True
    has_privacy_policy = True
    has_cookie_policy = True
    tags_before_consent = []


class TestCurvaDeRisco:
    def test_zero_e_zero(self):
        assert _curva_de_risco(0) == 0

    def test_nunca_passa_de_100(self):
        assert _curva_de_risco(10_000) <= 100

    def test_e_estritamente_crescente(self):
        """A exponencial anterior empatava tudo acima de ~200 pontos."""
        valores = [_curva_de_risco(p) for p in (30, 60, 110, 230, 350, 700)]
        for anterior, seguinte in zip(valores, valores[1:]):
            assert seguinte > anterior, f"empatou: {valores}"

    def test_distingue_sete_de_doze_achados(self):
        """O caso real: 45 para os dois, na versão anterior."""
        sete = _curva_de_risco(230)
        doze = _curva_de_risco(350)
        assert doze - sete >= 5, f"7 achados={sete}, 12 achados={doze} — perto demais"


class TestEixoNaoMedidoFicaDeFora:
    def test_sem_eventos_devolve_none(self):
        """`50` era uma afirmação falsa: não medimos, não é 'mediano'."""
        assert compute_event_architecture(None) is None

    def test_sinal_nao_observado_nao_penaliza_consentimento(self):
        """`has_reject_all is None` significa que o teste de recusa não rodou."""
        class _NaoTestado(_Consent):
            has_reject_all = None

        completo = compute_consent_integrity(_Consent())
        parcial = compute_consent_integrity(_NaoTestado())
        assert parcial == completo == 100, (
            f"site correto perdeu ponto por sinal não observado: {parcial} vs {completo}"
        )

    def test_ausencia_observada_penaliza(self):
        """Não observar é diferente de observar que não tem."""
        class _SemRecusa(_Consent):
            has_reject_all = False

        assert compute_consent_integrity(_SemRecusa()) < 100

    def test_peso_do_eixo_ausente_e_redistribuido(self):
        """Sem eventos, o score sai dos outros eixos — não de um 50 inventado."""
        sem_eventos = compute_scores([], None, None, [], _Consent(), _Privacy([]), [])
        assert sem_eventos.overall >= 70, (
            f"site sem problema algum ficou em {sem_eventos.overall} por não ter eventos"
        )


class TestOrdenacao:
    """A propriedade que faltava: mais problema, menos score."""

    def _score(self, violacoes, tem_cmp=True, tags_antes=0):
        """Cenário coerente: os dois sinais de CMP vêm da mesma varredura.

        Manter `consent_integrity` perfeito enquanto `privacy.has_consent_tool`
        dizia False descrevia um site impossível — e escondia a amplitude real
        da escala.
        """
        class _C(_Consent):
            tags_before_consent = list(range(tags_antes))
            cmp_detected = tem_cmp
            consent_mode_v2 = tem_cmp
            consent_mode_version = "v2" if tem_cmp else None
            has_default_denied = tem_cmp
            has_reject_all = tem_cmp
            has_cookie_policy = tem_cmp

        return compute_scores(
            [], None, None, [], _C(), _Privacy(violacoes, tem_cmp), []
        ).overall

    def test_mais_violacoes_nunca_aumenta_o_score(self):
        anterior = 101
        for n in range(0, 15):
            atual = self._score(["high"] * n)
            assert atual <= anterior, f"{n} violações deu score maior que {n-1}"
            anterior = atual

    def test_critica_pesa_mais_que_baixa(self):
        assert self._score(["critical"]) < self._score(["low"])

    def test_sem_cmp_pontua_menos(self):
        assert self._score([], tem_cmp=False) < self._score([], tem_cmp=True)

    def test_tag_antes_do_consentimento_derruba(self):
        assert self._score([], tags_antes=3) < self._score([], tags_antes=0)

    def test_site_impecavel_passa_de_80(self):
        """Quem corrigiu tudo precisa ver isso no número, senão o laudo não
        serve para provar conformidade — só para acusar."""
        assert self._score([]) >= 80

    def test_site_pessimo_fica_abaixo_de_50(self):
        pessimo = self._score(["critical"] * 6 + ["high"] * 6, tem_cmp=False, tags_antes=5)
        assert pessimo < 50, f"site sem CMP e com 12 achados ficou em {pessimo}"

    def test_faixa_util_nao_colapsa(self):
        """Bom, médio e ruim precisam cair em faixas distintas."""
        bom = self._score([])
        medio = self._score(["medium", "medium"])
        ruim = self._score(["critical"] * 4, tem_cmp=False, tags_antes=3)
        assert bom > medio > ruim
        assert bom - ruim >= 30, f"amplitude pequena demais: {bom} a {ruim}"


class TestSemDados:
    def test_privacy_ausente_nao_quebra(self):
        assert compute_privacy_risk(None) == 0

    def test_consent_ausente_devolve_none(self):
        assert compute_consent_integrity(None) is None

    def test_scan_vazio_nao_estoura(self):
        s = compute_scores([], None, None, [], None, None, [])
        assert 0 <= s.overall <= 100
