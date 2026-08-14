"""Envio de e-mail transacional pelo Resend.

Um módulo só, com uma função de envio e os textos das mensagens. O motivo de
não espalhar `requests.post` pelas rotas é o de sempre neste projeto: quando o
envio falha — e ele falha, por chave errada, domínio não verificado, cota — o
lugar do tratamento precisa ser um só.

**Falha de e-mail nunca derruba a operação que a originou.** O cliente pagou o
PIX; se o aviso ao dono não sair, o pagamento continua válido e o pedido
continua no painel. Levantar aqui trocaria "o dono não foi avisado" por "o
cliente viu um erro depois de pagar", que é muito pior. Por isso as funções
devolvem `bool` e registram o motivo no log, em vez de propagar.
"""
from __future__ import annotations

import os
from typing import Optional

import requests

RESEND_API_URL = "https://api.resend.com/emails"

#: Timeout curto: isto roda dentro de um request HTTP que o cliente está
#: esperando. Sem teto, uma indisponibilidade do Resend viraria uma tela
#: travada depois do pagamento.
TIMEOUT_SEGUNDOS = 8


def _config() -> tuple[Optional[str], str, str]:
    """(chave, remetente, destinatário do dono).

    Lidos a cada chamada, não no import: em teste e em desenvolvimento o
    ambiente muda depois que o módulo já foi carregado, e ler uma vez só
    congelaria o valor errado.
    """
    chave = (os.getenv("RESEND_API_KEY") or "").strip() or None
    # O Resend só entrega de domínio verificado. `onboarding@resend.dev`
    # funciona sem verificar nada, mas só para o e-mail dono da conta — serve
    # para testar, não para escrever ao cliente.
    remetente = (os.getenv("EMAIL_REMETENTE") or "DataTrust Audit <onboarding@resend.dev>").strip()
    dono = (os.getenv("EMAIL_DO_DONO") or "").strip()
    return chave, remetente, dono


def enviar(para: str, assunto: str, html: str, responder_para: str | None = None) -> bool:
    """Devolve True se o Resend aceitou a mensagem.

    "Aceitou" não é "entregou": o Resend responde 200 e entrega depois. Para
    saber o destino final é preciso olhar o painel dele — este retorno só
    distingue "saiu daqui" de "nem saiu".
    """
    chave, remetente, _ = _config()

    if not chave:
        print(f"[email] RESEND_API_KEY vazia — e-mail para {para} NÃO enviado: {assunto!r}")
        return False
    if not para or "@" not in para:
        print(f"[email] destinatário inválido ({para!r}) — nada enviado")
        return False

    corpo = {"from": remetente, "to": [para], "subject": assunto, "html": html}
    if responder_para:
        corpo["reply_to"] = responder_para

    try:
        r = requests.post(
            RESEND_API_URL,
            json=corpo,
            headers={"Authorization": f"Bearer {chave}"},
            timeout=TIMEOUT_SEGUNDOS,
        )
    except requests.RequestException as e:
        print(f"[email] falha de rede ao enviar para {para}: {e!r}")
        return False

    if r.status_code >= 300:
        # O corpo do Resend diz o motivo real ("domain is not verified",
        # "invalid api key"). Sem ele, o log viraria um 403 sem explicação.
        print(f"[email] Resend recusou ({r.status_code}) para {para}: {r.text[:300]}")
        return False
    return True


# ─────────────────────────────────────────────────────────────────────────────
# Mensagens
# ─────────────────────────────────────────────────────────────────────────────

_ESTILO_BASE = (
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;"
    "color:#14181C;line-height:1.55;"
)


def _moeda(valor: float) -> str:
    return f"R$ {valor:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _envelope(titulo: str, miolo: str) -> str:
    """Casca comum. Estilo inline porque cliente de e-mail ignora `<style>`."""
    return f"""
<div style="{_ESTILO_BASE}max-width:520px;margin:0 auto;padding:28px 24px;">
  <p style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#757B84;margin:0 0 18px;">
    DataTrust Audit
  </p>
  <h1 style="font-size:21px;line-height:1.25;margin:0 0 18px;font-weight:600;">{titulo}</h1>
  {miolo}
  <hr style="border:none;border-top:1px solid #D8D4C9;margin:28px 0 14px;">
  <p style="font-size:12px;color:#757B84;margin:0;">
    DataTrust Audit — auditoria de tags, cookies e consentimento.
  </p>
</div>
""".strip()


def avisar_dono_de_pix(
    *,
    email_do_cliente: str,
    nome_do_cliente: str | None,
    plano: str,
    valor: float,
    txid: str,
    link_de_confirmacao: str,
) -> bool:
    """Avisa o dono que um cliente declarou ter pago, com o botão de liberar.

    O botão leva a uma PÁGINA de confirmação, não a um endpoint que já libera.
    A diferença não é estética: scanners de link do Gmail, do Outlook e de
    antivírus corporativo abrem os links do e-mail sozinhos, antes de qualquer
    humano clicar. Um link que libera plano no GET seria disparado por eles — o
    plano sairia de graça, sem ninguém ter apertado nada.
    """
    _, _, dono = _config()
    if not dono:
        print("[email] EMAIL_DO_DONO vazio — aviso de PIX não enviado")
        return False

    quem = f"{nome_do_cliente} ({email_do_cliente})" if nome_do_cliente else email_do_cliente
    miolo = f"""
  <p style="margin:0 0 16px;">
    <strong>{quem}</strong> informou ter pago o PIX. Confira se o valor entrou na
    conta antes de liberar.
  </p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 22px;">
    <tr><td style="padding:6px 0;color:#4A5058;">Plano</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">{plano.capitalize()}</td></tr>
    <tr><td style="padding:6px 0;color:#4A5058;">Valor</td>
        <td style="padding:6px 0;text-align:right;font-weight:600;">{_moeda(valor)}</td></tr>
    <tr><td style="padding:6px 0;color:#4A5058;">Identificador</td>
        <td style="padding:6px 0;text-align:right;font-family:monospace;">{txid}</td></tr>
  </table>
  <a href="{link_de_confirmacao}"
     style="display:inline-block;background:#12285C;color:#fff;text-decoration:none;
            padding:13px 26px;border-radius:9px;font-weight:600;font-size:15px;">
    Recebi — liberar o acesso
  </a>
  <p style="font-size:12px;color:#757B84;margin:18px 0 0;">
    O botão abre uma página para você confirmar. Nada é liberado só por abrir
    este e-mail. Se o dinheiro não entrou, ignore — o pedido fica registrado no
    painel de qualquer forma.
  </p>
"""
    return enviar(
        para=dono,
        assunto=f"PIX informado — {plano.capitalize()} {_moeda(valor)} — {txid}",
        html=_envelope("Um cliente informou o pagamento", miolo),
        # Responder ao e-mail fala direto com quem comprou.
        responder_para=email_do_cliente,
    )


def confirmar_pix_ao_cliente(*, email_do_cliente: str, plano: str, valor: float, ate_quando: str) -> bool:
    """Avisa o cliente de que o acesso foi liberado."""
    miolo = f"""
  <p style="margin:0 0 16px;">
    Recebemos seu PIX de <strong>{_moeda(valor)}</strong> e o plano
    <strong>{plano.capitalize()}</strong> já está ativo na sua conta.
  </p>
  <p style="margin:0 0 22px;">
    O acesso vale até <strong>{ate_quando}</strong>. É compra única: não há
    renovação automática e nada será cobrado de novo.
  </p>
  <p style="font-size:13px;color:#4A5058;margin:0;">
    Basta entrar e escanear — os laudos que você já emitiu continuam no
    histórico da conta.
  </p>
"""
    return enviar(
        para=email_do_cliente,
        assunto=f"Seu plano {plano.capitalize()} está ativo",
        html=_envelope("Pagamento confirmado", miolo),
    )


def instrucoes_de_pix_ao_cliente(
    *, email_do_cliente: str, plano: str, valor: float, chave: str, brcode: str, minutos: int
) -> bool:
    """Manda ao cliente os dados do PIX, para ele não depender da aba aberta."""
    miolo = f"""
  <p style="margin:0 0 16px;">
    Para ativar o plano <strong>{plano.capitalize()}</strong>, faça um PIX de
    <strong>{_moeda(valor)}</strong> para a chave abaixo.
  </p>
  <p style="margin:0 0 6px;font-size:12px;color:#4A5058;">Chave PIX (e-mail)</p>
  <p style="margin:0 0 20px;font-family:monospace;font-size:15px;
            background:#EDEAE3;padding:12px 14px;border-radius:8px;">{chave}</p>
  <p style="margin:0 0 6px;font-size:12px;color:#4A5058;">Ou copie e cole no seu banco</p>
  <p style="margin:0 0 20px;font-family:monospace;font-size:11px;word-break:break-all;
            background:#EDEAE3;padding:12px 14px;border-radius:8px;">{brcode}</p>
  <p style="font-size:13px;color:#4A5058;margin:0;">
    O código vale por {minutos} minutos. Depois de pagar, volte ao site e
    clique em <strong>“Já fiz o PIX”</strong> — a liberação é conferida à mão e
    costuma sair em poucas horas.
  </p>
"""
    return enviar(
        para=email_do_cliente,
        assunto=f"Seu PIX de {_moeda(valor)} — plano {plano.capitalize()}",
        html=_envelope("Dados para o pagamento", miolo),
    )
