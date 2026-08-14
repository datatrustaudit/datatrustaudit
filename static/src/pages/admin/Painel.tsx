/**
 * Painel administrativo: pedidos de PIX e troca manual de plano.
 *
 * Toda rota de `api/admin.py` responde **404** para quem não é admin, de
 * propósito — 403 confirmaria que o painel existe. Isso obriga o front a
 * traduzir 404 como "sem acesso" e não como "página não encontrada", que é a
 * leitura errada e manda o admin caçar um bug de rota que não existe.
 *
 * A guarda visual daqui não protege nada: quem protege é a dependência
 * `somente_admin` no backend. Ela existe só para não montar uma tela inteira
 * de erro para quem abriu o endereço sem ser admin.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/hooks/use-toast';
import { Loader2, RefreshCw, Search, ShieldAlert } from 'lucide-react';

// ── Formato da resposta (ver `api/admin.py`) ───────────────────────────────

interface ResumoDoPainel {
    usuarios: number;
    pagantes: number;
    pedidosAguardando: number;
    pixConfirmados: number;
    totalRecebidoPix: number;
}

type StatusDoPedido = 'aguardando' | 'avisado' | 'confirmado' | 'cancelado' | 'expirado';

interface ClienteDoPedido {
    /* Todos anuláveis: `_pedido_para_o_painel` devolve `None` em cada campo
       quando a conta do pedido não existe mais. */
    id: number | null;
    email: string | null;
    nome: string | null;
    plano: string | null;
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
    confirmadoPor: string | null;
    cliente: ClienteDoPedido | null;
}

interface RespostaDePedidos {
    pedidos: PedidoPix[];
    aguardandoConfirmacao: number;
}

interface UsuarioDoPainel {
    id: number;
    email: string;
    name: string | null;
    plan: string;
    scans_used: number;
    is_admin: boolean;
    subscription_status: string;
    effective_plan: string;
    scans_limit: number;
}

// ── Rede ───────────────────────────────────────────────────────────────────

class ErroDoPainel extends Error {
    status: number;

    constructor(mensagem: string, status: number) {
        super(mensagem);
        this.name = 'ErroDoPainel';
        this.status = status;
    }
}

/** Lê `detail` do corpo de erro do FastAPI sem supor a forma do que chegou. */
function detalheDoErro(corpo: unknown): string {
    if (corpo && typeof corpo === 'object' && 'detail' in corpo) {
        const detalhe = (corpo as { detail?: unknown }).detail;
        if (typeof detalhe === 'string') return detalhe;
    }
    return '';
}

/**
 * Uma chamada ao painel, com todo caminho de falha virando mensagem legível.
 *
 * O 404 tem duas origens diferentes aqui e confundi-las dá diagnóstico errado:
 * `somente_admin` devolve o detalhe genérico "Not found" para quem não é
 * admin, enquanto pedido/usuário inexistente devolve um detalhe específico.
 * Só o primeiro caso significa falta de acesso.
 */
async function chamarPainel<T>(
    caminho: string,
    token: string | null,
    init?: RequestInit,
): Promise<T> {
    if (!token) {
        throw new ErroDoPainel('Sua sessão expirou. Entre de novo para usar o painel.', 401);
    }

    let resposta: Response;
    try {
        resposta = await fetch(caminho, {
            ...init,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
                ...(init?.headers || {}),
            },
        });
    } catch (erro) {
        // A mensagem na tela é a legível; o motivo real (DNS, CORS, offline) só
        // existe no objeto original e some se ninguém o registrar.
        console.error('[painel] falha de rede em', caminho, erro);
        throw new ErroDoPainel(
            'Não foi possível falar com o servidor. Verifique a conexão e tente de novo.',
            0,
        );
    }

    /* O catch-all do SPA responde index.html com 200 para qualquer GET que não
       casou com uma rota. Sem conferir o content-type, esse HTML chegaria ao
       `json()` como erro de sintaxe solto — e o painel diria "erro inesperado"
       quando o problema real é o router não estar registrado. */
    const ehJson = (resposta.headers.get('content-type') || '').toLowerCase().includes('application/json');

    let corpo: unknown = null;
    if (ehJson) {
        try {
            corpo = await resposta.json();
        } catch (erro) {
            console.error('[painel] JSON inválido em', caminho, erro);
            throw new ErroDoPainel(
                'O servidor respondeu um JSON quebrado. Veja o log do backend.',
                resposta.status,
            );
        }
    }

    if (!resposta.ok) {
        const detalhe = detalheDoErro(corpo);
        if (resposta.status === 404 && (!detalhe || detalhe === 'Not found')) {
            throw new ErroDoPainel('Você não tem acesso a este painel.', 404);
        }
        if (resposta.status === 401 || resposta.status === 403) {
            throw new ErroDoPainel('Sua sessão expirou. Entre de novo para usar o painel.', resposta.status);
        }
        throw new ErroDoPainel(detalhe || `O servidor respondeu ${resposta.status}.`, resposta.status);
    }

    if (!ehJson) {
        throw new ErroDoPainel(
            'O endereço do painel respondeu HTML em vez de JSON — o router de admin pode não estar registrado no backend.',
            resposta.status,
        );
    }

    return corpo as T;
}

/**
 * Extrai uma lista da resposta, ou levanta erro visível.
 *
 * `Array.isArray(dados?.x) ? dados.x : []` é o padrão de falha mais caro deste
 * projeto: chave lida errado — contrato que mudou, corpo truncado, resposta de
 * outra rota — vira lista vazia, e a tela afirma "nenhum pedido de PIX
 * registrado até agora". Isso não é um campo em branco, é uma afirmação sobre o
 * caixa que ninguém mediu, e o admin fecha o painel achando que não há nada
 * para conferir. Chave ausente é dita, nunca preenchida com o vazio plausível.
 */
function listaDaResposta<T>(corpo: unknown, chave: string, oQueEra: string): T[] {
    const valor =
        corpo && typeof corpo === 'object'
            ? (corpo as Record<string, unknown>)[chave]
            : undefined;

    if (!Array.isArray(valor)) {
        throw new ErroDoPainel(
            `O servidor respondeu sem a lista de ${oQueEra} (campo "${chave}"). ` +
            'Nada foi exibido: resposta quebrada não pode passar por painel vazio.',
            200,
        );
    }
    return valor as T[];
}

// ── Apresentação ───────────────────────────────────────────────────────────

const FORMATO_BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Devolve `null` quando não há número — quem chama diz que faltou, em vez de
 *  exibir "R$ 0,00", que é uma afirmação sobre o caixa que ninguém mediu. */
const emReais = (valor: unknown): string | null =>
    typeof valor === 'number' && Number.isFinite(valor) ? FORMATO_BRL.format(valor) : null;

const emNumero = (valor: unknown): string | null =>
    typeof valor === 'number' && Number.isFinite(valor) ? valor.toLocaleString('pt-BR') : null;

/**
 * `new Date(null)` devolve 1º de janeiro de 1970 e `new Date(undefined)`
 * devolve "Invalid Date" — os dois viram texto na tela sem estourar. Ausência
 * de data é tratada antes de construir o Date.
 *
 * O 'Z' é obrigatório: `utcnow()` do backend é naive de propósito, então
 * `isoformat()` manda "2026-08-13T02:40:00" sem fuso, e o navegador lê string
 * assim como hora **local** — três horas de erro no Brasil. Numa conferência
 * de caixa isso troca a hora do pagamento e pode jogá-lo para o dia anterior.
 * Só acrescenta quando a string realmente não traz fuso, para não estragar uma
 * resposta que um dia passe a mandá-lo. Mesma regra de `PagamentoPix.tsx` e
 * `ConfirmarPix.tsx`.
 */
const emDataHora = (iso: string | null | undefined): string | null => {
    if (!iso) return null;
    const comFuso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso) ? iso : `${iso}Z`;
    const data = new Date(comFuso);
    return Number.isNaN(data.getTime())
        ? null
        : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const APARENCIA_DO_STATUS: Record<StatusDoPedido, { rotulo: string; cor: string }> = {
    aguardando: { rotulo: 'aguardando pagamento', cor: 'var(--laudo-baixo)' },
    avisado: { rotulo: 'cliente avisou que pagou', cor: 'var(--laudo-medio)' },
    confirmado: { rotulo: 'confirmado', cor: 'var(--laudo-conforme)' },
    cancelado: { rotulo: 'cancelado', cor: 'var(--laudo-texto-fraco)' },
    expirado: { rotulo: 'expirado', cor: 'var(--laudo-texto-fraco)' },
};

/* Indexar o mapa com uma string qualquer devolve `undefined` sem o compilador
   reclamar (`noImplicitAny` está desligado) — foi assim que um acesso a chave
   inexistente virou tela branca em produção. O `??` cobre status novo que o
   backend passe a devolver, e exibe o valor cru em vez de inventar rótulo. */
const aparenciaDoStatus = (status: string) =>
    APARENCIA_DO_STATUS[status as StatusDoPedido] ?? { rotulo: status, cor: 'var(--laudo-texto-fraco)' };

/** `VALID_PAID_PLANS` no backend é `{"pro", "premium"}`; `free` entra pelo
 *  caminho de rebaixamento. Omitir `pro` daqui deixaria o painel sem como
 *  mostrar o plano real de quem já está nele. */
const PLANOS_DISPONIVEIS = ['free', 'pro', 'premium'] as const;

const FILTROS_DE_STATUS: { valor: string; rotulo: string }[] = [
    { valor: '', rotulo: 'Todos' },
    { valor: 'avisado', rotulo: 'Aguardando confirmação' },
    { valor: 'aguardando', rotulo: 'Aguardando pagamento' },
    { valor: 'confirmado', rotulo: 'Confirmados' },
    { valor: 'cancelado', rotulo: 'Cancelados' },
    { valor: 'expirado', rotulo: 'Expirados' },
];

const nomeDoCliente = (cliente: ClienteDoPedido | null): string =>
    cliente?.email || cliente?.nome || 'conta removida';

// ── Página ─────────────────────────────────────────────────────────────────

const Painel = () => {
    const { user, token, isLoading } = useAuth();
    const ehAdmin = !!user?.is_admin;

    const [resumo, setResumo] = useState<ResumoDoPainel | null>(null);
    const [carregandoResumo, setCarregandoResumo] = useState(false);
    const [erroResumo, setErroResumo] = useState<string | null>(null);

    const [pedidos, setPedidos] = useState<PedidoPix[]>([]);
    const [filtroStatus, setFiltroStatus] = useState('');
    const [carregandoPedidos, setCarregandoPedidos] = useState(false);
    const [erroPedidos, setErroPedidos] = useState<string | null>(null);

    const [busca, setBusca] = useState('');
    const [termoBuscado, setTermoBuscado] = useState('');
    const [usuarios, setUsuarios] = useState<UsuarioDoPainel[]>([]);
    const [carregandoUsuarios, setCarregandoUsuarios] = useState(false);
    const [erroUsuarios, setErroUsuarios] = useState<string | null>(null);

    const [acaoEmCurso, setAcaoEmCurso] = useState<string | null>(null);
    const [confirmacaoPendente, setConfirmacaoPendente] = useState<string | null>(null);
    const relogioDaConfirmacao = useRef<number | null>(null);

    /* Trava síncrona das ações. `acaoEmCurso` é estado: entre o clique e o
       repintar com `disabled`, um segundo clique ainda encontra os botões
       ativos. E disparo repetido aqui não é inofensivo — `_ativar_plano` SOMA
       um novo período ao que resta, então duas chamadas concedem o dobro do
       acesso pago. O ref fecha antes de qualquer render. */
    const acaoTravada = useRef(false);

    /* Contadores de versão: uma ação dispara recarga enquanto uma busca antiga
       ainda está no ar, e a resposta atrasada sobrescreveria a lista nova. */
    const versaoDoResumo = useRef(0);
    const versaoDosPedidos = useRef(0);
    const versaoDosUsuarios = useRef(0);

    const avisarErro = useCallback((erro: unknown, titulo: string) => {
        const mensagem = erro instanceof Error ? erro.message : String(erro);
        toast({ title: titulo, description: mensagem, variant: 'destructive' });
    }, []);

    // ── Cargas ─────────────────────────────────────────────────────────────

    const carregarResumo = useCallback(async () => {
        const versao = ++versaoDoResumo.current;
        setCarregandoResumo(true);
        setErroResumo(null);
        try {
            const dados = await chamarPainel<ResumoDoPainel>('/api/admin/resumo', token);
            if (versao !== versaoDoResumo.current) return;
            setResumo(dados);
        } catch (erro) {
            if (versao !== versaoDoResumo.current) return;
            setErroResumo(erro instanceof Error ? erro.message : String(erro));
            setResumo(null);
        } finally {
            if (versao === versaoDoResumo.current) setCarregandoResumo(false);
        }
    }, [token]);

    const carregarPedidos = useCallback(async (status: string) => {
        const versao = ++versaoDosPedidos.current;
        setCarregandoPedidos(true);
        setErroPedidos(null);
        try {
            const consulta = new URLSearchParams({ limite: '100' });
            if (status) consulta.set('status', status);
            const dados = await chamarPainel<RespostaDePedidos>(
                `/api/admin/pedidos-pix?${consulta.toString()}`,
                token,
            );
            const lista = listaDaResposta<PedidoPix>(dados, 'pedidos', 'pedidos');
            if (versao !== versaoDosPedidos.current) return;
            // O backend já ordena por id decrescente; reordenar aqui só criaria
            // uma segunda regra de ordenação para divergir da primeira.
            setPedidos(lista);
        } catch (erro) {
            if (versao !== versaoDosPedidos.current) return;
            setErroPedidos(erro instanceof Error ? erro.message : String(erro));
            setPedidos([]);
        } finally {
            if (versao === versaoDosPedidos.current) setCarregandoPedidos(false);
        }
    }, [token]);

    const carregarUsuarios = useCallback(async (termo: string) => {
        const versao = ++versaoDosUsuarios.current;
        setCarregandoUsuarios(true);
        setErroUsuarios(null);
        try {
            const consulta = new URLSearchParams({ limite: '50' });
            if (termo.trim()) consulta.set('busca', termo.trim());
            const dados = await chamarPainel<{ usuarios: UsuarioDoPainel[] }>(
                `/api/admin/usuarios?${consulta.toString()}`,
                token,
            );
            const lista = listaDaResposta<UsuarioDoPainel>(dados, 'usuarios', 'contas');
            if (versao !== versaoDosUsuarios.current) return;
            setUsuarios(lista);
        } catch (erro) {
            if (versao !== versaoDosUsuarios.current) return;
            setErroUsuarios(erro instanceof Error ? erro.message : String(erro));
            setUsuarios([]);
        } finally {
            if (versao === versaoDosUsuarios.current) setCarregandoUsuarios(false);
        }
    }, [token]);

    /* Sem `!token` na guarda: admin logado cujo token não chegou renderizava as
       três seções vazias, sem carregar e sem dizer nada — um painel que parece
       responder "não há nada aqui". Deixando a carga acontecer, `chamarPainel`
       devolve o erro de sessão e a tela mostra o motivo. */
    useEffect(() => {
        if (!ehAdmin) return;
        carregarResumo();
        carregarUsuarios('');
    }, [ehAdmin, token, carregarResumo, carregarUsuarios]);

    useEffect(() => {
        if (!ehAdmin) return;
        carregarPedidos(filtroStatus);
    }, [ehAdmin, token, filtroStatus, carregarPedidos]);

    useEffect(() => () => {
        if (relogioDaConfirmacao.current) window.clearTimeout(relogioDaConfirmacao.current);
    }, []);

    // ── Confirmação em dois cliques ────────────────────────────────────────

    const pedirConfirmacao = useCallback((chave: string) => {
        setConfirmacaoPendente(chave);
        if (relogioDaConfirmacao.current) window.clearTimeout(relogioDaConfirmacao.current);
        /* A confirmação desarma sozinha: botão que fica armado indefinidamente
           vira armadilha para o clique seguinte, dado sem lembrar do primeiro. */
        relogioDaConfirmacao.current = window.setTimeout(() => setConfirmacaoPendente(null), 6000);
    }, []);

    const limparConfirmacao = useCallback(() => {
        if (relogioDaConfirmacao.current) window.clearTimeout(relogioDaConfirmacao.current);
        setConfirmacaoPendente(null);
    }, []);

    // ── Ações ──────────────────────────────────────────────────────────────

    /* Devolve `false` quando outra ação já está no ar — o clique é descartado
       sem aviso de propósito: o que está rodando aparece como spinner, e um
       toast de "aguarde" só somaria ruído a um clique repetido. */
    const iniciarAcao = useCallback((chave: string) => {
        if (acaoTravada.current) return false;
        acaoTravada.current = true;
        setAcaoEmCurso(chave);
        return true;
    }, []);

    const encerrarAcao = useCallback(() => {
        acaoTravada.current = false;
        setAcaoEmCurso(null);
    }, []);

    const confirmarPedido = async (pedido: PedidoPix) => {
        if (!iniciarAcao(`pedido:${pedido.id}`)) return;
        try {
            const resposta = await chamarPainel<{ jaConfirmado?: boolean; pedido: PedidoPix }>(
                `/api/admin/pedidos-pix/${pedido.id}/confirmar`,
                token,
                { method: 'POST' },
            );
            toast(
                resposta?.jaConfirmado
                    ? {
                        title: 'Este pedido já estava confirmado',
                        description: 'Nenhum período novo foi somado ao acesso do cliente.',
                    }
                    : {
                        title: 'Plano liberado',
                        description: `${nomeDoCliente(pedido.cliente)} está no plano ${pedido.plano}.`,
                    },
            );
            await Promise.all([carregarResumo(), carregarPedidos(filtroStatus), carregarUsuarios(termoBuscado)]);
        } catch (erro) {
            avisarErro(erro, 'Não foi possível confirmar o pedido.');
        } finally {
            encerrarAcao();
            limparConfirmacao();
        }
    };

    const cancelarPedido = async (pedido: PedidoPix) => {
        if (!iniciarAcao(`pedido:${pedido.id}`)) return;
        try {
            await chamarPainel(`/api/admin/pedidos-pix/${pedido.id}/cancelar`, token, { method: 'POST' });
            toast({
                title: 'Pedido cancelado',
                description: 'O acesso do cliente não foi alterado — cancelar cobrança não retira plano.',
            });
            await Promise.all([carregarResumo(), carregarPedidos(filtroStatus)]);
        } catch (erro) {
            // O 409 chega aqui com o texto do backend explicando que cancelar
            // cobrança não é retirar acesso. É a mensagem certa: mostrar como veio.
            avisarErro(erro, 'Não foi possível cancelar o pedido.');
        } finally {
            encerrarAcao();
            limparConfirmacao();
        }
    };

    const trocarPlano = async (usuario: UsuarioDoPainel, plano: string) => {
        if (!iniciarAcao(`usuario:${usuario.id}`)) return;
        try {
            const resposta = await chamarPainel<{ usuario?: UsuarioDoPainel }>(
                `/api/admin/usuarios/${usuario.id}/plano`,
                token,
                { method: 'POST', body: JSON.stringify({ plano }) },
            );
            /* O aviso conta o que o servidor devolveu, não o que foi pedido:
               `plano` aqui é o botão que o admin apertou, e anunciá-lo como
               resultado transformaria uma troca que não pegou em confirmação. */
            const emVigor = resposta?.usuario?.effective_plan || resposta?.usuario?.plan;
            toast({
                title: 'Plano alterado',
                description: emVigor
                    ? `${usuario.email} agora está no plano ${emVigor}.`
                    : `${usuario.email}: o servidor aceitou a troca mas não devolveu o plano em vigor — confira na lista abaixo.`,
            });
            await Promise.all([carregarResumo(), carregarUsuarios(termoBuscado)]);
        } catch (erro) {
            avisarErro(erro, 'Não foi possível trocar o plano.');
        } finally {
            encerrarAcao();
            limparConfirmacao();
        }
    };

    // ── Guardas de renderização ────────────────────────────────────────────

    if (isLoading) {
        return (
            <div className="min-h-screen" style={{ background: 'var(--sup-0)' }}>
                <AppHeader />
                <main className="container mx-auto flex items-center gap-3 px-4 py-16"
                    style={{ color: 'var(--laudo-texto-suave)' }}>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verificando acesso…
                </main>
            </div>
        );
    }

    /* Sem sessão e sem permissão são diagnósticos diferentes. Mandar o admin
       deslogado "pedir para habilitarem a conta" o põe atrás de um problema que
       não existe, quando bastava entrar. */
    if (!user) {
        return (
            <AvisoDeAcesso titulo="Entre para abrir o painel">
                <p className="t-corpo" style={{ color: 'var(--laudo-texto-suave)' }}>
                    Esta tela precisa de uma sessão ativa.
                </p>
                <Link
                    to="/auth"
                    className="t-corpo inline-block mt-3 underline underline-offset-4"
                    style={{ color: 'var(--laudo-carimbo)' }}
                >
                    Entrar na minha conta
                </Link>
            </AvisoDeAcesso>
        );
    }

    if (!ehAdmin) {
        return (
            <AvisoDeAcesso titulo="Você não tem acesso a este painel">
                <p className="t-corpo" style={{ color: 'var(--laudo-texto-suave)' }}>
                    Ele é restrito à administração do produto. Se você deveria ter acesso,
                    peça para habilitarem sua conta.
                </p>
            </AvisoDeAcesso>
        );
    }

    const recarregarTudo = () => {
        carregarResumo();
        carregarPedidos(filtroStatus);
        carregarUsuarios(termoBuscado);
    };

    const ocupado = acaoEmCurso !== null;

    return (
        <div className="min-h-screen" style={{ background: 'var(--sup-0)' }}>
            <AppHeader />
            <main className="container mx-auto max-w-[72rem] px-4 py-10 space-y-6">
                <header className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <h1 className="t-titulo" style={{ color: 'var(--laudo-texto)' }}>
                            Painel administrativo
                        </h1>
                        <p className="t-apoio mt-1" style={{ maxWidth: '64ch' }}>
                            Pedidos de PIX aguardando conferência e troca manual de plano.
                        </p>
                    </div>
                    <Button variant="outline" onClick={recarregarTudo} disabled={ocupado}>
                        <RefreshCw
                            className={`h-4 w-4 mr-2 ${
                                carregandoResumo || carregandoPedidos || carregandoUsuarios ? 'animate-spin' : ''
                            }`}
                        />
                        Recarregar
                    </Button>
                </header>

                {/* ── Resumo ─────────────────────────────────────────────── */}
                <section className="cartao p-5">
                    <h2 className="t-etiqueta mb-4">Resumo</h2>

                    {erroResumo ? (
                        <FaixaDeErro mensagem={erroResumo} aoTentarDeNovo={carregarResumo} />
                    ) : carregandoResumo && !resumo ? (
                        <p className="t-apoio flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Carregando os números…
                        </p>
                    ) : resumo ? (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                            <Numero rotulo="Contas" valor={emNumero(resumo.usuarios)} />
                            <Numero rotulo="Pagantes" valor={emNumero(resumo.pagantes)} />
                            <Numero
                                rotulo="Aguardando confirmação"
                                valor={emNumero(resumo.pedidosAguardando)}
                                destacado={typeof resumo.pedidosAguardando === 'number' && resumo.pedidosAguardando > 0}
                                nota={
                                    typeof resumo.pedidosAguardando === 'number' && resumo.pedidosAguardando > 0
                                        ? 'exige ação'
                                        : undefined
                                }
                            />
                            <Numero rotulo="PIX confirmados" valor={emNumero(resumo.pixConfirmados)} />
                            <Numero rotulo="Recebido por PIX" valor={emReais(resumo.totalRecebidoPix)} />
                        </div>
                    ) : null}
                </section>

                {/* ── Pedidos PIX ────────────────────────────────────────── */}
                <section className="cartao p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                        <h2 className="t-etiqueta">Pedidos PIX</h2>
                        <label className="flex items-center gap-2 t-apoio">
                            Status
                            <select
                                value={filtroStatus}
                                onChange={(e) => setFiltroStatus(e.target.value)}
                                className="rounded-md border px-2 py-1.5 text-sm"
                                style={{
                                    background: 'var(--sup-2)',
                                    borderColor: 'var(--sup-borda)',
                                    color: 'var(--laudo-texto)',
                                }}
                            >
                                {FILTROS_DE_STATUS.map((f) => (
                                    <option key={f.valor || 'todos'} value={f.valor}>{f.rotulo}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {erroPedidos ? (
                        <FaixaDeErro mensagem={erroPedidos} aoTentarDeNovo={() => carregarPedidos(filtroStatus)} />
                    ) : carregandoPedidos && pedidos.length === 0 ? (
                        <p className="t-apoio flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Carregando os pedidos…
                        </p>
                    ) : pedidos.length === 0 ? (
                        <p className="t-apoio">
                            {filtroStatus
                                ? 'Nenhum pedido com este status.'
                                : 'Nenhum pedido de PIX registrado até agora.'}
                        </p>
                    ) : (
                        <ul className="space-y-3">
                            {pedidos.map((pedido) => {
                                const aparencia = aparenciaDoStatus(pedido.status);
                                const confirmado = pedido.status === 'confirmado';
                                const podeCancelar = pedido.status === 'aguardando' || pedido.status === 'avisado';
                                const chaveConfirmar = `confirmar:${pedido.id}`;
                                const chaveCancelar = `cancelar:${pedido.id}`;
                                const rodando = acaoEmCurso === `pedido:${pedido.id}`;
                                const valor = emReais(pedido.valor);
                                const avisadoEm = emDataHora(pedido.avisadoEm);
                                const criadoEm = emDataHora(pedido.criadoEm);
                                const confirmadoEm = emDataHora(pedido.confirmadoEm);

                                return (
                                    <li
                                        key={pedido.id}
                                        className="rounded-lg border p-4"
                                        style={{
                                            borderColor: 'var(--sup-borda)',
                                            background: 'var(--sup-2)',
                                            borderLeft: `3px solid ${aparencia.cor}`,
                                        }}
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="t-corpo font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                                    {nomeDoCliente(pedido.cliente)}
                                                </p>
                                                {pedido.cliente?.email && pedido.cliente?.nome && (
                                                    <p className="t-apoio">{pedido.cliente.nome}</p>
                                                )}
                                                <p className="voz-evidencia text-xs mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                    {pedido.txid}
                                                </p>
                                            </div>

                                            <div className="text-right shrink-0">
                                                <p className="voz-evidencia text-base font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                                    {valor ?? 'valor não registrado'}
                                                </p>
                                                <p className="t-apoio">plano {pedido.plano}</p>
                                                <span
                                                    className="inline-block mt-1 rounded px-2 py-0.5 text-[11px] font-medium"
                                                    style={{
                                                        color: aparencia.cor,
                                                        background: `color-mix(in srgb, ${aparencia.cor} 14%, transparent)`,
                                                    }}
                                                >
                                                    {aparencia.rotulo}
                                                </span>
                                            </div>
                                        </div>

                                        <dl className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2 text-xs"
                                            style={{ color: 'var(--laudo-texto-suave)' }}>
                                            <Linha rotulo="Criado" valor={criadoEm} ausente="não registrado" />
                                            <Linha
                                                rotulo="Cliente avisou"
                                                valor={avisadoEm}
                                                ausente={pedido.avisadoEm ? 'data ilegível' : 'ainda não avisou'}
                                            />
                                            {confirmado && (
                                                <>
                                                    <Linha rotulo="Confirmado" valor={confirmadoEm} ausente="não registrado" />
                                                    {/* Quem liberou o acesso: numa conferência de caixa é a
                                                        única coluna que responde a pergunta que importa. */}
                                                    <Linha
                                                        rotulo="Liberado por"
                                                        valor={pedido.confirmadoPor}
                                                        ausente="não registrado"
                                                        evidencia
                                                    />
                                                </>
                                            )}
                                        </dl>

                                        {!confirmado && (
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                <Button
                                                    size="sm"
                                                    disabled={ocupado}
                                                    onClick={() =>
                                                        confirmacaoPendente === chaveConfirmar
                                                            ? confirmarPedido(pedido)
                                                            : pedirConfirmacao(chaveConfirmar)
                                                    }
                                                >
                                                    {rodando && <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />}
                                                    {confirmacaoPendente === chaveConfirmar
                                                        ? 'Clique de novo para liberar o plano'
                                                        : 'Confirmar'}
                                                </Button>

                                                {podeCancelar && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        disabled={ocupado}
                                                        onClick={() =>
                                                            confirmacaoPendente === chaveCancelar
                                                                ? cancelarPedido(pedido)
                                                                : pedirConfirmacao(chaveCancelar)
                                                        }
                                                    >
                                                        {confirmacaoPendente === chaveCancelar
                                                            ? 'Clique de novo para cancelar'
                                                            : 'Cancelar'}
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>

                {/* ── Usuários ───────────────────────────────────────────── */}
                <section className="cartao p-5">
                    <h2 className="t-etiqueta mb-4">Contas</h2>

                    <form
                        className="flex gap-2 mb-4"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setTermoBuscado(busca);
                            carregarUsuarios(busca);
                        }}
                    >
                        <Input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar por e-mail"
                            aria-label="Buscar conta por e-mail"
                        />
                        <Button type="submit" variant="outline" disabled={carregandoUsuarios}>
                            <Search className="h-4 w-4 mr-2" />
                            Buscar
                        </Button>
                    </form>

                    {erroUsuarios ? (
                        <FaixaDeErro mensagem={erroUsuarios} aoTentarDeNovo={() => carregarUsuarios(termoBuscado)} />
                    ) : carregandoUsuarios && usuarios.length === 0 ? (
                        <p className="t-apoio flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Carregando as contas…
                        </p>
                    ) : usuarios.length === 0 ? (
                        <p className="t-apoio">
                            {termoBuscado
                                ? `Nenhuma conta com e-mail contendo "${termoBuscado}".`
                                : 'Nenhuma conta cadastrada.'}
                        </p>
                    ) : (
                        <ul className="space-y-2">
                            {usuarios.map((usuario) => {
                                const rodando = acaoEmCurso === `usuario:${usuario.id}`;
                                const limite = usuario.scans_limit === -1
                                    ? 'ilimitado'
                                    : emNumero(usuario.scans_limit) ?? 'não informado';

                                return (
                                    <li
                                        key={usuario.id}
                                        className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-4"
                                        style={{ borderColor: 'var(--sup-borda)', background: 'var(--sup-2)' }}
                                    >
                                        <div className="min-w-0">
                                            <p className="t-corpo font-medium flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                                                {usuario.email}
                                                {usuario.is_admin && (
                                                    <span
                                                        className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                                                        style={{
                                                            color: 'var(--laudo-carimbo)',
                                                            background: 'color-mix(in srgb, var(--laudo-carimbo) 14%, transparent)',
                                                        }}
                                                    >
                                                        admin
                                                    </span>
                                                )}
                                            </p>
                                            <p className="t-apoio">
                                                {usuario.name || 'sem nome cadastrado'} · plano {usuario.plan}
                                                {/* Os dois campos descrevem a mesma coisa e divergem quando o
                                                    espelho fica defasado. Esconder a diferença esconderia o bug. */}
                                                {usuario.effective_plan !== usuario.plan &&
                                                    ` (em vigor: ${usuario.effective_plan})`}
                                                {' · '}
                                                {emNumero(usuario.scans_used) ?? '?'}/{limite} varreduras na semana
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {rodando && <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--laudo-texto-fraco)' }} />}
                                            {PLANOS_DISPONIVEIS.map((plano) => {
                                                const atual = usuario.plan === plano;
                                                const chave = `plano:${usuario.id}:${plano}`;
                                                const armado = confirmacaoPendente === chave;
                                                return (
                                                    <Button
                                                        key={plano}
                                                        size="sm"
                                                        variant={atual ? 'secondary' : 'outline'}
                                                        disabled={atual || ocupado}
                                                        /* O que a ação faz de fato, segundo `_ativar_plano`:
                                                           plano pago SOMA um período novo ao que ainda resta,
                                                           e `free` encerra a assinatura sem apagar o histórico. */
                                                        title={
                                                            atual
                                                                ? 'Plano atual'
                                                                : plano === 'free'
                                                                    ? 'Rebaixar para free: encerra a assinatura, sem apagar o histórico'
                                                                    : `Trocar para ${plano}: concede um novo período de acesso`
                                                        }
                                                        onClick={() =>
                                                            armado ? trocarPlano(usuario, plano) : pedirConfirmacao(chave)
                                                        }
                                                        style={armado ? { borderColor: 'var(--laudo-alto)', color: 'var(--laudo-alto)' } : undefined}
                                                    >
                                                        {armado ? `Confirmar ${plano}?` : plano}
                                                    </Button>
                                                );
                                            })}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </section>
            </main>
        </div>
    );
};

// ── Peças de apoio ─────────────────────────────────────────────────────────

const AvisoDeAcesso = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
    <div className="min-h-screen" style={{ background: 'var(--sup-0)' }}>
        <AppHeader />
        <main className="container mx-auto max-w-[72rem] px-4 py-16">
            <div className="cartao p-6 flex items-start gap-3" style={{ maxWidth: '52ch' }}>
                <ShieldAlert className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }} />
                <div>
                    <h1 className="t-secao mb-1" style={{ color: 'var(--laudo-texto)' }}>{titulo}</h1>
                    {children}
                </div>
            </div>
        </main>
    </div>
);

const Numero = ({
    rotulo,
    valor,
    destacado,
    nota,
}: {
    rotulo: string;
    valor: string | null;
    destacado?: boolean;
    nota?: string;
}) => (
    <div
        className="rounded-lg border p-3"
        style={{
            borderColor: destacado ? 'var(--laudo-medio)' : 'var(--sup-borda)',
            background: destacado
                ? 'color-mix(in srgb, var(--laudo-medio) 12%, transparent)'
                : 'var(--sup-2)',
        }}
    >
        <p className="t-etiqueta">{rotulo}</p>
        <p
            className="voz-evidencia text-2xl font-semibold mt-1"
            style={{ color: destacado ? 'var(--laudo-medio)' : 'var(--laudo-texto)' }}
            title={valor === null ? 'O servidor não enviou este número.' : undefined}
        >
            {valor ?? '—'}
        </p>
        {nota && <p className="t-apoio text-[11px]" style={{ color: 'var(--laudo-medio)' }}>{nota}</p>}
    </div>
);

/** Campo ausente é dito, nunca preenchido com um valor plausível. */
const Linha = ({
    rotulo,
    valor,
    ausente,
    evidencia,
}: {
    rotulo: string;
    valor: string | null;
    ausente: string;
    evidencia?: boolean;
}) => (
    <div className="flex gap-2">
        <dt style={{ color: 'var(--laudo-texto-fraco)' }}>{rotulo}:</dt>
        <dd className={evidencia ? 'voz-evidencia' : undefined}
            style={{ color: valor ? 'var(--laudo-texto-suave)' : 'var(--laudo-texto-fraco)' }}>
            {valor ?? ausente}
        </dd>
    </div>
);

const FaixaDeErro = ({ mensagem, aoTentarDeNovo }: { mensagem: string; aoTentarDeNovo: () => void }) => (
    <div
        className="rounded-lg border p-4 flex flex-wrap items-center justify-between gap-3"
        style={{
            borderColor: 'var(--laudo-critico)',
            background: 'color-mix(in srgb, var(--laudo-critico) 10%, transparent)',
        }}
    >
        <p className="t-corpo" style={{ color: 'var(--laudo-texto)' }}>{mensagem}</p>
        <Button size="sm" variant="outline" onClick={aoTentarDeNovo}>Tentar de novo</Button>
    </div>
);

export default Painel;
