"""Reabrir um laudo já gravado, sem refazer a varredura.

O resultado vivia só no estado do React: recarregar a página descartava um
laudo que estava no banco, e o usuário gastava outra varredura da cota para
ver de novo o que já tinha. Com o id na URL (`/?scan=123`), F5 deixa de
custar dinheiro e o histórico passa a apontar para cada laudo em vez de só
listá-lo.

O que precisa valer:

- O laudo reaberto tem os mesmos campos do recém-gerado. Se faltar `storage`
  ou `summary`, a tela reabre pela metade — e o defeito é silencioso, porque
  campo ausente vira zero, não erro.
- Reabrir não consome cota. É leitura.
- Laudo de outro usuário não abre, e a resposta não confirma que o id existe.
"""
import json

import pytest

from db.models import Scan, utcnow


LAUDO = {
    "success": True,
    "url": "https://loja.com.br",
    "score": 42,
    "summary": {
        "violationsCount": 3,
        "violationsBySeverity": {"critical": 1, "high": 2, "medium": 0, "low": 0},
        "totalTags": 2,
        "piiExposureCount": 0,
    },
    "tags": [{"name": "Google Analytics 4", "isBeforeConsent": True}],
    "privacy": {
        "violations": [{"severity": "critical", "article": "LGPD art. 7º, I",
                        "violation": "Rastreamento sem consentimento"}],
        "totalViolations": 3,
        "hasConsentTool": False,
        "estimatedRiskExposure": "art. 52: até 2% do faturamento",
    },
    "storage": {"cookiesWithoutConsent": [{"name": "_ga", "domain": ".loja.com.br"}]},
    "scanMethod": "browser",
}


def _gravar(db, user_id, url="https://loja.com.br", raw=None, status="completed"):
    s = Scan(
        user_id=user_id,
        url=url,
        status=status,
        score=42,
        created_at=utcnow(),
        completed_at=utcnow(),
        scan_method="browser",
        raw_data=raw if raw is not None else LAUDO,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return s


@pytest.fixture()
def dono(db, usuario_logado):
    from db.models import User
    headers, email = usuario_logado
    return headers, db.query(User).filter(User.email == email).first()


class TestReabertura:
    def test_devolve_o_laudo_gravado(self, client, db, dono):
        headers, user = dono
        scan = _gravar(db, user.id)

        r = client.get(f"/api/scans/{scan.id}", headers=headers)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["url"] == "https://loja.com.br"
        assert d["result"] is not None

    def test_campos_que_a_tela_le_sobrevivem(self, client, db, dono):
        """Campo ausente vira zero na tela, não erro: o laudo reabriria pela
        metade sem ninguém perceber."""
        headers, user = dono
        scan = _gravar(db, user.id)

        resultado = client.get(f"/api/scans/{scan.id}", headers=headers).json()["result"]
        # A contagem sobrevive ao corte por plano — é ela que a tela mostra
        # para todo mundo.
        assert resultado["summary"]["violationsCount"] == 3
        assert resultado["summary"]["violationsBySeverity"]["critical"] == 1
        assert resultado["scanMethod"] == "browser"

    def test_reabrir_nao_consome_cota(self, client, db, dono):
        """É leitura. Cobrar de novo pelo mesmo laudo seria cobrar duas vezes."""
        from api.scans import contar_scans_da_semana

        headers, user = dono
        scan = _gravar(db, user.id)

        antes = contar_scans_da_semana(db, user.id)
        client.get(f"/api/scans/{scan.id}", headers=headers)
        client.get(f"/api/scans/{scan.id}", headers=headers)
        assert contar_scans_da_semana(db, user.id) == antes

    def test_laudo_de_trajeto_tambem_reabre(self, client, db, dono):
        """O modo trajeto grava com outro formato — e também precisa voltar."""
        headers, user = dono
        trajeto = {"tipo": "trajeto", "resumo": {"passos": 2}, "passos": []}
        scan = _gravar(db, user.id, raw=trajeto)

        d = client.get(f"/api/scans/{scan.id}", headers=headers).json()
        assert d["result"]["tipo"] == "trajeto"


class TestOCorteNaoMudaAoReabrir:
    """O mesmo scan não pode dizer duas coisas.

    O gratuito lê o veredito e a contagem, não a lista — e isso tem de valer
    igual no laudo recém-gerado e no reaberto. Antes divergia: um mostrava
    metade dos achados e o outro nenhum, então o número caía sozinho ao dar F5
    e o usuário não tinha como saber qual era verdade.
    """

    def test_free_nao_recebe_a_lista_ao_reabrir(self, client, db, dono):
        headers, user = dono
        varias = {
            **LAUDO,
            "privacy": {
                **LAUDO["privacy"],
                "violations": [
                    {"severity": "critical", "violation": f"Achado {i}"} for i in range(6)
                ],
            },
        }
        scan = _gravar(db, user.id, raw=varias)

        resultado = client.get(f"/api/scans/{scan.id}", headers=headers).json()["result"]
        assert resultado["privacy"]["violations"] == []

    def test_contagem_sobrevive_ao_corte(self, client, db, dono):
        """Dizer "3 achados" sem listá-los é o que motiva o upgrade; zerar a
        contagem junto faria a tela parecer defeituosa em vez de limitada."""
        headers, user = dono
        scan = _gravar(db, user.id)

        resultado = client.get(f"/api/scans/{scan.id}", headers=headers).json()["result"]
        assert resultado["summary"]["violationsCount"] == 3
        assert sum(resultado["summary"]["violationsBySeverity"].values()) == 3


class TestQuemPodeAbrir:
    def test_laudo_de_outro_usuario_nao_abre(self, client, db, dono):
        """Ids são sequenciais: sem esta checagem, dá para varrer a base."""
        import uuid
        from db.models import User

        headers, _ = dono
        email = f"vizinho-{uuid.uuid4().hex[:8]}@datatrust-teste.com"
        r = client.post("/api/auth/register", json={
            "email": email, "password": "senha-forte-123", "name": "Vizinho",
        })
        assert r.status_code == 200
        outro = db.query(User).filter(User.email == email).first()

        alheio = _gravar(db, outro.id, url="https://concorrente.com.br")

        r = client.get(f"/api/scans/{alheio.id}", headers=headers)
        assert r.status_code == 404
        assert "concorrente" not in r.text

    def test_id_inexistente_da_404(self, client, dono):
        headers, _ = dono
        assert client.get("/api/scans/99999999", headers=headers).status_code == 404

    def test_sem_login_nao_abre(self, client, db, dono):
        _, user = dono
        scan = _gravar(db, user.id)
        r = client.get(f"/api/scans/{scan.id}")
        assert r.status_code in (401, 403, 404)
