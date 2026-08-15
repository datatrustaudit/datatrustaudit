"""O relógio do laudo — fonte única dos carimbos de tempo que vão para a tela.

Todo instante que sai daqui é ISO **sem sufixo de fuso**, exatamente o que
`db.models.utcnow()` já grava nas colunas do banco. É esse formato que
`static/src/lib/datas.ts` lê, e ele lê como UTC.

O que este módulo fecha: `datetime.now()` devolve a hora **local do servidor**.
Num container em UTC ninguém percebe a diferença; fora dela, o mesmo scan
declarava dois horários conforme a tela — o histórico vem de `utcnow()` (UTC de
verdade) e o cabeçalho do laudo vinha de `datetime.now()`. Com a tela lendo tudo
como UTC, hora local vira erro de três horas no Brasil: o bastante para trocar o
DIA do exame numa peça cuja serventia é provar o que um site fez e quando.

Naive, e não aware, pelo mesmo motivo de `utcnow()`: as colunas `DateTime` não
guardam fuso e misturar aware com naive quebra as comparações de data.
"""
from datetime import datetime, timezone


def agora_utc_iso() -> str:
    """Instante atual em UTC, naive, no formato que a resposta da API carrega."""
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat()
