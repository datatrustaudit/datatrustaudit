"""`bg-transparent` era detectado como Google Analytics 4.

Descoberto auditando o site do próprio produto: o laudo acusou "GA4 disparando
antes do consentimento" num site que não tem GA4 nenhum. A rede não registrou
uma única requisição a domínio de rastreio — a acusação vinha só do HTML.

O padrão `G-[A-Z0-9]{10,12}` rodava com `re.IGNORECASE` sobre a página inteira.
Em **`bg-transparent`**, "g-" seguido de "transparent" dá exatamente 11
caracteres. Como praticamente todo site moderno usa Tailwind, praticamente todo
site seria acusado de ter Google Analytics — com um "Measurement ID" que é uma
classe de CSS.

É o erro mais caro que este motor pode cometer, e o CLAUDE.md do projeto já
registrava a regra: falso positivo custa mais que falso negativo. O cliente
confere a acusação, não encontra nada, e passa a duvidar do laudo inteiro —
inclusive da parte correta.

Identificador de tag é case-sensitive na origem: o Google emite `G-`, `GTM-`,
`UA-`, `AW-` e `DC-` sempre em maiúsculas. Nome de função e domínio não são
(`gtag(`, `fbq(`, `hotjar.com` aparecem em qualquer capitalização), e continuam
casando sem diferenciar.
"""
import os

import pytest

os.environ.setdefault("SECRET_KEY", "x" * 40)

from audit_engine.tag_detector import detect_tags


def _nomes(html: str):
    return {t.name for t in detect_tags(html, "https://exemplo.com.br")}


class TestClassesDeCssNaoViramTag:
    #: Classes reais, de páginas reais. Cada uma já casaria com algum padrão de
    #: identificador se a comparação ignorar maiúsculas.
    HTML_TAILWIND = """
    <html><body>
      <div class="bg-transparent rounded-lg shadow-lg bg-gradient-to-r">
        <span class="text-lg leading-relaxed from-transparent via-transparent"></span>
        <button class="bg-green-100 hover:bg-gray-100 focus:ring-2"></button>
      </div>
    </body></html>
    """

    def test_bg_transparent_nao_e_google_analytics(self):
        """O caso exato que produziu o laudo errado."""
        assert "Google Analytics 4" not in _nomes(self.HTML_TAILWIND)

    def test_pagina_de_tailwind_nao_acusa_nenhuma_tag(self):
        assert _nomes(self.HTML_TAILWIND) == set()

    @pytest.mark.parametrize("classe", [
        "bg-transparent", "bg-gradient-to-r", "from-transparent", "via-transparent",
        "rounded-lg", "shadow-lg", "text-lg", "leading-relaxed", "ring-offset-2",
    ])
    def test_classe_isolada_nao_vira_tag(self, classe):
        assert _nomes(f'<div class="{classe}"></div>') == set()

    def test_texto_que_fala_sobre_ga4_nao_e_ga4(self):
        """Uma página que EXPLICA o GA4 não tem GA4 instalado. Vale para
        documentação, blog e — no caso — para o próprio produto."""
        html = """
        <html><body>
          <h1>Como auditar seu GA4</h1>
          <p>Verifique se o gtag está configurado corretamente no seu site.</p>
        </body></html>
        """
        assert "Google Analytics 4" not in _nomes(html)


class TestOQueDEVEContinuarSendoDetectado:
    """A correção não pode ter comprado o silêncio com falso negativo."""

    def test_measurement_id_de_verdade(self):
        html = '<script>gtag("config", "G-ABC1234567");</script>'
        assert "Google Analytics 4" in _nomes(html)

    def test_container_gtm_de_verdade(self):
        html = '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234"></script>'
        assert "Google Tag Manager" in _nomes(html)

    def test_universal_analytics_de_verdade(self):
        assert "Universal Analytics (Deprecated)" in _nomes('<script>ga("create","UA-123456-1");</script>')

    def test_google_ads_de_verdade(self):
        assert "Google Ads Conversion" in _nomes('<script>gtag("config","AW-123456789");</script>')

    def test_o_script_do_ga4_pelo_src(self):
        html = '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>'
        assert "Google Analytics 4" in _nomes(html)

    def test_nome_de_funcao_continua_sem_diferenciar_maiuscula(self):
        """`fbq(` e `hotjar.com` aparecem minificados em qualquer
        capitalização — esses padrões precisam seguir tolerantes."""
        assert "Meta Pixel (Facebook)" in _nomes('<script>FBQ("init","123456789012345");</script>')


class TestFronteiraDoIdentificador:
    def test_identificador_colado_em_outra_palavra_nao_conta(self):
        """Sem fronteira à esquerda, "XG-ABC1234567" casaria pelo miolo."""
        assert "Google Analytics 4" not in _nomes('<div data-x="XG-ABC1234567"></div>')

    def test_identificador_precedido_de_hifen_nao_conta(self):
        assert "Google Analytics 4" not in _nomes('<div class="algo-G-ABC1234567"></div>')

    def test_identificador_no_comeco_do_atributo_conta(self):
        """Precedido de aspas — que não é letra nem hífen — é um ID legítimo."""
        assert "Google Analytics 4" in _nomes('<script>gtag("config","G-ABC1234567")</script>')


class TestMinusculaNaoEIdentificador:
    @pytest.mark.parametrize("falso", [
        "g-abc1234567", "gtm-abc1234", "ua-123456-1", "aw-123456789", "dc-1234567",
    ])
    def test_identificador_em_minusculo_e_recusado(self, falso):
        """O Google emite sempre em maiúsculas. Aceitar minúsculo foi
        exatamente o que abriu a porta para as classes de CSS."""
        assert _nomes(f'<div class="{falso}"></div>') == set()


class TestVereditoNaoAcusaColetaInexistente:
    """A frase saía dizendo "coleta por meio de **0** ferramenta(s)".

    Descoberto no mesmo laudo do `bg-transparent`: corrigido o detector, o site
    ficou com zero tags — e o veredito continuou acusando coleta sem
    consentimento. A causa era o `or violacoes` na classificação: o achado
    "sem controle de consentimento" existe sozinho, e bastava ele.

    Não ter CMP num site que não rastreia não é irregularidade. É uma página
    que não precisa de consentimento para nada.
    """

    @staticmethod
    def _veredito(**kw):
        from audit_engine.veredito import gerar_veredito
        return gerar_veredito(**kw)

    def test_site_sem_coleta_nao_recebe_veredito_de_coleta(self):
        v = self._veredito(
            total_de_achados=1,
            por_gravidade={"critical": 1},
            tem_cmp=False,
            tags_antes_do_consentimento=0,
            cookies_sem_consentimento=0,
            total_de_tags=0,
            violacoes=[{"description": "Sem controle de consentimento", "severity": "critical"}],
        )
        assert "0 ferramenta" not in (v.get("frase") or ""), (
            "a frase afirma coleta por meio de zero ferramentas"
        )

    def test_site_que_rastreia_de_verdade_continua_sendo_acusado(self):
        """A correção não pode ter comprado silêncio: com rastreador e sem
        CMP, a acusação é legítima e precisa continuar saindo."""
        v = self._veredito(
            total_de_achados=3,
            por_gravidade={"critical": 2},
            tem_cmp=False,
            tags_antes_do_consentimento=2,
            cookies_sem_consentimento=4,
            total_de_tags=2,
            violacoes=[{"description": "Rastreamento sem consentimento", "severity": "critical"}],
        )
        assert v.get("conforme") is False
        assert "2 ferramenta" in (v.get("frase") or "") or "2 " in (v.get("frase") or "")

    def test_cookie_sem_tag_ainda_conta_como_coleta(self):
        """Cookie gravado é coleta observada mesmo sem tag reconhecida no
        catálogo — é evidência direta, e some se só as tags contarem."""
        v = self._veredito(
            total_de_achados=2,
            por_gravidade={"critical": 1},
            tem_cmp=False,
            tags_antes_do_consentimento=0,
            cookies_sem_consentimento=5,
            total_de_tags=0,
            violacoes=[{"description": "Cookie antes do aceite", "severity": "critical"}],
        )
        assert v.get("conforme") is False

    def test_site_limpo_continua_recebendo_parabens(self):
        v = self._veredito(total_de_achados=0, tem_cmp=True, total_de_tags=0)
        assert v.get("conforme") is True
