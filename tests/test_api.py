"""Regressão das rotas: ordem de registro, autenticação e gating de plano."""
import pytest


class TestOrdemDasRotas:
    """O catch-all GET "/{full_path:path}" era declarado antes destas rotas.

    Starlette entrega para a primeira rota que casa, então todas devolviam o
    index.html — /health inclusive, o que reprova o health check do deploy.
    """

    @pytest.mark.parametrize("caminho", ["/health", "/lgpd-info"])
    def test_rota_de_api_nao_e_engolida_pelo_spa(self, client, caminho):
        r = client.get(caminho)
        assert r.headers["content-type"].startswith("application/json"), \
            f"{caminho} devolveu {r.headers['content-type']} — catch-all voltou a vir antes"

    def test_health_responde_ok(self, client):
        # o /health atual checa banco e variaveis de ambiente: ok | degraded
        assert client.get("/health").json()["status"] in ("ok", "degraded")

    def test_spa_fallback_continua_ativo(self, client):
        assert client.get("/alguma/rota/do/spa").status_code in (200, 404)

    def test_api_inexistente_da_404(self, client):
        assert client.get("/api/nao-existe").status_code == 404


class TestAutenticacaoObrigatoria:
    @pytest.mark.parametrize("metodo,caminho", [
        ("get", "/history"),
        ("delete", "/history"),          # era público: um curl -X DELETE zerava tudo
        ("get", "/api/exports/pdf/1"),   # era AttributeError -> 500
        ("get", "/api/exports/excel/1"),
        ("get", "/api/auth/me"),
    ])
    def test_sem_token_responde_401(self, client, metodo, caminho):
        assert getattr(client, metodo)(caminho).status_code == 401

    def test_criar_scan_sem_token_responde_401(self, client):
        r = client.post("/api/scans/", json={"url": "https://exemplo.com"})
        assert r.status_code == 401


class TestGatingDePlano:
    """O plano vinha do corpo da requisição."""

    @pytest.mark.parametrize("plano_pedido", ["premium", "pro", "full"])
    def test_anonimo_nao_recebe_plano_pago(self, client, plano_pedido):
        r = client.post("/api/audit", json={"url": "http://10.0.0.5/", "plan": plano_pedido})
        assert r.json().get("plan") != plano_pedido or r.json().get("plan") == "free"

    def test_usuario_free_nao_vira_premium_pelo_payload(self, client, usuario_logado):
        headers, _ = usuario_logado
        r = client.post("/api/audit", json={"url": "http://10.0.0.5/", "plan": "premium"}, headers=headers)
        assert r.json().get("plan") in (None, "free")


class TestSSRFNosEndpoints:
    @pytest.mark.parametrize("alvo", [
        "http://169.254.169.254/latest/meta-data/",
        "http://127.0.0.1:8000/",
        "http://10.0.0.5/",
    ])
    def test_audit_recusa_destino_interno(self, client, alvo):
        assert client.post("/api/audit", json={"url": alvo}).status_code == 400


class TestCadastroELogin:
    def test_senha_curta_e_recusada(self, client):
        r = client.post("/api/auth/register", json={
            "email": "curta@exemplo-teste.com", "password": "123", "name": "Curta"})
        assert r.status_code == 422
        assert r.json()["errorCode"] == "PASSWORD_TOO_SHORT"

    def test_me_traz_uso_real_da_semana(self, client, usuario_logado):
        headers, _ = usuario_logado
        corpo = client.get("/api/auth/me", headers=headers).json()
        assert corpo["plan"] == "free"
        # scans_used vinha de um campo que nada incrementava: era sempre 0
        assert "scans_used" in corpo and "scans_limit" in corpo
        assert corpo["scans_used"] == 0

    def test_me_reflete_scans_realmente_feitos(self, client, db, usuario_logado):
        """Regressão: Subscription.weekly_scan_count nunca é incrementado.

        Com o valor vindo daquele campo, o painel mostrava 0 auditorias usadas
        enquanto o limite — que conta pela tabela `scans` — já barrava o
        usuário com 403. Os dois números têm que sair da mesma fonte.
        """
        from db.models import Scan
        headers, email = usuario_logado
        user_id = client.get("/api/auth/me", headers=headers).json()["id"]

        for i in range(3):
            db.add(Scan(user_id=user_id, url=f"https://exemplo{i}.com", status="completed"))
        db.commit()

        corpo = client.get("/api/auth/me", headers=headers).json()
        assert corpo["scans_used"] == 3, f"esperava 3, veio {corpo['scans_used']}"

    def test_forca_bruta_no_login_e_barrada(self, client):
        codigos = [
            client.post("/api/auth/token", data={"username": "x@y.test", "password": "errada"}).status_code
            for _ in range(6)
        ]
        assert 429 in codigos, f"sem rate limit no login: {codigos}"


class TestEntradasMalformadas:
    """Erro de entrada do cliente não pode virar 500.

    `await request.json()` levantava em corpo inválido e a exceção caía no
    except genérico da rota, devolvendo 500 — o que polui o monitoramento e
    esconde falhas reais do servidor no meio do ruído.
    """

    @pytest.mark.parametrize("rota", ["/analyze", "/deep-analyze", "/chat"])
    def test_json_malformado_da_400(self, client, rota):
        r = client.post(rota, content=b"{isto nao e json", headers={"Content-Type": "application/json"})
        assert r.status_code == 400, f"{rota} devolveu {r.status_code}"

    @pytest.mark.parametrize("rota", ["/analyze", "/deep-analyze"])
    def test_corpo_que_nao_e_objeto_da_400(self, client, rota):
        r = client.post(rota, content=b'"apenas uma string"', headers={"Content-Type": "application/json"})
        assert r.status_code == 400

    def test_scan_id_nao_numerico_da_422(self, client):
        assert client.get("/api/scans/abc").status_code == 422

    def test_url_gigante_e_recusada(self, client):
        r = client.post("/api/audit", json={"url": "https://exemplo.com/" + "a" * 10000})
        assert r.status_code == 400


class TestChat:
    """O chat tem fallback por regras justamente para não depender do Gemini.

    O fallback estava morto no Windows: quando a chamada ao Gemini falhava (chave
    inválida, cota estourada), o `except` fazia print de uma string com emoji, o
    console cp1252 levantava UnicodeEncodeError, a exceção de log substituía a
    original e a rota devolvia 500 em vez da resposta por regras.
    """

    def test_responde_mesmo_sem_gemini(self, client):
        r = client.post("/chat", json={"message": "o que e multa da LGPD?"})
        assert r.status_code == 200, r.text
        corpo = r.json()
        assert corpo["status"] == "ok"
        assert corpo["response"], "resposta vazia"

    def test_mensagem_vazia_da_400(self, client):
        assert client.post("/chat", json={"message": "   "}).status_code == 400

    def test_mensagem_gigante_e_truncada_sem_erro(self, client):
        r = client.post("/chat", json={"message": "a" * 50000})
        assert r.status_code == 200

    def test_contexto_de_tipo_errado_nao_derruba(self, client):
        r = client.post("/chat", json={"message": "oi", "context": "isto devia ser objeto"})
        assert r.status_code == 200


class TestIDOR:
    def test_scan_anonimo_nao_e_legivel_por_terceiro(self, client, db, usuario_logado):
        """Scan com user_id NULL pulava a checagem de dono; os ids são sequenciais."""
        from db.models import Scan
        anonimo = Scan(user_id=None, url="https://sitedeoutro.com", status="completed", raw_data={"tags": []})
        db.add(anonimo)
        db.commit()
        headers, _ = usuario_logado
        assert client.get(f"/api/scans/{anonimo.id}", headers=headers).status_code == 404
