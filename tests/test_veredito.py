"""A frase única que o plano gratuito recebe.

O free deixou de ver meia lista de achados e passou a ver o veredito: o que
está errado, e qual dispositivo isso contraria. Meia lista dava a impressão de
laudo completo e sumia com o resto sem avisar — o cliente não tinha como saber
que faltava metade. Uma frase é claramente uma frase.

Isso concentra num único texto o peso que antes estava espalhado: é o que
convence a assinar e, se estiver errado, é o que queima o produto. Por isso a
frase é montada dos mesmos achados que o laudo pago detalha, e não gerada por
modelo a cada execução — texto inventado pode citar o artigo errado ou afirmar
o que a varredura não observou.
"""
import pytest

from audit_engine.veredito import gerar_veredito


class TestSiteLimpo:
    def test_reconhece_e_celebra(self):
        v = gerar_veredito(total_de_achados=0, total_de_tags=3)
        assert v["conforme"] is True
        assert "parabéns" in v["titulo"].lower()
        assert v["artigo"] is None, "site conforme não contraria dispositivo nenhum"

    def test_menciona_as_tags_que_se_comportam(self, ):
        """Dizer só "nada encontrado" soa como varredura que não rodou."""
        v = gerar_veredito(total_de_achados=0, total_de_tags=3)
        assert "3" in v["frase"]

    def test_site_sem_tag_alguma(self):
        v = gerar_veredito(total_de_achados=0, total_de_tags=0)
        assert v["conforme"] is True
        assert "não encontramos" in v["frase"].lower()

    def test_tag_antes_do_consentimento_impede_o_selo_verde(self):
        """Contagem zerada com tag disparando antes seria "conforme" por
        engano — o erro mais caro que este produto pode cometer."""
        v = gerar_veredito(total_de_achados=0, tags_antes_do_consentimento=2, total_de_tags=2)
        assert v["conforme"] is False

    def test_pii_impede_o_selo_verde(self):
        v = gerar_veredito(total_de_achados=0, pii_exposta=1)
        assert v["conforme"] is False


class TestOQueEleAnuncia:
    """Quem lê uma frase só precisa receber a pior notícia, não a primeira."""

    def test_pii_vem_antes_de_tudo(self):
        v = gerar_veredito(
            total_de_achados=9, tem_cmp=False, pii_exposta=2,
            tags_antes_do_consentimento=5,
        )
        assert v["motivo"] == "pii"
        assert "art. 6" in v["artigo"]

    def test_sem_cmp_cita_o_artigo_do_consentimento(self):
        v = gerar_veredito(
            total_de_achados=8, tem_cmp=False,
            tags_antes_do_consentimento=3, total_de_tags=3,
        )
        assert v["motivo"] == "cmp_ausente"
        assert "art. 7º, I" in v["artigo"]
        assert "3" in v["frase"]

    def test_cmp_que_nao_bloqueia_e_caso_proprio(self):
        """É diferente de não ter CMP: aqui existe aviso, e ele não impede
        nada. Confundir os dois faria o laudo recomendar o que já existe."""
        v = gerar_veredito(
            total_de_achados=5, tem_cmp=True,
            tags_antes_do_consentimento=2, cookies_sem_consentimento=4,
        )
        assert v["motivo"] == "cmp_sem_bloqueio"
        assert "art. 8º" in v["artigo"]
        assert "4" in v["frase"], "o número de cookies dá peso à afirmação"

    def test_achados_sem_relacao_com_consentimento(self):
        v = gerar_veredito(
            total_de_achados=3, por_gravidade={"critical": 1, "high": 2},
            tem_cmp=True, tags_antes_do_consentimento=0,
        )
        assert v["conforme"] is False
        assert "3" in v["titulo"]


class TestAFraseSeSustenta:
    def test_toda_frase_tem_titulo_e_corpo(self):
        cenarios = [
            dict(total_de_achados=0),
            dict(total_de_achados=1, tem_cmp=True),
            dict(total_de_achados=8, tem_cmp=False, tags_antes_do_consentimento=3),
            dict(total_de_achados=4, tem_cmp=True, tags_antes_do_consentimento=1),
            dict(total_de_achados=9, pii_exposta=1),
        ]
        for kw in cenarios:
            v = gerar_veredito(**kw)
            assert v["titulo"] and len(v["titulo"]) > 8
            assert v["frase"] and len(v["frase"]) > 60, f"frase curta demais: {v['frase']}"
            assert v["motivo"]

    def test_nao_afirma_o_que_nao_foi_observado(self):
        """"Coletou" é diferente de "pode coletar", e é essa diferença que
        sustenta o laudo perante quem for contestá-lo."""
        v = gerar_veredito(total_de_achados=0, total_de_tags=2)
        for termo in ("pode estar", "provavelmente", "talvez", "possivelmente"):
            assert termo not in v["frase"].lower()

    def test_entrada_vazia_nao_quebra(self):
        v = gerar_veredito(total_de_achados=0)
        assert v["conforme"] is True
        assert v["frase"]
