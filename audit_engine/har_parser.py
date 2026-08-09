"""Lê um HAR e devolve o percurso auditado, passo a passo.

O scanner abre a home, deslogado e sem aceitar cookies. Mas dado pessoal não
vaza na home: vaza no checkout, na área do cliente, na confirmação do pedido —
onde o e-mail entra no dataLayer e o CPF aparece na query string. Nenhum
scanner do mercado chega lá, porque nenhum faz login.

O HAR resolve isso sem extensão nem credencial: o auditor grava o DevTools
enquanto percorre o funil já logado, exporta e sobe o arquivo.

Duas decisões de arquitetura, ambas herdadas de erro que este produto já pagou:

**O HAR vira um scan, não um segundo motor.** Cada página do percurso é
convertida no mesmo formato que `browser_fetcher` produz, e passa pelo
`run_audit` de sempre. O produto já teve três motores respondendo sobre o mesmo
site, com três respostas diferentes; não vai ter um quarto.

**O percurso já está no arquivo.** `log.pages[]` são os passos, e cada entrada
aponta para a sua página por `pageref`. Não há o que inventar — só ler.
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


class HARInvalido(Exception):
    """Arquivo que não é um HAR utilizável."""


#: Teto de entradas processadas. Um HAR de sessão longa passa de 20 mil
#: requisições e alguns MB; ler tudo trava o worker sem melhorar o laudo, já
#: que rastreador repetido não acrescenta evidência.
MAX_ENTRADAS = 8000


class _RequisicaoDoHAR:
    """Mesma forma de `browser_fetcher.InterceptedRequest`.

    Duck typing de propósito: o motor lê por atributo, e importar a dataclass
    criaria dependência do módulo do Playwright num caminho que não abre
    navegador nenhum.
    """

    __slots__ = ("url", "method", "domain", "path", "post_data", "resource_type", "timestamp")

    def __init__(self, url, method, domain, path, post_data, resource_type, timestamp):
        self.url = url
        self.method = method
        self.domain = domain
        self.path = path
        self.post_data = post_data
        self.resource_type = resource_type
        self.timestamp = timestamp


class ScanDeTrajeto:
    """O que `run_audit` espera receber, montado a partir do HAR."""

    scan_method = "har"
    scan_status = "completed"
    fallback_used = False
    error = None

    def __init__(self, url: str, html: str = ""):
        self.url = url
        self.html = html
        self.intercepted_requests: List[_RequisicaoDoHAR] = []
        self.all_script_urls: List[str] = []
        self.cookies: List[Dict[str, Any]] = []
        self.local_storage: Dict[str, str] = {}
        self.session_storage: Dict[str, str] = {}
        self.datalayer_raw: List[Dict[str, Any]] = []
        self.gtag_configs: List[Dict[str, Any]] = []
        self.fbq_calls: List[Dict[str, Any]] = []
        self.consent_signals: Dict[str, Any] = {}


def _quando(iso: Optional[str]) -> float:
    """`startedDateTime` do HAR em epoch. A ordem importa mais que o valor.

    É o timestamp que sustenta a frase "disparou 0,35 s depois do carregamento,
    antes de qualquer aceite" — sem ele, volta-se a inferir ordem por posição
    no HTML, que não prova nada.
    """
    if not iso:
        return 0.0
    try:
        texto = str(iso).replace("Z", "+00:00")
        return datetime.fromisoformat(texto).timestamp()
    except (ValueError, TypeError):
        return 0.0


def _tipo_do_recurso(entrada: Dict[str, Any]) -> str:
    mime = ((entrada.get("response") or {}).get("content") or {}).get("mimeType") or ""
    mime = mime.lower()
    if "javascript" in mime:
        return "script"
    if "html" in mime:
        return "document"
    if "image" in mime:
        return "image"
    if "json" in mime:
        return "xhr"
    return entrada.get("_resourceType") or "other"


def _corpo(entrada: Dict[str, Any]) -> Optional[str]:
    """Corpo do POST, que é onde vive a prova de que a tag enviou dados."""
    post = (entrada.get("request") or {}).get("postData") or {}
    texto = post.get("text")
    if texto:
        return str(texto)[:4000]
    # Alguns exportadores só preenchem `params` em form-urlencoded.
    params = post.get("params")
    if isinstance(params, list) and params:
        return "&".join(
            f"{p.get('name', '')}={p.get('value', '')}"
            for p in params if isinstance(p, dict)
        )[:4000]
    return None


def _cookies_da_entrada(entrada: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Cookies que o servidor mandou gravar, lidos dos cabeçalhos de resposta.

    São os que `document.cookie` não enxerga — inclusive `HttpOnly` e os
    `FPID`/`FPLC` de tagueamento server-side, que só aparecem aqui.
    """
    saida = []
    for c in ((entrada.get("response") or {}).get("cookies") or []):
        if not isinstance(c, dict) or not c.get("name"):
            continue
        saida.append({
            "name": c.get("name"),
            "value": c.get("value", ""),
            "domain": c.get("domain") or "",
            "path": c.get("path") or "/",
            "httpOnly": bool(c.get("httpOnly")),
            "secure": bool(c.get("secure")),
            "expires": c.get("expires"),
        })
    return saida


def _nome_do_passo(pagina: Dict[str, Any], url: str) -> str:
    """Rótulo legível do passo do percurso.

    O título da página costuma ser mais reconhecível para quem lê o laudo
    ("Finalizar compra") do que o caminho da URL.
    """
    titulo = (pagina.get("title") or "").strip()
    caminho = urlparse(url).path or "/"
    if titulo and not titulo.startswith("http"):
        return f"{titulo} ({caminho})"
    return caminho


def ler_har(conteudo: str | bytes | Dict[str, Any]) -> Dict[str, Any]:
    """Valida e devolve o objeto `log` do HAR."""
    if isinstance(conteudo, (str, bytes)):
        try:
            dados = json.loads(conteudo)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise HARInvalido("O arquivo não é um JSON válido.") from exc
    else:
        dados = conteudo

    if not isinstance(dados, dict):
        raise HARInvalido("O arquivo não tem o formato de um HAR.")

    log = dados.get("log")
    if not isinstance(log, dict):
        raise HARInvalido(
            "Não encontrei a seção 'log'. Exporte pelo DevTools com o botão "
            "'Export HAR' na aba Network."
        )
    if not isinstance(log.get("entries"), list):
        raise HARInvalido("O HAR não contém requisições registradas.")
    return log


def montar_passos(log: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Agrupa as requisições por página navegada — os passos do percurso.

    HAR sem `pages` (alguns exportadores omitem) cai num passo único: melhor um
    laudo de percurso inteiro do que recusar o arquivo.
    """
    entradas = log.get("entries") or []
    if len(entradas) > MAX_ENTRADAS:
        entradas = entradas[:MAX_ENTRADAS]

    paginas = {
        p.get("id"): p
        for p in (log.get("pages") or [])
        if isinstance(p, dict) and p.get("id")
    }

    por_pagina: Dict[str, Dict[str, Any]] = {}
    ordem: List[str] = []

    for entrada in entradas:
        if not isinstance(entrada, dict):
            continue
        requisicao = entrada.get("request") or {}
        url = requisicao.get("url") or ""
        if not url or url.startswith(("data:", "blob:", "chrome-extension:")):
            continue

        ref = entrada.get("pageref") or "__unico__"
        if ref not in por_pagina:
            pagina = paginas.get(ref, {})
            por_pagina[ref] = {
                "ref": ref,
                "url": None,
                "titulo": pagina.get("title") or "",
                "inicio": _quando(pagina.get("startedDateTime") or entrada.get("startedDateTime")),
                "requisicoes": [],
                "cookies": [],
                "html": "",
            }
            ordem.append(ref)

        passo = por_pagina[ref]
        partes = urlparse(url)

        passo["requisicoes"].append(_RequisicaoDoHAR(
            url=url,
            method=requisicao.get("method") or "GET",
            domain=partes.netloc,
            path=partes.path,
            post_data=_corpo(entrada),
            resource_type=_tipo_do_recurso(entrada),
            timestamp=_quando(entrada.get("startedDateTime")),
        ))
        passo["cookies"].extend(_cookies_da_entrada(entrada))

        tipo = _tipo_do_recurso(entrada)
        if tipo == "script":
            passo["all_script_urls"] = passo.get("all_script_urls", []) + [url]

        # A primeira navegação de documento define a URL do passo, e o corpo
        # dela é o HTML que o motor analisa.
        if passo["url"] is None and tipo == "document":
            passo["url"] = url
            corpo = ((entrada.get("response") or {}).get("content") or {}).get("text")
            if isinstance(corpo, str):
                passo["html"] = corpo

    passos = []
    for ref in ordem:
        passo = por_pagina[ref]
        # Passo sem documento próprio (navegação por SPA, por exemplo) herda a
        # URL da primeira requisição observada.
        if passo["url"] is None:
            passo["url"] = passo["requisicoes"][0].url if passo["requisicoes"] else ""
        passo["nome"] = _nome_do_passo(
            {"title": passo["titulo"]}, passo["url"]
        )
        passos.append(passo)

    passos.sort(key=lambda p: p["inicio"])
    return passos


def passo_para_scan(passo: Dict[str, Any]) -> ScanDeTrajeto:
    """Converte um passo do percurso no scan que `run_audit` consome."""
    scan = ScanDeTrajeto(url=passo["url"], html=passo.get("html") or "")
    scan.intercepted_requests = passo["requisicoes"]
    scan.all_script_urls = passo.get("all_script_urls", [])

    # Cookie repetido entre requisições é o mesmo cookie: contar duas vezes
    # inflaria a evidência do laudo.
    vistos = set()
    for c in passo["cookies"]:
        chave = (c.get("name"), c.get("domain"))
        if chave in vistos:
            continue
        vistos.add(chave)
        scan.cookies.append(c)
    return scan


def resumo_do_percurso(passos: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Números do trajeto, para o topo do laudo."""
    total_requisicoes = sum(len(p["requisicoes"]) for p in passos)
    inicio = min((p["inicio"] for p in passos if p["inicio"]), default=0.0)
    fim = max(
        (r.timestamp for p in passos for r in p["requisicoes"] if r.timestamp),
        default=0.0,
    )
    return {
        "passos": len(passos),
        "requisicoes": total_requisicoes,
        "duracaoSegundos": round(fim - inicio, 1) if fim > inicio else None,
        "paginas": [p["nome"] for p in passos],
    }
