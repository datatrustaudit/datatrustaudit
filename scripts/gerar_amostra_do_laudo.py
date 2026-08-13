"""Regenera a amostra que a rota `/dev/laudo` usa para conferir a tela.

    python scripts/gerar_amostra_do_laudo.py [url]

A amostra é um laudo **real**, não um objeto montado à mão. Isso não é
preciosismo: dado inventado é o defeito mais caro que este produto já teve, e
uma amostra fabricada viraria referência de "como o laudo deve parecer" sobre
números que nunca existiram. Também é o que faz a conferência valer — foi
abrindo esta tela que apareceram o "Invalid Date" no cabeçalho, o "13 eventos ·
0 únicos" na aba Eventos e o "0%" de conformidade ao lado de um índice 38.

Rode isto sempre que mexer no formato da resposta de `/api/audit`. Amostra
velha confere uma tela que não existe mais — e passa, o que é pior do que
falhar.

O site auditado é público e a varredura não faz login, então não há dado
pessoal no arquivo. Antes de trocar a URL por uma que exija sessão, lembre que
o resultado vai para o repositório.
"""
import asyncio
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("SECRET_KEY", "x" * 40)

from api.audit import auditar_pagina  # noqa: E402

DESTINO = Path(__file__).resolve().parent.parent / "static" / "src" / "dev" / "laudo-de-exemplo.json"
URL_PADRAO = "https://terra.com.br"

#: Chaves que nenhuma tela lê. `gtm` e `ga4` somam 90 KB e a aba GTM Quality
#: usa `gtmQuality`; `debugging` são outros 38 KB de rastro de coleta.
DESCARTAR = ("_audit_result", "_scan", "gtm", "ga4", "debugging", "browser_attempts", "errors")

#: `context` guarda o HTML em volta de cada tag. Útil no produto, peso morto
#: numa amostra de conferência visual.
LIMITE_DO_CONTEXTO = 160


def main() -> int:
    url = sys.argv[1] if len(sys.argv) > 1 else URL_PADRAO
    print(f"Auditando {url} como premium — leva cerca de um minuto…")

    laudo = asyncio.run(auditar_pagina(url, "premium"))

    if not laudo.get("success"):
        print(f"A varredura falhou: {laudo.get('errorCode')} — {laudo.get('error')}")
        print("Amostra NÃO gravada: um laudo de falha não serve para conferir a tela.")
        return 1

    for chave in DESCARTAR:
        laudo.pop(chave, None)

    for tag in laudo.get("tags", []):
        contexto = tag.get("context")
        if isinstance(contexto, str) and len(contexto) > LIMITE_DO_CONTEXTO:
            tag["context"] = contexto[:LIMITE_DO_CONTEXTO] + "…"

    # A tela recebe o objeto já normalizado por `normalizeAuditResult`, que
    # deriva `timestamp` de `finished_at`. Sem isso o cabeçalho da amostra
    # mostraria "Invalid Date" — que foi, aliás, como o defeito apareceu.
    laudo["timestamp"] = laudo.get("finished_at") or laudo.get("started_at")

    texto = json.dumps(laudo, ensure_ascii=False, indent=1)
    DESTINO.write_text(texto, encoding="utf-8", newline="\n")

    resumo = laudo.get("summary") or {}
    print(f"\nGravado em {DESTINO.relative_to(Path.cwd())} ({len(texto) // 1024} KB)")
    print(f"  método .......... {laudo.get('scanMethod')}")
    print(f"  índice geral .... {laudo.get('score')}")
    print(f"  conformidade .... {(laudo.get('privacy') or {}).get('complianceScore')}")
    print(f"  tags ............ {len(laudo.get('tags') or [])}")
    print(f"  não conformidades {resumo.get('violationsCount')}")
    print(f"  eventos ......... {resumo.get('eventsDetected')} "
          f"({resumo.get('uniqueEventNames')} únicos, {resumo.get('duplicatedEventNames')} duplicados)")
    print("\nConfira em http://localhost:8080/dev/laudo")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
