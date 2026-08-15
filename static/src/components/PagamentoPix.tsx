/**
 * Cobrança por PIX — chave direta, conferência manual.
 *
 * O dinheiro não passa por gateway: o cliente paga na chave do recebedor e
 * alguém confere que entrou (ver o docstring de `api/pix.py`). Isso muda o que
 * esta tela pode prometer. Ela mostra o código, deixa avisar que pagou e diz
 * que a conferência é humana — **não** anuncia liberação, porque avisar não
 * libera nada. Prometer prazo aqui seria escrever um contrato que o produto
 * não tem como cumprir.
 *
 * Todo dado exibido vem da resposta do servidor. Não há valor, chave nem
 * prazo escrito no código: preço tem uma fonte só, e um número plausível na
 * tela de pagamento é a forma mais cara de errar.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as QRCode from 'qrcode';
import {
    AlertCircle, Check, Clock, Copy, Loader2, QrCode as IconeQrCode,
    RefreshCw, ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, ApiClientError } from '@/lib/apiClient';
import { codigoVencido } from '@/lib/pix';
import { Button } from '@/components/ui/button';

/** O que `_publico()` de `api/pix.py` devolve, mais o que só sai na criação. */
interface PedidoPix {
    id: number;
    txid: string;
    plano: string;
    valor: number;
    /** `aguardando` | `avisado` | `expirado` | `confirmado`. Quem decide é o servidor. */
    status: string;
    criadoEm: string | null;
    expiraEm: string | null;
    avisadoEm: string | null;
    confirmadoEm: string | null;
    /** Só vêm em `POST /pedido` e `GET /meu-pedido`; `/avisei` não os devolve. */
    chave?: string | null;
    brcode?: string | null;
    minutos?: number;
}

interface Props {
    /* Sem valor padrão de propósito: `plano = 'premium'` fazia um chamador
       distraído emitir cobrança do plano mais caro sem ninguém ter escolhido —
       e o cliente só descobriria pelo valor no app do banco. */
    plano: string;
    onConfirmado?: () => void;
}

const MOEDA = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * De quanto em quanto tempo a tela pergunta se o pagamento já foi conferido.
 * Generoso de propósito: do outro lado há uma pessoa olhando o extrato, não um
 * gateway — a resposta muda em minutos ou horas, nunca em segundos.
 */
const INTERVALO_DA_VERIFICACAO_MS = 15_000;

/**
 * Teto do tempo total de verificação. A conferência é manual e pode demorar
 * mais que isto; o teto não existe para dizer que ela terminou, e sim para que
 * uma aba esquecida aberta a noite inteira não fique batendo na API para
 * sempre. Quando ele estoura, a tela **diz** que parou de olhar sozinha — o
 * cliente ainda recebe o e-mail da liberação.
 */
const TETO_DA_VERIFICACAO_MS = 30 * 60_000;

/** Nenhum destes estados é silencioso — cada um tem uma frase na tela. */
type SituacaoDaVerificacao = 'ok' | 'falhando' | 'encerrada' | 'sessao-perdida';

/**
 * Devolve `null` em vez de "R$ NaN". `Intl.format(undefined)` não estoura — ele
 * escreve NaN, e aqui isso apareceria como o valor a pagar, que é o lugar onde
 * um número errado custa mais caro. Campo ausente é dito, não preenchido.
 */
function comoDinheiro(valor: unknown): string | null {
    return typeof valor === 'number' && Number.isFinite(valor) ? MOEDA.format(valor) : null;
}

/**
 * `apiRequest` devolve `{}` quando a resposta é 200 sem `content-type` JSON — um
 * proxy mal configurado no meio do caminho basta. Sem `id` não há como avisar
 * que pagou, e sem `txid` o pagamento não tem como ser localizado no extrato:
 * objeto assim não é cobrança, é buraco, e precisa aparecer como buraco em vez
 * de virar uma tela de pagamento com valor vazio e nenhum código.
 */
function ehPedido(p: PedidoPix | null | undefined): p is PedidoPix {
    return Boolean(p && typeof p.id === 'number' && typeof p.txid === 'string' && p.txid);
}

/**
 * O backend serializa `datetime` naive já em UTC, então a string chega sem
 * sufixo de fuso — e `new Date("2026-08-13T02:40:00")` é lido pelo navegador
 * como hora **local**. No Brasil isso desloca três horas: o contador nasce
 * vencido ou com tempo demais, e nos dois casos a tela mente sobre o prazo.
 * O 'Z' só é acrescentado quando a string realmente não traz fuso, para não
 * estragar uma resposta que um dia passe a mandá-lo.
 */
function comoInstanteUtc(iso: string | null | undefined): Date | null {
    if (!iso) return null;
    const jaTemFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso);
    const data = new Date(jaTemFuso ? iso : `${iso}Z`);
    return Number.isNaN(data.getTime()) ? null : data;
}

/** Arredonda para cima: recém-criado o contador mostra 30:00, não 29:59. */
function comoRelogio(ms: number): string {
    const segundos = Math.max(0, Math.ceil(ms / 1000));
    const minutos = Math.floor(segundos / 60);
    return `${String(minutos).padStart(2, '0')}:${String(segundos % 60).padStart(2, '0')}`;
}

function comoRotuloDePlano(plano: string): string {
    if (!plano) return '';
    return plano.charAt(0).toUpperCase() + plano.slice(1);
}

/** Bloco de dado conferível com botão de copiar ao lado. */
function CampoCopiavel({
    rotulo, valor, foiCopiado, aoCopiar, longo,
}: {
    rotulo: string;
    valor: string;
    foiCopiado: boolean;
    aoCopiar: () => void;
    /** Teto de altura com rolagem própria — o BR Code tem ~150 caracteres. */
    longo?: boolean;
}) {
    return (
        <div>
            <p className="t-etiqueta">{rotulo}</p>
            <div
                className="mt-2 rounded-xl border flex items-stretch gap-2 overflow-hidden"
                style={{ background: 'var(--sup-2)', borderColor: 'var(--sup-borda)' }}
            >
                <p
                    className={`voz-evidencia flex-1 min-w-0 px-4 py-3 text-sm leading-relaxed break-all ${
                        longo ? 'max-h-28 overflow-y-auto' : ''
                    }`}
                >
                    {valor}
                </p>
                <button
                    type="button"
                    onClick={aoCopiar}
                    className="shrink-0 px-4 flex items-center gap-2 text-sm font-medium border-l transition-opacity hover:opacity-75"
                    style={{
                        borderColor: 'var(--sup-borda)',
                        color: foiCopiado ? 'var(--laudo-conforme)' : 'var(--laudo-carimbo)',
                    }}
                >
                    {foiCopiado
                        ? <Check className="w-4 h-4 shrink-0" aria-hidden />
                        : <Copy className="w-4 h-4 shrink-0" aria-hidden />}
                    <span className="hidden sm:inline">{foiCopiado ? 'Copiado' : 'Copiar'}</span>
                    <span className="sr-only">{foiCopiado ? `${rotulo} copiado` : `Copiar ${rotulo}`}</span>
                </button>
            </div>
        </div>
    );
}

/** Caixa de recado com moldura da gravidade indicada. */
function Recado({
    tom, titulo, children, icone: Icone, papel,
}: {
    tom: string;
    titulo: string;
    children?: React.ReactNode;
    icone: typeof AlertCircle;
    /** `alert` para falha: sem isso o leitor de tela não anuncia o erro que
        acabou de aparecer, e quem não enxerga a caixa continua esperando. */
    papel?: 'alert' | 'status';
}) {
    return (
        <div
            role={papel}
            className="rounded-xl border p-4 flex gap-3"
            style={{
                borderColor: tom,
                background: `color-mix(in srgb, ${tom} 10%, transparent)`,
            }}
        >
            <Icone className="w-4 h-4 mt-0.5 shrink-0" style={{ color: tom }} aria-hidden />
            <div className="min-w-0">
                <p className="text-sm font-medium" style={{ color: tom }}>{titulo}</p>
                {children && <div className="t-apoio mt-1 break-words">{children}</div>}
            </div>
        </div>
    );
}

const PagamentoPix = ({ plano, onConfirmado }: Props) => {
    const { token, isAuthenticated } = useAuth();

    const [pedido, setPedido] = useState<PedidoPix | null>(null);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [indisponivel, setIndisponivel] = useState(false);
    const [sessaoPerdida, setSessaoPerdida] = useState(false);

    const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
    const [qrFalhou, setQrFalhou] = useState(false);

    const [copiado, setCopiado] = useState<'chave' | 'brcode' | null>(null);
    const [erroDeCopia, setErroDeCopia] = useState<string | null>(null);

    const [avisando, setAvisando] = useState(false);
    const [erroDoAviso, setErroDoAviso] = useState<string | null>(null);

    /* Situação da verificação periódica. Vai para a tela em todos os casos que
       não são "ok": verificação que morre calada deixa o cliente olhando uma
       atualização que nunca vai chegar. */
    const [verificacao, setVerificacao] = useState<SituacaoDaVerificacao>('ok');

    /* Quem clicou "já fiz o PIX" por engano precisa do código de volta — sem
       isso a única saída seria recarregar a página. */
    const [reexibirCodigo, setReexibirCodigo] = useState(false);

    const [restanteMs, setRestanteMs] = useState<number | null>(null);

    /**
     * `origem` existe porque o mesmo código HTTP quer dizer coisas diferentes
     * conforme a rota: só a emissão checa a chave de recebimento, então só ela
     * pode concluir "PIX desligado" a partir de um 503. Um 503 vindo do aviso é
     * do caminho (proxy, deploy em curso) — anunciar ali "a chave não está
     * configurada" seria inventar o diagnóstico, e ainda apagaria da tela a
     * cobrança que o cliente talvez já tenha pago.
     */
    const traduzirFalha = useCallback(
        (e: unknown, padrao: string, origem: 'emissao' | 'aviso') => {
            const info = e instanceof ApiClientError ? e.info : null;
            if (info?.status === 503 && origem === 'emissao') {
                setIndisponivel(true);
                return null;
            }
            if (info?.status === 401 || info?.status === 403) {
                setSessaoPerdida(true);
                return null;
            }
            return info?.userMessage || (e instanceof Error ? e.message : padrao);
        },
        [],
    );

    /**
     * `forcarNovo` pula a consulta ao pedido em aberto — é o caminho do
     * "gerar outro código" depois que o prazo venceu.
     */
    const iniciar = useCallback(async (forcarNovo = false) => {
        if (!token) return;
        setCarregando(true);
        setErro(null);
        setErroDoAviso(null);
        setIndisponivel(false);
        setSessaoPerdida(false);
        setReexibirCodigo(false);
        setVerificacao('ok');

        try {
            if (!forcarNovo) {
                const resposta = await apiRequest<{ pedido: PedidoPix | null }>(
                    '/api/payments/pix/meu-pedido',
                    { token, context: 'pix/meu-pedido' },
                );
                const anterior = resposta?.pedido ?? null;
                /* Um pedido de OUTRO plano não serve: o valor e o código são de
                   outra compra, e pagar por ele daria acesso ao plano errado.
                   `/meu-pedido` devolve o mais recente, seja qual for o plano —
                   a comparação é aqui. */
                if (ehPedido(anterior) && anterior.plano === plano) {
                    /* Confirmado não vem com código, e não deve mesmo: a
                       cobrança está paga. Exigir `brcode` aqui mandava a tela
                       emitir uma cobrança nova para quem acabou de ser liberado
                       — segundo PIX pelo mesmo acesso. */
                    if (anterior.status === 'confirmado' || anterior.brcode) {
                        setPedido(anterior);
                        return;
                    }
                }
            }

            const novo = await apiRequest<PedidoPix>(
                '/api/payments/pix/pedido',
                { method: 'POST', token, body: { plan: plano }, context: 'pix/pedido' },
            );
            if (!ehPedido(novo)) {
                throw new Error(
                    'O servidor respondeu sem os dados da cobrança — falta o identificador '
                    + 'que liga o pagamento à sua conta. Nada foi cobrado.',
                );
            }
            setPedido(novo);
        } catch (e) {
            setPedido(null);
            setErro(traduzirFalha(e, 'Não foi possível abrir a cobrança por PIX.', 'emissao'));
        } finally {
            setCarregando(false);
        }
    }, [token, plano, traduzirFalha]);

    /* Uma vez por plano. O StrictMode do React monta o componente duas vezes em
       desenvolvimento, e dois POST simultâneos podem escapar do reaproveitamento
       do servidor e abrir duas cobranças para a mesma compra — daí a trava.
       Ela guarda o plano, e não um booleano: se o `plano` mudar com o componente
       montado, a trava por booleano manteria na tela o código da compra
       anterior, com o valor do outro plano. */
    const planoJaIniciado = useRef<string | null>(null);
    useEffect(() => {
        if (!token || planoJaIniciado.current === plano) return;
        planoJaIniciado.current = plano;
        void iniciar();
    }, [token, plano, iniciar]);

    const expiraEm = useMemo(() => comoInstanteUtc(pedido?.expiraEm), [pedido?.expiraEm]);

    useEffect(() => {
        if (!expiraEm) {
            setRestanteMs(null);
            return;
        }
        const quantoFalta = () => expiraEm.getTime() - Date.now();
        const inicial = quantoFalta();
        setRestanteMs(inicial);
        // Vencido não tem o que contar, e um timer de um segundo sobrevive a
        // aba esquecida aberta.
        if (inicial <= 0) return;
        const id = window.setInterval(() => {
            const restante = quantoFalta();
            setRestanteMs(restante);
            if (restante <= 0) window.clearInterval(id);
        }, 1000);
        return () => window.clearInterval(id);
    }, [expiraEm]);

    const brcode = pedido?.brcode ?? null;

    useEffect(() => {
        if (!brcode) {
            setQrDataUrl(null);
            setQrFalhou(false);
            return;
        }
        let cancelado = false;
        QRCode.toDataURL(brcode, {
            width: 260,
            margin: 2,
            /* Correção média: o BR Code é longo e um nível alto adensa tanto a
               matriz que a câmera do celular passa a errar mais do que corrige. */
            errorCorrectionLevel: 'M',
            /* Preto sobre branco fixo, sem token de tema: o app roda em modo
               escuro e um QR claro sobre fundo escuro inverte o contraste que o
               leitor do banco espera — ele simplesmente não lê. */
            color: { dark: '#000000', light: '#FFFFFF' },
        })
            .then((url) => {
                if (cancelado) return;
                setQrDataUrl(url);
                setQrFalhou(false);
            })
            .catch((e: unknown) => {
                if (cancelado) return;
                /* QR meio desenhado é pior que QR nenhum: o banco recusa e o
                   cliente acha que a cobrança está quebrada. Some o QR, fica o
                   copia-e-cola, e a tela diz o que aconteceu. */
                console.error('[PagamentoPix] falha ao gerar o QR Code:', e);
                setQrDataUrl(null);
                setQrFalhou(true);
            });
        return () => { cancelado = true; };
    }, [brcode]);

    useEffect(() => {
        if (!copiado) return;
        const id = window.setTimeout(() => setCopiado(null), 2500);
        return () => window.clearTimeout(id);
    }, [copiado]);

    /* ─── Verificação periódica enquanto o pagamento espera conferência ──────
       Quem libera é uma pessoa olhando o extrato, em outro momento e em outra
       tela. Sem perguntar de tempos em tempos, o cliente que avisou ficava em
       "aguardando" até desistir: a liberação acontecia e ele nunca via. */
    const pedidoId = pedido?.id ?? null;
    const esperandoConferencia = pedido?.status === 'avisado';

    useEffect(() => {
        if (!token || !esperandoConferencia || pedidoId === null) return;

        let vivo = true;
        /* Uma consulta pode estar em voo quando o intervalo para. Sem esta
           trava, a resposta atrasada reescrevia a situação para 'ok' e a tela
           voltava a prometer que confere sozinha — depois de ter parado. */
        let parado = false;
        let id = 0;
        const comecouEm = Date.now();
        setVerificacao('ok');

        const verificar = async () => {
            try {
                const resposta = await apiRequest<{ pedido: PedidoPix | null }>(
                    '/api/payments/pix/meu-pedido',
                    { token, context: 'pix/meu-pedido' },
                );
                if (!vivo || parado) return;
                setVerificacao('ok');

                const atual = resposta?.pedido ?? null;
                /* `null` aqui é "sem novidade", NUNCA "o pedido sumiu" — a rota
                   também devolve null quando o código venceu e a conferência
                   ainda não saiu. Apagar a cobrança da tela por causa disso
                   diria a quem já transferiu que o pagamento se perdeu. Pelo
                   mesmo motivo um pedido de outro `id` é ignorado: é de outra
                   compra e trocaria a tela debaixo do cliente. */
                if (!ehPedido(atual) || atual.id !== pedidoId) return;
                /* A resposta do pedido confirmado não traz `chave` nem
                   `brcode`; o espalhamento por cima preserva o que já estava. */
                setPedido((anterior) => ({ ...(anterior ?? atual), ...atual }));
            } catch (e) {
                if (!vivo || parado) return;
                console.error('[PagamentoPix] falha ao verificar a conferência:', e);
                const info = e instanceof ApiClientError ? e.info : null;
                if (info?.status === 401 || info?.status === 403) {
                    /* Sem sessão nenhuma tentativa vai funcionar — insistir por
                       meia hora seria bater na porta errada. A tela não é
                       trocada pelo aviso de sessão expirada de propósito: quem
                       está aqui já transferiu, e sumir com a cobrança da frente
                       dele para anunciar login é a pior hora possível. */
                    parado = true;
                    window.clearInterval(id);
                    setVerificacao('sessao-perdida');
                    return;
                }
                setVerificacao('falhando');
            }
        };

        id = window.setInterval(() => {
            if (Date.now() - comecouEm >= TETO_DA_VERIFICACAO_MS) {
                parado = true;
                window.clearInterval(id);
                setVerificacao('encerrada');
                return;
            }
            void verificar();
        }, INTERVALO_DA_VERIFICACAO_MS);

        /* Confirmar, trocar de pedido ou desmontar param o intervalo: timer
           solto continua batendo na API depois de a tela sumir. */
        return () => {
            vivo = false;
            parado = true;
            window.clearInterval(id);
        };
    }, [token, esperandoConferencia, pedidoId]);

    /* Dispara uma vez por pedido: o callback do pai pode ser recriado a cada
       render e não deve reabrir a mesma comemoração. */
    const confirmacaoAvisada = useRef<number | null>(null);
    useEffect(() => {
        if (!pedido || pedido.status !== 'confirmado') return;
        if (confirmacaoAvisada.current === pedido.id) return;
        confirmacaoAvisada.current = pedido.id;
        onConfirmado?.();
    }, [pedido, onConfirmado]);

    const copiar = async (texto: string, campo: 'chave' | 'brcode') => {
        setErroDeCopia(null);
        try {
            if (!navigator.clipboard?.writeText) {
                throw new Error('Este navegador não liberou a área de transferência.');
            }
            await navigator.clipboard.writeText(texto);
            setCopiado(campo);
        } catch (e) {
            console.error('[PagamentoPix] falha ao copiar:', e);
            setErroDeCopia(
                'Não foi possível copiar automaticamente. Selecione o texto acima e copie à mão.',
            );
        }
    };

    const avisarQuePagou = async () => {
        if (!pedido || !token || avisando) return;
        setAvisando(true);
        setErroDoAviso(null);
        try {
            const atualizado = await apiRequest<PedidoPix>(
                '/api/payments/pix/avisei',
                { method: 'POST', token, body: { pedidoId: pedido.id }, context: 'pix/avisei' },
            );
            /* Resposta sem pedido dentro mesclaria zero campos por cima do que
               já estava na tela: a situação continuaria "aguardando" e o cliente
               apertaria o botão de novo achando que nada foi enviado — quando o
               servidor pode ter registrado o aviso. Melhor dizer o que houve. */
            if (!ehPedido(atualizado)) {
                throw new Error('O servidor respondeu sem a situação do pedido.');
            }
            /* A resposta de `/avisei` não traz `chave` nem `brcode` — mesclar
               por cima do que já estava na tela evita o código sumir se o
               cliente quiser voltar a vê-lo. */
            setPedido((anterior) => ({ ...(anterior ?? pedido), ...atualizado }));
            setReexibirCodigo(false);
        } catch (e) {
            setErroDoAviso(traduzirFalha(e, 'Não foi possível registrar o aviso.', 'aviso'));
        } finally {
            setAvisando(false);
        }
    };

    // ── Estados que substituem a tela inteira ──────────────────────────────

    if (!isAuthenticated) {
        return (
            <Recado tom="var(--laudo-alto)" titulo="Entre na sua conta para pagar" icone={AlertCircle}>
                A cobrança por PIX é emitida no nome de quem vai receber o acesso, então
                ela precisa de uma sessão aberta.
            </Recado>
        );
    }

    /* Sessão aberta mas sem credencial: `iniciar` não teria o que enviar e
       devolvia cedo, deixando o esqueleto girando para sempre e o botão "tentar
       de novo" sem efeito nenhum. Buraco dito é melhor que tela travada. */
    if (!token) {
        return (
            <Recado
                tom="var(--laudo-alto)"
                titulo="Não foi possível ler a credencial da sua sessão"
                icone={AlertCircle}
                papel="alert"
            >
                Recarregue a página ou entre de novo para emitir a cobrança. Nada foi cobrado.
            </Recado>
        );
    }

    if (sessaoPerdida) {
        return (
            <Recado tom="var(--laudo-alto)" titulo="Sua sessão expirou" icone={AlertCircle} papel="alert">
                {/* A frase depende de já haver cobrança na tela: dizer "nenhuma
                    cobrança foi emitida" para quem acabou de pagar sugere que o
                    dinheiro sumiu — e é justamente no clique do aviso que a
                    sessão costuma cair, depois do PIX feito. */}
                {pedido
                    ? (
                        <>
                            Entre novamente e volte a esta tela. Se o PIX já saiu da sua conta, ele
                            não se perdeu — a cobrança{' '}
                            {pedido.txid ? <span className="voz-evidencia">{pedido.txid}</span> : 'emitida aqui'}{' '}
                            continua aberta e o aviso pode ser dado depois.
                        </>
                    )
                    : 'Entre novamente e volte a esta tela — nenhuma cobrança foi emitida.'}
            </Recado>
        );
    }

    if (indisponivel) {
        return (
            <Recado
                tom="var(--laudo-alto)"
                titulo="Pagamento por PIX indisponível no momento"
                icone={AlertCircle}
                papel="alert"
            >
                A chave de recebimento não está configurada, então não há para onde pagar.
                Use o cartão ou fale com o suporte.
            </Recado>
        );
    }

    if (carregando) {
        return (
            <section className="cartao p-6 sm:p-8" aria-busy>
                <p className="t-etiqueta">Pagamento por PIX</p>
                <div className="mt-4 space-y-3" aria-hidden>
                    <div className="h-10 w-56 max-w-full rounded animate-pulse" style={{ background: 'var(--sup-2)' }} />
                    <div className="h-48 w-48 rounded animate-pulse" style={{ background: 'var(--sup-2)' }} />
                    <div className="h-12 w-full rounded animate-pulse" style={{ background: 'var(--sup-2)' }} />
                </div>
                <span className="sr-only">Emitindo a cobrança por PIX</span>
            </section>
        );
    }

    if (erro || !pedido) {
        return (
            <div className="space-y-4">
                <Recado
                    tom="var(--laudo-critico)"
                    titulo="A cobrança não foi emitida"
                    icone={AlertCircle}
                    papel="alert"
                >
                    {erro ?? 'O servidor não devolveu o pedido de pagamento.'}
                </Recado>
                <Button
                    onClick={() => void iniciar(true)}
                    className="w-full h-auto py-4 rounded-xl font-semibold"
                    style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                >
                    <RefreshCw className="w-4 h-4" aria-hidden />
                    Tentar de novo
                </Button>
            </div>
        );
    }

    // ── Situação do pedido ─────────────────────────────────────────────────

    const confirmado = pedido.status === 'confirmado';
    const avisado = pedido.status === 'avisado';
    /* A regra mora em `lib/pix.ts` para poder ser exercitada sem React — é ela
       que decide se a tela ainda oferece um código pagável, e o porquê de cada
       caso está lá. */
    const expirado = codigoVencido(pedido.status, restanteMs);

    const mostrarCodigo = !confirmado && !expirado && (!avisado || reexibirCodigo);
    const valorFormatado = comoDinheiro(pedido.valor);
    const chave = pedido.chave ?? null;
    const rotuloDoPlano = comoRotuloDePlano(pedido.plano);

    if (confirmado) {
        return (
            /* `status`: esta tela pode aparecer sozinha, no meio da espera, sem
               nenhum clique — quem usa leitor de tela não tem como perceber a
               troca se ela não for anunciada. */
            <section className="cartao p-6 sm:p-8" role="status">
                <div className="flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 mt-0.5 shrink-0" style={{ color: 'var(--laudo-conforme)' }} aria-hidden />
                    <div className="min-w-0">
                        <p className="t-secao" style={{ color: 'var(--laudo-conforme)' }}>
                            Pagamento conferido — acesso liberado
                        </p>
                        <p className="t-apoio mt-2">
                            {rotuloDoPlano
                                ? `O plano ${rotuloDoPlano} já está ativo nesta conta.`
                                : 'O acesso já está ativo nesta conta.'}
                            {' '}Se a tela ainda mostrar o plano antigo, recarregue a página.
                        </p>
                        <dl className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 text-sm">
                            <div>
                                <dt className="t-etiqueta">Valor pago</dt>
                                <dd className="mt-1">
                                    {valorFormatado
                                        ? <span className="voz-evidencia">{valorFormatado}</span>
                                        : (
                                            <span className="italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                o servidor não devolveu o valor
                                            </span>
                                        )}
                                </dd>
                            </div>
                            <div>
                                <dt className="t-etiqueta">Identificador</dt>
                                <dd className="voz-evidencia mt-1 break-all">{pedido.txid}</dd>
                            </div>
                        </dl>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="cartao overflow-hidden">
            <div className="p-6 sm:p-8">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
                    <p className="t-etiqueta">Pagamento por PIX</p>
                    <p className="voz-evidencia text-xs break-all" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        {pedido.txid}
                    </p>
                </div>

                {/* O valor exibido é o que o servidor gravou no pedido — é ele
                    que está dentro do código copiado e do QR. Se não veio, o
                    lugar dele diz isso: o app do banco mostra o valor real antes
                    de confirmar, e um número inventado aqui só serviria para o
                    cliente conferir contra o errado. */}
                <p className="t-etiqueta mt-6">Valor a pagar</p>
                {valorFormatado ? (
                    <p
                        className="voz-evidencia mt-2 font-semibold leading-none"
                        style={{ fontSize: 'clamp(2rem, 8vw, 3.25rem)', letterSpacing: '-0.02em' }}
                    >
                        {valorFormatado}
                    </p>
                ) : (
                    <p className="t-corpo mt-2" style={{ color: 'var(--laudo-texto-suave)' }}>
                        O servidor não devolveu o valor desta cobrança. Ele está dentro do código
                        abaixo — confira no app do banco antes de confirmar.
                    </p>
                )}
                <p className="t-apoio mt-2">
                    {rotuloDoPlano ? `Plano ${rotuloDoPlano}. ` : ''}
                    Transferência única, direto na chave abaixo.
                </p>

                {/* ─── Prazo do código ─────────────────────────────────────────
                    Só enquanto o cliente ainda é quem tem algo a fazer. Depois
                    do aviso, quem está devendo passo é a conferência — e dizer
                    "este código expirou, gere outro para pagar" a quem acabou de
                    transferir empurra para o segundo PIX pelo mesmo acesso. O
                    prazo vale para o código, não para o pagamento já feito. */}
                {!avisado && (
                    <>
                        <div
                            className="mt-6 rounded-xl border px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1"
                            style={{
                                borderColor: expirado ? 'var(--laudo-alto)' : 'var(--sup-borda)',
                                background: expirado
                                    ? 'color-mix(in srgb, var(--laudo-alto) 10%, transparent)'
                                    : 'var(--sup-2)',
                            }}
                        >
                            <Clock
                                className="w-4 h-4 shrink-0"
                                style={{ color: expirado ? 'var(--laudo-alto)' : 'var(--laudo-texto-fraco)' }}
                                aria-hidden
                            />
                            {expirado ? (
                                <span className="text-sm font-medium" style={{ color: 'var(--laudo-alto)' }}>
                                    Este código expirou. Gere outro para pagar.
                                </span>
                            ) : (
                                <>
                                    <span className="text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        Código válido por
                                    </span>
                                    <span className="voz-evidencia text-lg font-semibold tabular-nums">
                                        {restanteMs === null ? '--:--' : comoRelogio(restanteMs)}
                                    </span>
                                </>
                            )}
                        </div>

                        {expirado && (
                            <Button
                                onClick={() => void iniciar(true)}
                                disabled={carregando}
                                className="mt-4 w-full h-auto py-4 rounded-xl font-semibold"
                                style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                            >
                                <RefreshCw className="w-4 h-4" aria-hidden />
                                Gerar um novo código
                            </Button>
                        )}
                    </>
                )}

                {/* ─── Aviso já registrado ─────────────────────────────────── */}
                {avisado && (
                    <div className="mt-6" role="status">
                        <Recado tom="var(--laudo-carimbo)" titulo="Aguardando a conferência do pagamento" icone={Clock}>
                            <p>
                                Recebemos seu aviso. A conferência é feita à mão, olhando o extrato da
                                conta que recebe — não é automática. Assim que o pagamento for
                                localizado, {rotuloDoPlano ? `o acesso ao plano ${rotuloDoPlano}` : 'o acesso'} é
                                liberado e você recebe um e-mail.
                            </p>
                            <p className="mt-2">
                                Guarde o identificador <span className="voz-evidencia">{pedido.txid}</span> — é
                                por ele que a cobrança é encontrada.
                            </p>
                            {/* O que a verificação automática está fazendo. Só
                                a primeira frase promete atualização sozinha —
                                nos outros casos ela parou, e dizer isso é o que
                                impede o cliente de esperar uma tela que não vai
                                mais mudar. */}
                            <p className="mt-2">
                                {verificacao === 'ok' && 'Esta tela confere sozinha de tempos em tempos: quando o pagamento for localizado, ela muda aqui mesmo, sem precisar recarregar.'}
                                {verificacao === 'falhando' && 'A conferência automática desta tela não conseguiu falar com o servidor agora — seguimos tentando. O e-mail da liberação não depende dela.'}
                                {verificacao === 'encerrada' && 'Esta tela parou de conferir sozinha depois de um tempo aberta. Recarregue a página para ver a situação atual — a liberação chega por e-mail de qualquer forma.'}
                                {verificacao === 'sessao-perdida' && 'Sua sessão expirou e esta tela parou de conferir sozinha. Entre de novo para acompanhar por aqui; o pagamento e a conferência seguem valendo.'}
                            </p>
                        </Recado>
                        {!reexibirCodigo && !expirado && (
                            <button
                                type="button"
                                onClick={() => setReexibirCodigo(true)}
                                className="mt-3 text-sm underline underline-offset-4"
                                style={{ color: 'var(--laudo-carimbo)' }}
                            >
                                Avisei sem querer — mostrar o código de novo
                            </button>
                        )}
                    </div>
                )}

                {/* ─── O código ────────────────────────────────────────────── */}
                {mostrarCodigo && (
                    <div className="mt-6 space-y-6">
                        {qrDataUrl && (
                            <div className="flex flex-col items-center">
                                {/* Moldura branca fixa: a margem clara faz parte do
                                    código, e sem ela o leitor perde a borda. */}
                                <div className="rounded-xl p-3" style={{ background: '#FFFFFF' }}>
                                    <img
                                        src={qrDataUrl}
                                        alt={
                                            valorFormatado
                                                ? `QR Code do PIX de ${valorFormatado}, identificador ${pedido.txid}`
                                                : `QR Code do PIX, identificador ${pedido.txid}`
                                        }
                                        className="block w-44 h-44 sm:w-52 sm:h-52"
                                    />
                                </div>
                                <p className="t-apoio mt-3 text-center">
                                    Abra o app do banco, escolha PIX e aponte para o código.
                                </p>
                            </div>
                        )}

                        {qrFalhou && brcode && (
                            <Recado tom="var(--laudo-medio)" titulo="O QR Code não pôde ser desenhado" icone={AlertCircle}>
                                Um QR incompleto seria recusado pelo banco, então ele foi omitido.
                                Use o copia e cola abaixo — ele carrega exatamente a mesma cobrança.
                            </Recado>
                        )}

                        {chave ? (
                            <CampoCopiavel
                                rotulo="Chave PIX"
                                valor={chave}
                                foiCopiado={copiado === 'chave'}
                                aoCopiar={() => void copiar(chave, 'chave')}
                            />
                        ) : (
                            <Recado tom="var(--laudo-alto)" titulo="A chave PIX não veio nesta resposta" icone={AlertCircle}>
                                Sem ela não há para onde transferir. Gere um novo código ou fale com o suporte.
                            </Recado>
                        )}

                        {brcode ? (
                            <CampoCopiavel
                                rotulo="PIX copia e cola"
                                valor={brcode}
                                foiCopiado={copiado === 'brcode'}
                                aoCopiar={() => void copiar(brcode, 'brcode')}
                                longo
                            />
                        ) : (
                            <Recado tom="var(--laudo-alto)" titulo="O código copia e cola não veio nesta resposta" icone={AlertCircle}>
                                {valorFormatado
                                    ? `Pague pela chave acima, informando o valor ${valorFormatado}, ou gere um novo código.`
                                    : 'Sem o código e sem o valor não há como montar a transferência aqui. '
                                      + 'Gere um novo código ou fale com o suporte.'}
                            </Recado>
                        )}

                        {erroDeCopia && (
                            <Recado tom="var(--laudo-medio)" titulo="Nada foi copiado" icone={AlertCircle} papel="alert">
                                {erroDeCopia}
                            </Recado>
                        )}
                    </div>
                )}

                {/* ─── Falha ao registrar o aviso ──────────────────────────── */}
                {erroDoAviso && (
                    <div className="mt-6">
                        <Recado
                            tom="var(--laudo-critico)"
                            titulo="O aviso não foi registrado"
                            icone={AlertCircle}
                            papel="alert"
                        >
                            {erroDoAviso} Se o PIX já saiu da sua conta, tente de novo — o pagamento
                            não se perde, ele só ainda não foi sinalizado para conferência.
                        </Recado>
                    </div>
                )}

                {/* ─── Avisar que pagou ────────────────────────────────────────
                    Continua disponível depois do prazo: quem pagou no minuto 29
                    tem um PIX real na conta do recebedor, e o servidor aceita
                    confirmar um pedido vencido. Recusar aqui obrigaria a pagar
                    duas vezes. */}
                {!avisado && (
                    <Button
                        onClick={() => void avisarQuePagou()}
                        disabled={avisando}
                        aria-busy={avisando}
                        className="mt-6 w-full h-auto py-5 text-base font-semibold rounded-xl transition-opacity hover:opacity-90"
                        style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                    >
                        {avisando
                            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                            : <IconeQrCode className="w-4 h-4" aria-hidden />}
                        {avisando ? 'Registrando o aviso…' : 'Já fiz o PIX'}
                    </Button>
                )}
            </div>

            {/* ─── O que acontece depois ───────────────────────────────────── */}
            <div
                className="border-t px-6 sm:px-8 py-5"
                style={{ background: 'var(--sup-2)', borderColor: 'var(--sup-borda)' }}
            >
                <p className="text-sm font-medium">Como a liberação acontece</p>
                <p className="t-apoio mt-1">
                    Avisar que pagou não libera o plano sozinho: alguém confere o recebimento
                    no extrato antes de liberar. O acesso sai assim que o pagamento for
                    conferido, e você recebe um e-mail quando isso acontecer.
                </p>
            </div>
        </section>
    );
};

export default PagamentoPix;
