"""Regressão do teste do "Recusar".

Toda ferramenta de auditoria mede um estado só: página carregada, nada clicado.
A violação que de fato se pune é outra — o usuário recusa e o rastreamento
continua. Estes testes exercitam o clique de verdade, num Chromium real, contra
banners sintéticos que reproduzem os padrões encontrados em produção.

Sem rede: o HTML é injetado com set_content, então o resultado é determinístico
e não depende de um site de terceiro continuar igual.
"""
import asyncio

import pytest

from audit_engine.consent_interaction import (
    classifica_rotulo,
    tentar_recusar,
    SELETORES_DE_RECUSA,
    TEXTOS_DE_RECUSA,
)
from audit_engine.storage_auditor import auditar_recusa

playwright_async = pytest.importorskip("playwright.async_api")


def _roda(corrotina):
    """Executa a corrotina num laço próprio.

    Evita depender do pytest-asyncio só para estes casos — o restante da suíte
    não usa plugin de async, e acrescentar dependência para quatro testes não
    se paga.
    """
    laco = asyncio.new_event_loop()
    try:
        return laco.run_until_complete(corrotina)
    finally:
        laco.close()


# ─── Páginas sintéticas ──────────────────────────────────────────────────────

BANNER_COOKIEBOT_QUE_RESPEITA = """
<html><body>
  <div id="CybotCookiebotDialog">
    <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Aceitar tudo</button>
    <button id="CybotCookiebotDialogBodyButtonDecline">Recusar</button>
  </div>
  <script>
    document.getElementById('CybotCookiebotDialogBodyButtonDecline')
      .addEventListener('click', function(){
        document.getElementById('CybotCookiebotDialog').style.display='none';
      });
  </script>
</body></html>
"""

# O caso que interessa: recusa aceita na aparência, rastreamento continua.
BANNER_QUE_IGNORA_A_RECUSA = """
<html><body>
  <div id="aviso">
    <button id="ok">Aceitar</button>
    <button id="nao">Recusar</button>
  </div>
  <script>
    document.getElementById('nao').addEventListener('click', function(){
      document.getElementById('aviso').style.display='none';
      // grava identificador mesmo com a recusa
      document.cookie = "_ga=GA1.1.999.888; path=/";
      localStorage.setItem('amplitude_id_teste', 'abc');
    });
  </script>
</body></html>
"""

BANNER_SO_COM_ACEITAR = """
<html><body>
  <div id="aviso">
    <p>Usamos cookies para melhorar sua experiência.</p>
    <button id="ok">Aceitar</button>
  </div>
</body></html>
"""

SEM_BANNER = "<html><body><h1>Site sem aviso de cookies</h1></body></html>"


async def _abre(playwright, html: str):
    navegador = await playwright.chromium.launch(headless=True)
    contexto = await navegador.new_context()
    pagina = await contexto.new_page()
    # about:blank não aceita cookie/localStorage; um host qualquer resolve
    await pagina.route("**/*", lambda rota: rota.fulfill(
        status=200, content_type="text/html", body=html))
    await pagina.goto("https://exemplo-de-teste.local/")
    return navegador, contexto, pagina


async def _recusa_em(html: str, aguardar_ms: int = 300):
    async with playwright_async.async_playwright() as p:
        nav, ctx, pagina = await _abre(p, html)
        try:
            antes = {(c["name"], c["domain"]) for c in await ctx.cookies()}
            resultado = await tentar_recusar(pagina, aguardar_ms=aguardar_ms)
            depois = await ctx.cookies()
            resultado.cookies_apos_recusa = [
                c for c in depois if (c["name"], c["domain"]) not in antes
            ]
            return resultado
        finally:
            await nav.close()


class TestCliqueDeRecusa:
    def test_clica_por_seletor_conhecido_do_cmp(self):
        r = _roda(_recusa_em(BANNER_COOKIEBOT_QUE_RESPEITA))
        assert r.conseguiu_recusar is True
        assert r.cmp_identificado == "Cookiebot"
        assert r.metodo == "seletor_conhecido"

    def test_clica_por_texto_em_banner_caseiro(self):
        r = _roda(_recusa_em(BANNER_QUE_IGNORA_A_RECUSA))
        assert r.conseguiu_recusar is True
        assert r.metodo == "texto_do_botao"

    def test_detecta_banner_sem_opcao_de_recusar(self):
        """Dark pattern: só existe o caminho do 'sim'."""
        r = _roda(_recusa_em(BANNER_SO_COM_ACEITAR))
        assert r.conseguiu_recusar is False
        assert r.tem_opcao_de_aceitar is True
        assert r.tem_opcao_de_recusar is False

    def test_pagina_sem_banner_nao_quebra(self):
        r = _roda(_recusa_em(SEM_BANNER))
        assert r.tentado is True
        assert r.conseguiu_recusar is False
        assert r.motivo_da_falha

    def test_rastreamento_apos_recusa_e_capturado(self):
        """O caso que sustenta o produto: recusou e o site gravou assim mesmo."""
        r = _roda(_recusa_em(BANNER_QUE_IGNORA_A_RECUSA, aguardar_ms=500))
        assert r.conseguiu_recusar is True
        nomes = {c["name"] for c in r.cookies_apos_recusa}
        assert "_ga" in nomes, f"cookie gravado após recusa não foi capturado: {nomes}"

    def test_recusa_respeitada_nao_gera_cookie(self):
        """Banner que só esconde o aviso não deve produzir achado de rastreio."""
        r = _roda(_recusa_em(BANNER_COOKIEBOT_QUE_RESPEITA, aguardar_ms=500))
        assert r.conseguiu_recusar is True
        rastreadores = [c for c in r.cookies_apos_recusa if c["name"].startswith(("_ga", "_fbp"))]
        assert rastreadores == []


class TestClassificacaoDeRotulo:
    @pytest.mark.parametrize("texto", [
        "Recusar", "Rejeitar tudo", "Continuar sem aceitar", "Apenas necessários",
        "Reject all", "Decline", "Não aceito", "Somente essenciais",
    ])
    def test_reconhece_recusa(self, texto):
        assert classifica_rotulo(texto) == "recusar"

    @pytest.mark.parametrize("texto", ["Aceitar tudo", "Concordo", "Accept all", "Permitir"])
    def test_reconhece_aceite(self, texto):
        assert classifica_rotulo(texto) == "aceitar"

    @pytest.mark.parametrize("texto", ["Comprar agora", "Fale conosco", "", "Ver mais"])
    def test_ignora_botao_comum(self, texto):
        assert classifica_rotulo(texto) is None

    def test_texto_longo_e_ignorado(self):
        """Parágrafo inteiro não é rótulo de botão."""
        assert classifica_rotulo("Recusar " * 30) is None

    @pytest.mark.parametrize("manchete", [
        # Caso real: rodando contra a bbc.com, a versão anterior clicou nesta
        # manchete porque continha "reject", navegou para a notícia e reportou
        # que havia recusado o consentimento.
        "Man City reject Barcelona's £38.5m bid for Rodri",
        "Senado rejeita projeto de lei sobre dados",
        "Empresa recusa proposta de compra bilionária",
        "Court declines to hear the privacy case",
    ])
    def test_manchete_com_a_palavra_nao_e_botao_de_recusa(self, manchete):
        assert classifica_rotulo(manchete) is None, (
            "substring solta faz o scanner clicar em notícia e reportar recusa falsa"
        )

    @pytest.mark.parametrize("texto", [
        # "ok" casava dentro de "facebook" na versão anterior
        "Follow BBC on facebook", "Compartilhar no Facebook", "Ver no Outlook",
    ])
    def test_palavra_dentro_de_outra_nao_conta(self, texto):
        assert classifica_rotulo(texto) is None

    def test_termo_de_uma_palavra_exige_rotulo_inteiro(self):
        assert classifica_rotulo("Recusar") == "recusar"
        assert classifica_rotulo("Recusar!") == "recusar"      # pontuação tolerada
        assert classifica_rotulo("Recusar entrega do pedido") is None

    def test_termo_de_duas_palavras_vale_como_trecho(self):
        assert classifica_rotulo("Continuar sem aceitar") == "recusar"
        assert classifica_rotulo("» Continuar sem aceitar «") == "recusar"


class TestAchadosNoLaudo:
    class _Recusa:
        def __init__(self, **kw):
            self.tentado = True
            self.conseguiu_recusar = False
            self.cmp_identificado = None
            self.tem_opcao_de_aceitar = False
            self.tem_opcao_de_recusar = False
            self.rotulos_encontrados = []
            self.cookies_apos_recusa = []
            self.requisicoes_apos_recusa = []
            self.storage_apos_recusa = {}
            self.__dict__.update(kw)

    def test_rastreamento_apos_recusa_vira_achado_critico(self):
        recusa = self._Recusa(
            conseguiu_recusar=True,
            cmp_identificado="Cookiebot",
            cookies_apos_recusa=[{"name": "_ga", "domain": ".loja.com.br"}],
            requisicoes_apos_recusa=[{"url": "https://www.facebook.com/tr?id=1", "domain": "www.facebook.com"}],
        )
        achados = auditar_recusa(recusa, tem_cmp=True)
        assert len(achados) == 1
        assert achados[0]["check"] == "tracking_after_rejection"
        assert achados[0]["status"] == "critical"
        assert "_ga" in achados[0]["evidence"]["cookies"]

    def test_recusa_respeitada_e_reportada_como_ok(self):
        recusa = self._Recusa(conseguiu_recusar=True, cmp_identificado="OneTrust")
        achados = auditar_recusa(recusa, tem_cmp=True)
        assert achados[0]["check"] == "rejection_respected"
        assert achados[0]["status"] == "ok"

    def test_banner_sem_recusar_vira_achado_critico(self):
        recusa = self._Recusa(tem_opcao_de_aceitar=True, tem_opcao_de_recusar=False,
                              rotulos_encontrados=["Aceitar"])
        achados = auditar_recusa(recusa, tem_cmp=True)
        assert achados[0]["check"] == "no_reject_option"
        assert achados[0]["status"] == "critical"

    def test_cookie_funcional_apos_recusa_nao_acusa(self):
        """Cookie de sessão gravado após a recusa não é rastreamento."""
        recusa = self._Recusa(
            conseguiu_recusar=True,
            cookies_apos_recusa=[{"name": "PHPSESSID", "domain": ".loja.com.br"}],
        )
        achados = auditar_recusa(recusa, tem_cmp=True)
        assert achados[0]["check"] == "rejection_respected"

    def test_cmp_no_codigo_sem_banner_na_tela(self):
        """Caso real: terra.com.br tem CMP no código e não exibe controle algum.

        É pior do que não ter CMP — passa impressão de conformidade sem nunca
        pedir nada ao visitante. Costuma ser banner restrito à União Europeia.
        """
        recusa = self._Recusa(tem_opcao_de_aceitar=False, tem_opcao_de_recusar=False)
        achados = auditar_recusa(recusa, tem_cmp=True)
        assert achados[0]["check"] == "cmp_present_no_ui"
        assert achados[0]["status"] == "critical"

    def test_sem_cmp_e_sem_banner_e_outro_achado(self):
        """Sem CMP nenhum o diagnóstico é diferente: não há o que configurar."""
        recusa = self._Recusa(tem_opcao_de_aceitar=False, tem_opcao_de_recusar=False)
        achados = auditar_recusa(recusa, tem_cmp=False)
        assert achados[0]["check"] == "no_consent_control"

    def test_sem_teste_executado_nao_gera_achado(self):
        assert auditar_recusa(None, tem_cmp=True) == []


def test_catalogo_de_cmps_cobre_os_principais():
    nomes = {nome for nome, _ in SELETORES_DE_RECUSA}
    for esperado in ("Cookiebot", "OneTrust", "Didomi", "Usercentrics", "CookieYes"):
        assert esperado in nomes, f"{esperado} fora do catálogo de CMPs"
    assert len(TEXTOS_DE_RECUSA) >= 15
