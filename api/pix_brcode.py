"""Gera o "copia e cola" do PIX (BR Code), no padrão EMV do Banco Central.

Sem dependência nova: o formato é uma sequência de campos
``ID + tamanho + valor``, e o único cálculo é um CRC16-CCITT no fim. Uma
biblioteca para isso traria mais superfície de atualização do que código.

O que sai daqui vai para o aplicativo do banco de quem está pagando. Um
caractere errado não gera "erro de formato" — gera **"QR Code inválido"** na
hora do pagamento, e a venda se perde sem ninguém saber por quê. Por isso os
campos são validados na montagem em vez de truncados em silêncio.

Referência: Manual do BR Code (BACEN) e EMV® QRCPS.
"""
from __future__ import annotations

import re
import unicodedata

# Identificadores do padrão EMV usados aqui.
_ID_FORMATO = "00"
_ID_MERCHANT_ACCOUNT = "26"
_ID_CATEGORIA = "52"
_ID_MOEDA = "53"
_ID_VALOR = "54"
_ID_PAIS = "58"
_ID_RECEBEDOR = "59"
_ID_CIDADE = "60"
_ID_ADICIONAL = "62"
_ID_CRC = "63"

_GUI_PIX = "br.gov.bcb.pix"

#: Limites do padrão. Estourar não é detalhe estético: o app do banco recusa.
_MAX_RECEBEDOR = 25
_MAX_CIDADE = 15
_MAX_TXID = 25


def _campo(identificador: str, valor: str) -> str:
    """Monta ``ID + tamanho(2 dígitos) + valor``."""
    return f"{identificador}{len(valor):02d}{valor}"


def _somente_ascii(texto: str, limite: int) -> str:
    """Remove acento e caracteres fora do ASCII imprimível.

    O BR Code não aceita acentuação: "São Paulo" precisa virar "SAO PAULO".
    Mandar o acento cru produz um código que alguns bancos leem e outros
    recusam — o pior dos casos, porque o defeito só aparece com parte dos
    clientes.
    """
    sem_acento = unicodedata.normalize("NFKD", texto or "")
    sem_acento = sem_acento.encode("ascii", "ignore").decode("ascii")
    sem_acento = re.sub(r"[^A-Za-z0-9 .\-]", "", sem_acento)
    return sem_acento.strip().upper()[:limite]


def crc16(payload: str) -> str:
    """CRC-16/CCITT-FALSE — polinômio 0x1021, valor inicial 0xFFFF.

    É o dígito verificador do BR Code inteiro, calculado sobre o payload já
    contendo "6304". Errar aqui produz um código que o banco recusa sem
    explicar.
    """
    crc = 0xFFFF
    for byte in payload.encode("utf-8"):
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF
    return f"{crc:04X}"


def gerar_brcode(
    chave: str,
    valor: float,
    nome_recebedor: str,
    cidade: str,
    txid: str = "***",
    descricao: str | None = None,
) -> str:
    """Devolve o copia-e-cola do PIX.

    `txid` identifica a cobrança na conciliação — é o que permite casar o
    pagamento recebido com o pedido certo quando duas pessoas pagam o mesmo
    valor no mesmo minuto. "***" significa "sem identificador", aceito pelo
    padrão mas inútil para conferir depois.
    """
    if not chave or not str(chave).strip():
        raise ValueError("PIX sem chave: o código gerado seria recusado pelo banco.")

    valor_decimal = round(float(valor), 2)
    if valor_decimal <= 0:
        raise ValueError(f"PIX com valor {valor_decimal}: não há o que cobrar.")

    recebedor = _somente_ascii(nome_recebedor, _MAX_RECEBEDOR) or "RECEBEDOR"
    municipio = _somente_ascii(cidade, _MAX_CIDADE) or "BRASIL"

    # O txid aceita letras e números, sem espaço nem acento.
    identificador = re.sub(r"[^A-Za-z0-9]", "", txid or "")[:_MAX_TXID] or "***"

    conta = _campo("00", _GUI_PIX) + _campo("01", str(chave).strip())
    if descricao:
        # Campo opcional; alguns bancos exibem ao pagador. Cabe no que sobra
        # dos 99 caracteres do Merchant Account Information.
        sobra = 99 - len(conta) - 4
        if sobra > 0:
            conta += _campo("02", _somente_ascii(descricao, sobra))

    payload = (
        _campo(_ID_FORMATO, "01")
        + _campo(_ID_MERCHANT_ACCOUNT, conta)
        + _campo(_ID_CATEGORIA, "0000")
        + _campo(_ID_MOEDA, "986")          # BRL
        + _campo(_ID_VALOR, f"{valor_decimal:.2f}")
        + _campo(_ID_PAIS, "BR")
        + _campo(_ID_RECEBEDOR, recebedor)
        + _campo(_ID_CIDADE, municipio)
        + _campo(_ID_ADICIONAL, _campo("05", identificador))
    )

    # O CRC é calculado sobre o payload JÁ com "6304" no fim.
    payload += f"{_ID_CRC}04"
    return payload + crc16(payload)
