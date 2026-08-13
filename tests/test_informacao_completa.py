"""Tudo que o motor mede precisa chegar ao plano pago.

O produto coleta muito mais do que exibia. Três coisas que o motor já sabia e
o laudo não dizia:

- **A ordem real de disparo.** A aba se chamava "Ordem de Carregamento" e
  ordenava por posição no HTML — que é ordem de DECLARAÇÃO. Uma tag no fim do
  body com `async` dispara antes de outra no head; a tela afirmava o contrário,
  e é essa ordem que sustenta a acusação de coleta antes do consentimento.
- **Quando cada rastreador disparou.** O tempo era medido a partir do primeiro
  rastreador, então o primeiro dava sempre 0 ms e `firstTrackerFiredMs` era
  fixo em zero. A frase que vende a seção — "o pixel saiu aos 349 ms, antes de
  o banner aparecer" — não podia ser dita.
- **Como corrigir.** O motor escreve a providência e a API entrega em
  `howToFix`; o laudo apontava o problema e calava sobre a solução.

E um defeito de credibilidade que vinha junto: página de bloqueio anti-bot
sendo auditada como se fosse o site.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from audit_engine.storage_auditor import auditar_armazenamento
from tests.test_campos_das_visoes import AGORA, _Scan


class TestQuandoCadaTagDisparou:
    def test_tempo_e_medido_desde_o_inicio_da_pagina(self):
        """O beacon do cenário sai 350 ms depois do início da navegação."""
        class S(_Scan):
            navigation_started_at = AGORA

        r = auditar_armazenamento(S(), tem_cmp=False)
        assert r.linha_do_tempo, "nenhum evento na linha do tempo"
        assert r.primeiro_disparo_ms is not None
        assert 300 <= r.primeiro_disparo_ms <= 400, (
            f"esperava ~350 ms desde o início da página, veio {r.primeiro_disparo_ms}"
        )

    def test_sem_o_marco_a_regua_e_relativa(self):
        """Scan antigo ou HAR sem a informação: melhor um tempo relativo
        declarado do que um absoluto inventado."""
        class S(_Scan):
            pass

        r = auditar_armazenamento(S(), tem_cmp=False)
        assert r.primeiro_disparo_ms == 0

    def test_tempo_nunca_e_negativo(self):
        """Relógio pode voltar atrás entre medições, e um valor negativo seria
        lido como 'disparou antes de a página existir'."""
        class S(_Scan):
            navigation_started_at = AGORA + 10  # marco depois do evento

        r = auditar_armazenamento(S(), tem_cmp=False)
        assert all(e.ms_desde_o_inicio >= 0 for e in r.linha_do_tempo)

    def test_a_ordem_e_cronologica(self):
        """É a ordem de disparo que sustenta o achado — não a do HTML."""
        class S(_Scan):
            navigation_started_at = AGORA

        r = auditar_armazenamento(S(), tem_cmp=False)
        tempos = [e.ms_desde_o_inicio for e in r.linha_do_tempo]
        assert tempos == sorted(tempos)


class TestPaginaDeBloqueioNaoViraLaudo:
    """Um 403 de desafio anti-bot devolve HTML válido. Sem olhar o status, o
    motor não encontrava rastreador nenhum e o veredito concluía "Seu site está
    de parabéns" — selo verde sobre uma página que nunca foi vista.
    """

    def test_status_de_erro_marca_a_varredura_como_bloqueada(self):
        from audit_engine.browser_fetcher import BrowserScanResult

        r = BrowserScanResult(url="https://loja.com.br", html="<html>Acesso negado</html>")
        r.http_status = 403
        r.scan_status = "blocked"
        assert r.scan_status != "completed"

    def test_o_campo_de_status_existe_no_resultado(self):
        """Sem o campo, não há como distinguir bloqueio de site limpo."""
        from audit_engine.browser_fetcher import BrowserScanResult

        r = BrowserScanResult(url="https://loja.com.br", html="")
        assert hasattr(r, "http_status")
        assert hasattr(r, "navigation_started_at")

    def test_varredura_bloqueada_nao_devolve_sucesso(self):
        """O guarda de "HTML vazio" não pegava este caso: a página de bloqueio
        tem HTML."""
        import asyncio

        import api.audit as aa

        class _Bloqueado(_Scan):
            html = "<html><body>Verificando seu navegador…</body></html>"
            scan_status = "blocked"
            http_status = 403
            intercepted_requests = []
            cookies = []

        original = aa.browser_scan
        aa.browser_scan = lambda url, timeout: _Bloqueado()
        try:
            r = asyncio.run(aa.auditar_pagina("https://loja.com.br", "premium"))
        finally:
            aa.browser_scan = original

        assert r["success"] is False, (
            "página de bloqueio recebeu laudo de sucesso — o cliente veria "
            "'site conforme' sobre uma página que nunca foi auditada"
        )
        assert r["errorCode"] == "BLOCKED"


class TestAProvidenciaChegaJunto:
    def test_recomendacao_traz_como_corrigir(self):
        from api.audit import _issue_from_recommendation

        item = _issue_from_recommendation({
            "title": "Instalar CMP",
            "severity": "critical",
            "fix": "Adicione o script do Cookiebot como primeiro elemento do <head>.",
        })
        assert item["howToFix"].startswith("Adicione o script")

    def test_sem_fix_ainda_diz_algo_util(self):
        """Campo vazio não pode virar string vazia na tela."""
        from api.audit import _issue_from_recommendation

        item = _issue_from_recommendation({"title": "Algo", "severity": "low"})
        assert item["howToFix"]
