"""O que a resposta entrega a cada plano, e por que os números não podem brigar.

A tela mostrava **"0 tag(s) detectada(s)" ao lado de "15 achados"**, e um selo
de "50% visível" num laudo que o servidor tinha cortado como gratuito. Três
causas somadas:

- O frontend mantinha a própria tabela de visibilidade (50/75/100%), divergente
  da do servidor.
- O Dashboard cortava a lista **de novo**, por cima do corte que já viera
  pronto — corte duplo, que em outra época deixou o gratuito vendo 15% do laudo.
- O seletor de plano do modo dev mudava só o estado do React: o servidor
  continuava lendo o plano do banco, então a tela dizia "Pro" e recebia dados
  de "free".

Contradição numérica é pior que dado ausente: quem vê "0 tags" e "15 achados"
na mesma tela não conclui que falta upgrade — conclui que a ferramenta está
errada, e aí duvida também do que está certo.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.audit import _normalize_audit_response
from audit_engine.guia_de_correcao import plano_ve_detalhe, quantidade_visivel
from audit_engine.orchestrator import run_audit
from tests.test_campos_das_visoes import _Scan


@pytest.fixture(scope="module")
def resultado():
    return run_audit("https://loja.com.br", _Scan())


def _resposta(resultado, plano):
    return _normalize_audit_response("https://loja.com.br", plano, _Scan(), resultado)


class TestOsNumerosNaoSeContradizem:
    def test_free_sem_tags_mas_com_contagem_declarada(self, resultado):
        """Sem lista é o esperado; sem contagem seria defeito.

        A tela precisa poder dizer "encontramos 15, e o laudo completo mostra
        quais" — o que exige a lista vazia E o número cheio.
        """
        free = _resposta(resultado, "free")
        assert free["tags"] == []
        assert free["summary"]["totalTags"] > 0, (
            "sem o total, a tela mostra 0 tags e 15 achados e parece quebrada"
        )

    def test_total_de_tags_e_o_real_nos_dois_planos(self, resultado):
        free = _resposta(resultado, "free")
        premium = _resposta(resultado, "premium")
        assert free["summary"]["totalTags"] == premium["summary"]["totalTags"]

    def test_contagem_de_achados_e_a_mesma(self, resultado):
        free = _resposta(resultado, "free")
        premium = _resposta(resultado, "premium")
        assert free["summary"]["violationsCount"] == premium["summary"]["violationsCount"]
        assert free["summary"]["violationsBySeverity"] == premium["summary"]["violationsBySeverity"]

    def test_grafico_de_gravidade_tem_o_que_desenhar_no_free(self, resultado):
        """O gráfico lê o agregado, não a lista — foi assim que ele deixou de
        nascer vazio ao lado do contador cheio."""
        free = _resposta(resultado, "free")
        assert sum(free["summary"]["violationsBySeverity"].values()) > 0


class TestQuemDecideOCorte:
    def test_a_resposta_declara_o_nivel_de_detalhe(self, resultado):
        """`showsDetail` existe para o frontend não precisar adivinhar pelo
        nome do plano — adivinhar foi o que criou a divergência."""
        assert _resposta(resultado, "free")["showsDetail"] is False
        assert _resposta(resultado, "premium")["showsDetail"] is True

    def test_o_plano_vem_declarado_na_resposta(self, resultado):
        assert _resposta(resultado, "free")["plan"] == "free"
        assert _resposta(resultado, "premium")["plan"] == "premium"

    def test_regra_de_visibilidade_e_uma_so(self):
        """O frontend espelha estes valores; divergir foi o que produziu o
        selo de "50% visível" sobre uma lista vazia."""
        assert quantidade_visivel(10, "free") == 0
        assert quantidade_visivel(10, "premium") == 10
        assert plano_ve_detalhe("free") is False
        assert plano_ve_detalhe("premium") is True

    def test_pro_descontinuado_mantem_acesso(self):
        """Quem assinou antes não pode ser rebaixado por mudança de catálogo."""
        assert plano_ve_detalhe("pro") is True
        assert quantidade_visivel(10, "pro") == 10


class TestOFreeAindaVendeOUpgrade:
    def test_recebe_o_veredito_com_a_lei(self, resultado):
        v = _resposta(resultado, "free")["veredito"]
        assert v["titulo"] and v["frase"]
        assert "LGPD" in (v["artigo"] or "")

    def test_nao_recebe_nada_que_localize_o_problema(self, resultado):
        """O que se vende é o "onde". Se vazar aqui, não há o que cobrar."""
        free = _resposta(resultado, "free")
        assert free["privacy"]["violations"] == []
        assert free.get("storage") is None
        assert free["debugging"] == {}
        assert free["ga4"]["measurementIds"] == []
        assert free["gtm"]["containerIds"] == []
