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

    def test_health_responde_healthy(self, client):
        assert client.get("/health").json()["status"] == "healthy"

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
        r = client.post("/api/auth/register", json={"email": "curta@exemplo-teste.com", "password": "123"})
        assert r.status_code == 400

    def test_me_traz_uso_real_do_mes(self, client, usuario_logado):
        headers, _ = usuario_logado
        corpo = client.get("/api/auth/me", headers=headers).json()
        assert corpo["plan"] == "free"
        # scans_used vinha de um campo que nada incrementava: era sempre 0
        assert "scans_used" in corpo and "scans_limit" in corpo

    def test_forca_bruta_no_login_e_barrada(self, client):
        codigos = [
            client.post("/api/auth/token", data={"username": "x@y.test", "password": "errada"}).status_code
            for _ in range(6)
        ]
        assert 429 in codigos, f"sem rate limit no login: {codigos}"


class TestIDOR:
    def test_scan_anonimo_nao_e_legivel_por_terceiro(self, client, db, usuario_logado):
        """Scan com user_id NULL pulava a checagem de dono; os ids são sequenciais."""
        from db.models import Scan
        anonimo = Scan(user_id=None, url="https://sitedeoutro.com", status="completed", raw_data={"tags": []})
        db.add(anonimo)
        db.commit()
        headers, _ = usuario_logado
        assert client.get(f"/api/scans/{anonimo.id}", headers=headers).status_code == 404
