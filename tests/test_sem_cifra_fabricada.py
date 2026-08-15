"""O laudo não publica valor de multa em dinheiro.

A LGPD não tem tabela de multa por tipo de violação. O art. 52 fala em até 2%
do faturamento no Brasil, limitado a R$ 50 milhões **por infração** — e o valor
efetivo depende do faturamento, da abrangência e dos agravantes. Sem saber o
faturamento do cliente, qualquer cifra é invenção.

Num documento que o cliente leva ao DPO ou anexa a um processo, uma cifra
fabricada é o primeiro ponto que a outra parte ataca — e ela derruba junto o que
o laudo tem de correto.

O produto já teve duas versões desse defeito:

- `_RISK_TABLE` carregava `min_fine`/`max_fine` por tipo de achado (8.000,
  60.000, 150.000…), somados em acumuladores que ninguém publicava. Números
  inventados dormindo no código, à espera de alguém que os exibisse.
- O motor legado de `main.py` somava essas cifras, **dividia por 5** — um câmbio
  que ninguém consultou — e publicava o resultado **em dólar**, num laudo de
  LGPD entregue a cliente brasileiro. Três fabricações numa linha.

Este arquivo é a trava contra a volta de qualquer uma das duas.
"""
import os
import re

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)


#: Uma cifra de verdade: "R$ 8.000", "USD $1,234", "50000" solto num campo de
#: dinheiro. O teto legal (R$ 50 milhões) e o percentual (2%) são o CRITÉRIO da
#: lei e podem — devem — aparecer.
_CIFRA = re.compile(r"(?:R\$|USD|US\$|\$)\s*[\d][\d.,_]*", re.IGNORECASE)

_CRITERIO_LEGAL = ("50 milhões", "50 milhoes", "2% do faturamento")


def _tem_cifra_fabricada(texto: str) -> bool:
    """Cifra que não seja a citação do teto legal do art. 52."""
    if not texto:
        return False
    for achado in _CIFRA.findall(texto):
        contexto = texto[max(0, texto.find(achado) - 40): texto.find(achado) + 60]
        if not any(marca in contexto for marca in _CRITERIO_LEGAL):
            return True
    return False


class TestOCatalogoDeRiscoNaoTemPreco:
    def test_nenhuma_entrada_carrega_valor_de_multa(self):
        from audit_engine.privacy_analyzer import _RISK_TABLE

        for chave, entrada in _RISK_TABLE.items():
            proibidos = [c for c in entrada if "fine" in c.lower() or "multa" in c.lower()]
            assert not proibidos, f"{chave} voltou a carregar cifra: {proibidos}"

    def test_o_texto_das_entradas_nao_cita_valor(self):
        from audit_engine.privacy_analyzer import _RISK_TABLE

        for chave, entrada in _RISK_TABLE.items():
            for campo, valor in entrada.items():
                if isinstance(valor, str):
                    assert not _tem_cifra_fabricada(valor), f"{chave}.{campo}: {valor[:80]}"


class TestAExposicaoPublicaCriterio:
    """O campo `estimatedRiskExposure` é o que a tela e o PDF exibem."""

    @staticmethod
    def _exposicao(html, url="https://loja.com.br"):
        from audit_engine.privacy_analyzer import analyze_privacy, detect_jurisdiction
        from audit_engine.tag_detector import detect_tags

        tags = detect_tags(html, url)
        # Sem CMP e com rastreio: o pior caso, que é onde a cifra aparecia.
        r = analyze_privacy(
            tags,
            has_consent_tool=False,
            tags_before_consent=tags,
            jurisdiction=detect_jurisdiction(html, url),
        )
        return getattr(r, "estimated_risk_exposure", "") or ""

    HTML_COM_RASTREIO = (
        '<html><body><script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567">'
        '</script></body></html>'
    )

    def test_site_irregular_nao_recebe_cifra(self):
        texto = self._exposicao(self.HTML_COM_RASTREIO)
        assert not _tem_cifra_fabricada(texto), f"exposição com cifra: {texto[:160]}"

    def test_site_irregular_recebe_o_criterio_legal(self):
        """Remover a cifra não pode ter deixado o campo mudo: o leitor precisa
        saber sob que regra a conduta é avaliada."""
        texto = self._exposicao(self.HTML_COM_RASTREIO)
        assert texto.strip(), "a exposição ficou vazia"
        assert any(m in texto for m in _CRITERIO_LEGAL) or "art. 52" in texto, texto[:160]

    def test_nao_publica_valor_em_dolar(self):
        """Laudo de LGPD para cliente brasileiro citando dólar era o defeito do
        motor legado — e o câmbio usado era uma divisão por 5."""
        texto = self._exposicao(self.HTML_COM_RASTREIO)
        assert "USD" not in texto and "US$" not in texto, texto[:160]


class TestOMotorLegadoTambem:
    """`/analyze` continua exposta. Se ela contradiz o motor principal sobre o
    mesmo site, o produto não sabe o que afirma."""

    def test_a_rota_legada_nao_devolve_cifra(self):
        import main

        gerar = getattr(main, "generate_audit_report", None)
        if gerar is None:
            pytest.skip("o motor legado já foi removido")

        fonte = __import__("inspect").getsource(main)
        trecho = fonte[fonte.find("estimated_risk_exposure ="):][:900]
        assert "USD" not in trecho, "o motor legado voltou a publicar dólar"
        assert "/5" not in trecho, "o câmbio inventado (divisão por 5) voltou"


class TestOCriterioLegalContinuaPermitido:
    """A trava não pode proibir a citação da lei — só a invenção de valor."""

    def test_o_teto_do_artigo_52_passa(self):
        texto = (
            "A LGPD (art. 52) prevê multa de até 2% do faturamento no Brasil, "
            "limitada a R$ 50 milhões por infração."
        )
        assert not _tem_cifra_fabricada(texto)

    def test_uma_cifra_inventada_e_pega(self):
        """Sem este caso, os testes acima passariam com o detector quebrado."""
        assert _tem_cifra_fabricada("Exposição estimada: R$ 8.000 a R$ 60.000")
        assert _tem_cifra_fabricada("Exposição Potencial (apenas ref.): USD $1,600")
