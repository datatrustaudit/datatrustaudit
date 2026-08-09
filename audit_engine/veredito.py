"""A frase única que o plano gratuito entrega.

O free não mostra achado a achado — mostra o veredito. Se há problema, diz
qual é o mais grave e qual dispositivo ele contraria; se não há, diz isso com
todas as letras. O detalhe (qual tag, em que linha, como corrigir) é o que se
compra.

Esse corte é mais honesto que o anterior, que mostrava metade da lista: meia
lista dá a impressão de laudo completo e some com achados sem avisar. Uma
frase é claramente uma frase.

**A frase é montada, não gerada por modelo.** Num laudo, texto inventado a
cada execução pode citar o artigo errado ou afirmar o que a varredura não
observou — e o produto inteiro se sustenta em não errar para mais. Aqui a
frase sai dos mesmos achados que o laudo pago detalha: se divergir, é bug, não
criatividade.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

#: Ordem em que os problemas são anunciados. O primeiro que casar vira a
#: manchete — quem lê uma frase só precisa receber a pior notícia, não a
#: primeira que apareceu na lista.
_PRIORIDADE = (
    "pii",
    "sem_consentimento",
    "cmp_sem_bloqueio",
    "cmp_ausente",
    "outro",
)


def _classificar(
    violacoes: List[Dict[str, Any]],
    tem_cmp: bool,
    tags_antes: int,
    pii: int,
) -> str:
    if pii > 0:
        return "pii"
    if not tem_cmp and (tags_antes > 0 or violacoes):
        return "cmp_ausente"
    if tem_cmp and tags_antes > 0:
        return "cmp_sem_bloqueio"
    if tags_antes > 0:
        return "sem_consentimento"
    return "outro"


def gerar_veredito(
    *,
    total_de_achados: int,
    por_gravidade: Optional[Dict[str, int]] = None,
    tem_cmp: bool = False,
    tags_antes_do_consentimento: int = 0,
    cookies_sem_consentimento: int = 0,
    pii_exposta: int = 0,
    total_de_tags: int = 0,
    violacoes: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Devolve o veredito do site em uma frase, com o tom certo.

    `conforme` distingue "não achamos nada" de "achamos" — a tela usa isso para
    decidir entre celebrar e alertar, e é o que impede o selo verde de aparecer
    ao lado de um problema.
    """
    por_gravidade = por_gravidade or {}
    violacoes = violacoes or []
    criticas = int(por_gravidade.get("critical") or 0)

    if total_de_achados == 0 and tags_antes_do_consentimento == 0 and pii_exposta == 0:
        return {
            "conforme": True,
            "titulo": "Seu site está de parabéns",
            "frase": (
                "Nenhuma não conformidade foi observada nesta varredura. "
                + (
                    f"As {total_de_tags} ferramentas de rastreamento encontradas "
                    "esperam a decisão do visitante antes de coletar."
                    if total_de_tags
                    else "Não encontramos ferramentas de rastreamento nesta página."
                )
            ),
            "artigo": None,
            "motivo": "conforme",
        }

    motivo = _classificar(violacoes, tem_cmp, tags_antes_do_consentimento, pii_exposta)

    # Cada frase afirma só o que a varredura observou. "Coletou" é diferente de
    # "pode coletar", e é essa diferença que sustenta o laudo.
    if motivo == "pii":
        return {
            "conforme": False,
            "titulo": "Dado pessoal trafegando em texto claro",
            "frase": (
                f"Encontramos {pii_exposta} ocorrência(s) de dado pessoal — como e-mail "
                "ou documento — sendo enviado sem proteção junto com os dados de "
                "navegação. É o achado mais grave que uma varredura pode apontar, "
                "e contraria os artigos 6º e 46 da LGPD, que exigem segurança e "
                "finalidade no tratamento."
            ),
            "artigo": "LGPD art. 6º e art. 46",
            "motivo": motivo,
        }

    if motivo == "cmp_ausente":
        quantos = tags_antes_do_consentimento or total_de_tags
        return {
            "conforme": False,
            "titulo": "Coleta sem pedir consentimento",
            "frase": (
                f"Seu site coleta dados de navegação por meio de {quantos} ferramenta(s) "
                "de rastreamento e não apresenta nenhum controle de consentimento. "
                "A coleta começa assim que a página carrega — o visitante não tem em "
                "momento algum a chance de aceitar ou recusar. Isso contraria o "
                "art. 7º, I da LGPD, que condiciona o tratamento ao consentimento "
                "do titular."
            ),
            "artigo": "LGPD art. 7º, I",
            "motivo": motivo,
        }

    if motivo == "cmp_sem_bloqueio":
        return {
            "conforme": False,
            "titulo": "O aviso de cookies não está bloqueando nada",
            "frase": (
                f"Seu site exibe um controle de consentimento, mas {tags_antes_do_consentimento} "
                "ferramenta(s) de rastreamento disparam antes de qualquer resposta do "
                "visitante"
                + (f", e {cookies_sem_consentimento} cookie(s) já foram gravados no navegador"
                   if cookies_sem_consentimento else "")
                + ". Ter o aviso não basta: se ele não impede a coleta, o consentimento "
                "não existe na prática. Contraria o art. 8º, §1º da LGPD."
            ),
            "artigo": "LGPD art. 8º, §1º",
            "motivo": motivo,
        }

    gravidade = (
        f"{criticas} de gravidade crítica" if criticas
        else "nenhuma delas crítica"
    )
    return {
        "conforme": False,
        "titulo": f"{total_de_achados} não conformidade(s) encontradas",
        "frase": (
            f"A varredura apontou {total_de_achados} ponto(s) fora de conformidade "
            f"na configuração de rastreamento deste site, {gravidade}. "
            "O relatório completo mostra cada um deles, onde está no código e "
            "como corrigir."
        ),
        "artigo": None,
        "motivo": motivo,
    }
