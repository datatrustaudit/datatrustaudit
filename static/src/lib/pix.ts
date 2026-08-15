/**
 * A regra de prazo da tela de PIX, fora do componente.
 *
 * Ela decide se a cobrança ainda oferece um código pagável — e já esteve
 * errada de um jeito caro nos dois sentidos. Aqui ela roda sem React, o que
 * permite exercitá-la de verdade (`tests/test_pix_manual.py`, classe
 * `TestOPrazoDaTelaDePix`, executa este arquivo no Node).
 */

/**
 * O código desta cobrança venceu?
 *
 * Dois juízes para o vencimento, e os dois são necessários: o servidor já pode
 * ter carimbado `expirado`, e o contador local vence entre uma resposta e
 * outra — quem olha só o servidor deixa a tela oferecer por minutos um código
 * que o relógio já derrubou.
 *
 * `confirmado` e `avisado` nunca vencem, e é aí que mora o defeito que esta
 * função existe para prender:
 *
 * - **confirmado** é pagamento já conferido; dizer "expirou, gere outro" a
 *   quem foi liberado convida ao segundo PIX pelo mesmo acesso.
 * - **avisado** é aviso já dado. O prazo é do código, não do aviso: quem paga
 *   no minuto 29 e clica "já fiz o PIX" fica com um pedido cujo `expira_em`
 *   vence em seguida, enquanto a conferência humana leva horas. É a mesma
 *   regra que `_codigo_vencido_sem_aviso` aplica em `api/pix.py`, que segue
 *   devolvendo esse pedido com o mesmo `brcode` depois do vencimento — o BR
 *   Code não carrega validade, ele identifica o txid (`api/pix_brcode.py`).
 *   Enquanto o vencimento também valia para `avisado`, quem clicou por engano
 *   perdia no minuto 30 o botão de rever o código e ficava sem forma nenhuma
 *   de pagar: como o servidor reaproveita o pedido avisado, recarregar a
 *   página devolvia a mesma tela sem código, para sempre.
 *
 * `restanteMs` nulo é "ainda não sei" — a cobrança acabou de chegar e o
 * contador não rodou. Tratar como vencido esconderia o código de uma cobrança
 * boa no primeiro quadro.
 */
export function codigoVencido(status: string, restanteMs: number | null): boolean {
    if (status === 'confirmado' || status === 'avisado') return false;
    return status === 'expirado' || (restanteMs !== null && restanteMs <= 0);
}
