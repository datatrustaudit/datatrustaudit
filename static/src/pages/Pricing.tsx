/**
 * Planos — a tela onde se compra o laudo completo.
 *
 * Ela ainda vendia um produto que não existe mais:
 *
 *   · três planos lado a lado. O Pro saiu de venda — continua no código porque
 *     quem assinou antes mantém o acesso, mas não pode aparecer como opção de
 *     compra, senão alguém compra um plano que ninguém mais entrega;
 *   · "Assinar", "/mês" e "cancele quando quiser" descreviam mensalidade. A
 *     cobrança é avulsa, e isso era justamente o argumento que o concorrente
 *     não tem — estava escondido numa nota de 12px no rodapé do cabeçalho;
 *   · a comparação listava recurso de plano descontinuado em três colunas.
 *
 * Preço tem uma fonte só: GET /api/payments/plans, via `usePricing`. A
 * formatação é a mesma do checkout (Intl pt-BR/BRL, dois dígitos) porque um
 * centavo de diferença entre o que a página anuncia e o que a cobrança debita
 * vira contestação. O `formatPrice` do LocaleContext não serve aqui: ele trata
 * o número como dólar e converte pela taxa — os R$ 247 que o servidor devolve
 * viravam "R$ 1.445" na tela enquanto o checkout cobrava 247. É o mesmo defeito
 * que já fez a tela mostrar R$ 49,90 e o checkout cobrar R$ 97.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { usePlan, PlanType, PLAN_CONFIGS } from '@/context/PlanContext';
import { usePricing, type FormaDePagamento } from '@/hooks/usePricing';
import AppHeader from '@/components/AppHeader';
import { Button } from '@/components/ui/button';
import { ArrowRight, Check, Minus } from 'lucide-react';

/* Os limites saem de onde o app decide o corte de verdade (PLAN_CONFIGS, que
   espelha WEEKLY_SCAN_LIMITS do backend). Número escrito à mão aqui é número
   que envelhece sem ninguém perceber. */
const LIMITE_GRATUITO = PLAN_CONFIGS.free.limits;
const LIMITE_PREMIUM = PLAN_CONFIGS.premium.limits;

/* O que cada plano entrega, na ordem em que interessa a quem lê. As mesmas
   frases aparecem no corte do laudo (`components/laudo/Veredito.tsx`): a
   promessa da página de preço e a do produto precisam ser a mesma. */
const ENTREGA_GRATUITA = [
    'O veredito do site em uma frase',
    'Quantas não conformidades existem, e a gravidade de cada uma',
    'O artigo da LGPD que o site contraria',
    `${LIMITE_GRATUITO.scansPerWeek} varreduras por semana`,
    `Chat com a IA, ${LIMITE_GRATUITO.aiChatMessagesPerDay} perguntas por dia`,
];

const ENTREGA_PREMIUM = [
    'Cada achado com a tag responsável e a linha no código',
    'Os cookies e as chaves de storage gravados antes do aceite, um a um',
    'O passo a passo da correção, com o código pronto',
    'A versão para o jurídico, com base legal e cadeia de evidência',
    'Exportação em PDF, Excel e JSON',
    'Histórico e comparação entre varreduras',
    `${LIMITE_PREMIUM.scansPerWeek} varreduras por semana`,
];

/* Duas colunas, e só o que o produto entrega hoje. Saíram as linhas do modelo
   antigo: a coluna do Pro, "dashboard básico/detalhado" (que não descrevia
   nada que o usuário reconheça na tela) e "suporte prioritário", que não tem
   contrapartida implementada — prometer atendimento diferente sem fila
   diferente é o mesmo alarme falso que a identidade proíbe nos achados. */
const COMPARE_ROWS: { recurso: string; gratuito: boolean | string; premium: boolean | string }[] = [
    {
        recurso: 'Varreduras por semana',
        gratuito: String(LIMITE_GRATUITO.scansPerWeek),
        premium: String(LIMITE_PREMIUM.scansPerWeek),
    },
    { recurso: 'Veredito e contagem de não conformidades', gratuito: true, premium: true },
    { recurso: 'Gravidade de cada achado', gratuito: true, premium: true },
    { recurso: 'Artigo da LGPD contrariado', gratuito: true, premium: true },
    { recurso: 'Tag responsável por cada achado', gratuito: false, premium: true },
    { recurso: 'Linha exata no código-fonte', gratuito: false, premium: true },
    { recurso: 'Cookies e storage gravados antes do aceite', gratuito: false, premium: true },
    { recurso: 'Passo a passo da correção', gratuito: false, premium: true },
    { recurso: 'Versão para o jurídico', gratuito: false, premium: true },
    { recurso: 'Exportação em PDF, Excel e JSON', gratuito: false, premium: true },
    { recurso: 'Histórico e comparação entre varreduras', gratuito: false, premium: true },
    { recurso: 'Leitura em tempo real', gratuito: false, premium: true },
    { recurso: 'Varredura profunda, várias páginas', gratuito: false, premium: true },
    {
        recurso: 'Chat com a IA',
        gratuito: `${LIMITE_GRATUITO.aiChatMessagesPerDay} por dia`,
        premium: 'Sem limite',
    },
];

/* O mesmo formatador do checkout. Ver o cabeçalho do arquivo: converter aqui
   com outra régua foi o que fez a página anunciar um valor e a cobrança
   debitar outro. */
const formatarBRL = (valor: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

const PricingPage = () => {
    const { isAuthenticated } = useAuth();
    const { plan: currentPlan, selectPlan } = usePlan();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [showCompare, setShowCompare] = useState(false);
    const [planoDestacado, setPlanoDestacado] = useState<string | null>(null);
    const [clickedPlan, setClickedPlan] = useState<string | null>(null);

    /* Forma de pagamento no lugar do ciclo de cobrança: a compra é avulsa, e o
       que muda o valor é o método. */
    const [formaDePagamento, setFormaDePagamento] = useState<FormaDePagamento>('pix');
    const { pricing: precos } = usePricing();
    const descontoPix = precos?.pixDiscountPct ?? 5;
    const diasDeAcesso = precos?.accessDays ?? 365;

    useEffect(() => {
        const planParam = searchParams.get('plan');
        if (planParam && ['free', 'pro', 'premium'].includes(planParam)) {
            setPlanoDestacado(planParam);
        }
    }, [searchParams]);

    const handleSelect = (planId: string) => {
        setClickedPlan(planId);
        selectPlan(planId as PlanType);

        if (planId === 'free') { navigate('/'); return; }

        // A forma escolhida viaja para o checkout: é ela que define o valor.
        const dest = `/checkout?plan=${planId}&method=${formaDePagamento}`;

        if (!isAuthenticated) {
            localStorage.setItem('gtm-redirect-after-auth', dest);
            navigate('/auth');
            return;
        }

        navigate(dest);
    };

    /* O preço vem do backend, que é quem monta a cobrança. Enquanto a resposta
       não chega, o lugar do valor fica com um travessão: exibir a tabela local
       de reserva mostraria R$ 149,90 por um laudo de R$ 247 — divergência é o
       defeito que essa tela já teve, e meio segundo dele basta para o cliente
       fotografar a tela. */
    const premium = precos?.plans?.premium ?? null;
    const valorPremium = premium ? premium[formaDePagamento] : null;
    const economiaNoPix = premium?.pixSavings ?? 0;
    const janelaDeAcesso = diasDeAcesso >= 360
        ? '1 ano'
        : `${Math.round(diasDeAcesso / 30)} meses`;

    const jaTemPremium = currentPlan?.type === 'premium';
    const jaTemPro = currentPlan?.type === 'pro';
    const estaNoGratuito = currentPlan?.type === 'free';

    const anelDeDestaque = (planId: string) =>
        planoDestacado === planId
            ? { boxShadow: '0 0 0 2px color-mix(in srgb, var(--laudo-carimbo) 55%, transparent)' }
            : undefined;

    return (
        <div className="sup-0 voz-ferramenta min-h-screen" style={{ color: 'var(--laudo-texto)' }}>
            <AppHeader />

            <main className="container mx-auto max-w-5xl px-4 pb-24 pt-14 md:pt-20">
                {/* ─── Manchete ─────────────────────────────────────────────── */}
                <header className="max-w-[46rem]">
                    <h2 className="t-etiqueta">Planos</h2>

                    <h1 className="t-titulo voz-argumento mt-5" style={{ color: 'var(--laudo-texto)' }}>
                        Pague uma vez. O laudo é seu.
                    </h1>

                    <p className="t-corpo mt-6" style={{ color: 'var(--laudo-texto-suave)' }}>
                        A varredura gratuita diz se o seu site está irregular e por qual artigo
                        da LGPD. O laudo completo diz onde: a tag responsável, a linha no código
                        e o que fazer para corrigir.
                    </p>

                    <p className="t-apoio mt-4">
                        Pagamento único, sem mensalidade e sem renovação automática. O acesso
                        vale por {janelaDeAcesso} a partir da confirmação.
                    </p>
                </header>

                {/* Quem já assinou o Pro não pode abrir esta tela e não achar o
                    próprio plano em lugar nenhum. */}
                {jaTemPro && (
                    <p
                        className="t-apoio mt-8 border-l-2 pl-4"
                        style={{ borderColor: 'var(--sup-borda-forte)' }}
                    >
                        Você assinou o Pro, que saiu de venda. Seu acesso continua como está.
                    </p>
                )}

                {/* ─── Forma de pagamento ───────────────────────────────────────
                    Substituiu o seletor mensal/anual: a cobrança virou compra
                    avulsa, sem renovação automática. O que muda o valor agora é
                    o método — o PIX não tem taxa de parcelamento nem risco de
                    chargeback, e parte disso volta para quem paga à vista. */}
                <section className="mt-14" aria-labelledby="forma-de-pagamento">
                    <h2 id="forma-de-pagamento" className="t-etiqueta">
                        Forma de pagamento
                    </h2>

                    <div
                        role="group"
                        aria-labelledby="forma-de-pagamento"
                        className="mt-4 inline-flex gap-1 rounded-full border p-1"
                        style={{ background: 'var(--sup-1)', borderColor: 'var(--sup-borda)' }}
                    >
                        <button
                            type="button"
                            aria-pressed={formaDePagamento === 'pix'}
                            onClick={() => setFormaDePagamento('pix')}
                            className="flex items-center gap-2 rounded-full px-5 py-2 text-sm transition-colors"
                            style={formaDePagamento === 'pix'
                                ? { background: 'var(--laudo-texto)', color: 'var(--sup-0)', fontWeight: 600 }
                                : { color: 'var(--laudo-texto-suave)' }}
                        >
                            PIX
                            <span className="voz-evidencia text-[11px] opacity-70">
                                −{descontoPix}%
                            </span>
                        </button>
                        <button
                            type="button"
                            aria-pressed={formaDePagamento === 'card'}
                            onClick={() => setFormaDePagamento('card')}
                            className="rounded-full px-5 py-2 text-sm transition-colors"
                            style={formaDePagamento === 'card'
                                ? { background: 'var(--laudo-texto)', color: 'var(--sup-0)', fontWeight: 600 }
                                : { color: 'var(--laudo-texto-suave)' }}
                        >
                            Cartão
                        </button>
                    </div>

                    {/* Quanto o PIX economiza, nos dois estados do seletor: quem
                        está no cartão precisa ver o que deixa na mesa, e quem
                        está no PIX precisa ver o que já economizou. Sem os dois
                        valores lado a lado, "234,65" é só um número. */}
                    {premium && economiaNoPix > 0 && (
                        <p className="t-apoio mt-4">
                            {formaDePagamento === 'pix' ? (
                                <>
                                    No PIX você paga{' '}
                                    <span className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                                        {formatarBRL(economiaNoPix)}
                                    </span>{' '}
                                    a menos:{' '}
                                    <span className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                                        {formatarBRL(premium.pix)}
                                    </span>{' '}
                                    em vez de{' '}
                                    <span className="voz-evidencia">{formatarBRL(premium.card)}</span>.
                                </>
                            ) : (
                                <>
                                    No cartão o valor é{' '}
                                    <span className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                                        {formatarBRL(premium.card)}
                                    </span>
                                    . Pagando por PIX são{' '}
                                    <span className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                                        {formatarBRL(premium.pix)}
                                    </span>
                                    , ou {formatarBRL(economiaNoPix)} a menos.
                                </>
                            )}
                        </p>
                    )}
                </section>

                {/* ─── Os dois planos ───────────────────────────────────────── */}
                <section className="mt-10 grid items-start gap-5 md:grid-cols-2">
                    {/* Gratuito */}
                    <article
                        className="cartao flex h-full flex-col p-7 sm:p-8"
                        style={anelDeDestaque('free')}
                    >
                        <div className="flex items-baseline justify-between gap-3">
                            <h3 className="t-secao" style={{ color: 'var(--laudo-texto)' }}>
                                Gratuito
                            </h3>
                            {estaNoGratuito && (
                                <span className="t-etiqueta">Seu plano</span>
                            )}
                        </div>

                        <p className="t-apoio mt-2">Para saber se existe problema.</p>

                        <p
                            className="mt-8 text-4xl font-semibold leading-none"
                            style={{ color: 'var(--laudo-texto)' }}
                        >
                            Grátis
                        </p>
                        <p className="t-apoio mt-2">Sem prazo e sem cartão.</p>

                        <ul className="mt-8 list-none space-y-3 p-0">
                            {ENTREGA_GRATUITA.map((item) => (
                                <li key={item} className="flex gap-3">
                                    <Check
                                        className="mt-[3px] h-4 w-4 shrink-0"
                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                        aria-hidden="true"
                                    />
                                    <span className="text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        {item}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <p
                            className="voz-argumento mt-8 border-t pt-6 text-sm"
                            style={{ borderColor: 'var(--sup-borda)', color: 'var(--laudo-texto-suave)' }}
                        >
                            O gratuito responde se há irregularidade. Não responde onde ela está.
                        </p>

                        <div className="mt-auto pt-8">
                            <Button
                                onClick={() => handleSelect('free')}
                                aria-busy={clickedPlan === 'free'}
                                className="h-11 w-full border bg-transparent text-sm font-semibold hover:bg-[color:var(--sup-2)]"
                                style={{
                                    borderColor: 'var(--sup-borda-forte)',
                                    color: 'var(--laudo-texto)',
                                }}
                            >
                                Fazer uma varredura grátis
                            </Button>
                        </div>
                    </article>

                    {/* Premium */}
                    <article
                        className="cartao flex h-full flex-col p-7 sm:p-8"
                        style={{
                            borderColor: 'color-mix(in srgb, var(--laudo-carimbo) 45%, var(--sup-borda))',
                            ...anelDeDestaque('premium'),
                        }}
                    >
                        <div className="flex items-baseline justify-between gap-3">
                            <h3 className="t-secao" style={{ color: 'var(--laudo-texto)' }}>
                                Laudo completo
                            </h3>
                            <span className="t-etiqueta" style={{ color: 'var(--laudo-carimbo)' }}>
                                {jaTemPremium ? 'Seu plano' : 'Recomendado'}
                            </span>
                        </div>

                        <p className="t-apoio mt-2">Para resolver, e para provar que resolveu.</p>

                        <p
                            className="voz-evidencia mt-8 text-4xl font-semibold leading-none"
                            style={{ color: 'var(--laudo-texto)' }}
                        >
                            {valorPremium !== null ? formatarBRL(valorPremium) : '—'}
                        </p>

                        <p className="t-apoio mt-2">
                            Pagamento único, {formaDePagamento === 'pix' ? 'no PIX' : 'no cartão'}.
                            {' '}Acesso por {janelaDeAcesso}.
                        </p>

                        {formaDePagamento === 'pix' && premium && economiaNoPix > 0 && (
                            <p className="t-apoio mt-1">
                                <span className="line-through" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    {formatarBRL(premium.card)}
                                </span>{' '}
                                no cartão — {descontoPix}% a menos à vista.
                            </p>
                        )}

                        <ul className="mt-8 list-none space-y-3 p-0">
                            <li className="text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                                Tudo do gratuito, e mais:
                            </li>
                            {ENTREGA_PREMIUM.map((item) => (
                                <li key={item} className="flex gap-3">
                                    <Check
                                        className="mt-[3px] h-4 w-4 shrink-0"
                                        style={{ color: 'var(--laudo-carimbo)' }}
                                        aria-hidden="true"
                                    />
                                    <span className="text-sm" style={{ color: 'var(--laudo-texto)' }}>
                                        {item}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-auto pt-8">
                            <Button
                                onClick={() => handleSelect('premium')}
                                disabled={jaTemPremium}
                                aria-busy={clickedPlan === 'premium'}
                                className="h-11 w-full text-sm font-semibold hover:opacity-90"
                                style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                            >
                                {jaTemPremium ? (
                                    'Você já tem o laudo completo'
                                ) : (
                                    <>
                                        Comprar o laudo completo
                                        <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
                                    </>
                                )}
                            </Button>
                        </div>
                    </article>
                </section>

                {/* ─── Comparação ───────────────────────────────────────────── */}
                <section className="mt-16">
                    <button
                        type="button"
                        onClick={() => setShowCompare(!showCompare)}
                        aria-expanded={showCompare}
                        aria-controls="tabela-de-comparacao"
                        className="text-sm text-[color:var(--laudo-carimbo)] transition-opacity hover:opacity-80"
                    >
                        {showCompare ? 'Ocultar a comparação' : 'Comparar item a item'}
                    </button>

                    {showCompare && (
                        <div id="tabela-de-comparacao" className="mt-6 overflow-x-auto">
                            <table className="w-full min-w-[34rem] border-collapse text-left">
                                <caption className="sr-only">
                                    O que cada plano entrega, item a item.
                                </caption>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid var(--sup-borda-forte)' }}>
                                        <th scope="col" className="t-etiqueta py-3 pr-4 font-normal">
                                            Recurso
                                        </th>
                                        <th scope="col" className="t-etiqueta w-28 py-3 text-center font-normal">
                                            Gratuito
                                        </th>
                                        <th
                                            scope="col"
                                            className="t-etiqueta w-28 py-3 text-center font-normal"
                                            style={{ color: 'var(--laudo-carimbo)' }}
                                        >
                                            Completo
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {COMPARE_ROWS.map((linha) => (
                                        <tr
                                            key={linha.recurso}
                                            style={{ borderBottom: '1px solid var(--sup-borda)' }}
                                        >
                                            <th
                                                scope="row"
                                                className="py-3 pr-4 text-sm font-normal"
                                                style={{ color: 'var(--laudo-texto-suave)' }}
                                            >
                                                {linha.recurso}
                                            </th>
                                            {(['gratuito', 'premium'] as const).map((coluna) => {
                                                const valor = linha[coluna];
                                                return (
                                                    <td key={coluna} className="py-3 text-center">
                                                        {valor === true ? (
                                                            <>
                                                                <Check
                                                                    className="mx-auto h-4 w-4"
                                                                    style={{ color: 'var(--laudo-texto)' }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className="sr-only">incluído</span>
                                                            </>
                                                        ) : valor === false ? (
                                                            <>
                                                                <Minus
                                                                    className="mx-auto h-4 w-4"
                                                                    style={{ color: 'var(--laudo-texto-fraco)' }}
                                                                    aria-hidden="true"
                                                                />
                                                                <span className="sr-only">não incluído</span>
                                                            </>
                                                        ) : (
                                                            <span
                                                                className="voz-evidencia text-sm"
                                                                style={{ color: 'var(--laudo-texto)' }}
                                                            >
                                                                {valor}
                                                            </span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {/* ─── O que está combinado ─────────────────────────────────── */}
                <section
                    className="mt-16 grid gap-10 border-t pt-10 sm:grid-cols-3"
                    style={{ borderColor: 'var(--sup-borda)' }}
                >
                    <div>
                        <h2 className="t-etiqueta">Pagamento único</h2>
                        <p className="t-apoio mt-3">
                            Sem assinatura e sem renovação automática. O acesso vale por{' '}
                            {janelaDeAcesso} depois da confirmação.
                        </p>
                    </div>
                    <div>
                        <h2 className="t-etiqueta">PIX ou cartão</h2>
                        <p className="t-apoio mt-3">
                            O pagamento é processado pelo Mercado Pago. Os dados do cartão não
                            passam por aqui.
                        </p>
                    </div>
                    <div>
                        <h2 className="t-etiqueta">Garantia de 7 dias</h2>
                        <p className="t-apoio mt-3">
                            Não serviu para o seu caso? Devolvemos o valor integral.
                        </p>
                    </div>
                </section>

                {/* ─── Rodapé ───────────────────────────────────────────────── */}
                <footer
                    className="mt-16 border-t pt-10"
                    style={{ borderColor: 'var(--sup-borda)' }}
                >
                    <p className="t-apoio">
                        Dúvida antes de comprar?{' '}
                        <a
                            href="mailto:suporte@datatrustauditpro.com"
                            className="text-[color:var(--laudo-carimbo)] transition-opacity hover:opacity-80"
                        >
                            suporte@datatrustauditpro.com
                        </a>
                    </p>
                    <p
                        className="mt-4 max-w-[52ch] text-xs"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        Avaliação técnica indicativa de risco. Não substitui assessoria jurídica.
                    </p>
                </footer>
            </main>
        </div>
    );
};

export default PricingPage;
