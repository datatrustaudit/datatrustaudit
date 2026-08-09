"""Remove dado pessoal do HAR, guardando só onde ele estava.

Gravar o checkout captura e-mail, CPF, endereço — às vezes cartão. Se isso
subisse para o nosso banco, o produto viraria exatamente o vazamento que
audita, e não sobreviveria à primeira pergunta de um DPO.

A saída é separar o achado do valor: **o laudo aponta o local, nunca o
conteúdo**. "E-mail em texto claro no evento `purchase`, parâmetro
`user_data.em`" é evidência suficiente para o cliente ir corrigir — e não
exige que a gente tenha guardado o e-mail de ninguém.

O mascaramento roda no servidor mesmo havendo um no navegador. Checagem só no
cliente é conveniência, não proteção: quem chamar a API direto entrega o HAR
cru, e aí o dado já estaria dentro de casa.

**O risco de mascarar demais é real.** Identificador de tag é numérico e se
parece com PII: o ID do Meta Pixel tem 13 a 16 dígitos, como um cartão.
Estragá-lo quebraria a detecção da própria tag que se quer auditar. Por isso
nada aqui casa só por formato — CPF, CNPJ e cartão passam por validação de
dígito verificador antes de serem tocados.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

#: Marcadores que substituem o valor. Mantêm o tipo visível no laudo.
MARCADOR = {
    "email": "[e-mail removido]",
    "cpf": "[cpf removido]",
    "cnpj": "[cnpj removido]",
    "cartao": "[cartao removido]",
    "telefone": "[telefone removido]",
}

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]{2,}", re.IGNORECASE)
#: CPF com ou sem pontuação. A validação abaixo é que decide.
_CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
_CNPJ = re.compile(r"\b\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}\b")
#: Telefone brasileiro, e só com formatação característica: parênteses no DDD,
#: hífen separando, ou +55.
#:
#: A versão anterior aceitava 10 ou 11 dígitos crus e mascarava o `cid` do GA4
#: (`847362819.1691582734`), que é identificador de cliente, não telefone. Sem
#: o `cid` o laudo perde a ligação entre requisições da mesma sessão. Número
#: cru nessa faixa é ambíguo demais — o risco de estragar identificador supera
#: o de deixar passar um telefone sem formatação.
_TELEFONE = re.compile(
    r"(?:\+55[\s-]?)?(?:\(\d{2}\)[\s-]?\d{4,5}[-\s]?\d{4}"      # (11) 98765-4321
    r"|\b\d{2}[\s-]\d{4,5}[-\s]?\d{4}\b"                          # 11 98765-4321
    r"|\b9?\d{4}-\d{4}\b)"                                        # 98765-4321
)
_CARTAO = re.compile(r"\b(?:\d[ -]?){13,19}\b")


def _digitos(texto: str) -> str:
    return re.sub(r"\D", "", texto)


def _cpf_valido(texto: str) -> bool:
    """Dígito verificador do CPF. Evita mascarar um ID qualquer de 11 dígitos."""
    n = _digitos(texto)
    if len(n) != 11 or n == n[0] * 11:
        return False
    for tamanho in (9, 10):
        soma = sum(int(n[i]) * (tamanho + 1 - i) for i in range(tamanho))
        digito = (soma * 10) % 11 % 10
        if digito != int(n[tamanho]):
            return False
    return True


def _cnpj_valido(texto: str) -> bool:
    n = _digitos(texto)
    if len(n) != 14 or n == n[0] * 14:
        return False
    for tamanho in (12, 13):
        pesos = list(range(tamanho - 7, 1, -1)) + list(range(9, 1, -1))
        soma = sum(int(n[i]) * pesos[i] for i in range(tamanho))
        resto = soma % 11
        digito = 0 if resto < 2 else 11 - resto
        if digito != int(n[tamanho]):
            return False
    return True


def _luhn(texto: str) -> bool:
    """Checksum de cartão. Sem isto, o ID do Meta Pixel viraria "cartão"."""
    n = _digitos(texto)
    if not (13 <= len(n) <= 19):
        return False
    soma = 0
    par = False
    for digito in reversed(n):
        d = int(digito)
        if par:
            d *= 2
            if d > 9:
                d -= 9
        soma += d
        par = not par
    return soma % 10 == 0


def mascarar_texto(texto: str) -> Tuple[str, List[str]]:
    """Devolve o texto sem PII e a lista de tipos encontrados."""
    if not texto or not isinstance(texto, str):
        return texto, []

    achados: List[str] = []

    def troca(padrao: re.Pattern, tipo: str, validador=None):
        nonlocal texto
        def _sub(m):
            valor = m.group(0)
            if validador and not validador(valor):
                return valor
            achados.append(tipo)
            return MARCADOR[tipo]
        texto = padrao.sub(_sub, texto)

    # E-mail primeiro: sem isso, o trecho numérico de um endereço poderia ser
    # analisado pelos padrões seguintes.
    troca(_EMAIL, "email")
    troca(_CNPJ, "cnpj", _cnpj_valido)
    troca(_CPF, "cpf", _cpf_valido)
    troca(_CARTAO, "cartao", _luhn)
    troca(_TELEFONE, "telefone")

    return texto, achados


def mascarar_har(dados: Dict[str, Any]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Percorre o HAR removendo PII e registrando onde ela estava.

    Devolve `(har_limpo, ocorrencias)`. Cada ocorrência aponta o passo, a URL e
    o campo — é o que vira achado no laudo, sem carregar o valor junto.
    """
    ocorrencias: List[Dict[str, Any]] = []

    def registra(tipos: List[str], url: str, onde: str, pageref: str):
        """A URL do registro passa pelo mascarador antes de ser guardada.

        Sem isso o mascaramento vazava por si mesmo: quando a PII está na query
        string, guardar a URL "de onde veio" carrega o dado de volta para
        dentro — e a lista de ocorrências é justamente a parte que vai para o
        laudo e para o banco.
        """
        url_segura, _ = mascarar_texto((url or "")[:300])
        for tipo in set(tipos):
            ocorrencias.append({
                "tipo": tipo,
                "onde": onde,
                "url": url_segura[:200],
                "pageref": pageref,
            })

    log = dados.get("log")
    if not isinstance(log, dict):
        return dados, ocorrencias

    for entrada in (log.get("entries") or []):
        if not isinstance(entrada, dict):
            continue
        pageref = entrada.get("pageref") or ""
        requisicao = entrada.get("request") or {}
        url_original = requisicao.get("url") or ""

        # 1. URL — query string é onde CPF em GET costuma aparecer
        if isinstance(url_original, str):
            limpa, tipos = mascarar_texto(url_original)
            if tipos:
                requisicao["url"] = limpa
                registra(tipos, url_original, "URL (query string)", pageref)

        # 2. Corpo do POST — o payload do beacon
        post = requisicao.get("postData")
        if isinstance(post, dict):
            if isinstance(post.get("text"), str):
                limpo, tipos = mascarar_texto(post["text"])
                if tipos:
                    post["text"] = limpo
                    registra(tipos, url_original, "corpo da requisição", pageref)
            for p in (post.get("params") or []):
                if isinstance(p, dict) and isinstance(p.get("value"), str):
                    limpo, tipos = mascarar_texto(p["value"])
                    if tipos:
                        p["value"] = limpo
                        registra(tipos, url_original, f"parâmetro {p.get('name', '?')}", pageref)

        # 3. Cabeçalhos e cookies dos dois lados
        for secao, rotulo in ((requisicao, "cabeçalho da requisição"),
                              (entrada.get("response") or {}, "cabeçalho da resposta")):
            if not isinstance(secao, dict):
                continue
            for campo in ("headers", "cookies", "queryString"):
                for item in (secao.get(campo) or []):
                    if isinstance(item, dict) and isinstance(item.get("value"), str):
                        limpo, tipos = mascarar_texto(item["value"])
                        if tipos:
                            item["value"] = limpo
                            registra(tipos, url_original, f"{rotulo}: {item.get('name', '?')}", pageref)

        # 4. Corpo da resposta — pode conter o pedido inteiro, com dados do
        #    comprador. É o maior volume de PII num HAR de checkout.
        conteudo = (entrada.get("response") or {}).get("content")
        if isinstance(conteudo, dict) and isinstance(conteudo.get("text"), str):
            limpo, tipos = mascarar_texto(conteudo["text"])
            if tipos:
                conteudo["text"] = limpo
                registra(tipos, url_original, "corpo da resposta", pageref)

    return dados, ocorrencias


def resumo_das_ocorrencias(ocorrencias: List[Dict[str, Any]]) -> Dict[str, int]:
    """Quantas de cada tipo — para o laudo dizer o tamanho do problema."""
    contagem: Dict[str, int] = {}
    for o in ocorrencias:
        contagem[o["tipo"]] = contagem.get(o["tipo"], 0) + 1
    return contagem
