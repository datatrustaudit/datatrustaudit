import copy
import os
import traceback
from dataclasses import MISSING, fields as dc_fields
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User, Scan, utcnow
from api.auth import get_current_user, get_current_active_user
from audit_engine.url_guard import validate_public_url, UnsafeURLError
from audit_engine.models import (
    AuditResult,
    AuditScores,
    ConsentAuditResult,
    ConsentFinding,
    DataLayerFinding,
    DataQualityNote,
    DuplicateFinding,
    EventAuditResult,
    EventFinding,
    EventParameter,
    GTMQualityFinding,
    GTMQualityResult,
    PrivacyAnalysisResult,
    PrivacyViolation,
    Recommendation,
    TagFinding,
)
from audit_engine.storage_auditor import (
    AchadoDeArmazenamento,
    EventoDeRede,
    ResultadoDeArmazenamento,
)
from worker.tasks import run_website_audit
from audit_engine.credit_rules import WEEKLY_SCAN_LIMITS, get_weekly_limit, can_perform_scan

router = APIRouter(prefix="/api/scans", tags=["Scans"])

# Weekly scan limits (configurable via env)
FREE_MAX_SCANS = int(os.getenv("FREE_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["free"])))
PRO_MAX_SCANS = int(os.getenv("PRO_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["pro"])))
PREMIUM_MAX_SCANS = int(os.getenv("PREMIUM_MAX_SCANS", str(WEEKLY_SCAN_LIMITS["premium"])))

PLAN_LIMITS = {
    "free": FREE_MAX_SCANS,
    "pro": PRO_MAX_SCANS,
    "premium": PREMIUM_MAX_SCANS,
}


class ScanRequest(BaseModel):
    url: str


def inicio_da_semana():
    """Segunda-feira 00:00 UTC da semana corrente."""
    agora = utcnow()
    return (agora - timedelta(days=agora.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def contar_scans_da_semana(db: Session, user_id: int) -> int:
    return (
        db.query(Scan)
        .filter(Scan.user_id == user_id, Scan.created_at >= inicio_da_semana())
        .count()
    )


@router.post("/")
def create_scan(
    payload: ScanRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Queues a new website audit task asynchronously.

    Exige autenticação. Antes aceitava requisição anônima e, nesse caminho,
    a contagem semanal ficava fixa em 0 — bastava omitir o header Authorization
    para ter scans ilimitados no lugar do limite do plano.
    O scan grátis sem cadastro continua existindo, por /analyze e /api/audit.
    """
    plan = current_user.plan
    is_admin = bool(getattr(current_user, "is_admin", False))

    scans_this_week = contar_scans_da_semana(db, current_user.id)

    if not can_perform_scan(plan, scans_this_week, is_admin):
        limite = get_weekly_limit(plan, is_admin)
        raise HTTPException(
            status_code=403,
            detail=f"Limite semanal atingido ({scans_this_week}/{limite} auditorias para o plano {plan}). Faça upgrade para continuar.",
        )

    try:
        safe_url = validate_public_url(payload.url)
    except UnsafeURLError as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_scan = Scan(user_id=current_user.id, url=safe_url, status="pending")
    db.add(new_scan)
    db.commit()
    db.refresh(new_scan)

    # Queue task natively via FastAPI
    background_tasks.add_task(run_website_audit, new_scan.id)

    return {
        "scan_id": new_scan.id,
        "status": new_scan.status,
        "scans_this_week": scans_this_week + 1,
        "weekly_limit": get_weekly_limit(plan, is_admin),
    }


# ATENÇÃO: esta rota precisa vir ANTES de `/{scan_id}`.
# O path param casa com qualquer segmento, inclusive a palavra "comparar", e o
# FastAPI entrega para a primeira rota registrada que casa — a mesma armadilha
# do catch-all do SPA em main.py, que já engoliu /health e /history.
@router.get("/comparar")
def comparar_scans(
    antes: int,
    agora: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Diferença entre duas varreduras: o que foi corrigido, o que continua.

    Responde à pergunta que o cliente faz depois de mexer no site — e que hoje
    ele responde comparando dois relatórios na mão.
    """
    from audit_engine.comparador import comparar, resumo_em_texto

    if antes == agora:
        raise HTTPException(status_code=400, detail="Escolha duas varreduras diferentes.")

    scans = (
        db.query(Scan)
        .filter(Scan.id.in_([antes, agora]), Scan.user_id == current_user.id)
        .all()
    )
    por_id = {s.id: s for s in scans}

    # 404 em vez de 403, e sem dizer qual dos dois faltou: 403 (ou uma mensagem
    # específica) confirmaria a existência de um scan de outro usuário.
    if antes not in por_id or agora not in por_id:
        raise HTTPException(status_code=404, detail="Varredura não encontrada.")

    a, b = por_id[antes], por_id[agora]

    if a.url != b.url:
        raise HTTPException(
            status_code=400,
            detail="As duas varreduras precisam ser do mesmo endereço para a comparação fazer sentido.",
        )

    incompletos = [s.id for s in (a, b) if s.status != "completed"]
    if incompletos:
        raise HTTPException(
            status_code=409,
            detail="Só é possível comparar varreduras concluídas.",
        )

    # Compara sobre o dado íntegro. O corte por plano vale para exibir detalhe,
    # não para decidir o que mudou: comparar listas já truncadas inventaria
    # correções que não aconteceram.
    diff = comparar(a.raw_data, b.raw_data, score_anterior=a.score, score_atual=b.score)

    return {
        "url": a.url,
        "antes": {
            "id": a.id,
            "data": a.created_at.isoformat() if a.created_at else None,
            "score": a.score,
        },
        "agora": {
            "id": b.id,
            "data": b.created_at.isoformat() if b.created_at else None,
            "score": b.score,
        },
        "resumo": resumo_em_texto(diff),
        **diff,
    }


@router.get("/{scan_id}")
def get_scan(
    scan_id: int,
    current_user: Optional[User] = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Polls the status of a specific scan. If complete, returns the data with appropriate plan stripping."""
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    # Todo scan tem dono e só o dono lê. Antes, scan com user_id NULL pulava a
    # checagem inteira: como o id é sequencial, dava para varrer
    # /api/scans/1,2,3… e ler a URL auditada e o relatório de qualquer visitante.
    if scan.user_id is None or not current_user or scan.user_id != current_user.id:
        # 404 em vez de 403: 403 confirmaria que o id existe.
        raise HTTPException(status_code=404, detail="Scan not found")

    plan = current_user.plan

    return {
        "id": scan.id,
        "url": scan.url,
        "status": scan.status,
        "created_at": scan.created_at.isoformat() if scan.created_at else None,
        "completed_at": scan.completed_at.isoformat() if scan.completed_at else None,
        "score": scan.score,
        "result": _resultado_para_a_tela(scan, plan),
        "plan_applied": plan,
    }


def _plan_filtered_result(raw_data, status: str, plan: str):
    """Aplica o gating de plano sobre uma CÓPIA do resultado.

    Antes mutava `scan.raw_data` direto — o mesmo objeto que a sessão do
    SQLAlchemy tem em memória. Um flush posterior na mesma sessão gravaria o
    relatório já truncado por cima do original no banco, destruindo os dados
    pagos de forma irreversível.

    Continua sendo o caminho de quem NÃO é laudo do motor: varredura ainda em
    andamento e o formato próprio do modo trajeto. O laudo do motor passa por
    `_laudo_no_formato_da_api`, que devolve a mesma forma de `/api/audit`.
    """
    if not raw_data or not isinstance(raw_data, dict):
        return raw_data
    if status != "completed":
        return raw_data

    if plan == "premium":
        # Sem corte, mas a resposta precisa declarar o nível de detalhe: a tela
        # lê `showsDetail` para decidir se mostra o laudo ou só o veredito, e
        # o campo ausente era lido como "não mostrar".
        res = copy.deepcopy(raw_data)
        res["showsDetail"] = True
        return res

    res = copy.deepcopy(raw_data)

    # 1. Truncate tags based on plan visibility
    # O percentual vem de audit_engine.guia_de_correcao — estava repetido aqui,
    # em api/audit.py e em main.py, e divergir significa entregar conteúdo pago
    # a quem não pagou (ou cortar de quem pagou).
    from audit_engine.guia_de_correcao import quantidade_visivel

    tags = res.get("tags")
    if isinstance(tags, list) and tags:
        res["tags"] = tags[:quantidade_visivel(len(tags), plan)]
        res["locked_tags"] = True

    # 2. Hide exact code lines for free and pro
    for tag in res.get("tags") or []:
        if isinstance(tag, dict):
            tag.pop("lineNumber", None)
            tag.pop("context", None)
            if plan == "free":
                tag.pop("matchedPattern", None)
                tag.pop("dataCollected", None)

    # 3. Corta o DETALHE das violações para o free — nunca a contagem.
    #
    # Zerar a lista, como era feito aqui, produzia duas respostas para o mesmo
    # scan: o laudo recém-gerado mostrava metade dos achados (é o que
    # `_normalize_audit_response` faz, via `quantidade_visivel`), e o mesmo
    # laudo reaberto pelo histórico mostrava nenhum. O usuário via o número
    # cair sozinho ao dar F5.
    #
    # A contagem tem de sobreviver ao corte: mostrar 2 de 22 e dizer que são 22
    # é o que motiva o upgrade; mostrar 0 e dizer que são 22 parece defeito.
    privacy = res.get("privacy")
    if plan == "free" and isinstance(privacy, dict):
        violacoes = privacy.get("violations")
        if isinstance(violacoes, list) and violacoes:
            privacy["violations"] = violacoes[:quantidade_visivel(len(violacoes), plan)]
            privacy["locked_violations"] = True
        # snake_case: é a chave que jsonable_encoder realmente grava em raw_data.
        # Escrever só "estimatedRiskExposure" deixava o valor real intacto na
        # resposta — o dado pago vazava para o plano free.
        privacy["estimated_risk_exposure"] = "Desbloqueie no plano Pro"
        privacy["estimatedRiskExposure"] = "Desbloqueie no plano Pro"
        privacy["_lockedForPlan"] = "pro"

    # 4. Strip duplicate implementations for free
    duplicates = res.get("duplicates")
    if plan == "free" and isinstance(duplicates, list) and len(duplicates) > 1:
        res["duplicates"] = duplicates[:1]
        res["locked_duplicates"] = True

    # 5. Hide viewSourceInfo
    res.pop("viewSourceInfo", None)

    # 6. O mesmo corte que a geração aplica.
    #
    # `raw_data` guarda o laudo ÍNTEGRO — é o certo, senão o cliente que
    # pagasse depois nunca recuperaria o que já foi varrido. Mas isso torna
    # esta função a única barreira na reabertura, e ela cortava menos do que
    # `_normalize_audit_response`: quem abrisse o laudo pelo histórico ou por
    # `?scan=` recebia storage, debugging, eventos e recomendações que a
    # varredura recém-feita tinha escondido. Bastava dar F5 para o conteúdo
    # pago aparecer.
    from audit_engine.guia_de_correcao import plano_ve_detalhe

    if not plano_ve_detalhe(plan):
        res["showsDetail"] = False
        res["violations"] = []
        res["events"] = []
        res["recommendations"] = []
        res["storage"] = None
        res["debugging"] = {}
        res["dataQualityNotes"] = []
        res["tags"] = []
        res["locked_tags"] = True

        privacy = res.get("privacy")
        if isinstance(privacy, dict):
            privacy["violations"] = []
            privacy["tagsBeforeConsent"] = []

        for chave, campos in (("ga4", ("measurementIds", "events")),
                              ("gtm", ("containerIds", "issues"))):
            bloco = res.get(chave)
            if isinstance(bloco, dict):
                for campo in campos:
                    bloco[campo] = []
    else:
        res["showsDetail"] = True

    return res


# ─────────────────────────────────────────────────────────────────────────────
# Reabrir um laudo: a MESMA forma que `POST /api/audit` devolve
# ─────────────────────────────────────────────────────────────────────────────
#
# `scan.raw_data` é o que o `jsonable_encoder` fez do `AuditResult`: as chaves
# são os nomes dos campos das dataclasses, em snake_case e em português onde o
# motor escreve em português. A resposta de `/api/audit` é outra coisa — ela
# passa pelo `to_dict()` de cada dataclass, que renomeia para camelCase e
# traduz (`cookies_sem_consentimento` vira `cookiesWithoutConsent`).
#
# Enquanto esta rota devolvia `raw_data` cru, a tela lia uma chave que não
# existe e recebia lista vazia — sem erro nenhum, que é o padrão de falha mais
# caro deste projeto. O `CookiesInspector` então estampava o escudo verde
# "Nenhum cookie foi gravado antes de qualquer aceite" sobre uma varredura que
# gravou oito, e a aba de ordem de carregamento anunciava "esta varredura não
# trouxe a medição de rede" negando sessenta requisições interceptadas. O mesmo
# scan dizia duas coisas conforme tivesse ou não passado por um F5, e a versão
# reaberta era justamente a que afirmava conformidade.
#
# A correção é na causa: remontar o `AuditResult` a partir do que foi gravado e
# passar pela MESMA `_normalize_audit_response` da varredura ao vivo. Ensinar a
# tela a ler as duas grafias resolveria estes dois componentes e deixaria a
# armadilha montada para o próximo.


def _camel(nome: str) -> str:
    """`cookies_sem_consentimento` → `cookiesSemConsentimento`."""
    primeira, *resto = nome.split("_")
    return primeira + "".join(parte.title() for parte in resto)


#: Campos cujo `to_dict()` publica uma chave que NÃO é o camelCase do nome do
#: campo. Sem estes apelidos, ler um laudo gravado no formato da resposta
#: perderia o valor em silêncio — e silêncio aqui vira laudo errado, não erro.
_APELIDOS: Dict[type, Dict[str, Tuple[str, ...]]] = {
    PrivacyAnalysisResult: {"law_full": ("framework",)},
    # `privacyRisk` é o nome novo; `lgpdRisk` é o apelido que o `to_dict()`
    # mantém por compatibilidade e que o normalizador do frontend lê primeiro.
    TagFinding: {"privacy_risk": ("privacyRisk", "lgpdRisk")},
    AuditScores: {
        "overall": ("auditScore",),
        "tracking_quality": ("trackingQualityScore",),
        "event_architecture": ("eventArchitectureScore",),
        "datalayer_quality": ("datalayerQualityScore",),
        "consent_integrity": ("consentIntegrityScore",),
        "privacy_risk": ("privacyRiskScore",),
    },
    ResultadoDeArmazenamento: {
        "cookies_sem_consentimento": ("cookiesWithoutConsent",),
        "storage_sem_consentimento": ("storageWithoutConsent",),
        "linha_do_tempo": ("firingTimeline",),
        "primeiro_disparo_ms": ("firstTrackerFiredMs",),
        "problemas_de_ordem": ("orderIssues",),
        "achados_da_recusa": ("rejectionFindings",),
        "recusa": ("rejectionTest",),
    },
    AchadoDeArmazenamento: {
        "tipo": ("type",),
        "nome": ("name",),
        "dono": ("owner",),
        "finalidade": ("purpose",),
        "severidade": ("severity",),
        "detalhe": ("detail",),
        "duracao_dias": ("durationDays",),
        "http_only": ("httpOnly",),
        "dominio": ("domain",),
    },
    EventoDeRede: {
        "ordem": ("order",),
        "ms_desde_o_inicio": ("msSincePageStart",),
        "dono": ("owner",),
    },
}

#: Quais campos carregam outra dataclass do motor. É o que permite descer a
#: árvore inteira sem repetir aqui o mapa de chaves de cada `to_dict()`.
_ANINHADOS: Dict[type, Dict[str, type]] = {
    AuditResult: {
        "tags": TagFinding,
        "gtm_quality": GTMQualityResult,
        "events": EventAuditResult,
        "datalayer_findings": DataLayerFinding,
        "consent": ConsentAuditResult,
        "privacy": PrivacyAnalysisResult,
        "duplicates": DuplicateFinding,
        "storage": ResultadoDeArmazenamento,
        "scores": AuditScores,
        "recommendations": Recommendation,
        "data_quality_notes": DataQualityNote,
    },
    GTMQualityResult: {"findings": GTMQualityFinding},
    EventAuditResult: {"events": EventFinding},
    EventFinding: {"parameters_found": EventParameter},
    ConsentAuditResult: {"findings": ConsentFinding},
    PrivacyAnalysisResult: {"violations": PrivacyViolation},
    ResultadoDeArmazenamento: {
        "cookies_sem_consentimento": AchadoDeArmazenamento,
        "storage_sem_consentimento": AchadoDeArmazenamento,
        "linha_do_tempo": EventoDeRede,
    },
}

#: Sentinela de "a chave não estava lá". `None` não serve: valor nulo gravado é
#: diferente de campo ausente, e confundir os dois é como se inventa dado.
_SEM_VALOR = object()


def _chaves_de_leitura(cls: type, campo) -> Tuple[str, ...]:
    """As grafias sob as quais este campo pode ter sido gravado."""
    apelidos = _APELIDOS.get(cls, {}).get(campo.name)
    if apelidos:
        return (campo.name,) + tuple(apelidos)
    return (campo.name, _camel(campo.name))


def _foi_gravado(raw: dict, nome: str) -> bool:
    """O laudo gravado traz este campo do `AuditResult`, em qualquer grafia.

    Serve para separar "gravado" de "ausente" DEPOIS da remontagem, onde os dois
    ficam iguais: campo opcional que faltou recebe o default da dataclass, e um
    default pode ser uma afirmação (`scan_method` vale "html_source").
    """
    for campo in dc_fields(AuditResult):
        if campo.name == nome:
            return any(chave in raw for chave in _chaves_de_leitura(AuditResult, campo))
    raise KeyError(f"{nome} não é campo de AuditResult")


def _reconstroi(cls: type, dados: Any):
    """Remonta uma dataclass do motor a partir do dicionário gravado.

    Aceita as duas grafias de cada campo — o nome do campo, que é como o
    `jsonable_encoder` grava, e a chave que o `to_dict()` publica — porque as
    duas existem no banco: os laudos do motor foram gravados na primeira, e o
    modo trajeto guarda laudos já no formato da resposta.

    Campo obrigatório que não foi gravado vira `None`, nunca um valor plausível:
    o laudo precisa poder dizer "não veio". Campo opcional ausente fica com o
    default da própria dataclass — que é o mesmo que a varredura ao vivo usaria.
    """
    if not isinstance(dados, dict):
        return None

    aninhados = _ANINHADOS.get(cls, {})
    valores: Dict[str, Any] = {}

    for campo in dc_fields(cls):
        bruto = _SEM_VALOR
        for chave in _chaves_de_leitura(cls, campo):
            if chave in dados:
                bruto = dados[chave]
                break

        if bruto is _SEM_VALOR:
            if campo.default is MISSING and campo.default_factory is MISSING:
                valores[campo.name] = None
            continue

        tipo = aninhados.get(campo.name)
        e_lista = campo.default_factory is list

        if tipo is None:
            valores[campo.name] = bruto
        elif e_lista and isinstance(bruto, list):
            filhos = [_reconstroi(tipo, item) for item in bruto]
            valores[campo.name] = [f for f in filhos if f is not None]
        elif not e_lista and isinstance(bruto, dict):
            valores[campo.name] = _reconstroi(tipo, bruto)
        # Gravado numa forma que não corresponde ao campo — `None`, número,
        # objeto solto onde deveria haver lista: fica o default da dataclass, e
        # a resposta declara a ausência. Aproveitar o que veio "mais ou menos"
        # é como se produz laudo com evidência que ninguém observou.

    return cls(**valores)


def _bloco_de_eventos(raw: dict) -> Optional[dict]:
    """O bloco de eventos, nas duas formas que existem no banco.

    A resposta da API achata `events` para a lista pura e manda os contadores em
    `summary`; o laudo do motor guarda o `EventAuditResult` inteiro. Sem separar
    os dois casos, um laudo gravado no formato da resposta perderia os eventos
    em silêncio — a lista viraria uma lista de blocos vazios.
    """
    bruto = raw.get("events")
    if isinstance(bruto, list):
        return {"events": bruto}
    if isinstance(bruto, dict):
        return bruto
    return None


def _forma_canonica(raw: dict) -> dict:
    """O laudo gravado na forma que `/api/audit` monta antes de normalizar.

    Chaves de primeiro nível em snake_case (é o que `_normalize_audit_response`
    lê) e as internas em camelCase, vindas do `to_dict()` de cada dataclass —
    a fonte única desse mapeamento. Reproduzir o mapa aqui garantiria que os
    dois divergissem no primeiro campo novo.
    """
    from api.audit import _safe_dict

    preparado = dict(raw)  # cópia rasa: `scan.raw_data` não pode ser tocado
    eventos = _bloco_de_eventos(raw)
    if eventos is None:
        preparado.pop("events", None)
    else:
        preparado["events"] = eventos

    canonica = _safe_dict(_reconstroi(AuditResult, preparado)) or {}

    # `_normalize_audit_response` só aceita o bloco de eventos como dicionário
    # com a lista dentro — sem ela estoura em `len(None)` e derruba a rota. O
    # laudo do motor sempre traz o bloco; laudo antigo, gravado antes de ele
    # existir, não traz.
    #
    # Zero aqui não é evidência inventada: a resposta da API não tem como dizer
    # "eventos não medidos" — `totalEvents` é número, e todo caminho do produto
    # (inclusive a tela, quando a chave falta) já publica zero nesse caso.
    if not isinstance(canonica.get("events"), dict):
        canonica["events"] = EventAuditResult().to_dict()

    return canonica


#: Métodos que só existem porque o navegador não deu conta. É por eles que se
#: sabe, depois do fato, que a coleta caiu para o HTML.
_METODOS_DE_QUEDA = frozenset({"static_fallback", "html_fallback"})

#: Métodos em que o dado veio da coleta plena — se o laudo saiu daí, não houve
#: queda.
_METODOS_SEM_QUEDA = frozenset({"browser", "har"})


def _houve_queda_para_o_html(scan_method: Optional[str]) -> Optional[bool]:
    """Se a coleta caiu para o HTML, segundo o método gravado. `None` = não dá para saber."""
    if scan_method in _METODOS_DE_QUEDA:
        return True
    if scan_method in _METODOS_SEM_QUEDA:
        return False
    return None


def _metodo_publicado(scan: Scan, raw: dict) -> Optional[str]:
    """O método de coleta que a resposta vai publicar.

    Mesma precedência de `_normalize_audit_response`: o que o laudo gravou vem
    primeiro, a coluna `scans.scan_method` depois. Tudo o que a resposta afirmar
    sobre a coleta tem de sair DESTE valor — derivar de uma segunda fonte faz o
    documento se contradizer sozinho ("método: navegador" ao lado de "caiu para
    o HTML: sim"), que é o defeito que este arquivo existe para não repetir.
    """
    return raw.get("scan_method") or raw.get("scanMethod") or scan.scan_method


class _ColetaGravada:
    """O que o banco ainda sabe sobre a coleta, para `_normalize_audit_response`.

    Aquela função foi escrita em cima do objeto do navegador, que só existe
    durante a varredura: script inspecionado, requisição interceptada, tentativas
    e horário de início não são persistidos. Este objeto carrega o que o banco
    guarda de verdade e deixa o resto ausente — e é por isso que `debugging`
    sai da resposta depois: publicar "nenhum script, nenhuma requisição" sobre
    uma coleta que teve dezenas é a mesma mentira do escudo verde.
    """

    def __init__(self, scan: Scan, raw: dict):
        self.all_script_urls = []
        self.intercepted_requests = []
        self.error = None
        # `False` aqui não é neutro: `static_fallback_used: false` AFIRMA que o
        # navegador deu conta. O banco não guarda a tentativa, só o método que
        # produziu o dado — quando ele responde, a resposta sai dele; quando
        # não, fica `None`, que é "não se sabe". Um laudo coletado por
        # `static_fallback` chegava a negar a própria queda.
        queda = _houve_queda_para_o_html(_metodo_publicado(scan, raw))
        self.fallback_used = queda
        self.static_fallback_attempted = queda
        self.browser_attempts = None
        self.failure_reason = None
        # Aviso da coleta não é persistido. `[]` diria "a varredura não emitiu
        # aviso nenhum"; ausente diz que ninguém sabe — e é o que sabemos.
        self.warnings = None
        self.final_url = None
        self.started_at = None
        self.scan_status = scan.status
        self.scan_method = scan.scan_method
        # Quando o exame aconteceu — nunca a hora em que alguém reabriu a
        # página. `timestamp` é o carimbo UTC que o orchestrator gravou; o
        # `completed_at` do banco é o segundo melhor.
        self.finished_at = raw.get("timestamp") or (
            scan.completed_at.isoformat() if scan.completed_at else None
        )


#: Chaves que identificam um laudo do motor. O modo trajeto grava outro formato
#: (`tipo: "trajeto"`, com um laudo por passo) que não é um `AuditResult` e
#: continua passando direto, como sempre passou.
_MARCAS_DE_LAUDO = frozenset({
    "tags", "privacy", "consent", "scores", "storage", "duplicates",
    "recommendations", "gtm_quality", "gtmQuality",
    "datalayer_findings", "datalayerFindings",
    "data_quality_notes", "dataQualityNotes",
    "scan_method", "scanMethod",
})


def _e_laudo_do_motor(raw: Any) -> bool:
    if not isinstance(raw, dict) or raw.get("tipo"):
        return False
    return bool(_MARCAS_DE_LAUDO & set(raw))


def _preserva_agregados_gravados(resposta: dict, raw: dict) -> None:
    """Contador gravado vence contador recalculado.

    `_normalize_audit_response` recalcula o `summary` a partir das listas. Isso
    está certo na varredura ao vivo, onde a lista está inteira; num laudo
    gravado a lista pode ter sido guardada já resumida, e aí recalcular DIMINUI
    o número — que é exatamente o defeito de "o número cai sozinho ao dar F5"
    que a reabertura já teve uma vez. Mesma regra de `_agregados_de_evento`:
    prefere o que o motor calculou, só recalcula quando não veio.

    O laudo do motor não grava `summary`, então isto só alcança os laudos
    gravados no formato da resposta.
    """
    gravado = raw.get("summary")
    resumo = resposta.get("summary")
    if not isinstance(gravado, dict) or not isinstance(resumo, dict):
        return
    for chave, valor in gravado.items():
        if valor is not None:
            resumo[chave] = valor


#: Texto que o plano gratuito lê no lugar da exposição de risco estimada.
_RISCO_BLOQUEADO = "Desbloqueie no plano Pro"


def _corte_da_reabertura(resposta: dict, plan: str) -> None:
    """O corte que só a reabertura fazia, e que continua valendo.

    `raw_data` guarda o laudo ÍNTEGRO de propósito — quem paga depois recupera
    o que já foi varrido —, e isso faz do corte a única barreira nesta rota. O
    grosso dele agora vem de `_normalize_audit_response`, a mesma função da
    varredura ao vivo: o mesmo scan passa a dar a mesma resposta com ou sem F5.

    Sobram dois itens, e aqui a reabertura corta MAIS do que a varredura ao vivo:
    `_normalize_audit_response` entrega ao gratuito a exposição de risco e a
    lista inteira de duplicatas, e a reabertura sempre escondeu as duas. Quem
    acabou de rodar a varredura já viu os dois valores, então isto não protege
    aquela sessão — protege o laudo antigo de quem varreu pagando e hoje está no
    gratuito. É a única diferença que resta entre o laudo recém-feito e o mesmo
    laudo reaberto, e é decisão de plano, não de evidência: conformidade,
    contagem e achado saem idênticos nos dois caminhos.
    """
    if plan != "free":
        return

    # Detalhe pago. A contagem (`summary.duplicatesDetected`) é calculada antes
    # do corte e continua de pé — é ela que motiva o upgrade.
    duplicatas = resposta.get("duplicates")
    if isinstance(duplicatas, list) and len(duplicatas) > 1:
        resposta["duplicates"] = duplicatas[:1]
        resposta["locked_duplicates"] = True

    # A exposição de risco estimada é o número que o plano pago vende.
    privacidade = resposta.get("privacy")
    if isinstance(privacidade, dict):
        privacidade["estimatedRiskExposure"] = _RISCO_BLOQUEADO
        privacidade["_lockedForPlan"] = "pro"
    resumo = resposta.get("summary")
    if isinstance(resumo, dict) and resumo.get("estimatedFine") is not None:
        resumo["estimatedFine"] = _RISCO_BLOQUEADO


def _publica_o_score_medido(resposta: dict, canonica: dict, scan: Scan) -> None:
    """O score que abre o laudo é o medido — nunca um plausível.

    `_normalize_audit_response` lê o eixo geral com `or` e, quando não acha
    nada, carimba "70 se achou tag, 50 se não". Na reabertura isso mente de
    duas formas:

    - eixo geral igual a **0** é falsy e cai no mesmo buraco do ausente: um site
      medido em 0 saía publicado como 70 — "conforme" por engano, que é o erro
      que o cliente leva ao DPO sem conferir;
    - laudo gravado sem `scores` (o motor devolve `scores=None` quando o cálculo
      estoura) ganhava 70 enquanto a coluna `scans.score`, na MESMA resposta
      HTTP, mostrava outro número.

    Aqui não há o que adivinhar: o eixo geral do laudo gravado é a medida, e a
    coluna `scans.score` — que saiu dele na hora de gravar — é o segundo melhor.
    Sem nenhum dos dois, fica o que a normalização decidiu; corrigir o palpite
    é assunto de `_normalize_audit_response`, e vale para a varredura ao vivo
    também.
    """
    medido = (canonica.get("scores") or {}).get("auditScore")
    if medido is None:
        medido = scan.score
    if isinstance(medido, bool) or not isinstance(medido, (int, float)):
        return
    if medido != medido:      # NaN não é medida
        return
    resposta["score"] = int(max(0, min(100, medido)))


def _laudo_no_formato_da_api(scan: Scan, raw: dict, plan: str) -> dict:
    """O laudo gravado, na forma exata que `POST /api/audit` devolve."""
    from api.audit import _normalize_audit_response

    canonica = _forma_canonica(raw)

    # `scan_method` tem default na dataclass: laudo gravado sem a chave voltava
    # declarando "html_source" — ter lido só o código-fonte — ao lado de cookies
    # e de uma linha do tempo de rede, que só o navegador enxerga. É a mesma
    # contradição que já derrubou o laudo pago quando o método virava
    # "view_source" (ver o orchestrator): numa peça de evidência ela põe em
    # dúvida tudo o que vem depois. O método descreve a COLETA, e o que o banco
    # registrou dela é evidência; o default da dataclass não é.
    if not _foi_gravado(raw, "scan_method"):
        canonica["scan_method"] = None      # cai para a coluna `scans.scan_method`

    resposta = _normalize_audit_response(
        scan.url, plan, _ColetaGravada(scan, raw), canonica
    )
    _publica_o_score_medido(resposta, canonica, scan)

    # A seção de depuração é montada a partir do objeto do navegador, que não é
    # persistido. Mantê-la significaria publicar `scriptsInspected: []` e
    # `networkHints: []` num laudo cuja coleta viu dezenas de cada — negativa
    # inventada, do mesmo tipo que este arquivo existe para corrigir. Campo
    # ausente é dito, não preenchido. O que de fato foi gravado continua na
    # resposta, em `datalayerFindings`.
    #
    # O plano gratuito recebe `{}` de `_normalize_audit_response` e assim fica:
    # ali a ausência é do plano, não da coleta.
    if resposta.get("debugging"):
        resposta["debugging"] = None

    _preserva_agregados_gravados(resposta, raw)
    _corte_da_reabertura(resposta, plan)

    # `/api/audit` devolve o id junto do laudo; a exportação de PDF/XLSX monta a
    # URL com ele.
    resposta["scan_id"] = scan.id
    return resposta


def _resultado_para_a_tela(scan: Scan, plan: str):
    """O que vai no `result` da reabertura."""
    raw = scan.raw_data
    if scan.status != "completed" or not _e_laudo_do_motor(raw):
        return _plan_filtered_result(raw, scan.status, plan)

    try:
        return _laudo_no_formato_da_api(scan, raw, plan)
    except Exception as exc:
        # Nada falha em silêncio. Cair de volta para o `raw_data` cru devolveria
        # justamente a forma que a tela lê errado — e ela não avisa: chave
        # inexistente vira lista vazia e o laudo passa a AFIRMAR conformidade.
        # Erro visível é melhor do que laudo bonito e falso.
        traceback.print_exc()
        print(f"[scans] falha ao remontar o laudo do scan {scan.id}: {exc}")
        raise HTTPException(
            status_code=500,
            detail="Não foi possível remontar este laudo no formato do relatório.",
        )
