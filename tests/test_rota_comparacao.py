"""A rota que compara duas varreduras.

Duas classes de erro custam caro aqui, e são diferentes entre si:

- **Vazamento.** O scan guarda a URL auditada e o relatório inteiro de um
  cliente. Uma rota que recebe dois ids e não confere o dono deixa qualquer
  usuário logado varrer ids sequenciais e ler auditoria alheia. Já aconteceu
  neste projeto com `GET /api/scans/{id}`.
- **Resposta plausível e errada.** Comparar varreduras de sites diferentes, ou
  uma varredura que falhou, produz um diff que parece legítimo — "você corrigiu
  22 problemas" — sobre dados que não se comparam.
"""
import pytest

from db.models import Scan, utcnow


def _violacao(article, description, tag="Página", severity="high"):
    return {
        "article": article, "description": description,
        "tag": tag, "severity": severity,
        "violation": f"{description} em {tag}",
    }


SEM_CMP = _violacao("LGPD art. 7º, I", "Rastreamento sem consentimento", severity="critical")
COOKIE_GA = _violacao("LGPD art. 16", "Cookie antes do consentimento", "Google Analytics 4")
COOKIE_META = _violacao("LGPD art. 16", "Cookie antes do consentimento", "Meta Pixel")


def _criar_scan(db, user_id, url, violacoes, score=50, status="completed"):
    s = Scan(
        user_id=user_id,
        url=url,
        status=status,
        score=score,
        created_at=utcnow(),
        raw_data={"privacy": {"violations": list(violacoes)}, "scores": {"overall": score}, "tags": []},
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture()
def dono(client, db, usuario_logado):
    from db.models import User
    headers, email = usuario_logado
    user = db.query(User).filter(User.email == email).first()
    return headers, user


class TestComparacao:
    def test_compara_duas_varreduras_do_mesmo_site(self, client, db, dono):
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [SEM_CMP, COOKIE_GA, COOKIE_META], score=30)
        b = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA], score=70)

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers)
        assert r.status_code == 200, r.text
        d = r.json()

        assert d["veredito"] == "melhorou"
        assert d["totais"] == {"antes": 3, "agora": 1, "corrigidas": 2, "persistentes": 1, "novas": 0}
        assert d["score"]["variacao"] == 40
        assert "corrigida" in d["resumo"]

    def test_regressao_e_reportada(self, client, db, dono):
        """Tag publicada no GTM depois da correção — o caso que motiva o
        acompanhamento."""
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA])
        b = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA, COOKIE_META])

        d = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers).json()
        assert d["veredito"] == "regrediu"
        assert d["totais"]["novas"] == 1
        assert d["novas"][0]["tag"] == "Meta Pixel"

    def test_mesmo_total_com_troca_nao_e_sem_mudanca(self, client, db, dono):
        """Delta zero escondia a regressão no comparador antigo."""
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA, COOKIE_META])
        b = _criar_scan(db, user.id, "https://loja.com.br", [SEM_CMP, COOKIE_GA])

        d = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers).json()
        assert d["veredito"] == "misto"
        assert d["totais"]["antes"] == d["totais"]["agora"] == 2


class TestAutorizacao:
    def test_exige_login(self, client, db, dono):
        _, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA])
        b = _criar_scan(db, user.id, "https://loja.com.br", [])

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}")
        assert r.status_code in (401, 403), "rota sem autenticação expõe auditoria alheia"

    def test_nao_compara_scan_de_outro_usuario(self, client, db, dono):
        """O ataque é trivial: ids são sequenciais.

        A URL é a mesma nos dois scans de propósito. Com URLs diferentes, uma
        falha na checagem de dono seria mascarada pelo 400 de "sites
        diferentes" — o teste passaria sem testar nada.
        """
        import uuid
        from db.models import User

        headers_a, user_a = dono

        # Segundo usuário de verdade: a fixture `usuario_logado` tem escopo de
        # função e devolveria o mesmo usuário dentro deste teste.
        email_b = f"vizinho-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        r = client.post("/api/auth/register", json={
            "email": email_b, "password": "senha-forte-123", "name": "Vizinho",
        })
        assert r.status_code == 200, r.text
        user_b = db.query(User).filter(User.email == email_b).first()
        assert user_b.id != user_a.id, "os dois usuários precisam ser distintos"

        meu = _criar_scan(db, user_a.id, "https://loja.com.br", [COOKIE_GA])
        alheio = _criar_scan(db, user_b.id, "https://loja.com.br", [SEM_CMP])

        r = client.get(f"/api/scans/comparar?antes={meu.id}&agora={alheio.id}", headers=headers_a)
        assert r.status_code == 404, "leu varredura de outro usuário"
        # 404 e não 403: 403 confirmaria que aquele id existe.
        assert "Rastreamento sem consentimento" not in r.text

    def test_scan_inexistente_da_404(self, client, db, dono):
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA])
        r = client.get(f"/api/scans/comparar?antes={a.id}&agora=99999999", headers=headers)
        assert r.status_code == 404


class TestComparacaoQueNaoFazSentido:
    def test_sites_diferentes_sao_recusados(self, client, db, dono):
        """Comparar dois sites produz um diff que parece legítimo e não é."""
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [SEM_CMP])
        b = _criar_scan(db, user.id, "https://outra-loja.com.br", [])

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers)
        assert r.status_code == 400
        assert "mesmo endereço" in r.json()["detail"]

    def test_varredura_que_falhou_nao_entra(self, client, db, dono):
        """Scan `failed` tem raw_data vazio: compará-lo diria "corrigiu tudo"."""
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [SEM_CMP, COOKIE_GA])
        b = _criar_scan(db, user.id, "https://loja.com.br", [], status="failed")

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers)
        assert r.status_code == 409

    def test_mesma_varredura_dos_dois_lados(self, client, db, dono):
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA])
        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={a.id}", headers=headers)
        assert r.status_code == 400


class TestRotaNaoFoiEngolida:
    def test_comparar_nao_cai_no_path_param(self, client, db, dono):
        """`/{scan_id}` casa com qualquer segmento, inclusive "comparar".

        Se a ordem de registro inverter, esta rota vira `scan_id="comparar"` e
        devolve 422 — a mesma armadilha do catch-all do SPA em main.py, que já
        engoliu /health e /history.
        """
        headers, user = dono
        a = _criar_scan(db, user.id, "https://loja.com.br", [COOKIE_GA])
        b = _criar_scan(db, user.id, "https://loja.com.br", [])

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers)
        assert r.status_code == 200, (
            f"a rota /comparar foi engolida por /{{scan_id}} (status {r.status_code})"
        )
