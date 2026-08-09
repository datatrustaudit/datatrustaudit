"""Regressão do contexto que o chat entrega ao modelo.

O prompt do assistente monta uma ficha do site auditado. Quando o frontend
mandava menos campos do que o prompt lê, o assistente afirmava com convicção
coisas que o laudo ao lado contradizia — "Vazamentos PII: 0" com PII apontado
na tela, e "site Desconhecido" com a URL na barra do navegador.

Contradição entre o laudo e o assistente é pior do que assistente sem
resposta: quem vê os dois discordarem deixa de confiar nos dois.
"""
import os

os.environ.setdefault("SECRET_KEY", "x" * 40)

from main import _ficha_do_site


CONTEXTO_COMPLETO = {
    "url": "https://loja.com.br",
    "score": 11,
    "violations": 22,
    "hasConsentTool": False,
    "tags": ["Google Analytics 4", "Meta Pixel", "Microsoft Clarity"],
    "tagCount": 3,
    "estimatedFine": "art. 52: até 2% do faturamento",
    "piiExposure": 2,
    "securityIssues": 1,
    "isDeepScan": False,
}


class TestFichaDoSite:
    def test_todo_achado_do_laudo_chega_ao_prompt(self):
        """Campo que o laudo mostra e o prompt não recebe vira resposta errada."""
        ficha = _ficha_do_site(CONTEXTO_COMPLETO)
        assert "loja.com.br" in ficha
        assert "22" in ficha, "número de não conformidades"
        assert "11%" in ficha, "score"
        assert "AUSENTE" in ficha, "ausência de CMP precisa ser afirmada, não inferida"
        assert "art. 52" in ficha, "exposição estimada"
        assert "Dados pessoais expostos: 2" in ficha
        assert "integridade: 1" in ficha

    def test_tags_entram_por_nome(self):
        """"12 tags encontradas" faz o assistente responder no genérico."""
        ficha = _ficha_do_site(CONTEXTO_COMPLETO)
        assert "Google Analytics 4" in ficha
        assert "Meta Pixel" in ficha

    def test_lista_de_tags_tem_teto(self):
        """Site com 200 tags não pode estourar o prompt."""
        ficha = _ficha_do_site({**CONTEXTO_COMPLETO, "tags": [f"Tag {i}" for i in range(200)], "tagCount": 200})
        assert "(200)" in ficha, "o total continua exato mesmo com a lista cortada"
        assert ficha.count(",") < 20, "a lista de nomes precisa ser truncada"

    def test_contexto_vazio_nao_quebra(self):
        """Chat aberto antes de qualquer auditoria."""
        ficha = _ficha_do_site({})
        assert "nao informado" in ficha
        assert "nenhuma identificada" in ficha

    def test_tags_nulas_sao_descartadas(self):
        """O frontend mapeia name||vendor; tag sem os dois vira None."""
        ficha = _ficha_do_site({**CONTEXTO_COMPLETO, "tags": [None, "", "Hotjar", None]})
        assert "Hotjar" in ficha
        assert "None" not in ficha

    def test_deep_scan_e_declarado(self):
        """O assistente precisa saber se olhou uma página ou o site inteiro."""
        assert "pagina unica" in _ficha_do_site(CONTEXTO_COMPLETO)
        assert "Deep Scan" in _ficha_do_site({**CONTEXTO_COMPLETO, "isDeepScan": True})

    def test_cmp_detectado_muda_a_afirmacao(self):
        ficha = _ficha_do_site({**CONTEXTO_COMPLETO, "hasConsentTool": True})
        assert "detectado" in ficha
        assert "AUSENTE" not in ficha
