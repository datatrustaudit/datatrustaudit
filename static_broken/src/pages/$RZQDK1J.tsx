import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/context/I18nContext';
import { useSubscription, PLAN_PRICING, PRO_BRL, PREMIUM_BRL } from '@/context/SubscriptionContext';
import { useLocaleContext } from '@/context/LocaleContext';
import AppHeader from '@/components/AppHeader';
import CurrencySelector from '@/components/CurrencySelector';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Check, X, Zap, Shield, Crown, Tag, Star, ArrowRight,
    Building2, ChevronDown, MessageSquare, FileText, Globe,
    Lock, AlertCircle, Sparkles, BarChart3, Download, History,
    Users, Headphones, Code2, Eye, Network
} from 'lucide-react';

// ─── Plan definitions (BRL as canonical source) ───────────────────────────────

const getPlans = (isEn: boolean) => [
    {
        id: 'free' as const,
        name: 'Free',
        icon: <Tag className="w-5 h-5" />,
        color: 'slate',
        gradient: 'from-slate-600 to-slate-700',
        borderColor: 'border-slate-700/50',
        bgGlow: '',
        monthlyBrl: 0,
        annualBrl: 0,
        annualTotalBrl: 0,
        badge: null,
        tagline: isEn ? 'Discover tag risks, no commitment' : 'Descubra riscos de tags, sem compromisso',
        ctaText: isEn ? 'Start for free' : 'Começar grátis',
        ctaVariant: 'outline' as const,
        auditCount: isEn ? '1 audit / month' : '1 auditoria / mês',
        visibility: 10,
        features: [
            { text: isEn ? 'Basic tag detection' : 'Detecção básica de tags', included: true },
            { text: isEn ? '10% data visibility' : '10% de visibilidade dos dados', included: true },
            { text: isEn ? 'Compliance risk score' : 'Score de risco de conformidade', included: true },
            { text: isEn ? 'Consent signal basics' : 'Sinais básicos de consentimento', included: true },
            { text: isEn ? '5 AI chat messages/day' : '5 mensagens IA/dia', included: true },
            { text: isEn ? 'Violation details' : 'Detalhes de violações', included: false },
            { text: isEn ? 'PDF / JSON export' : 'Exportação PDF / JSON', included: false },
            { text: isEn ? 'Line-level precision' : 'Precisão por linha de código', included: false },
        ],
    },
    {
        id: 'pro' as const,
        name: 'Pro',
        icon: <Star className="w-5 h-5" />,
        color: 'blue',
        gradient: 'from-blue-500 to-indigo-600',
        borderColor: 'border-blue-500/40',
        bgGlow: 'from-blue-600/10 to-indigo-600/10',
        monthlyBrl: PRO_BRL,
        annualBrl: Math.round(PRO_BRL * 12 * 0.80 / 12),
        annualTotalBrl: Math.round(PRO_BRL * 12 * 0.80),
        badge: { text: isEn ? '⭐ Most Popular' : '⭐ Mais Popular', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' },
        tagline: isEn ? 'For growing teams & agencies' : 'Para equipes e agências',
        ctaText: isEn ? 'Subscribe to Pro' : 'Assinar Pro',
        ctaVariant: 'default' as const,
        auditCount: isEn ? '2 full audits / month' : '2 auditorias completas / mês',
        visibility: 70,
        features: [
            { text: isEn ? 'All Free features' : 'Tudo do plano Free', included: true },
            { text: isEn ? '70% data visibility' : '70% de visibilidade dos dados', included: true },
            { text: isEn ? 'Full violation details' : 'Detalhes completos de violações', included: true },
            { text: isEn ? 'PDF export' : 'Exportação PDF', included: true },
            { text: isEn ? 'JSON export' : 'Exportação JSON', included: true },
            { text: isEn ? 'AI chat (100 msg/day)' : 'Chat IA (100 msg/dia)', included: true },
            { text: isEn ? 'GA4 / GTM diagnostics' : 'Diagnósticos GA4 / GTM', included: true },
            { text: isEn ? 'Duplicate tag detection' : 'Detecção de tags duplicadas', included: true },
            { text: isEn ? 'Consent issues summary' : 'Resumo de problemas de consentimento', included: true },
            { text: isEn ? 'Fine forecast (LGPD/GDPR/CCPA)' : 'Previsão de multas (LGPD/GDPR/CCPA)', included: true },
            { text: isEn ? 'Line-level code precision' : 'Precisão por linha de código', included: false },
            { text: isEn ? 'Network-level event diagnostics' : 'Diagnósticos de eventos em rede', included: false },
        ],
    },
    {
        id: 'premium' as const,
        name: 'Premium',
        icon: <Crown className="w-5 h-5" />,
        color: 'amber',
        gradient: 'from-amber-500 to-orange-600',
        borderColor: 'border-amber-500/40',
        bgGlow: 'from-amber-500/10 to-orange-500/10',
        monthlyBrl: PREMIUM_BRL,
        annualBrl: Math.round(PREMIUM_BRL * 12 * 0.80 / 12),
        annualTotalBrl: Math.round(PREMIUM_BRL * 12 * 0.80),
        badge: { text: isEn ? '👑 Best Value' : '👑 Melhor Valor', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
        tagline: isEn ? 'For professionals & consultants' : 'Para profissionais e consultores',
        ctaText: isEn ? 'Subscribe to Premium' : 'Assinar Premium',
        ctaVariant: 'default' as const,
        auditCount: isEn ? '3 advanced audits / month' : '3 auditorias avançadas / mês',
        visibility: 100,
        features: [
            { text: isEn ? 'Everything in Pro' : 'Tudo do plano Pro', included: true },
            { text: isEn ? '100% data visibility' : '100% de visibilidade dos dados', included: true },
            { text: isEn ? 'Excel export' : 'Exportação Excel', included: true },
            { text: isEn ? 'Complete audit history' : 'Histórico completo de auditorias', included: true },
            { text: isEn ? 'Real-time diagnostics' : 'Diagnósticos em tempo real', included: true },
            { text: isEn ? 'Line-level HTML precision' : 'Precisão por linha no HTML', included: true },
            { text: isEn ? 'DOM vs source comparison' : 'Comparação DOM vs código-fonte', included: true },
            { text: isEn ? 'Network-level event diagnostics' : 'Diagnósticos de eventos em rede', included: true },
            { text: isEn ? 'Cross-tool validation (GA4, Amplitude, Meta, Ads)' : 'Validação cruzada (GA4, Amplitude, Meta, Ads)', included: true },
            { text: isEn ? 'Bilingual report (EN+PT)' : 'Relatório bilíngue (EN+PT)', included: true },
            { text: isEn ? 'Priority support' : 'Prioridade de suporte', included: true },
        ],
    },
];

// ─── Feature comparison table ────────────────────────────────────────────────

const getComparisonRows = (isEn: boolean) => [
    { label: isEn ? 'Audits per month' : 'Auditorias/mês', icon: <Zap className="w-3.5 h-3.5" />, free: '1', pro: '2', premium: '3' },
    { label: isEn ? 'Tag data visibility' : 'Visibilidade dos dados', icon: <Eye className="w-3.5 h-3.5" />, free: '10%', pro: '70%', premium: '100%' },
    { label: isEn ? 'Privacy compliance' : 'Conformidade LGPD', icon: <Shield className="w-3.5 h-3.5" />, free: isEn ? 'Score only' : 'Apenas score', pro: isEn ? 'Full details' : 'Detalhes completos', premium: isEn ? 'Full details' : 'Detalhes completos' },
    { label: isEn ? 'AI chat' : 'Chat IA', icon: <MessageSquare className="w-3.5 h-3.5" />, free: isEn ? '5 msg/day' : '5 msg/dia', pro: isEn ? '100 msg/day' : '100 msg/dia', premium: isEn ? 'Unlimited' : 'Ilimitado' },
    { label: isEn ? 'PDF export' : 'Exportação PDF', icon: <FileText className="w-3.5 h-3.5" />, free: false, pro: true, premium: true },
    { label: isEn ? 'JSON export' : 'Exportação JSON', icon: <FileText className="w-3.5 h-3.5" />, free: false, pro: true, premium: true },
    { label: isEn ? 'Excel export' : 'Exportação Excel', icon: <Download className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Fine estimation' : 'Estimativa de multas', icon: <AlertCircle className="w-3.5 h-3.5" />, free: false, pro: true, premium: true },
    { label: isEn ? 'Line-level HTML precision' : 'Precisão por linha HTML', icon: <Code2 className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Network-level diagnostics' : 'Diagnósticos de rede', icon: <Network className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Cross-tool validation' : 'Validação cruzada', icon: <BarChart3 className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Audit history' : 'Histórico de auditorias', icon: <History className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Bilingual reports' : 'Relatórios bilíngues', icon: <Globe className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
    { label: isEn ? 'Priority support' : 'Suporte prioritário', icon: <Headphones className="w-3.5 h-3.5" />, free: false, pro: false, premium: true },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function CellValue({ value }: { value: string | boolean }) {
    if (typeof value === 'boolean') {
        return value
            ? <Check className="w-4 h-4 text-green-400 mx-auto" />
            : <X className="w-4 h-4 text-white/20 mx-auto" />;
    }
    return <span className="text-xs text-white/70">{value}</span>;
}

// ─── Component ────────────────────────────────────────────────────────────────

const PricingPage = () => {
    const navigate = useNavigate();
    const { t, language } = useI18n();
    const { billingCycle, setBillingCycle, subscription } = useSubscription();
    const { formatBrlPrice, currency } = useLocaleContext();
    const isAnnual = billingCycle === 'annual';
    const isEn = language === 'en';
    const [faqOpen, setFaqOpen] = useState<number | null>(null);

    const PLANS = getPlans(isEn);
    const COMPARISON_ROWS = getComparisonRows(isEn);

    // ── Currency-aware price formatters ──────────────────────────────────────
    // All prices are sourced in BRL, then converted via formatBrlPrice()
    const fmtPrice = (brl: number) => formatBrlPrice(brl);
    const fmtTotal = (brl: number) => formatBrlPrice(brl);

    const handleSelectPlan = (planId: 'free' | 'pro' | 'premium') => {
        if (planId === 'free') { navigate('/'); return; }
        localStorage.setItem('gtm-selected-plan', planId);
        localStorage.setItem('gtm-billing-cycle', billingCycle);
        navigate(`/checkout?plan=${planId}&cycle=${billingCycle}`);
    };

    const getPlanPrice = (plan: typeof PLANS[0]) => {
        if (plan.id === 'free') return isEn ? 'Free' : 'Grátis';
        return isAnnual ? fmtPrice(plan.annualBrl) : fmtPrice(plan.monthlyBrl);
    };

    // Currency label for showing conversion notice
    const currencyNotice = currency !== 'BRL'
        ? (isEn ? `Prices converted from BRL to ${currency}` : `Preços convertidos de BRL para ${currency}`)
        : null;

    const faqs = [
        {
            q: isEn ? 'Can I change my plan anytime?' : 'Posso mudar de plano a qualquer momento?',
            a: isEn ? 'Yes. You can upgrade or downgrade at any time from your account settings. No penalties.' : 'Sim. Você pode fazer upgrade ou downgrade a qualquer momento nas configurações da conta. Sem penalidades.',
        },
        {
            q: isEn ? 'What payment methods are available?' : 'Quais formas de pagamento são aceitas?',
            a: isEn ? 'We accept PIX (instant) and bank transfer (Nubank). Card payments coming soon.' : 'Aceitamos PIX (instantâneo) e transferência bancária (Nubank). Pagamento com cartão em breve.',
        },
        {
            q: isEn ? 'Is there a free trial for paid plans?' : 'Há período de teste para os planos pagos?',
            a: isEn ? 'Our Free plan is fully functional with no time limit. We offer a 7-day satisfaction guarantee on paid plans — contact support within 7 days for a full refund.' : 'Nosso plano Grátis é completo sem limite de tempo. Oferecemos garantia de satisfação de 7 dias nos planos pagos.',
        },
        {
            q: isEn ? 'What does "70% data visibility" mean?' : 'O que significa "70% de visibilidade de dados"?',
            a: isEn ? 'Our engine detects all tracking tags and events. Free plan shows 10% of detected tags. Pro shows 70% — enough for most audits. Premium shows 100% with line-level HTML positions and network-level event inspection.' : 'Nosso motor detecta todas as tags e eventos. O plano Free mostra 10% das tags detectadas. Pro mostra 70% — suficiente para a maioria das auditorias. Premium mostra 100% com posições exatas no HTML e inspeção de eventos em nível de rede.',
        },
        {
            q: isEn ? 'Do you support agencies and teams?' : 'Vocês suportam agências e equipes?',
            a: isEn ? "Yes — all plans support a single user. For team accounts, multi-domain audits, or custom reports, request a custom audit quote. We'll build a tailored plan." : 'Sim — todos os planos suportam um usuário. Para contas de equipe, auditorias multi-domínio ou relatórios personalizados, solicite um orçamento de auditoria personalizada.',
        },
    ];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 font-sans">
            <AppHeader />

            {/* Hero */}
            <section className="pt-32 pb-12 px-4 text-center relative overflow-hidden">
                {/* Background glow effects */}
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-blue-500/8 rounded-full blur-3xl" />
                    <div className="absolute top-20 right-1/4 w-64 h-64 bg-indigo-500/6 rounded-full blur-2xl" />
                    <div className="absolute top-20 left-1/4 w-64 h-64 bg-purple-500/6 rounded-full blur-2xl" />
                </div>

                <div className="relative max-w-3xl mx-auto">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300 text-sm font-medium mb-6">
                        <Sparkles className="w-3.5 h-3.5" />
                        {isEn ? 'Transparent pricing. No surprises.' : 'Preços transparentes. Sem surpresas.'}
                    </div>
                    <h1 className="text-5xl md:text-6xl font-extrabold text-white tracking-tight leading-tight mb-5">
                        {isEn ? 'Choose the right plan for your' : 'Escolha o plano certo para suas'}&nbsp;
                        <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-indigo-400 to-purple-400">
                            {isEn ? 'audit needs' : 'auditorias de dados'}
                        </span>
                    </h1>
                    <p className="text-xl text-white/50 max-w-xl mx-auto font-light">
                        {isEn
                            ? 'Start for free. Scale as your compliance needs grow. Full audits, real diagnostics, actionable findings.'
                            : 'Comece grátis. Escale conforme cresce. Auditorias completas, diagnósticos reais, achados acionáveis.'}
                    </p>

                    {/* Options Bar: Billing & Currency */}
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-6 mt-10">
                        {/* Currency Selector */}
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-white/50">
                                {isEn ? 'Currency:' : 'Moeda:'}
                            </span>
                            <CurrencySelector variant="solid" className="bg-slate-800 border-slate-700 text-white" />
                        </div>

                        <div className="hidden sm:block w-px h-8 bg-white/10" />

                        {/* Billing toggle */}
                        <div className="flex items-center gap-4">
                            <span className={`text-sm font-medium ${!isAnnual ? 'text-white' : 'text-white/40'}`}>
                                {isEn ? 'Monthly' : 'Mensal'}
                            </span>
                            <button
                                onClick={() => setBillingCycle(isAnnual ? 'monthly' : 'annual')}
                                className={`relative w-14 h-7 rounded-full border transition-all ${
                                    isAnnual ? 'bg-blue-600 border-blue-500' : 'bg-white/10 border-white/20'
                                }`}
                            >
                                <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow-md transition-all ${
                                    isAnnual ? 'left-8' : 'left-1'
                                }`} />
                            </button>
                            <span className={`text-sm font-medium flex items-center gap-2 ${isAnnual ? 'text-white' : 'text-white/40'}`}>
                                {isEn ? 'Annual' : 'Anual'}
                                <Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-xs px-2 py-0">
                                    {isEn ? 'Save 20%' : 'Poupe 20%'}
                                </Badge>
                            </span>
                        </div>
                    </div>

                    {/* Currency notice if not BRL */}
                    {currencyNotice && (
                        <p className="text-white/30 text-xs mt-3">
                            {currencyNotice} · {isEn ? 'Approx. rate.' : 'Taxa aproximada.'}
                        </p>
                    )}
                </div>
            </section>

            {/* Plan Cards */}
            <section className="px-4 pb-16">
                <div className="max-w-6xl mx-auto">
                    <div className="grid md:grid-cols-3 gap-5 mb-8">
                        {PLANS.map((plan) => {
                            const isCurrentPlan = subscription.plan === plan.id && subscription.status === 'active';
                            const isFeatured = plan.id === 'pro' || plan.id === 'premium';
                            const price = getPlanPrice(plan);
                            const monthlyEquiv = isAnnual && plan.id !== 'free'
                                ? fmtPrice(plan.annualBrl)
                                : null;

                            return (
                                <div
                                    key={plan.id}
                                    className={`relative rounded-2xl border backdrop-blur-xl transition-all duration-300 cursor-pointer group mt-4 ${
                                        isFeatured
                                            ? `${plan.borderColor} shadow-2xl hover:shadow-3xl hover:-translate-y-1`
                                            : 'border-white/10 hover:border-white/20 hover:-translate-y-0.5'
                                    }`}
                                >
                                    {/* Background gradient */}
                                    {plan.bgGlow && (
                                        <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${plan.bgGlow} opacity-60 pointer-events-none`} />
                                    )}

                                    <div className="relative p-7">
                                        {/* Badge */}
                                        {plan.badge && (
                                            <div className={`absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold border whitespace-nowrap ${plan.badge.color}`}>
                                                {plan.badge.text}
                                            </div>
                                        )}

                                        {/* Plan header */}
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center bg-gradient-to-br ${plan.gradient} text-white shadow-lg`}>
                                                {plan.icon}
                                            </div>
                                            <div>
                                                <div className="text-white font-bold text-lg leading-none">{plan.name}</div>
                                                {isCurrentPlan && (
                                                    <div className="text-[10px] text-green-400 font-medium mt-0.5">
                                                        {isEn ? '✓ Current plan' : '✓ Plano atual'}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <p className="text-white/40 text-sm mb-5">{plan.tagline}</p>

                                        {/* Price — uses formatBrlPrice so currency switching works */}
                                        <div className="mb-1">
                                            <div className="flex items-end gap-1">
                                                {plan.id === 'free' ? (
                                                    <span className="text-4xl font-extrabold text-white">{price}</span>
                                                ) : (
                                                    <>
                                                        <span className="text-4xl font-extrabold text-white">
                                                            {monthlyEquiv ?? price}
                                                        </span>
                                                        <span className="text-white/40 text-sm mb-1.5">/{isEn ? 'mo' : 'mês'}</span>
                                                    </>
                                                )}
                                            </div>
                                            {isAnnual && plan.id !== 'free' && (
                                                <div className="text-white/40 text-xs mt-1">
                                                    {fmtTotal(plan.annualTotalBrl)}/{isEn ? 'yr' : 'ano'} · <span className="text-green-400">{isEn ? '20% off' : '20% desc.'}</span>
                                                </div>
                                            )}
                                            {!isAnnual && plan.id !== 'free' && (
                                                <div className="text-white/30 text-xs mt-1">
                                                    {isEn ? 'Billed monthly' : 'Cobrado mensalmente'}
                                                </div>
                                            )}
                                        </div>

                                        {/* Audit count */}
                                        <div className="flex items-center gap-1.5 text-white/50 text-xs mb-5 mt-3">
                                            <Zap className="w-3 h-3" />
                                            {plan.auditCount}
                                        </div>

                                        {/* Visibility bar */}
                                        {plan.visibility > 0 && (
                                            <div className="mb-5">
                                                <div className="flex justify-between text-[11px] text-white/40 mb-1">
                                                    <span>{isEn ? 'Data visibility' : 'Visibilidade'}</span>
                                                    <span className={plan.id === 'premium' ? 'text-amber-400 font-bold' : plan.id === 'pro' ? 'text-blue-400 font-bold' : 'text-white/40 font-bold'}>
                                                        {plan.visibility}%
                                                    </span>
                                                </div>
                                                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full bg-gradient-to-r ${plan.gradient} rounded-full transition-all duration-500`}
                                                        style={{ width: `${plan.visibility}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {/* CTA Button */}
                                        <Button
                                            size="lg"
                                            onClick={() => handleSelectPlan(plan.id)}
                                            disabled={isCurrentPlan}
                                            className={`w-full mb-5 font-bold transition-all ${
                                                plan.id === 'free'
                                                    ? 'bg-white/8 hover:bg-white/15 text-white border border-white/15'
                                                    : `bg-gradient-to-r ${plan.gradient} hover:opacity-90 text-white shadow-lg group-hover:shadow-xl`
                                            } ${isCurrentPlan ? 'opacity-50 cursor-not-allowed' : ''}`}
                                        >
                                            {isCurrentPlan
                                                ? (isEn ? 'Current Plan' : 'Plano Atual')
                                                : (plan.id === 'free'
                                                    ? (isEn ? 'Start for free' : 'Começar grátis')
                                                    : (isEn ? 'Get started' : 'Começar agora'))}
                                            {!isCurrentPlan && plan.id !== 'free' && <ArrowRight className="w-4 h-4 ml-1.5" />}
                                        </Button>

                                        {/* Features list */}
                                        <div className="space-y-2.5">
                                            {plan.features.map((f, fi) => (
                                                <div key={fi} className="flex items-start gap-2.5">
                                                    {f.included
                                                        ? <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0 mt-0.5" />
                                                        : <X className="w-3.5 h-3.5 text-white/20 flex-shrink-0 mt-0.5" />
                                                    }
                                                    <span className={`text-sm leading-snug ${f.included ? 'text-white/70' : 'text-white/25 line-through decoration-white/15'}`}>
                                                        {f.text}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Custom Audit Card */}
                    <div className="relative rounded-2xl border border-purple-500/30 bg-gradient-to-r from-purple-500/10 to-indigo-500/10 overflow-hidden backdrop-blur-xl">
                        <div className="relative p-7 md:flex items-center justify-between gap-6">
                            <div className="flex items-center gap-4 mb-5 md:mb-0">
                                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white flex-shrink-0">
                                    <Building2 className="w-6 h-6" />
                                </div>
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-white font-bold text-lg">
                                            {isEn ? 'Custom Audit' : 'Auditoria Personalizada'}
                                        </span>
                                        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px] px-2 py-0">
                                            {isEn ? 'Enterprise & Agencies' : 'Empresas & Agências'}
                                        </Badge>
                                    </div>
                                    <p className="text-white/50 text-sm max-w-lg">
                                        {isEn
                                            ? 'Full-service audit by our specialists — multi-domain, white-label reports, dedicated support, custom SLAs, and human-assisted implementation review. Pricing by scope.'
                                            : 'Auditoria completa por nossos especialistas — multi-domínio, relatórios white-label, suporte dedicado, SLAs customizados e revisão de implementação assistida. Preço por escopo.'}
                                    </p>
                                </div>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
                                <div className="flex flex-wrap gap-2 items-center text-white/40 text-xs">
                                    {[
                                        isEn ? 'Multi-domain' : 'Multi-domínio',
                                        isEn ? 'White-label' : 'White-label',
                                        isEn ? 'Team access' : 'Acesso equipe',
                                        isEn ? 'Custom SLA' : 'SLA Custom',
                                        isEn ? 'Human review' : 'Revisão humana',
                                    ].map(tag => (
                                        <span key={tag} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded">{tag}</span>
                                    ))}
                                </div>
                                <Button
                                    onClick={() => navigate('/quote')}
                                    className="bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-bold px-6 whitespace-nowrap"
                                >
                                    {isEn ? 'Request Quote' : 'Solicitar Orçamento'}
                                    <ArrowRight className="w-4 h-4 ml-1.5" />
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Visibility Section */}
            <section className="px-4 pb-16">
                <div className="max-w-4xl mx-auto">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
                        <h3 className="text-lg font-bold text-white text-center mb-6 flex items-center justify-center gap-2">
                            <Eye className="w-5 h-5 text-white/60" />
                            {isEn ? 'What you see in each plan' : 'O que você vê em cada plano'}
                        </h3>
                        <div className="grid grid-cols-3 gap-8 text-center">
                            <div>
                                <div className="text-4xl font-extrabold text-white/50">10%</div>
                                <div className="text-sm text-white/40 mb-3">Free</div>
                                <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                                    <div className="h-full w-[10%] bg-gradient-to-r from-slate-500 to-slate-600 rounded-full" />
                                </div>
                            </div>
                            <div>
                                <div className="text-4xl font-extrabold text-blue-400">70%</div>
                                <div className="text-sm text-blue-400 mb-3">Pro</div>
                                <div className="h-2 bg-blue-500/20 rounded-full overflow-hidden">
                                    <div className="h-full w-[70%] bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full" />
                                </div>
                            </div>
                            <div>
                                <div className="text-4xl font-extrabold text-amber-400">100%</div>
                                <div className="text-sm text-amber-400 mb-3">Premium</div>
                                <div className="h-2 bg-amber-500/20 rounded-full overflow-hidden">
                                    <div className="h-full w-full bg-gradient-to-r from-amber-500 to-orange-600 rounded-full" />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Comparison Table */}
            <section className="px-4 pb-16">
                <div className="max-w-4xl mx-auto">
                    <h2 className="text-2xl font-bold text-white text-center mb-8">
                        {isEn ? 'Full feature comparison' : 'Comparação completa de recursos'}
                    </h2>
                    <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                        {/* Header */}
                        <div className="grid grid-cols-4 gap-0 border-b border-white/10">
                            <div className="px-5 py-4 text-white/40 text-xs uppercase tracking-widest font-semibold">
                                {isEn ? 'Feature' : 'Recurso'}
                            </div>
                            {['Free', 'Pro', 'Premium'].map((p, i) => (
                                <div key={p} className={`px-3 py-4 text-center font-bold text-sm ${
                                    i === 0 ? 'text-white/50'
                                    : i === 1 ? 'text-blue-400'
                                    : 'text-amber-400'
                                }`}>{p}</div>
                            ))}
                        </div>
                        {COMPARISON_ROWS.map((row, i) => (
                            <div key={i} className={`grid grid-cols-4 gap-0 border-b border-white/5 last:border-0 ${i % 2 === 0 ? 'bg-white/2' : ''}`}>
                                <div className="px-5 py-3.5 flex items-center gap-2 text-white/60 text-sm">
                                    <span className="text-white/30">{row.icon}</span>
                                    {row.label}
                                </div>
                                <div className="px-3 py-3.5 text-center flex items-center justify-center">
                                    <CellValue value={row.free} />
                                </div>
                                <div className="px-3 py-3.5 text-center flex items-center justify-center bg-blue-500/5">
                                    <CellValue value={row.pro} />
                                </div>
                                <div className="px-3 py-3.5 text-center flex items-center justify-center bg-amber-500/5">
                                    <CellValue value={row.premium} />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Custom Audit CTA in comparison */}
                    <div className="mt-4 text-center">
                        <p className="text-white/30 text-sm mb-3">
                            {isEn ? 'Need something beyond Premium?' : 'Precisa de mais que o Premium?'}
                        </p>
                        <Button
                            variant="outline"
                            className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200"
                            onClick={() => navigate('/quote')}
                        >
                            <Building2 className="w-4 h-4 mr-2" />
                            {isEn ? 'Request Custom Audit →' : 'Solicitar Auditoria Personalizada →'}
                        </Button>
                    </div>
                </div>
            </section>

            {/* Trust signals */}
            <section className="px-4 pb-16">
                <div className="max-w-3xl mx-auto">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {[
                            { icon: <Lock className="w-5 h-5" />, title: isEn ? 'Secure Payments' : 'Pagamento Seguro', desc: isEn ? 'PIX & Bank Transfer' : 'PIX e Transferência' },
                            { icon: <Shield className="w-5 h-5" />, title: isEn ? '7-day Guarantee' : 'Garantia de 7 dias', desc: isEn ? 'Full refund policy' : 'Reembolso total' },
                            { icon: <Users className="w-5 h-5" />, title: isEn ? '500+ Users' : '500+ Usuários', desc: isEn ? 'Analytics professionals' : 'Profissionais de analytics' },
                            { icon: <Headphones className="w-5 h-5" />, title: isEn ? 'Expert Support' : 'Suporte Especializado', desc: isEn ? '< 24h response time' : '< 24h de resposta' },
                        ].map((trust, i) => (
                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
                                <div className="w-10 h-10 rounded-xl bg-white/8 flex items-center justify-center text-white/60 mx-auto mb-3">
                                    {trust.icon}
                                </div>
                                <div className="text-white/80 text-sm font-semibold mb-0.5">{trust.title}</div>
                                <div className="text-white/35 text-xs">{trust.desc}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* FAQ */}
            <section className="px-4 pb-24">
                <div className="max-w-2xl mx-auto">
                    <h2 className="text-2xl font-bold text-white text-center mb-8">
                        {isEn ? 'Frequently Asked Questions' : 'Perguntas Frequentes'}
                    </h2>
                    <div className="space-y-3">
                        {faqs.map((faq, i) => (
                            <div key={i} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                                <button
                                    onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                                    className="w-full flex items-center justify-between px-5 py-4 text-left"
                                >
                                    <span className="text-white/80 font-medium text-sm pr-4">{faq.q}</span>
                                    <ChevronDown className={`w-4 h-4 text-white/40 flex-shrink-0 transition-transform ${faqOpen === i ? 'rotate-180' : ''}`} />
                                </button>
                                {faqOpen === i && (
                                    <div className="px-5 pb-4 text-white/50 text-sm leading-relaxed border-t border-white/10 pt-3">
                                        {faq.a}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Still have questions? */}
                    <div className="mt-8 text-center bg-slate-800/80 border border-slate-700 rounded-xl p-8">
                        <p className="text-white/70 text-base font-medium mb-4">
                            {isEn ? 'Still have questions?' : 'Ainda tem dúvidas?'}
                        </p>
                        <Button
                            size="lg"
                            className="bg-white text-slate-900 hover:bg-slate-100 font-bold px-8 shadow-lg"
                            onClick={() => navigate('/support')}
                        >
                            <MessageSquare className="w-4 h-4 mr-2" />
                            {isEn ? 'Contact Support' : 'Falar com Suporte'}
                        </Button>
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className="border-t border-white/8 bg-white/2">
                <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
                    <p className="text-white/25 text-sm">© {new Date().getFullYear()} DataTrust Audit · TRACKNOLOGY Ecosystem</p>
                    <div className="flex items-center gap-6 text-sm text-white/30">
                        <a href="/" className="hover:text-white/60 transition-colors">{isEn ? 'App' : 'App'}</a>
                        <a href="/support" className="hover:text-white/60 transition-colors">{isEn ? 'Support' : 'Suporte'}</a>
                        <a href="/quote" className="hover:text-white/60 transition-colors">{isEn ? 'Custom Audit' : 'Auditoria'}</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default PricingPage;
