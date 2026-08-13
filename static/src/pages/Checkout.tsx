import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { useSubscription, SubscriptionPlan } from '@/context/SubscriptionContext';
import { apiRequest } from '@/lib/apiClient';
import { usePricing, type FormaDePagamento } from '@/hooks/usePricing';
import { Button } from '@/components/ui/button';
import LocaleSelector from '@/components/LocaleSelector';
import MarcaDataTrust from '@/components/MarcaDataTrust';
import {
    Check, Lock, AlertCircle, ArrowRight, Loader2,
    CreditCard, QrCode, ExternalLink,
} from 'lucide-react';

/* ─── O que o plano entrega ────────────────────────────────────────────────────
   Só texto. O gradiente por plano, a coroa e a estrela que moravam aqui saíram:
   nesta identidade cor saturada é reservada à gravidade de um achado, e selo
   colorido na tela onde o dinheiro entra é decoração, não informação. */
const PLAN_META: Record<SubscriptionPlan, {
    label: { en: string; pt: string };
    audits: { en: string; pt: string };
    highlights: { en: string[]; pt: string[] };
}> = {
    free: {
        label: { en: 'Free', pt: 'Grátis' },
        audits: { en: '10 scans per week', pt: '10 escaneamentos por semana' },
        highlights: {
            en: ['Basic dashboard', 'Risk summary', 'AI chat (5 msg/day)'],
            pt: ['Dashboard básico', 'Resumo de riscos', 'Chat IA (5 msg/dia)'],
        },
    },
    pro: {
        label: { en: 'Pro', pt: 'Pro' },
        audits: { en: '50 scans per week', pt: '50 escaneamentos por semana' },
        highlights: {
            en: ['Full audit (GA4, GTM, pixels, cookies)', 'Pre-consent risk detection', 'PDF report', 'All violations (70% visibility)'],
            pt: ['Auditoria completa (GA4, GTM, pixels, cookies)', 'Riscos antes do consentimento', 'Relatório em PDF', 'Todas violações (70% visibilidade)'],
        },
    },
    premium: {
        label: { en: 'Premium', pt: 'Premium' },
        audits: { en: '200 scans per week', pt: '200 escaneamentos por semana' },
        highlights: {
            en: ['Everything in Pro', 'Full evidence export (JSON)', 'Network, cookies & dataLayer tabs', 'Consent timeline', 'LGPD/GDPR exposure estimate', 'Priority support'],
            pt: ['Tudo do Pro', 'Evidências completas (JSON)', 'Network, cookies e dataLayer', 'Timeline de consentimento', 'Estimativa de exposição LGPD/GDPR', 'Suporte prioritário'],
        },
    },
};

const CheckoutPage = () => {
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const { isAuthenticated, user, token } = useAuth();
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const { language } = useI18n();
    const { markPending } = useSubscription();

    const planId = (params.get('plan') ?? localStorage.getItem('gtm-selected-plan') ?? 'pro') as SubscriptionPlan;
    /* Forma de pagamento no lugar do ciclo: a compra é avulsa, e é o método que
       muda o valor. `cycle` ainda pode chegar em link antigo — é ignorado. */
    const metodo: FormaDePagamento = params.get('method') === 'card' ? 'card' : 'pix';

    const plan = PLAN_META[planId] ?? PLAN_META.pro;
    const isEn = language !== 'pt-BR';
    const localeKey: 'en' | 'pt' = isEn ? 'en' : 'pt';
    const L = (obj: { en: string; pt: string }) => obj[localeKey] ?? obj.en;

    /* Preço: o servidor é a única fonte. É ele que monta a preferência do
       Mercado Pago, e exibir aqui um número diferente do que será cobrado é o
       bug que já existiu nesta tela — mostrava R$ 49,90 e o checkout cobrava
       R$ 97. Por isso a tabela local (PLAN_PRICING) não aparece mais como
       valor: enquanto a resposta não chega, o lugar do preço fica em branco
       (esqueleto), e se ela falhar a tela diz que o valor será confirmado na
       próxima etapa em vez de arriscar um palpite convertido de dólar. */
    const { pricing: serverPricing, isLoading: carregandoPrecos } = usePricing();
    const serverPlan = serverPricing?.plans?.[planId as 'pro' | 'premium'];
    const serverTotalBrl = serverPlan ? serverPlan[metodo] : null;
    const economiaDoPix = serverPlan && metodo === 'pix' ? serverPlan.pixSavings : 0;
    const diasDeAcesso = serverPricing?.accessDays ?? 365;

    const formatBrl = (valor: number) =>
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor);

    const temPreco = serverTotalBrl !== null;
    const totalDuePrice = serverTotalBrl !== null ? formatBrl(serverTotalBrl) : null;

    const planLabel = L(plan.label);
    const highlights = plan.highlights[localeKey] ?? plan.highlights.en;
    const audits = L(plan.audits);

    useEffect(() => {
        if (!isAuthenticated) {
            // A forma de pagamento viaja junto: sem ela, quem escolheu PIX
            // voltava do login para o preço do cartão.
            const dest = `/checkout?plan=${planId}&method=${metodo}`;
            localStorage.setItem('gtm-redirect-after-auth', dest);
            navigate('/auth');
            return;
        }
        if (!PLAN_META[planId] || planId === 'free') {
            navigate('/pricing');
        }
    }, [isAuthenticated, planId]);

    if (!isAuthenticated || !PLAN_META[planId] || planId === 'free') return null;

    const handlePay = async () => {
        setIsLoading(true);
        setError(null);

        try {
            // Rastro do que o usuário viu antes de sair para o provedor.
            const checkoutState = {
                planId,
                metodo,
                userId: user?.email,
                localPrice: totalDuePrice,
                initiatedAt: new Date().toISOString(),
                status: 'pending',
            };
            localStorage.setItem('gtm-checkout-state', JSON.stringify(checkoutState));
            localStorage.setItem('gtm-selected-plan', planId);

            // O pagamento passa pelo backend: /api/payments/create-preference cria
            // a preferência no Mercado Pago com o preço vindo do .env e amarra o
            // external_reference ao id do usuário. É esse vínculo que permite ao
            // webhook liberar o plano sozinho.
            // Antes o botão redirecionava direto para um link fixo da Kiwify, e
            // como não existe webhook da Kiwify no backend, quem pagava ficava
            // esperando ativação manual.
            if (!isAuthenticated || !token) {
                navigate(`/auth?redirect=/checkout?plan=${planId}&method=${metodo}`);
                return;
            }

            /* Só o método viaja — nunca o valor. O servidor calcula o preço e o
               desconto do PIX a partir da própria tabela; mandar `amount` daqui
               deixaria qualquer um comprar o premium por um real. */
            const preference = await apiRequest<{
                id: string; init_point: string; amount?: number; method?: string;
            }>(
                '/api/payments/create-preference',
                {
                    method: 'POST',
                    token,
                    body: { plan: planId, method: metodo },
                    context: 'checkout',
                }
            );

            if (!preference?.init_point) {
                throw new Error(isEn
                    ? 'Payment provider did not return a checkout link. Please try again.'
                    : 'O provedor de pagamento não devolveu o link de checkout. Tente novamente.');
            }

            markPending(planId);

            // Redirect to Mercado Pago secure checkout
            window.location.href = preference.init_point;
        } catch (err: any) {
            console.error('Checkout error:', err);
            setError(
                err?.info?.userMessage
                || err.message
                || (isEn ? 'Could not start the payment.' : 'Não foi possível iniciar o pagamento.')
            );
            setIsLoading(false);
        }
    };

    const rotuloDoMetodo = metodo === 'pix'
        ? (isEn ? 'via PIX' : 'à vista no PIX')
        : (isEn ? 'by credit or debit card' : 'no cartão de crédito ou débito');

    const rotuloDoBotao = (() => {
        if (isLoading) return isEn ? 'Opening secure checkout…' : 'Abrindo o checkout seguro…';
        const forma = metodo === 'pix' ? 'PIX' : (isEn ? 'card' : 'cartão');
        if (!totalDuePrice) return isEn ? `Pay with ${forma}` : `Pagar no ${forma}`;
        return isEn
            ? `Pay ${totalDuePrice} with ${forma}`
            : `Pagar ${totalDuePrice} no ${forma}`;
    })();

    const IconeDoMetodo = metodo === 'pix' ? QrCode : CreditCard;

    return (
        <div className="min-h-screen sup-0 flex flex-col" style={{ color: 'var(--laudo-texto)' }}>
            {/* ─── Cabeçalho ─────────────────────────────────────────────────── */}
            <header className="border-b" style={{ borderColor: 'var(--sup-borda)' }}>
                <div className="mx-auto w-full max-w-2xl px-5 sm:px-6 py-4 flex items-center justify-between gap-4">
                    <Link to="/" className="shrink-0">
                        <MarcaDataTrust tamanho={26} />
                    </Link>
                    <div className="flex items-center gap-3 sm:gap-4">
                        <LocaleSelector compact />
                        <span
                            className="hidden sm:inline-flex items-center gap-1.5 text-xs"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            <Lock className="w-3.5 h-3.5" aria-hidden />
                            {isEn ? 'Secure payment' : 'Pagamento seguro'}
                        </span>
                    </div>
                </div>
            </header>

            <main className="flex-1">
                <div className="mx-auto w-full max-w-2xl px-5 sm:px-6 py-12 sm:py-16">

                    {/* ─── Manchete: o que está sendo comprado ───────────────── */}
                    <p className="t-etiqueta">{isEn ? 'Order confirmation' : 'Confirmação de compra'}</p>
                    <h1 className="t-titulo mt-3">DataTrust Audit — {planLabel}</h1>
                    <p className="t-apoio mt-4">
                        {isEn
                            ? `${audits}. ${diasDeAcesso} days of access.`
                            : `${audits}. Acesso por ${diasDeAcesso} dias.`}
                    </p>

                    {/* ─── O valor ───────────────────────────────────────────────
                        Destaque absoluto da tela: quanto, e por qual forma. */}
                    <section className="cartao mt-10 overflow-hidden">
                        <div className="p-6 sm:p-8">
                            <p className="t-etiqueta">{isEn ? 'Amount due' : 'Valor a pagar'}</p>

                            {temPreco ? (
                                <p
                                    className="voz-evidencia mt-4 font-semibold leading-none"
                                    style={{ fontSize: 'clamp(2.25rem, 9vw, 4rem)', letterSpacing: '-0.02em' }}
                                >
                                    {totalDuePrice}
                                </p>
                            ) : carregandoPrecos ? (
                                <>
                                    <div
                                        className="mt-4 h-12 sm:h-14 w-48 max-w-full rounded animate-pulse"
                                        style={{ background: 'var(--sup-2)' }}
                                        aria-hidden
                                    />
                                    <span className="sr-only">
                                        {isEn ? 'Loading the amount' : 'Carregando o valor'}
                                    </span>
                                </>
                            ) : (
                                <p className="t-corpo mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {isEn
                                        ? 'We could not load the amount right now. It is shown for your confirmation on the next screen, before any payment.'
                                        : 'Não conseguimos carregar o valor agora. Ele aparece para você conferir na próxima tela, antes de qualquer pagamento.'}
                                </p>
                            )}

                            <p
                                className="mt-3 flex items-center gap-2 text-sm"
                                style={{ color: 'var(--laudo-texto-suave)' }}
                            >
                                <IconeDoMetodo className="w-4 h-4 shrink-0" aria-hidden />
                                {rotuloDoMetodo}
                            </p>

                            {/* Quanto o PIX economiza. Sem o valor do cartão ao lado,
                                o desconto é só um número solto. */}
                            {metodo === 'pix' && economiaDoPix > 0 && serverPlan && (
                                <p className="mt-2 text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {isEn ? 'You save ' : 'Você economiza '}
                                    <span className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                                        {formatBrl(economiaDoPix)}
                                    </span>
                                    {isEn ? ' — by card it would be ' : ' — no cartão seriam '}
                                    <span className="voz-evidencia line-through">{formatBrl(serverPlan.card)}</span>.
                                </p>
                            )}

                            <Link
                                to="/pricing"
                                className="inline-block mt-4 text-sm underline underline-offset-4"
                                style={{ color: 'var(--laudo-carimbo)' }}
                            >
                                {isEn ? 'Change plan or payment method' : 'Mudar de plano ou de forma de pagamento'}
                            </Link>
                        </div>

                        {/* A dúvida número um de quem compra, respondida antes do botão. */}
                        <div
                            className="border-t px-6 sm:px-8 py-5"
                            style={{ background: 'var(--sup-2)', borderColor: 'var(--sup-borda)' }}
                        >
                            <p className="font-medium">
                                {isEn
                                    ? 'One-time payment — no auto-renewal.'
                                    : 'Pagamento único — sem renovação automática.'}
                            </p>
                            <p className="t-apoio mt-1">
                                {isEn
                                    ? `Nothing is charged again. Access lasts ${diasDeAcesso} days from the moment the payment is confirmed.`
                                    : `Nada é cobrado de novo. O acesso vale por ${diasDeAcesso} dias a partir da confirmação do pagamento.`}
                            </p>
                        </div>
                    </section>

                    {/* ─── O que o cliente recebe ────────────────────────────── */}
                    <section className="cartao mt-4 p-6 sm:p-8">
                        <p className="t-etiqueta">{isEn ? 'What you get' : 'O que você recebe'}</p>
                        <ul className="mt-4 space-y-3">
                            {highlights.map((h, i) => (
                                <li key={i} className="flex items-start gap-3">
                                    <Check
                                        className="w-4 h-4 mt-1 shrink-0"
                                        style={{ color: 'var(--laudo-carimbo)' }}
                                        aria-hidden
                                    />
                                    <span className="text-sm leading-relaxed">{h}</span>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {/* ─── Em nome de quem ───────────────────────────────────── */}
                    {user && (
                        <div
                            className="cartao mt-4 px-6 sm:px-8 py-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                        >
                            <span className="t-etiqueta">{isEn ? 'Buying as' : 'Comprando como'}</span>
                            <span className="voz-evidencia text-sm break-all">{user.email}</span>
                        </div>
                    )}

                    {/* ─── Como o pagamento acontece ─────────────────────────── */}
                    <p className="t-apoio mt-6">
                        {isEn
                            ? 'You will be redirected to the secure Mercado Pago checkout. Your plan is released automatically as soon as the payment is confirmed.'
                            : 'Você será levado ao checkout seguro do Mercado Pago. Seu plano é liberado automaticamente assim que o pagamento for confirmado.'}
                    </p>

                    {/* ─── Falha ao iniciar o pagamento ──────────────────────────
                        A mensagem vem do servidor e explica o motivo (ex.: meio de
                        pagamento indisponível). Não trocar por texto genérico. */}
                    {error && (
                        <div
                            role="alert"
                            className="mt-6 rounded-xl border p-4 flex gap-3"
                            style={{
                                borderColor: 'var(--laudo-critico)',
                                background: 'var(--sup-1)',
                            }}
                        >
                            <AlertCircle
                                className="w-4 h-4 mt-0.5 shrink-0"
                                style={{ color: 'var(--laudo-critico)' }}
                                aria-hidden
                            />
                            <div className="min-w-0">
                                <p className="text-sm font-medium" style={{ color: 'var(--laudo-critico)' }}>
                                    {isEn ? 'Payment was not started' : 'O pagamento não foi iniciado'}
                                </p>
                                <p className="t-apoio mt-1 break-words">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* ─── Pagar ───────────────────────────────────────────────
                        O contraste do botão vira nos dois temas: no escuro o
                        carimbo é claro e o texto fica quase preto; no claro, o
                        inverso. */}
                    <Button
                        onClick={handlePay}
                        disabled={isLoading}
                        aria-busy={isLoading}
                        className="mt-6 w-full h-auto py-5 text-base font-semibold rounded-xl transition-opacity hover:opacity-90"
                        style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                    >
                        {isLoading
                            ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
                            : <Lock className="w-4 h-4" aria-hidden />}
                        {rotuloDoBotao}
                        {!isLoading && <ArrowRight className="w-4 h-4" aria-hidden />}
                    </Button>

                    {/* ─── Rodapé ────────────────────────────────────────────── */}
                    <div
                        className="mt-8 pt-6 border-t space-y-2 text-xs"
                        style={{ borderColor: 'var(--sup-borda)', color: 'var(--laudo-texto-fraco)' }}
                    >
                        <p className="flex items-center gap-1.5">
                            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden />
                            {isEn
                                ? 'Payment processed by Mercado Pago. We never see or store your card data.'
                                : 'Pagamento processado pelo Mercado Pago. Não vemos nem guardamos os dados do seu cartão.'}
                        </p>
                        <p>
                            {isEn ? 'By proceeding, you agree to our ' : 'Ao prosseguir, você concorda com nossos '}
                            <Link
                                to="/terms"
                                className="underline underline-offset-2"
                                style={{ color: 'var(--laudo-texto-suave)' }}
                            >
                                {isEn ? 'Terms' : 'Termos'}
                            </Link>
                            {isEn ? ' & ' : ' e a '}
                            <Link
                                to="/privacy"
                                className="underline underline-offset-2"
                                style={{ color: 'var(--laudo-texto-suave)' }}
                            >
                                {isEn ? 'Privacy Policy' : 'Política de Privacidade'}
                            </Link>.
                        </p>
                        <p>
                            {isEn
                                ? 'Indicative technical assessment. Does not replace legal advice.'
                                : 'Avaliação técnica indicativa. Não substitui assessoria jurídica.'}
                        </p>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default CheckoutPage;
