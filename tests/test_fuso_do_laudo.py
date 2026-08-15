"""O fuso do laudo: a data exibida tem de ser a data em que o exame aconteceu.

O backend grava e serializa instantes **naive** — `db.models.utcnow()` devolve
UTC sem `tzinfo` de propósito, porque as colunas `DateTime` não usam
`timezone=True` e misturar aware com naive quebra as comparações de data (a
janela semanal de cota, em `api/scans.py`, depende disso).

O preço é pago do outro lado. `datetime.isoformat()` de um naive não escreve
sufixo algum:

    "2026-08-13T02:40:00"

e o ECMAScript manda o navegador ler uma string **sem fuso e com hora** como
**hora local**. No Brasil (UTC−3) o laudo aparecia três horas adiantado — e não
é só o relógio que erra:

    "2026-08-13T02:40:00"  →  exibido: 13/08/2026 02:40
                              correto: 12/08/2026 23:40

O **dia** muda. Num documento que se propõe a provar o que um site fez e quando,
essa é a informação errada escrita com confiança: quem confere a evidência não
acha nada no dia declarado, e o laudo inteiro vira suspeito.

Por isso o frontend acrescenta o 'Z' antes de ler (`comoInstanteUtc`, em
`static/src/lib/datas.ts`) — e por isso ele só o acrescenta quando a string
realmente não traz fuso, para não estragar uma resposta que um dia passe a
mandá-lo. Este arquivo prende as duas pontas do contrato que sustenta essa
regra:

- os campos de data existem e chegam como string ISO **sem** offset;
- lê-los como UTC devolve o instante que o backend quis dizer.

Se algum dia o backend passar a mandar o offset, as asserções de "sem sufixo"
falham aqui — e é o aviso de que a regra do frontend precisa ser revista, em vez
de o laudo silenciosamente voltar a errar o dia.

Os dois relógios, agora um só. `created_at` — histórico, comparador,
reabertura — sempre veio de `utcnow()`, UTC de verdade. Já
`started_at`/`finished_at` do laudo e o `timestamp` do motor vinham de
`datetime.now()`, a hora **local do servidor**: num container em UTC os dois
coincidiam e nada aparecia; fora dela (a máquina de desenvolvimento, UTC−3) o
mesmo scan declarava dois horários com três horas de diferença conforme a tela
em que fosse aberto — e, com a tela lendo tudo como UTC, o carimbo local errava
para o outro lado. Todos passam por `audit_engine/tempo.agora_utc_iso()`, e as
duas pontas estão presas aqui.
"""
import json
import os
import re
import shutil
import subprocess
import time
from dataclasses import fields
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from api.audit import _normalize_audit_response
from audit_engine.browser_fetcher import BrowserScanResult
from audit_engine.orchestrator import run_audit
from db.models import Scan, utcnow


# Espelho de `comoInstanteUtc` (static/src/lib/datas.ts). Não há vitest no
# projeto, então o teste do lado que consome mora aqui, junto do lado que
# produz: é a única forma de uma mudança no formato da resposta acusar erro.
#
# O espelho sozinho não protegeria nada — ele passa mesmo que `datas.ts` volte
# a ler a data crua, porque testa a cópia, não o original. Quem prende o
# original é `TestOHelperDoFrontendDeVerdade`, no fim do arquivo, que executa o
# próprio arquivo do frontend; e é ele também que acusa se o espelho aqui
# divergir da implementação real.
_TEM_FUSO = re.compile(r"(?:Z|[+-]\d{2}:?\d{2})$", re.IGNORECASE)


def como_instante_utc(iso):
    """O instante, ou `None` se a entrada não for data utilizável."""
    if not isinstance(iso, str) or not iso:
        return None
    texto = iso if _TEM_FUSO.search(iso) else f"{iso}Z"
    try:
        return datetime.fromisoformat(texto)
    except ValueError:
        return None


DATAS_TS = Path(__file__).resolve().parents[1] / "static" / "src" / "lib" / "datas.ts"

# Fuso do cliente brasileiro, forçado no processo do Node. Sem ele o teste
# rodaria no fuso da máquina: numa CI em UTC, ler a data crua e lê-la como UTC
# dão o mesmo instante, e o teste passaria com a correção desfeita — que é
# justamente o tipo de teste que este arquivo existe para não ser.
FUSO_DO_TESTE = "America/Sao_Paulo"


def _rodar_datas_ts(entradas):
    """Executa o `datas.ts` de verdade no Node e devolve o que ele produziu.

    O Node 22.6+ remove as anotações de tipo sozinho, então o arquivo do
    frontend roda sem build nem empacotador — é o arquivo publicado, não uma
    tradução dele.
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("Node não encontrado no PATH — o helper do frontend não foi exercitado")

    versao = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=60)
    maior = int(re.sub(r"^v", "", versao.stdout.strip()).split(".")[0] or 0)
    if maior < 22:
        pytest.skip(f"Node {versao.stdout.strip()} não remove tipos de .ts (precisa de 22+)")

    driver = f"""
    import {{ comoInstanteUtc, dataHoraLegivel }} from {json.dumps(DATAS_TS.as_uri())};
    const saida = {json.dumps(entradas)}.map((iso) => {{
      const d = comoInstanteUtc(iso);
      return {{ instante: d === null ? null : d.toISOString(), legivel: dataHoraLegivel(iso) }};
    }});
    process.stdout.write(JSON.stringify(saida));
    """
    r = subprocess.run(
        [node, "--input-type=module", "-e", driver],
        capture_output=True, text=True, encoding="utf-8", timeout=120,
        env={**os.environ, "TZ": FUSO_DO_TESTE},
    )
    # Falha do Node é falha do teste, nunca lista vazia: um erro engolido aqui
    # transformaria "o frontend não foi verificado" em "o frontend passou".
    assert r.returncode == 0, f"o Node não conseguiu executar {DATAS_TS.name}:\n{r.stderr}"
    return json.loads(r.stdout)


AGORA = 1_700_000_000.0

# Um instante fixo e conhecido, escrito como o backend escreve: UTC, naive,
# sem sufixo. É contra ele que se mede o que a tela mostraria.
INSTANTE = datetime(2026, 8, 13, 2, 40, 0, tzinfo=timezone.utc)
NAIVE_UTC = INSTANTE.replace(tzinfo=None).isoformat()  # "2026-08-13T02:40:00"

BRASILIA = timezone(timedelta(hours=-3))


class _Req:
    def __init__(self, url, timestamp=AGORA):
        self.url = url
        self.timestamp = timestamp
        self.method = "GET"
        self.domain = ""
        self.path = ""
        self.post_data = None
        self.resource_type = "script"


class _Scan:
    """Varredura de navegador com os dois marcos de tempo preenchidos."""
    scan_method = "browser"
    scan_status = "completed"
    fallback_used = False
    all_script_urls = []
    error = None
    started_at = datetime(2026, 8, 13, 2, 39, 30).isoformat()
    finished_at = NAIVE_UTC
    html = (
        "<html><head>"
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC1234567"></script>'
        "</head><body>loja</body></html>"
    )
    intercepted_requests = [
        _Req("https://www.google-analytics.com/g/collect?v=2&tid=G-ABC1234567", AGORA + 0.35)
    ]
    cookies = [
        {"name": "_ga", "domain": ".loja.com.br", "expires": time.time() + 3e7, "httpOnly": False}
    ]
    local_storage = {}
    session_storage = {}


@pytest.fixture(scope="module")
def resposta():
    resultado = run_audit("https://loja.com.br", _Scan())
    return _normalize_audit_response("https://loja.com.br", "premium", _Scan(), resultado)


class TestOsCamposExistem:
    """Sem eles a tela não tem de onde tirar a data — e o fallback mente.

    O normalizador do frontend faz
    `finished_at || started_at || timestamp || new Date().toISOString()`.
    O último degrau nunca falha: se as duas primeiras chaves sumirem, o
    cabeçalho passa a carimbar o relógio de quem abriu a página, e um laudo
    antigo reaberto pelo histórico ganha a data de hoje sem nenhum erro
    aparecer. Campo que some é campo que precisa quebrar um teste.
    """

    def test_finished_at_e_started_at_chegam_na_resposta(self, resposta):
        assert resposta["finished_at"] == _Scan.finished_at
        assert resposta["started_at"] == _Scan.started_at

    def test_o_motor_declara_os_dois_marcos(self):
        """`getattr(scan, "finished_at", None)` devolve None em silêncio se o
        campo for renomeado no motor — o laudo perde a data e nada estoura."""
        campos = {f.name for f in fields(BrowserScanResult)}
        assert {"started_at", "finished_at"} <= campos

    def test_a_resposta_nao_tem_timestamp(self, resposta):
        """A chave que o tipo do frontend declarava e a API nunca mandou.

        Se ela passar a existir, o frontend precisa ser revisto: hoje ele deriva
        a data de `finished_at`, e duas fontes para o mesmo carimbo é como se
        criam duas verdades na mesma tela.
        """
        assert "timestamp" not in resposta


class TestOFormatoQueOHelperLe:
    def test_sao_string_e_nao_datetime(self, resposta):
        """`JSONResponse` serializa com `json.dumps`, que não conhece datetime:
        um objeto aqui derruba a rota inteira depois da varredura já paga."""
        json.dumps({k: resposta[k] for k in ("started_at", "finished_at")})
        assert isinstance(resposta["finished_at"], str)
        assert isinstance(resposta["started_at"], str)

    def test_chegam_sem_sufixo_de_fuso(self, resposta):
        """É esta ausência que obriga o frontend a acrescentar o 'Z'."""
        for campo in ("started_at", "finished_at"):
            assert not _TEM_FUSO.search(resposta[campo]), (
                f"{campo} passou a trazer fuso — reveja `comoInstanteUtc` em "
                "static/src/lib/datas.ts antes de comemorar"
            )

    def test_sao_iso_8601_legivel(self, resposta):
        for campo in ("started_at", "finished_at"):
            assert como_instante_utc(resposta[campo]) is not None

    def test_lido_como_utc_da_o_instante_certo(self, resposta):
        """O centro da correção: mesma string, instante certo."""
        assert como_instante_utc(resposta["finished_at"]) == INSTANTE

    def test_lido_cru_troca_o_dia_do_exame_em_brasilia(self):
        """O defeito, reproduzido — para que ninguém "simplifique" a leitura.

        `new Date("2026-08-13T02:40:00")` interpreta a string no fuso do
        navegador, então o que ele renderiza é a própria string, sem conversão
        nenhuma. O fuso é fixo aqui (−3) em vez de vir da máquina: o defeito
        precisa ser demonstrável também numa CI rodando em UTC.
        """
        exibicao_correta = INSTANTE.astimezone(BRASILIA).replace(tzinfo=None)
        exibicao_crua = datetime.fromisoformat(NAIVE_UTC)

        assert (exibicao_correta.day, exibicao_correta.hour) == (12, 23)
        assert (exibicao_crua.day, exibicao_crua.hour) == (13, 2)
        assert exibicao_crua - exibicao_correta == timedelta(hours=3)


class TestAsOutrasTelasQueMostramData:
    """Histórico e comparador leem `created_at`, que é `utcnow()` de verdade.

    Aqui não há dublê: a data sai do banco, passa pela rota e volta pelo HTTP,
    que é o caminho exato da tela. Se ela chegasse em hora local, ler como UTC
    jogaria o resultado para longe de "agora" e a asserção quebraria.
    """

    @pytest.fixture()
    def dono(self, db, usuario_logado):
        from db.models import User
        headers, email = usuario_logado
        return headers, db.query(User).filter(User.email == email).first()

    def _gravar(self, db, user_id, url="https://loja.com.br"):
        s = Scan(
            user_id=user_id,
            url=url,
            status="completed",
            score=42,
            created_at=utcnow(),
            raw_data={"privacy": {"violations": []}, "scores": {"overall": 42}, "tags": []},
        )
        db.add(s)
        db.commit()
        db.refresh(s)
        return s

    def test_history_manda_instante_utc_sem_sufixo(self, client, db, dono):
        headers, user = dono
        self._gravar(db, user.id)

        itens = client.get("/history", headers=headers).json()["history"]
        assert itens, "sem item não há o que conferir"
        carimbo = itens[0]["timestamp"]

        assert not _TEM_FUSO.search(carimbo)
        lido = como_instante_utc(carimbo)
        assert lido is not None
        assert abs(lido - datetime.now(timezone.utc)) < timedelta(minutes=5)

    def test_comparador_manda_as_duas_datas_no_mesmo_formato(self, client, db, dono):
        headers, user = dono
        a = self._gravar(db, user.id, "https://comparar.com.br")
        b = self._gravar(db, user.id, "https://comparar.com.br")

        r = client.get(f"/api/scans/comparar?antes={a.id}&agora={b.id}", headers=headers)
        assert r.status_code == 200, r.text
        d = r.json()

        for lado in ("antes", "agora"):
            carimbo = d[lado]["data"]
            assert isinstance(carimbo, str)
            assert not _TEM_FUSO.search(carimbo)
            lido = como_instante_utc(carimbo)
            assert lido is not None
            assert abs(lido - datetime.now(timezone.utc)) < timedelta(minutes=5)


class TestOHelperDoFrontendDeVerdade:
    """Aqui roda `static/src/lib/datas.ts`, não uma cópia dele em Python.

    É a diferença entre proteger a correção e descrevê-la. Desfeito o `+ 'Z'`
    no arquivo do frontend, tudo acima deste ponto continua verde — o espelho
    em Python não sabe que o original mudou. Estas asserções ficam vermelhas.

    O processo do Node roda em `America/Sao_Paulo` de propósito: em UTC as duas
    leituras coincidem e o teste viraria decoração.
    """

    def test_string_sem_fuso_e_lida_como_utc(self):
        """O centro da correção, no arquivo que vai para o ar.

        Sem o 'Z', o navegador brasileiro leria este instante como 05:40Z — três
        horas adiante, e no dia seguinte quando o exame acontece de madrugada.
        """
        (r,) = _rodar_datas_ts([NAIVE_UTC])
        assert r["instante"] == "2026-08-13T02:40:00.000Z", (
            "datas.ts deixou de ler a data do backend como UTC — o laudo volta a "
            "carimbar o dia errado"
        )

    def test_string_com_fuso_e_respeitada(self):
        """A outra ponta: acrescentar 'Z' sempre estragaria o dia em que a API
        passar a mandar o offset. O 'Z' só entra quando falta fuso."""
        entradas = ["2026-08-13T02:40:00Z", "2026-08-12T23:40:00-03:00", "2026-08-13T02:40:00+00:00"]
        for r in _rodar_datas_ts(entradas):
            assert r["instante"] == "2026-08-13T02:40:00.000Z"

    def test_lixo_vira_ausencia_declarada_e_nao_invalid_date(self):
        """`new Date('lixo').toLocaleString()` devolve a string "Invalid Date",
        que ia para a tela como se fosse conteúdo."""
        for r in _rodar_datas_ts(["", "lixo", "2026-13-45T99:99:99", None]):
            assert r["instante"] is None
            assert r["legivel"] is None

    def test_o_espelho_em_python_nao_divergiu_do_original(self):
        """O espelho `como_instante_utc` sustenta as asserções do resto do
        arquivo. Se ele e o `datas.ts` discordarem, os testes acima passam a
        medir uma implementação que o produto não tem — e ninguém percebe,
        porque nada quebra. Este teste é o que faz a divergência doer.
        """
        entradas = [
            NAIVE_UTC,
            "2026-08-13T02:40:00Z",
            "2026-08-12T23:40:00-03:00",
            "2026-08-13T02:40:00.123456",  # `utcnow().isoformat()` escreve microssegundos
            "lixo",
            "",
        ]
        for iso, real in zip(entradas, _rodar_datas_ts(entradas)):
            espelho = como_instante_utc(iso)
            do_node = (
                None if real["instante"] is None
                else datetime.fromisoformat(real["instante"].replace("Z", "+00:00"))
            )
            assert (espelho is None) == (do_node is None), (
                f"espelho e datas.ts discordam sobre {iso!r}: "
                f"Python={espelho!r}, JavaScript={do_node!r}"
            )
            if espelho is not None:
                # Comparação em milissegundos, que é a resolução do `Date` do
                # JavaScript: `utcnow().isoformat()` escreve microssegundos e o
                # navegador trunca os três últimos dígitos. Exigir igualdade
                # exata reprovaria toda data real por 123 microssegundos, sem
                # que nada estivesse errado. O que importa aqui — o fuso e o
                # dia — cabe folgado nesta resolução.
                assert espelho.timestamp() == pytest.approx(do_node.timestamp(), abs=0.001), (
                    f"instantes diferentes para {iso!r}: "
                    f"Python={espelho.isoformat()}, JavaScript={do_node.isoformat()}"
                )

    def test_a_unica_divergencia_conhecida_e_a_data_sem_hora(self):
        """Registrada em teste, não em comentário — divergência que ninguém
        mede é divergência que cresce.

        Para `"2026-08-13"` o espelho devolve `None` e o `datas.ts` devolve a
        meia-noite UTC. O motivo está nos dois lados: o `datas.ts` não
        acrescenta o 'Z' quando não há hora (a especificação já manda ler data
        pura como UTC, e `"2026-08-13Z"` derruba motor estrito), enquanto o
        espelho acrescenta sempre e o `datetime.fromisoformat` recusa o
        resultado.

        Nenhuma rota emite data sem hora — `isoformat()` de um `datetime`
        sempre traz o horário —, então a diferença não alcança tela nenhuma; é
        por isso que ela pode ficar de fora do teste de deriva acima. Fica
        presa aqui para que, se um dia alcançar, ou se alguém "consertar" um
        dos lados por conta própria, o teste conte o que mudou.
        """
        (real,) = _rodar_datas_ts(["2026-08-13"])

        assert como_instante_utc("2026-08-13") is None
        assert real["instante"] == "2026-08-13T00:00:00.000Z"
