"""Compara duas varreduras do mesmo site.

É o que transforma um relatório que se lê uma vez em algo que se acompanha:
depois de corrigir, o cliente precisa de uma resposta direta para "melhorou?",
e hoje ele roda de novo e compara na mão.

O comparador que existia no frontend derivava tudo da diferença de contagem:

    newViolations: violationsDiff > 0 ? ['Nova violação detectada'] : []

Isso erra no caso que mais importa. Se três achados foram corrigidos e três
novos apareceram, o delta é zero e a tela dizia "sem mudança" — quando na
verdade o trabalho foi feito e uma regressão entrou junto. Comparar de verdade
exige olhar item a item.

O trabalho todo é a chave de identidade: decidir quando duas violações de
varreduras diferentes são "a mesma".
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple


def _normaliza(texto: Any) -> str:
    """Minúsculas, sem acento e sem pontuação, para comparação estável."""
    if not texto:
        return ""
    s = unicodedata.normalize("NFKD", str(texto))
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"[^\w\s]", " ", s.lower())
    return re.sub(r"\s+", " ", s).strip()


def chave_da_violacao(violacao: Dict[str, Any]) -> str:
    """Identidade estável de um achado, entre varreduras.

    Usa o dispositivo legal e a tag envolvida, não o texto da violação: a frase
    embute contagens e nomes que mudam entre visitas ("3 ferramentas ativas:
    GA4, Meta, Clarity"). Comparar por ela faria toda violação parecer nova
    sempre que uma tag entrasse ou saísse do site — e o cliente veria "você não
    corrigiu nada" depois de ter corrigido.
    """
    artigo = _normaliza(violacao.get("article"))
    tag = _normaliza(violacao.get("tag"))
    # `description` é o rótulo curto e fixo do tipo de achado; `violation` é a
    # frase longa e variável. Só a primeira serve de identidade.
    tipo = _normaliza(violacao.get("description"))
    return "|".join(p for p in (artigo, tipo, tag) if p) or _normaliza(violacao.get("violation"))[:80]


def _violacoes_de(raw: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Lê as violações de um `raw_data`, nos dois formatos que convivem aqui.

    `raw_data` vem de `jsonable_encoder` e é snake_case; a resposta da API é
    camelCase. Ler só um dos dois devolve lista vazia em silêncio — e lista
    vazia num comparador vira "corrigiu tudo".
    """
    if not isinstance(raw, dict):
        return []
    privacy = raw.get("privacy") or {}
    if not isinstance(privacy, dict):
        return []
    violacoes = privacy.get("violations")
    if not isinstance(violacoes, list):
        return []
    return [v for v in violacoes if isinstance(v, dict)]


def _score_de(raw: Optional[Dict[str, Any]], reserva: Optional[float]) -> Optional[float]:
    if isinstance(raw, dict):
        scores = raw.get("scores")
        if isinstance(scores, dict):
            for chave in ("overall", "auditScore", "audit_score"):
                if isinstance(scores.get(chave), (int, float)):
                    return float(scores[chave])
        if isinstance(raw.get("score"), (int, float)):
            return float(raw["score"])
    return float(reserva) if isinstance(reserva, (int, float)) else None


def _tags_de(raw: Optional[Dict[str, Any]]) -> List[str]:
    if not isinstance(raw, dict):
        return []
    tags = raw.get("tags") or []
    if not isinstance(tags, list):
        return []
    nomes = []
    for t in tags:
        if isinstance(t, dict):
            nome = t.get("name") or t.get("vendor")
            if nome:
                nomes.append(str(nome))
    return nomes


def comparar(
    anterior: Optional[Dict[str, Any]],
    atual: Optional[Dict[str, Any]],
    *,
    score_anterior: Optional[float] = None,
    score_atual: Optional[float] = None,
) -> Dict[str, Any]:
    """Diferença entre duas varreduras, item a item.

    Devolve três listas — corrigidas, persistentes e novas — mais o movimento
    do score e das tags. A soma de persistentes com novas é o total atual.
    """
    de = _violacoes_de(anterior)
    para = _violacoes_de(atual)

    # Índice por chave. Achados repetidos na mesma varredura (a mesma regra
    # violada por tags diferentes) já têm chave distinta pela tag.
    indice_de = {chave_da_violacao(v): v for v in de}
    indice_para = {chave_da_violacao(v): v for v in para}

    chaves_de = set(indice_de)
    chaves_para = set(indice_para)

    corrigidas = [indice_de[k] for k in chaves_de - chaves_para]
    persistentes = [indice_para[k] for k in chaves_de & chaves_para]
    novas = [indice_para[k] for k in chaves_para - chaves_de]

    ordem = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    def por_gravidade(lista):
        return sorted(lista, key=lambda v: ordem.get(v.get("severity"), 4))

    s_de = _score_de(anterior, score_anterior)
    s_para = _score_de(atual, score_atual)
    variacao = (s_para - s_de) if (s_de is not None and s_para is not None) else None

    tags_de = set(_tags_de(anterior))
    tags_para = set(_tags_de(atual))

    """Veredito.

    O score sozinho não serve de juízo: ele mistura seis eixos, e uma tag nova
    bem instalada pode subi-lo no mesmo dia em que uma regressão de
    consentimento entra. Quem manda é o que aconteceu com os achados — e
    regressão pesa mais que correção, porque é o que o cliente precisa saber
    antes de publicar.
    """
    if novas and corrigidas:
        veredito = "misto"
    elif novas:
        veredito = "regrediu"
    elif corrigidas:
        veredito = "melhorou"
    else:
        veredito = "sem_mudanca"

    return {
        "veredito": veredito,
        "corrigidas": por_gravidade(corrigidas),
        "persistentes": por_gravidade(persistentes),
        "novas": por_gravidade(novas),
        "totais": {
            "antes": len(de),
            "agora": len(para),
            "corrigidas": len(corrigidas),
            "persistentes": len(persistentes),
            "novas": len(novas),
        },
        "score": {
            "antes": s_de,
            "agora": s_para,
            "variacao": round(variacao, 1) if variacao is not None else None,
        },
        "tags": {
            "adicionadas": sorted(tags_para - tags_de),
            "removidas": sorted(tags_de - tags_para),
            "antes": len(tags_de),
            "agora": len(tags_para),
        },
    }


def resumo_em_texto(diff: Dict[str, Any]) -> str:
    """Uma frase para o topo da tela e para o assunto do e-mail de alerta."""
    t = diff["totais"]
    if diff["veredito"] == "sem_mudanca":
        return (
            f"Nada mudou: as mesmas {t['persistentes']} não conformidades continuam."
            if t["persistentes"]
            else "Nada mudou — nenhuma não conformidade nas duas varreduras."
        )
    partes = []
    if t["corrigidas"]:
        partes.append(f"{t['corrigidas']} corrigida(s)")
    if t["novas"]:
        partes.append(f"{t['novas']} nova(s)")
    if t["persistentes"]:
        partes.append(f"{t['persistentes']} ainda aberta(s)")
    return ", ".join(partes) + "."
