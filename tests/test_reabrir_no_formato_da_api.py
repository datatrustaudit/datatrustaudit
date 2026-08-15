"""Reabrir um laudo devolve a MESMA forma que a varredura recém-feita.

O defeito, medido: `scan.raw_data` é o que o `jsonable_encoder` fez do
`AuditResult` — chaves em snake_case, com os nomes dos campos das dataclasses.
A resposta de `POST /api/audit` é outra coisa: ela passa pelo `to_dict()` de
cada dataclass, que renomeia para camelCase e traduz do português
(`cookies_sem_consentimento` vira `cookiesWithoutConsent`).

`GET /api/scans/{id}` devolvia `raw_data` cru. A tela lia
`storage.cookiesWithoutConsent` de um objeto que só tinha
`cookies_sem_consentimento`, recebia `undefined`, caía no `?? []` e entrava no
ramo do escudo verde — **"Nenhum cookie foi gravado antes de qualquer aceite"**
estampado sobre uma varredura que gravou oito. Pela mesma porta,
`storage.firingTimeline` sumia e a aba de ordem de carregamento anunciava "esta
varredura não trouxe a medição de rede" negando as requisições interceptadas.

Nada disso levanta erro. O mesmo scan dizia duas coisas conforme tivesse ou não
passado por um F5, e a versão reaberta era justamente a que afirmava
conformidade — o defeito mais caro que este produto pode ter: erro para mais o
cliente confere e reclama; "conforme" por engano ele leva ao DPO.

O que este arquivo prende:

- o laudo do motor reaberto traz os cookies e a linha do tempo que a varredura
  observou, nas chaves que a tela lê;
- a remontagem é idêntica, campo a campo, ao que `/api/audit` monta — comparada
  contra `_safe_dict`, que é a fonte, e não contra uma cópia do mapeamento;
- o corte por plano continua valendo, e continua cortando exibição, nunca o
  banco;
- laudo gravado em outro formato (modo trajeto) e varredura ainda em andamento
  continuam abrindo.
"""
import time

import pytest
from fastapi.encoders import jsonable_encoder

from db.models import Scan, User, utcnow


AGORA = 1_700_000_000.0


class _Requisicao:
    """Requisição interceptada, como o `browser_fetcher` a entrega."""

    def __init__(self, url, domain, ts):
        self.url = url
        self.domain = domain
        self.timestamp = ts
        self.method = "GET"
        self.path = "/collect"
        self.post_data = None
        self.resource_type = "xhr"


class _Coleta:
    """Uma coleta de navegador com cookie, storage e rede — sem nenhum aceite.

    É o caso que o produto vende: o scanner nunca clica em "aceitar", então tudo
    aqui foi gravado sem consentimento.
    """

    scan_method = "browser"
    scan_status = "completed"
    fallback_used = False
    error = None
    started_at = "2026-08-13T02:39:30"
    finished_at = "2026-08-13T02:40:00"
    all_script_urls = ["https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"]
    html = (
        "<html><head>"
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>'
        '<script async src="https://connect.facebook.net/en_US/fbevents.js"></script>'
        "</head><body>loja</body></html>"
    )
    intercepted_requests = [
        _Requisicao("https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567",
                    "www.google-analytics.com", AGORA + 0.35),
        _Requisicao("https://www.facebook.com/tr/?id=1&ev=PageView",
                    "www.facebook.com", AGORA + 0.52),
    ]
    cookies = [
        {"name": "_ga", "domain": ".loja.com.br", "expires": time.time() + 3e7, "httpOnly": False},
        {"name": "_gid", "domain": ".loja.com.br", "expires": time.time() + 86400, "httpOnly": False},
        {"name": "_fbp", "domain": ".loja.com.br", "expires": time.time() + 3e6, "httpOnly": False},
    ]
    local_storage = {"_ga_XYZ123": "GS1.1.17"}
    session_storage = {}


@pytest.fixture(scope="module")
def laudo_do_motor():
    """O `AuditResult` de verdade, do motor, sobre a coleta acima."""
    from audit_engine.orchestrator import run_audit

    return run_audit("https://loja.com.br", _Coleta())


@pytest.fixture(scope="module")
def gravado(laudo_do_motor):
    """Exatamente o que vai para a coluna `raw_data` — snake_case."""
    return jsonable_encoder(laudo_do_motor)


@pytest.fixture()
def dono(db, usuario_logado):
    headers, email = usuario_logado
    return headers, db.query(User).filter(User.email == email).first()


def _gravar(db, user_id, raw, plano=None, status="completed", url="https://loja.com.br",
            metodo="browser", score=42):
    if plano:
        usuario = db.query(User).filter(User.id == user_id).first()
        usuario.plan = plano
        db.commit()
    registro = Scan(
        user_id=user_id,
        url=url,
        status=status,
        score=score,
        created_at=utcnow(),
        completed_at=utcnow(),
        scan_method=metodo,
        raw_data=raw,
    )
    db.add(registro)
    db.commit()
    db.refresh(registro)
    return registro


def _reabrir(client, headers, scan_id):
    r = client.get(f"/api/scans/{scan_id}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["result"]


class TestAPremissa:
    """Sem isto, os testes abaixo poderiam passar por acidente."""

    def test_o_que_o_banco_guarda_e_snake_case(self, gravado):
        armazenamento = gravado["storage"]
        assert "cookies_sem_consentimento" in armazenamento
        assert "cookiesWithoutConsent" not in armazenamento, (
            "se `raw_data` passou a ser camelCase, a remontagem virou decoração "
            "— confira o que mudou em `_persist_scan`"
        )

    def test_a_coleta_gravou_cookie_e_rede(self, gravado):
        assert len(gravado["storage"]["cookies_sem_consentimento"]) >= 3
        assert len(gravado["storage"]["linha_do_tempo"]) >= 2

    def test_a_leitura_da_tela_sobre_o_dado_cru_da_vazio(self, gravado):
        """O defeito em uma linha: é este `None` que virava escudo verde.

        `CookiesInspector` faz `storage?.cookiesWithoutConsent ?? []` e, com
        lista vazia, exibe "Nenhum cookie foi gravado antes de qualquer aceite".
        """
        assert gravado["storage"].get("cookiesWithoutConsent") is None
        assert gravado["storage"].get("firingTimeline") is None


class TestOLaudoReabertoTrazAEvidencia:
    """A correção, medida pela rota HTTP — o caminho exato da tela."""

    def test_os_cookies_gravados_voltam(self, client, db, dono, gravado):
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        armazenamento = _reabrir(client, headers, scan.id)["storage"]

        assert armazenamento is not None, "o plano pago perdeu a leitura de cookies"
        cookies = armazenamento["cookiesWithoutConsent"]
        assert len(cookies) == len(gravado["storage"]["cookies_sem_consentimento"])
        assert {c["name"] for c in cookies} >= {"_ga", "_gid", "_fbp"}
        assert armazenamento["totalCookiesWithoutConsent"] == len(cookies)

    def test_o_escudo_verde_nao_pode_aparecer(self, client, db, dono, gravado):
        """A afirmação de conformidade só pode sair de uma medição vazia.

        Aqui a medição não é vazia: oito achados de armazenamento. Se a lista
        chegar vazia, a tela declara conformidade sobre uma varredura que
        observou o contrário.
        """
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        armazenamento = _reabrir(client, headers, scan.id)["storage"]
        assert armazenamento["cookiesWithoutConsent"], (
            "laudo reaberto declararia 'nenhum cookie gravado antes do aceite' "
            "sobre uma varredura que gravou cookie"
        )

    def test_a_linha_do_tempo_de_rede_volta(self, client, db, dono, gravado):
        """`ScriptTimeline` anunciava "esta varredura não trouxe a medição de
        rede" com a interceptação inteira gravada no banco."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        armazenamento = _reabrir(client, headers, scan.id)["storage"]
        assert len(armazenamento["firingTimeline"]) == len(gravado["storage"]["linha_do_tempo"])
        assert armazenamento["firingTimeline"][0]["msSincePageStart"] is not None
        assert armazenamento["totalTimelineEvents"] >= 2

    def test_o_outro_armazenamento_tambem(self, client, db, dono, gravado):
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        armazenamento = _reabrir(client, headers, scan.id)["storage"]
        assert [s["name"] for s in armazenamento["storageWithoutConsent"]] == ["_ga_XYZ123"]

    def test_o_veredito_conta_os_cookies(self, client, db, dono, gravado):
        """O veredito é a frase que abre o laudo. Ele soma os cookies sem
        consentimento — lidos da mesma chave que sumia."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["veredito"], "o laudo reaberto ficou sem veredito"


class TestMesmaFormaDaVarreduraAoVivo:
    def test_a_remontagem_e_identica_ao_que_o_motor_produz(self, laudo_do_motor, gravado):
        """Comparado contra `_safe_dict`, que é a fonte.

        Conferir contra uma cópia do mapeamento só provaria que a cópia
        concorda consigo mesma. Assim, campo novo no motor, chave renomeada num
        `to_dict()` ou dataclass aninhada nova quebram aqui — que é o único
        jeito de a divergência doer antes de virar laudo errado.
        """
        from api.audit import _safe_dict
        from api.scans import _forma_canonica

        assert _forma_canonica(gravado) == _safe_dict(laudo_do_motor)

    def test_ler_o_proprio_formato_da_api_nao_perde_campo(self, laudo_do_motor):
        """Guarda a tabela de apelidos, que o teste acima não alcança.

        Nem toda chave publicada pelo `to_dict()` é o camelCase do nome do
        campo: `law_full` sai como `framework`, `overall` como `auditScore`,
        `cookies_sem_consentimento` como `cookiesWithoutConsent`. Laudo gravado
        no formato da resposta chega escrito assim, e apelido que falte faz o
        campo virar `None` — sem erro, que é como este projeto perde dado.

        Reler a própria saída tem de devolvê-la intacta: qualquer apelido
        errado ou ausente quebra a igualdade.
        """
        from api.audit import _safe_dict
        from api.scans import _forma_canonica

        no_formato_da_api = _safe_dict(laudo_do_motor)
        assert _forma_canonica(no_formato_da_api) == no_formato_da_api

    def test_reaberto_e_ao_vivo_respondem_a_mesma_coisa(self, client, db, dono, laudo_do_motor, gravado):
        """O mesmo scan não pode dizer duas coisas conforme o F5."""
        from api.audit import _normalize_audit_response

        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        ao_vivo = _normalize_audit_response("https://loja.com.br", "premium", _Coleta(), laudo_do_motor)
        reaberto = _reabrir(client, headers, scan.id)

        assert reaberto["storage"] == ao_vivo["storage"]
        assert reaberto["summary"] == ao_vivo["summary"]
        assert reaberto["violations"] == ao_vivo["violations"]
        assert reaberto["tags"] == ao_vivo["tags"]
        assert reaberto["scanMethod"] == ao_vivo["scanMethod"]

    def test_a_data_e_a_do_exame_e_nao_a_da_reabertura(self, client, db, dono, gravado):
        """O cabeçalho do laudo lê `finished_at`. Se ele sumir, o normalizador
        do frontend cai para o relógio de quem abriu a página."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["finished_at"] == gravado["timestamp"]

    def test_nao_afirma_coleta_que_nao_foi_gravada(self, client, db, dono, gravado):
        """O objeto do navegador não é persistido.

        Publicar `scriptsInspected: []` e `networkHints: []` num laudo cuja
        coleta viu dezenas de cada é a mesma negativa inventada do escudo verde
        — só que do outro lado da tela.
        """
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["debugging"] is None
        # o que de fato foi gravado continua na resposta
        assert "datalayerFindings" in resultado


class TestOCorteContinuaValendo:
    def test_o_gratuito_nao_recebe_o_detalhe(self, client, db, dono, gravado):
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="free")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["showsDetail"] is False
        assert resultado["storage"] is None
        assert resultado["tags"] == []
        assert resultado["violations"] == []
        assert resultado["privacy"]["violations"] == []
        assert resultado["events"] == []

    def test_o_gratuito_continua_vendo_a_contagem(self, client, db, dono, gravado):
        """Dizer "N achados" sem listá-los é o que motiva o upgrade; zerar a
        contagem junto faria a tela parecer defeituosa em vez de limitada."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="free")

        resumo = _reabrir(client, headers, scan.id)["summary"]
        assert resumo["violationsCount"] == gravado["privacy"]["total_violations"]
        assert resumo["violationsCount"] > 0
        assert sum(resumo["violationsBySeverity"].values()) == resumo["violationsCount"]

    def test_o_gratuito_nao_recebe_a_exposicao_de_risco(self, client, db, dono, gravado):
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="free")

        resultado = _reabrir(client, headers, scan.id)
        real = gravado["privacy"]["estimated_risk_exposure"]
        assert resultado["privacy"]["estimatedRiskExposure"] != real
        assert resultado["summary"]["estimatedFine"] != real

    def test_o_laudo_integro_continua_no_banco(self, client, db, dono, gravado):
        """O corte é de exibição. `_normalize_audit_response` opera sobre uma
        cópia; se um dia passar a mutar, o gratuito grava o laudo truncado por
        cima do original e quem fizer upgrade não recupera nada."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="free")

        _reabrir(client, headers, scan.id)
        db.refresh(scan)
        assert scan.raw_data["storage"]["cookies_sem_consentimento"], "o banco foi truncado"
        assert scan.raw_data["tags"], "o banco foi truncado"


class TestOsFormatosAntigosContinuamAbrindo:
    def test_laudo_gravado_no_formato_da_resposta(self, client, db, dono):
        """Laudo gravado em camelCase — é o que o modo trajeto guarda por passo,
        e o que existe no banco de antes desta mudança."""
        antigo = {
            "url": "https://antigo.com.br",
            "score": 42,
            "summary": {"violationsCount": 7, "totalTags": 3,
                        "violationsBySeverity": {"critical": 4, "high": 3, "medium": 0, "low": 0}},
            "tags": [{"name": "Google Analytics 4", "type": "analytics", "tagId": "G-ABC",
                      "isBeforeConsent": True, "lgpdRisk": "critical"}],
            "privacy": {"violations": [{"severity": "critical", "violation": "Rastreio sem consentimento"}],
                        "totalViolations": 7, "hasConsentTool": False},
            "storage": {"cookiesWithoutConsent": [{"name": "_ga", "owner": "Google Analytics"}]},
            "scanMethod": "browser",
        }
        headers, user = dono
        scan = _gravar(db, user.id, antigo, plano="premium", url="https://antigo.com.br")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["storage"]["cookiesWithoutConsent"][0]["name"] == "_ga"
        assert resultado["tags"][0]["tagId"] == "G-ABC"
        assert resultado["scanMethod"] == "browser"
        # o contador gravado vence o recalculado: a lista veio resumida, e
        # recalcular por ela faria o número cair de 7 para 1 ao dar F5
        assert resultado["summary"]["violationsCount"] == 7
        assert resultado["summary"]["totalTags"] == 3

    def test_laudo_do_modo_trajeto_passa_direto(self, client, db, dono):
        """Outro formato, com um laudo por passo. Remontá-lo como `AuditResult`
        jogaria fora o percurso inteiro."""
        headers, user = dono
        trajeto = {"success": True, "tipo": "trajeto", "arquivo": "checkout.har",
                   "resumo": {"passos": 2, "violationsCount": 5}, "passos": []}
        scan = _gravar(db, user.id, trajeto, plano="premium")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["tipo"] == "trajeto"
        assert resultado["resumo"]["passos"] == 2

    def test_varredura_em_andamento_nao_e_remontada(self, client, db, dono):
        headers, user = dono
        scan = _gravar(db, user.id, None, plano="premium", status="pending")

        r = client.get(f"/api/scans/{scan.id}", headers=headers)
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

    def test_laudo_antigo_nao_ganha_o_default_da_dataclass(self, client, db, dono):
        """Campo que faltou não pode voltar preenchido com o default do motor.

        `AuditResult.scan_method` vale "html_source" quando ninguém o define.
        Laudo gravado sem a chave voltava declarando ter lido só o código-fonte
        — ao lado dos cookies gravados, que só o navegador enxerga. Numa peça de
        evidência a contradição derruba tudo o que vem depois; e o banco sabe o
        método, ele está na coluna `scans.scan_method`.
        """
        headers, user = dono
        sem_metodo = {
            "tags": [{"name": "Google Analytics 4", "tagId": "G-ABC"}],
            "storage": {"cookiesWithoutConsent": [{"name": "_ga", "owner": "Google Analytics"}]},
        }
        assert "scan_method" not in sem_metodo and "scanMethod" not in sem_metodo
        scan = _gravar(db, user.id, sem_metodo, plano="premium", metodo="browser")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["scanMethod"] == "browser", (
            "o laudo reaberto declarou um método de coleta que não foi o da "
            "varredura — aqui veio do default da dataclass"
        )

    def test_laudo_capenga_nao_derruba_a_rota(self, client, db, dono):
        """Campo que faltou fica ausente; a rota não pode responder 500 por um
        laudo antigo incompleto."""
        headers, user = dono
        capenga = {"tags": [{"name": "Meta Pixel"}], "privacy": None, "storage": None}
        scan = _gravar(db, user.id, capenga, plano="premium")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["storage"] is None
        assert resultado["tags"][0]["name"] == "Meta Pixel"


class TestOQueNaoFoiGravadoNaoEAfirmado:
    """A reabertura monta a resposta com um objeto de coleta que o banco não tem.

    Cada campo desse objeto vira afirmação na resposta. `False` e `[]` não são
    valores neutros: dizem "não aconteceu" e "não houve", e a coleta que
    responderia por isso não é persistida.
    """

    def test_nao_nega_a_queda_para_o_html(self, client, db, dono, gravado):
        """`static_fallback_used: false` afirma que o navegador deu conta.

        Num scan cujo método gravado é `static_fallback`, essa negativa
        contradiz a própria identificação da varredura, dentro do mesmo
        documento.
        """
        headers, user = dono
        caiu = dict(gravado, scan_method="static_fallback")
        scan = _gravar(db, user.id, caiu, plano="premium", metodo="static_fallback")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["scanMethod"] == "static_fallback"
        assert resultado["static_fallback_used"] is True, (
            "o laudo negou a queda para o HTML de uma varredura que caiu"
        )

    def test_o_que_o_metodo_nao_responde_fica_sem_resposta(self, client, db, dono, gravado):
        """Método fora da lista conhecida não vira negativa: vira ausência."""
        headers, user = dono
        outro = dict(gravado, scan_method="html_source")
        scan = _gravar(db, user.id, outro, plano="premium", metodo="html_source")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["static_fallback_used"] is None

    def test_a_queda_sai_do_metodo_que_a_resposta_publica(self, client, db, dono, gravado):
        """Uma fonte só. O laudo gravado manda no método publicado, então é dele
        que a queda tem de sair — a coluna do banco pode ter ficado para trás, e
        duas fontes produzem "método: navegador" ao lado de "caiu para o HTML"."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium", metodo="static_fallback")

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["scanMethod"] == "browser"       # o que o laudo gravou
        assert resultado["static_fallback_used"] is False

    def test_nao_afirma_que_a_varredura_nao_avisou_nada(self, client, db, dono, gravado):
        """Aviso de coleta não é persistido — `[]` diria que não houve nenhum."""
        headers, user = dono
        scan = _gravar(db, user.id, gravado, plano="premium")

        assert _reabrir(client, headers, scan.id)["warnings"] is None

    def test_o_score_ausente_nao_vira_um_plausivel(self, client, db, dono):
        """`_normalize_audit_response` carimba "70 se achou tag" quando não
        recebe eixo geral. O laudo reaberto tem a coluna `scans.score`, que saiu
        da medição — e é ela que a lista do histórico já mostra."""
        headers, user = dono
        sem_scores = {
            "tags": [{"name": "Google Analytics 4", "tagId": "G-ABC"}],
            "scan_method": "browser",
            "scores": None,
        }
        scan = _gravar(db, user.id, sem_scores, plano="premium", score=12)

        resultado = _reabrir(client, headers, scan.id)
        assert resultado["score"] == 12, (
            "o laudo publicou um score que ninguém mediu — e diferente do que a "
            "mesma resposta HTTP traz em `score`"
        )

    def test_score_zero_e_medida_e_nao_ausencia(self, client, db, dono):
        """Zero é falsy, e a leitura do eixo geral usa `or`: o site medido em 0
        caía no mesmo palpite do laudo sem score e era publicado como 70 —
        "adequado" sobre a pior nota possível."""
        headers, user = dono
        tudo_errado = {
            "tags": [{"name": "Google Analytics 4", "tagId": "G-ABC"}],
            "scan_method": "browser",
            "scores": {"overall": 0, "tracking_quality": 0, "event_architecture": None,
                       "datalayer_quality": 0, "consent_integrity": 0, "privacy_risk": 100},
        }
        scan = _gravar(db, user.id, tudo_errado, plano="premium", score=0)

        assert _reabrir(client, headers, scan.id)["score"] == 0
