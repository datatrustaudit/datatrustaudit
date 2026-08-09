"""Regressão do guia de correção e do gating por plano.

Apontar o problema é a parte fácil. O laudo só é útil se disser o que digitar
para resolver — e se o corte por plano for o mesmo em todos os pontos do
sistema, senão conteúdo pago vaza para quem não pagou (ou some de quem pagou).
"""
import pytest

from audit_engine.guia_de_correcao import (
    GUIAS,
    VISIBILIDADE_POR_PLANO,
    guia_para,
    quantidade_visivel,
    visibilidade_do_plano,
)
from audit_engine.storage_auditor import auditar_recusa, auditar_ordem_do_consent_mode


class TestVisibilidadePorPlano:
    """São dois planos: o Free lê o veredito, o Premium lê o laudo.

    O gratuito mostrava metade da lista de achados. Meia lista dá a impressão
    de laudo completo e some com o resto sem avisar — o cliente não tinha como
    saber que faltava. Agora ele recebe uma frase (audit_engine/veredito.py) e
    a contagem: "22 achados, o mais grave é coleta sem consentimento". É
    claramente parcial, e é o que motiva o upgrade.
    """

    def test_percentuais_definidos(self):
        assert visibilidade_do_plano("free") == 0.0
        assert visibilidade_do_plano("premium") == 1.00

    def test_free_nao_recebe_detalhe(self):
        from audit_engine.guia_de_correcao import plano_ve_detalhe
        assert plano_ve_detalhe("free") is False
        assert plano_ve_detalhe("premium") is True

    def test_pro_descontinuado_mantem_acesso_total(self):
        """Quem assinou o Pro antes de ele sair não pode ser rebaixado."""
        assert visibilidade_do_plano("pro") == 1.00

    def test_plano_desconhecido_cai_no_mais_restrito(self):
        """Errar para o lado de mostrar menos, nunca de vazar conteúdo pago."""
        assert visibilidade_do_plano("inventado") == VISIBILIDADE_POR_PLANO["free"]
        assert visibilidade_do_plano("") == VISIBILIDADE_POR_PLANO["free"]

    def test_premium_ve_tudo(self):
        assert quantidade_visivel(37, "premium") == 37

    def test_free_nao_ve_item_da_lista(self):
        """Ele lê o veredito, não a lista."""
        assert quantidade_visivel(10, "free") == 0

    def test_planos_ativos_sao_dois(self):
        from audit_engine.guia_de_correcao import PLANOS_ATIVOS
        assert PLANOS_ATIVOS == ("free", "premium")

    def test_plano_parcial_mostra_ao_menos_um(self):
        """Nenhum plano usa faixa intermediária hoje, mas a escala suporta —
        e lista vazia num plano que deveria mostrar algo parece defeito."""
        from audit_engine.guia_de_correcao import VISIBILIDADE_POR_PLANO
        VISIBILIDADE_POR_PLANO["_teste_parcial"] = 0.30
        try:
            assert quantidade_visivel(1, "_teste_parcial") == 1
            assert quantidade_visivel(10, "_teste_parcial") == 3
        finally:
            VISIBILIDADE_POR_PLANO.pop("_teste_parcial", None)

    def test_lista_vazia_nao_inventa_item(self):
        assert quantidade_visivel(0, "free") == 0

    def test_nunca_passa_do_total(self):
        for plano in ("free", "pro", "premium"):
            for total in range(0, 40):
                assert 0 <= quantidade_visivel(total, plano) <= total


class TestConteudoDosGuias:
    @pytest.mark.parametrize("chave", sorted(GUIAS.keys()))
    def test_guia_tem_o_essencial(self, chave):
        guia = GUIAS[chave]
        assert guia.o_que_esta_errado, f"{chave}: sem descrição do problema"
        assert guia.por_que_importa, f"{chave}: sem consequência prática"
        assert guia.como_corrigir, f"{chave}: sem passo a passo"
        assert guia.esforco in ("baixo", "medio", "alto")

    @pytest.mark.parametrize("chave", sorted(GUIAS.keys()))
    def test_passos_sao_acionaveis(self, chave):
        """Passo bom diz o que fazer; 'revise suas configurações' não ajuda ninguém."""
        for passo in GUIAS[chave].como_corrigir:
            assert len(passo) > 25, f"{chave}: passo curto demais — {passo!r}"

    @pytest.mark.parametrize("chave", sorted(GUIAS.keys()))
    def test_serializa_para_a_api(self, chave):
        d = GUIAS[chave].to_dict()
        assert d["whatIsWrong"] and d["whyItMatters"] and d["howToFix"]

    def test_achados_criticos_tem_guia(self):
        """Os que aparecem no laudo com severidade alta precisam de instrução."""
        for chave in ("tracking_after_rejection", "no_reject_option",
                      "cmp_present_no_ui", "no_consent_control",
                      "storage_without_consent", "consent_default_after_config"):
            assert guia_para(chave) is not None, f"{chave} sem guia de correção"

    def test_achado_positivo_nao_tem_guia(self):
        """'Recusa respeitada' não é problema: não há o que corrigir."""
        assert guia_para("rejection_respected") is None

    def test_chave_desconhecida_nao_quebra(self):
        assert guia_para("nao_existe_isso") is None

    def test_equivalencias_apontam_para_guia_real(self):
        for chave in ("tracking_before_consent", "critical_tracker", "no_cmp"):
            assert guia_para(chave) is not None, f"{chave} deveria cair num guia"


class TestGuiaChegaAoLaudo:
    class _Recusa:
        tentado = True
        conseguiu_recusar = True
        cmp_identificado = "Cookiebot"
        tem_opcao_de_aceitar = True
        tem_opcao_de_recusar = True
        rotulos_encontrados = []
        cookies_apos_recusa = [{"name": "_ga", "domain": ".loja.com.br"}]
        requisicoes_apos_recusa = []
        storage_apos_recusa = {}

    def test_achado_da_recusa_vem_com_guia(self):
        achados = auditar_recusa(self._Recusa(), tem_cmp=True)
        assert achados[0]["check"] == "tracking_after_rejection"
        guia = achados[0].get("guide")
        assert guia, "o achado chegou ao laudo sem instrução de correção"
        assert guia["howToFix"], "sem passo a passo"
        assert guia["codeExample"], "este caso precisa de exemplo de código"

    def test_problema_de_ordem_vem_com_guia(self):
        html = """<script>gtag('config','G-ABC1234567');</script>
                  <script>gtag('consent','default',{ad_storage:'denied'});</script>"""
        problemas = auditar_ordem_do_consent_mode(html)
        assert problemas[0]["guide"]["codeExample"], "ordem do consent mode sem exemplo"

    def test_recusa_respeitada_nao_traz_guia(self):
        class _OK(self._Recusa):
            cookies_apos_recusa = []
        achados = auditar_recusa(_OK(), tem_cmp=True)
        assert achados[0]["check"] == "rejection_respected"
        assert "guide" not in achados[0] or achados[0].get("guide") is None
