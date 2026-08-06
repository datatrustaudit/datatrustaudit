"""Regressão do worker de auditoria.

`scan.findings = [{...}, ...]` atribuía dicts a um relationship do SQLAlchemy e
levantava AttributeError ("'dict' object has no attribute '_sa_instance_state'").
O except marcava o scan como "failed", sobrescrevendo o "completed" que já tinha
sido atribuído. Com a lista vazia passava — ou seja, a auditoria só quebrava
quando encontrava alguma duplicata ou violação de privacidade.
"""
from db.models import Scan, Finding
from worker.tasks import _collect_findings, _severity


class _Duplicata:
    def to_dict(self):
        return {"tag": "GA4", "severity": "high", "recommendation": "Consolidar as 3 instâncias"}


class _DuplicataSemCampos:
    def to_dict(self):
        return {"tag": "Meta Pixel", "severity": None, "recommendation": None}


class _Violacao:
    def to_dict(self):
        return {"violation": "PII no dataLayer", "severity": "critical"}


class _Privacidade:
    violations = [_Violacao()]


class _ResultadoComProblemas:
    duplicates = [_Duplicata(), _DuplicataSemCampos()]
    privacy = _Privacidade()


class _ResultadoLimpo:
    duplicates = []
    privacy = None


def test_auditoria_com_problemas_persiste(db):
    scan = Scan(url="https://com-problemas.test", status="processing")
    db.add(scan)
    db.commit()

    scan.findings = _collect_findings(_ResultadoComProblemas())
    scan.status = "completed"
    db.commit()

    assert scan.status == "completed"
    assert len(scan.findings) == 3
    assert all(isinstance(f, Finding) for f in scan.findings)


def test_auditoria_limpa_persiste(db):
    scan = Scan(url="https://limpo.test", status="processing")
    db.add(scan)
    db.commit()
    scan.findings = _collect_findings(_ResultadoLimpo())
    scan.status = "completed"
    db.commit()
    assert scan.findings == []


def test_resultado_sem_os_atributos_nao_explode():
    class Vazio:
        pass
    assert _collect_findings(Vazio()) == []


def test_severidade_e_normalizada():
    # severity é NOT NULL no model; valor inválido tem que virar o padrão
    assert _severity("HIGH", "medium") == "high"
    assert _severity(None, "medium") == "medium"
    assert _severity("inventada", "medium") == "medium"
    assert _severity(42, "high") == "high"


def test_campos_obrigatorios_nunca_ficam_nulos(db):
    findings = _collect_findings(_ResultadoComProblemas())
    assert all(f.severity and f.title for f in findings)
