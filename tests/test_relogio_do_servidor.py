"""O relógio que carimba o laudo tem de ser UTC — e um só.

Complementa `tests/test_fuso_do_laudo.py`, que prende o outro lado: lá se
verifica que a tela lê como UTC a string sem sufixo que a API manda. Aqui se
verifica quem **escreve** essa string.

O defeito: `db.models.utcnow()` devolve UTC, mas `started_at`/`finished_at`
(`audit_engine/browser_fetcher.py`), o `timestamp` do motor
(`audit_engine/orchestrator.py`) e os dois relatórios de `main.py` usavam
`datetime.now()` — a hora **local do servidor**. Ambos saem em ISO sem sufixo,
indistinguíveis na resposta, e a tela lê os dois como UTC.

Num container em UTC nada aparece. Fora dele (a máquina de desenvolvimento é
UTC−3) o mesmo scan declarava dois horários com três horas de diferença
conforme a tela: o histórico, vindo de `created_at`, dizia uma coisa; o
cabeçalho do laudo, vindo de `finished_at`, dizia outra. E, com a tela lendo
tudo como UTC, o carimbo local ainda errava para o lado contrário — a
varredura das 23h40 aparecia às 20h40.

Fonte única: `audit_engine.tempo.agora_utc_iso()`.
"""
import re
from datetime import datetime, timezone
from pathlib import Path

import main
from audit_engine import orchestrator, tempo

RAIZ = Path(__file__).resolve().parents[1]

# Um relógio de mentira que responde diferente conforme lhe perguntem a hora
# local ou a hora UTC. É o que torna este teste independente do fuso da máquina
# que o roda: numa CI em UTC as duas leituras seriam iguais e o teste passaria
# até com a correção desfeita.
class _RelogioFalso:
    LOCAL = datetime(2026, 8, 13, 23, 40, 0)
    UTC = datetime(2026, 8, 14, 2, 40, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.UTC if tz is not None else cls.LOCAL


class TestOHelperDoRelogio:
    def test_le_o_relogio_em_utc_e_nao_o_local(self, monkeypatch):
        """`datetime.now()` sem fuso devolveria 23:40 do dia 13 — três horas de
        erro e um dia a menos que o instante real."""
        monkeypatch.setattr(tempo, "datetime", _RelogioFalso)
        assert tempo.agora_utc_iso() == "2026-08-14T02:40:00"

    def test_sai_sem_sufixo_de_fuso(self):
        """Mesmo formato de `db.models.utcnow()`: é o que a tela espera, e
        misturar um carimbo com offset e outro sem cria duas leituras para o
        mesmo campo."""
        assert not re.search(r"(?:Z|[+-]\d{2}:?\d{2})$", tempo.agora_utc_iso())

    def test_e_o_mesmo_instante_de_utcnow(self):
        """Se as duas fontes divergirem, histórico e laudo voltam a contar
        histórias diferentes sobre a mesma varredura."""
        from db.models import utcnow

        agora = datetime.fromisoformat(tempo.agora_utc_iso())
        assert abs((agora - utcnow()).total_seconds()) < 5


class TestQuemCarimbaOLaudo:
    """Os produtores de verdade, exercitados — não só lidos."""

    def test_o_motor_usa_o_relogio_unico(self, monkeypatch):
        """`run_audit` grava o `timestamp` que vai para `raw_data` e que, ao
        reabrir um laudo pelo histórico, pode virar a data do cabeçalho."""
        monkeypatch.setattr(orchestrator, "agora_utc_iso", lambda: "carimbo-do-relogio-unico")
        resultado = orchestrator.run_audit("https://loja.com.br", "<html><body>oi</body></html>")
        assert resultado.timestamp == "carimbo-do-relogio-unico"

    def test_o_motor_legado_usa_o_relogio_unico(self, monkeypatch):
        """`/analyze` ainda responde por este relatório, e ele carrega a mesma
        chave `timestamp` lida pela tela."""
        monkeypatch.setattr(main, "agora_utc_iso", lambda: "carimbo-do-relogio-unico")
        relatorio = main.generate_audit_report({"url": "https://loja.com.br", "html": "<html></html>"})
        assert relatorio["timestamp"] == "carimbo-do-relogio-unico"


class TestNinguemVoltaAORelogioLocal:
    """O scanner não cabe num teste unitário — ele sobe um Chromium de verdade.

    Como `browser_scan` só carimba depois de navegar, a garantia de que
    `started_at`/`finished_at` saem em UTC é feita sobre o código: nenhum
    `datetime.now()` sem fuso nos arquivos que produzem carimbo de laudo. É
    verificação mais pobre que executar, e está escrito que é — mas cobre
    justamente o caminho que nenhum teste alcança sem navegador.
    """

    ARQUIVOS = (
        "audit_engine/browser_fetcher.py",
        "audit_engine/orchestrator.py",
        "main.py",
    )
    RELOGIO_LOCAL = re.compile(r"datetime\.now\(\s*\)")

    def test_nenhum_carimbo_sai_do_relogio_local(self):
        culpados = []
        for caminho in self.ARQUIVOS:
            fonte = (RAIZ / caminho).read_text(encoding="utf-8")
            for numero, linha in enumerate(fonte.splitlines(), start=1):
                # Comentário citando o defeito é bem-vindo; código, não.
                sem_comentario = linha.split("#", 1)[0]
                if self.RELOGIO_LOCAL.search(sem_comentario):
                    culpados.append(f"{caminho}:{numero}: {linha.strip()}")

        assert not culpados, (
            "carimbo em hora local do servidor — use audit_engine.tempo.agora_utc_iso():\n"
            + "\n".join(culpados)
        )


class TestONormalizadorNaoInventaData:
    """O último degrau do fallback do frontend era `new Date().toISOString()`.

    Ele nunca falha: sem `finished_at` nem `started_at` na resposta, o cabeçalho
    passava a carimbar o relógio de quem abriu a página — e um laudo antigo
    reaberto pelo histórico ganhava a data de hoje, sem erro nenhum aparecer.

    `normalizeAuditResult` mora num `.tsx` que só carrega dentro do empacotador,
    então aqui a conferência é sobre o texto do arquivo. Vale pelo que protege:
    a reintrodução do fallback é uma linha, e é exatamente essa linha que se
    procura.
    """

    def test_o_timestamp_do_laudo_nao_tem_fallback_para_agora(self):
        fonte = (RAIZ / "static/src/components/AuditContainer.tsx").read_text(encoding="utf-8")
        atribuicoes = re.findall(r"timestamp:\s*safeRaw[^\n;]*", fonte)

        assert atribuicoes, (
            "a normalização do `timestamp` mudou de forma em AuditContainer.tsx — "
            "confira à mão se ela ainda declara a ausência em vez de inventar a data"
        )
        for linha in atribuicoes:
            assert "new Date(" not in linha, (
                "o laudo voltou a carimbar o relógio de quem abriu a página: " + linha
            )
