import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiRequest, ApiClientError } from '@/lib/apiClient';
import { Button } from '@/components/ui/button';
import MarcaDataTrust from '@/components/MarcaDataTrust';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

/**
 * Confirmação de PIX — a tela que o dono abre pelo botão do e-mail.
 *
 * No carregamento só há leitura (`GET`). Quem libera o acesso é o `POST`, e
 * ele só sai do clique: scanners de link do Gmail, do Outlook e de antivírus
 * corporativo abrem os links de um e-mail sozinhos, com GET, antes de
 * qualquer humano. Se abrir esta página liberasse o plano, o acesso sairia de
 * graça sem ninguém ter apertado nada. **Nenhum efeito colateral no mount.**
 *
 * O que aparece aqui vem inteiro da resposta do servidor. Campo que não veio é
 * dito, nunca preenchido com valor plausível: é sobre estes números que o dono
 * decide liberar acesso pago, e ele vai conferi-los contra o extrato do banco.
 */

interface ClienteDoPedido {
    email: string | null;
    nome: string | null;
}

interface PedidoPix {
    id: number;
    txid: string;
    plano: string;
    valor: number;
    status: string;
    criadoEm: string | null;
    expiraEm: string | null;
    avisadoEm: string | null;
    confirmadoEm: string | null;
    cliente?: ClienteDoPedido | null;
    /** Vem `true` quando o token já tinha sido consumido com sucesso antes. */
    jaConfirmado?: boolean;
}

/* Mapas tipados, e sempre com queda para o valor cru do servidor. Plano ou
   situação novos do lado de lá viram texto visível em vez de `undefined` na
   tela — foi um acesso a chave inexistente que já trocou o laudo por uma tela
   de erro. */
const NOMES_DE_PLANO: Record<'pro' | 'premium', string> = {
    pro: 'Pro',
    premium: 'Premium',
};

const SITUACOES: Record<'aguardando' | 'avisado' | 'confirmado' | 'expirado', string> = {
    aguardando: 'Aguardando pagamento',
    avisado: 'Cliente informou que pagou',
    confirmado: 'Acesso liberado',
    expirado: 'Código de pagamento expirado',
};

const nomeDoPlano = (plano: string) =>
    NOMES_DE_PLANO[plano as keyof typeof NOMES_DE_PLANO] ?? plano;

const nomeDaSituacao = (status: string) =>
    SITUACOES[status as keyof typeof SITUACOES] ?? status;

/**
 * O servidor grava UTC sem fuso (`utcnow()` é naive de propósito) e serializa
 * assim. O JavaScript lê data-hora sem marca de fuso como horário **local**, o
 * que adiantaria o carimbo em três horas no Brasil — daí o 'Z' acrescentado
 * quando não há fuso na string.
 */
const formatarInstante = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const comFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
    const data = new Date(comFuso);
    // `new Date('lixo')` não estoura: devolve "Invalid Date", que iria para a
    // tela como se fosse um horário.
    if (Number.isNaN(data.getTime())) return null;
    return data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const formatarValor = (valor: unknown): string | null =>
    typeof valor === 'number' && Number.isFinite(valor)
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor)
        : null;

/** Uma linha de evidência. Sem valor, a linha diz o que faltou. */
const Campo = ({
    rotulo,
    valor,
    ausente,
}: {
    rotulo: string;
    valor: string | null;
    ausente: string;
}) => (
    <div
        className="py-3 border-b last:border-b-0 flex flex-col gap-1"
        style={{ borderColor: 'var(--sup-borda)' }}
    >
        <span className="t-etiqueta">{rotulo}</span>
        {valor ? (
            <span className="voz-evidencia text-sm break-all" style={{ color: 'var(--laudo-texto)' }}>
                {valor}
            </span>
        ) : (
            <span className="text-sm italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
                {ausente}
            </span>
        )}
    </div>
);

const ConfirmarPix = () => {
    const [params] = useSearchParams();
    const token = (params.get('t') ?? '').trim();

    const [pedido, setPedido] = useState<PedidoPix | null>(null);
    const [carregando, setCarregando] = useState(Boolean(token));
    /* `linkMorto` separa o 404 do resto: link já usado não é falha do dono nem
       do sistema, e oferecer "tentar de novo" ali só faria ele repetir. */
    const [erroDeCarga, setErroDeCarga] = useState<{ mensagem: string; linkMorto: boolean } | null>(null);
    const [confirmando, setConfirmando] = useState(false);
    const [erroDeConfirmacao, setErroDeConfirmacao] = useState<string | null>(null);
    const [liberadoAgora, setLiberadoAgora] = useState(false);

    /* Trava síncrona da liberação, além do `disabled` do botão. `confirmando` é
       estado: entre o clique e o repintar, um segundo clique ainda encontra o
       botão ativo e o guarda lendo `false`. Aqui isso não é inofensivo —
       `_ativar_plano` SOMA um período ao que resta, e a idempotência do servidor
       compara o status antes de gravar, comparação que duas requisições
       simultâneas atravessam juntas: dois anos de acesso por um pagamento. O ref
       fecha antes de qualquer render. É a mesma trava do painel admin. */
    const liberacaoEmVoo = useRef(false);

    const carregar = useCallback(async () => {
        if (!token) return;
        setCarregando(true);
        setErroDeCarga(null);
        try {
            const dados = await apiRequest<PedidoPix>(
                `/api/payments/pix/confirmacao/${encodeURIComponent(token)}`,
                { context: 'confirmação de PIX' },
            );
            setPedido(dados);
        } catch (err) {
            const status = err instanceof ApiClientError ? err.info.status : 0;
            setErroDeCarga({
                linkMorto: status === 404,
                mensagem:
                    err instanceof Error
                        ? err.message
                        : 'Não foi possível carregar o pedido.',
            });
        } finally {
            setCarregando(false);
        }
    }, [token]);

    useEffect(() => {
        void carregar();
    }, [carregar]);

    /* Só daqui sai o POST. Nada nesta tela pode chamá-lo sozinho. */
    const confirmar = async () => {
        if (!token || liberacaoEmVoo.current) return;
        liberacaoEmVoo.current = true;
        setConfirmando(true);
        setErroDeConfirmacao(null);
        try {
            const dados = await apiRequest<PedidoPix>('/api/payments/pix/confirmar', {
                method: 'POST',
                body: { token },
                context: 'confirmação de PIX',
            });
            setPedido((anterior) => ({
                ...(anterior ?? ({} as PedidoPix)),
                ...dados,
                /* A resposta do POST traz `cliente` só com o e-mail — e nem isso
                   quando o pedido já constava confirmado. O nome existe apenas
                   no que o GET trouxe. Campo a campo, e não objeto inteiro: o
                   GET devolve `{email: null, nome: null}` quando a conta sumiu,
                   e esse objeto é "presente" para o `??`, então ele venceria o
                   e-mail verdadeiro do POST — a tela diria "o servidor não
                   devolveu o e-mail" sobre uma liberação que sabe para quem foi. */
                cliente: {
                    email: dados.cliente?.email ?? anterior?.cliente?.email ?? null,
                    nome: anterior?.cliente?.nome ?? dados.cliente?.nome ?? null,
                },
            }));
            setLiberadoAgora(true);
        } catch (err) {
            const status = err instanceof ApiClientError ? err.info.status : 0;
            setErroDeConfirmacao(
                status === 404
                    ? 'Este link não vale mais: ele já foi usado ou um aviso mais recente do cliente o substituiu. Nada foi liberado agora.'
                    : err instanceof Error
                        ? err.message
                        : 'Não foi possível liberar o acesso. Tente de novo.',
            );
        } finally {
            liberacaoEmVoo.current = false;
            setConfirmando(false);
        }
    };

    /* `apiRequest` devolve `{}` quando a resposta é 200 sem corpo JSON — um
       proxy mal configurado no meio do caminho basta. Sem identificação o
       objeto não é pedido nenhum, e oferecer o botão sobre ele deixaria o dono
       liberar acesso pago sem um único dado para conferir. */
    const pedidoUtilizavel = Boolean(pedido && (pedido.txid || typeof pedido.id === 'number'));

    const jaVeioConfirmado = pedido?.status === 'confirmado' && !liberadoAgora;
    const confirmado = liberadoAgora || pedido?.status === 'confirmado';

    const emailDoCliente = pedido?.cliente?.email ?? null;
    const rotuloDoPlano = pedido?.plano ? nomeDoPlano(pedido.plano) : null;
    const nomeDoCliente = pedido?.cliente?.nome ?? null;
    const valorFormatado = formatarValor(pedido?.valor);
    const confirmadoEm = formatarInstante(pedido?.confirmadoEm);
    const avisadoEm = formatarInstante(pedido?.avisadoEm);

    /* Liberou, mas a resposta não trouxe o registro atualizado. Acontece de
       verdade: `apiRequest` devolve `{}` quando o 200 chega sem corpo JSON — um
       proxy no caminho basta — e aí o que sobrou na tela é o pedido de antes.
       Repetir "cliente informou que pagou" logo abaixo de "acesso liberado"
       seria contradição num documento que existe para ser conferido, e quem lê
       não tem como saber qual das duas linhas está velha. */
    const situacaoDesatualizada = liberadoAgora && pedido?.status !== 'confirmado';
    const situacao = !situacaoDesatualizada && pedido?.status ? nomeDaSituacao(pedido.status) : null;

    return (
        <div className="min-h-screen sup-0" style={{ color: 'var(--laudo-texto)' }}>
            <header className="border-b" style={{ borderColor: 'var(--sup-borda)' }}>
                <div className="mx-auto w-full max-w-md px-5 py-4">
                    <MarcaDataTrust tamanho={26} />
                </div>
            </header>

            <main className="mx-auto w-full max-w-md px-5 py-8 pb-16">
                {/* ─── Link sem o token ───────────────────────────────────── */}
                {!token && (
                    <section role="alert">
                        <p className="t-etiqueta">Confirmação de PIX</p>
                        <h1 className="t-titulo mt-3">O link está incompleto</h1>
                        <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                            Falta o trecho <span className="voz-evidencia">?t=…</span> no endereço, que é
                            o que identifica o pagamento. Abra de novo pelo botão do e-mail, ou copie o
                            endereço inteiro — alguns aplicativos de e-mail cortam o fim do link.
                        </p>
                        <p className="t-apoio mt-4">Nada foi liberado.</p>
                    </section>
                )}

                {/* ─── Lendo o pedido ─────────────────────────────────────── */}
                {token && carregando && (
                    <section aria-busy="true" className="flex items-center gap-3 py-10">
                        <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden />
                        <span className="t-corpo" style={{ color: 'var(--laudo-texto-suave)' }}>
                            Buscando o pedido…
                        </span>
                    </section>
                )}

                {/* ─── Link já usado ou inválido ──────────────────────────── */}
                {token && !carregando && erroDeCarga?.linkMorto && (
                    <section role="alert">
                        <p className="t-etiqueta">Confirmação de PIX</p>
                        <h1 className="t-titulo mt-3">Este link não vale mais</h1>
                        <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                            Ele já foi usado para liberar o acesso, ou um aviso mais recente do mesmo
                            cliente o substituiu — cada aviso gera um link novo e cancela o anterior.
                            Não é erro seu, e nada foi liberado agora.
                        </p>
                        <p className="t-apoio mt-4">
                            Se o cliente ainda não estiver com o acesso, peça que ele avise de novo pela
                            tela de pagamento: chega outro e-mail, com um link válido.
                        </p>
                    </section>
                )}

                {/* ─── Falha de rede ou do servidor ───────────────────────── */}
                {token && !carregando && erroDeCarga && !erroDeCarga.linkMorto && (
                    <section role="alert">
                        <p className="t-etiqueta">Confirmação de PIX</p>
                        <h1 className="t-titulo mt-3">Não deu para ler o pedido</h1>
                        <p
                            className="t-corpo mt-4 break-words"
                            style={{ color: 'var(--laudo-texto-suave)' }}
                        >
                            {erroDeCarga.mensagem}
                        </p>
                        <p className="t-apoio mt-4">
                            Nada foi liberado. O link continua valendo — pode tentar de novo.
                        </p>
                        <Button
                            type="button"
                            onClick={() => void carregar()}
                            className="mt-6 w-full h-auto py-5 text-base font-semibold rounded-xl transition-opacity hover:opacity-90"
                            style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                        >
                            <RefreshCw className="w-4 h-4" aria-hidden />
                            Tentar de novo
                        </Button>
                    </section>
                )}

                {/* ─── O pedido ───────────────────────────────────────────── */}
                {token && !carregando && !erroDeCarga && pedidoUtilizavel && pedido && (
                    <>
                        {liberadoAgora ? (
                            <section aria-live="polite">
                                <div
                                    className="w-14 h-14 rounded-full flex items-center justify-center"
                                    style={{
                                        background: 'color-mix(in srgb, var(--laudo-conforme) 16%, transparent)',
                                        border: '1px solid var(--laudo-conforme)',
                                    }}
                                >
                                    <CheckCircle2
                                        className="w-7 h-7"
                                        style={{ color: 'var(--laudo-conforme)' }}
                                        aria-hidden
                                    />
                                </div>
                                <h1 className="t-titulo mt-5">Acesso liberado</h1>
                                <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {emailDoCliente ? (
                                        <>
                                            {rotuloDoPlano ? `O plano ${rotuloDoPlano} está` : 'O acesso está'}{' '}
                                            valendo para{' '}
                                            <span className="voz-evidencia break-all" style={{ color: 'var(--laudo-texto)' }}>
                                                {emailDoCliente}
                                            </span>
                                            . O cliente recebe o aviso por e-mail.
                                        </>
                                    ) : (
                                        <>
                                            {rotuloDoPlano ? `O plano ${rotuloDoPlano} foi liberado.` : 'O acesso foi liberado.'}{' '}
                                            O servidor não devolveu o e-mail do cliente nesta resposta —
                                            confira pelo identificador abaixo.
                                        </>
                                    )}
                                </p>
                                {pedido.jaConfirmado && (
                                    <p className="t-apoio mt-3">
                                        Este pedido já constava confirmado. A liberação não foi repetida e
                                        nenhum período extra de acesso foi somado.
                                    </p>
                                )}
                                {confirmadoEm && (
                                    <p className="t-apoio mt-3">
                                        Confirmado em <span className="voz-evidencia">{confirmadoEm}</span>.
                                    </p>
                                )}
                            </section>
                        ) : jaVeioConfirmado ? (
                            <section>
                                <p className="t-etiqueta">Confirmação de PIX</p>
                                <h1 className="t-titulo mt-3">Este pagamento já foi liberado</h1>
                                <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {confirmadoEm
                                        ? <>A liberação aconteceu em <span className="voz-evidencia">{confirmadoEm}</span>.</>
                                        : 'A liberação já tinha acontecido — o servidor não devolveu a data.'}
                                    {' '}Não há nada a fazer aqui: liberar de novo somaria dois períodos de
                                    acesso por um pagamento só.
                                </p>
                            </section>
                        ) : (
                            <section>
                                <p className="t-etiqueta">Confirmação de PIX</p>
                                <h1 className="t-titulo mt-3">Um cliente informou que pagou</h1>
                                <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    Confira os dados abaixo contra o extrato antes de liberar o acesso.
                                </p>
                            </section>
                        )}

                        {/* ─── O valor ────────────────────────────────────────
                            Primeira coisa que o dono procura no extrato. */}
                        <section className="cartao mt-8 p-6">
                            <p className="t-etiqueta">Valor informado</p>
                            {valorFormatado ? (
                                <p
                                    className="voz-evidencia mt-3 font-semibold leading-none"
                                    style={{ fontSize: 'clamp(2rem, 11vw, 3rem)', letterSpacing: '-0.02em' }}
                                >
                                    {valorFormatado}
                                </p>
                            ) : (
                                <p className="t-corpo mt-3" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    O servidor não devolveu o valor deste pedido. Sem ele não há como
                                    conferir contra o extrato — confira pelo identificador abaixo
                                    {typeof pedido.id === 'number' ? ` (pedido ${pedido.id})` : ''} antes de
                                    liberar.
                                </p>
                            )}
                            <p className="mt-3 text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                                {rotuloDoPlano
                                    ? `Plano ${rotuloDoPlano} · pagamento por PIX`
                                    : 'Pagamento por PIX — o servidor não devolveu o plano'}
                            </p>
                        </section>

                        {/* ─── O que confere com o extrato ───────────────────── */}
                        <section className="cartao mt-4 px-6 py-2">
                            <Campo
                                rotulo="Identificador (txid)"
                                valor={pedido.txid || null}
                                ausente="o servidor não devolveu o identificador"
                            />
                            <Campo
                                rotulo="E-mail do cliente"
                                valor={emailDoCliente}
                                ausente="o servidor não devolveu o e-mail"
                            />
                            <Campo
                                rotulo="Nome do cliente"
                                valor={nomeDoCliente}
                                ausente="esta conta não tem nome cadastrado"
                            />
                            <Campo
                                rotulo="Situação"
                                valor={situacao}
                                ausente={
                                    situacaoDesatualizada
                                        ? 'a resposta da liberação não trouxe a situação atualizada'
                                        : 'o servidor não devolveu a situação'
                                }
                            />
                            <Campo
                                rotulo="Cliente avisou em"
                                valor={avisadoEm}
                                ausente="sem registro do aviso"
                            />
                            {confirmado && (
                                <Campo
                                    rotulo="Liberado em"
                                    valor={confirmadoEm}
                                    ausente="o servidor não devolveu a data da liberação"
                                />
                            )}
                        </section>

                        {/* ─── O único controle que existe ───────────────────
                            Precisa estar dito na tela: não há verificação
                            automática contra o banco, e o clique abaixo libera
                            acesso pago. */}
                        {!confirmado && (
                            <>
                                <section
                                    className="mt-6 rounded-xl border p-4 flex gap-3"
                                    style={{
                                        borderColor: 'var(--laudo-alto)',
                                        background: 'color-mix(in srgb, var(--laudo-alto) 10%, transparent)',
                                    }}
                                >
                                    <AlertTriangle
                                        className="w-4 h-4 mt-0.5 shrink-0"
                                        style={{ color: 'var(--laudo-alto)' }}
                                        aria-hidden
                                    />
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold" style={{ color: 'var(--laudo-alto)' }}>
                                            Confira se o dinheiro entrou antes de liberar
                                        </p>
                                        <p className="t-apoio mt-1">
                                            Este sistema não fala com o banco. Nada nesta tela prova que o
                                            PIX caiu — o que está aqui foi informado pelo cliente. Sua
                                            conferência no extrato é o único controle que existe.
                                        </p>
                                    </div>
                                </section>

                                {erroDeConfirmacao && (
                                    <div
                                        role="alert"
                                        className="mt-4 rounded-xl border p-4 flex gap-3"
                                        style={{ borderColor: 'var(--laudo-critico)', background: 'var(--sup-1)' }}
                                    >
                                        <AlertTriangle
                                            className="w-4 h-4 mt-0.5 shrink-0"
                                            style={{ color: 'var(--laudo-critico)' }}
                                            aria-hidden
                                        />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium" style={{ color: 'var(--laudo-critico)' }}>
                                                O acesso não foi liberado
                                            </p>
                                            <p className="t-apoio mt-1 break-words">{erroDeConfirmacao}</p>
                                        </div>
                                    </div>
                                )}

                                <Button
                                    type="button"
                                    onClick={() => void confirmar()}
                                    disabled={confirmando}
                                    aria-busy={confirmando}
                                    className="mt-6 w-full h-auto min-h-[3.5rem] py-6 text-base font-semibold rounded-xl transition-opacity hover:opacity-90"
                                    style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                                >
                                    {confirmando ? (
                                        <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
                                    ) : (
                                        <ShieldCheck className="w-5 h-5" aria-hidden />
                                    )}
                                    {confirmando ? 'Liberando o acesso…' : 'Recebi — liberar o acesso'}
                                </Button>

                                <p className="t-apoio mt-3">
                                    O link vale uma vez só: depois da liberação ele deixa de funcionar.
                                </p>
                            </>
                        )}
                    </>
                )}

                {/* Resposta sem erro e sem pedido dentro. Buraco visível é melhor
                    que um botão de liberar acesso sobre campos em branco. */}
                {token && !carregando && !erroDeCarga && !pedidoUtilizavel && (
                    <section role="alert">
                        <p className="t-etiqueta">Confirmação de PIX</p>
                        <h1 className="t-titulo mt-3">O servidor respondeu sem o pedido</h1>
                        <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                            A consulta terminou sem erro, mas a resposta não trouxe os dados do
                            pagamento — nem o identificador. Sem eles não há o que conferir, e nada foi
                            liberado.
                        </p>
                        <Button
                            type="button"
                            onClick={() => void carregar()}
                            className="mt-6 w-full h-auto py-5 text-base font-semibold rounded-xl transition-opacity hover:opacity-90"
                            style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                        >
                            <RefreshCw className="w-4 h-4" aria-hidden />
                            Tentar de novo
                        </Button>
                    </section>
                )}
            </main>
        </div>
    );
};

export default ConfirmarPix;
