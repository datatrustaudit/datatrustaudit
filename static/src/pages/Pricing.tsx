import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useLocale, localizePrice } from '@/hooks/useLocale';
import { useLocaleContext } from '@/context/LocaleContext';
import { useI18n } from '@/context/I18nContext';
import { useAuth } from '@/context/AuthContext';
import { usePlan, PlanType } from '@/context/PlanContext';
import { useSubscription, PLAN_PRICING, BillingCycle } from '@/context/SubscriptionContext';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import LocaleSelector from '@/components/LocaleSelector';
import {
    Check, X, Tag, Zap, Star, Crown, ArrowRight, Shield,
    HelpCircle, Lock, TrendingUp, Clock, FileText, Calendar, Sparkles
} from 'lucide-react';

// ─── Plan definitions (display data only — pricing from PLAN_PRICING) ──────────
const PLANS = [
    {
        id: 'free' as const,
        icon: <Tag className="w-5 h-5" />,
        label: { en: 'Free', pt: 'Free' },
        badge: { en: 'Beginner', pt: 'Iniciante' },
        cardClass: 'border-white/10',
        gradient: 'from-slate-500 to-slate-600',
        btnClass: 'bg-white/10 text-white/80 hover:bg-white/20',
        visibility: 10,
        usageCap: { en: '1 simple audit / month', pt: '1 auditoria simples / mês' },
        features: {
            en: ['1 simple audit per month', 'Basic dashboard', '10% data visibility', 'Tag count detection', 'Basic AI chat'],
            pt: ['1 auditoria simples por mês', 'Dashboard básico', '10% de visibilidade', 'Contagem de tags detectadas', 'Chat IA limitado'],
        },
        locked: {
            en: ['Audit history', 'PDF / JSON / Excel', 'Deep scan', 'Line-level code precision', 'Detailed dashboard'],
            pt: ['Histórico completo', 'PDF / JSON / Excel export', 'Real-time & Deep scan', 'Localização exata das tags no HTML', 'Dashboard detalhado'],
        },
    },
    {
        id: 'pro' as const,
        icon: <Star className="w-5 h-5" />,
        label: { en: 'Pro', pt: 'Pro' },
        badge: { en: '⭐ Most Popular', pt: '⭐ Mais popular' },
        cardClass: 'border-blue-500 scale-[1.02] shadow-2xl shadow-blue-500/20',
        gradient: 'from-blue-500 to-indigo-600',
        btnClass: 'bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white shadow-lg shadow-blue-500/30',
        visibility: 70,
        usageCap: { en: '2 full audits / month', pt: '2 auditorias completas / mês' },
        features: {
            en: ['2 full audits/month', 'Detailed dashboard', '70% data visibility', 'PDF & JSON export', 'Expanded AI chat'],
            pt: ['2 auditorias completas por mês', 'Dashboard detalhado', '70% de visibilidade', 'Exportação PDF e JSON', 'Detalhes das violações'],
        },
        locked: {
            en: ['Complete history', 'Excel export', 'Real-time & View-source', 'Line-level code precision'],
            pt: ['Histórico completo avançado', 'Exportação Excel', 'Real-time & View-source avançada', 'Localização exata com código'],
        },
    },
    {
        id: 'premium' as const,
        icon: <Crown className="w-5 h-5" />,
        label: { en: 'Premium', pt: 'Premium' },
        badge: { en: '👑 Best Value', pt: '👑 Elite' },
        cardClass: 'border-amber-400/60',
        gradient: 'from-amber-500 to-orange-600',
        btnClass: 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-lg shadow-amber-500/30',
        visibility: 100,
        usageCap: { en: '3 limited audits / month', pt: '3 auditorias limitadas por mês' },
        features: {
            en: ['3 limited audits/month', 'Everything in Pro', '100% data visibility', 'Excel export', 'Real-time monitoring', 'Advanced view-source analysis', 'Priority support'],
            pt: ['3 auditorias limitadas por mês', 'Tudo do Pro', '100% de visibilidade', 'Exportação Excel', 'Real-time', 'Análise view-source avançada', 'Suporte prioritário'],
        },
        locked: { en: [], pt: [] },
    },
] as const;

const COMPARE_ROWS = [
    { feature: { en: 'Audits per month', pt: 'Auditorias por mês' }, free: '1 simples', pro: '2 completas', full: '3 limitadas' },
    { feature: { en: 'Basic dashboard', pt: 'Dashboard básico' }, free: true, pro: true, full: true },
    { feature: { en: 'Detailed dashboard', pt: 'Dashboard detalhado' }, free: false, pro: true, full: true },
    { feature: { en: 'JSON export', pt: 'Exportação JSON' }, free: false, pro: true, full: true },
    { feature: { en: 'PDF export', pt: 'Exportação PDF' }, free: false, pro: true, full: true },
    { feature: { en: 'Excel export', pt: 'Exportação Excel' }, free: false, pro: false, full: true },
    { feature: { en: 'Complete history', pt: 'Histórico completo' }, free: false, pro: false, full: true },
    { feature: { en: 'Real-time monitoring', pt: 'Real-time' }, free: false, pro: false, full: true },
    { feature: { en: 'Advanced view-source', pt: 'Análise view-source avançada' }, free: false, pro: false, full: true },
    { feature: { en: 'Exact tag localization in HTML', pt: 'Localização exata das tags no HTML' }, free: false, pro: false, full: true },
    { feature: { en: 'AI Chat', pt: 'Chat IA' }, free: { en: 'Limited', pt: 'Limitado' }, pro: { en: 'Expanded', pt: 'Expandido' }, full: { en: 'Unlimited', pt: 'Ilimitado' } },
    { feature: { en: 'Priority support', pt: 'Suporte prioritário' }, free: false, pro: false, full: true }
];

const PLAN_RANK: Record<string, number> = { free: 0, pro: 1, full: 2 };

const PricingPage = () => {
    const locale = useLocale();
    const { formatPrice } = useLocaleContext();
    const { language } = useI18n();
    const { isAuthenticated } = useAuth();
    const { plan: currentPlan, selectPlan, selectedPlan } = usePlan();
    const { billingCycle, setBillingCycle } = useSubscription();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [showCompare, setShowCompare] = useState(false);
    const [hoveredPlan, setHoveredPlan] = useState<string | null>(null);
    const [clickedPlan, setClickedPlan] = useState<string | null>(null);
    const L = (obj: { en: string; pt: string }) => obj[language as 'en' | 'pt'] ?? obj.en;
    const isEn = language === 'en';

    useEffect(() => {
        const planParam = searchParams.get('plan');
        if (planParam && ['free', 'pro', 'premium'].includes(planParam)) {
            setHoveredPlan(planParam);
            // Optionally, we could scroll to the pricing cards if the page is long
        }
    }, [searchParams]);

    const handleSelect = (planId: string) => {
        setClickedPlan(planId);
        selectPlan(planId as PlanType);
        localStorage.setItem('gtm-billing-cycle', billingCycle);

        if (planId === 'free') { navigate('/'); return; }

        const dest = `/checkout?plan=${planId}&cycle=${billingCycle}`;

        if (!isAuthenticated) {
            localStorage.setItem('gtm-redirect-after-auth', dest);
            navigate('/auth');
            return;
        }

        navigate(dest);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            {/* Nav */}
            <nav className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <Link to="/" className="flex items-center gap-2.5 group">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                            <Tag className="w-4 h-4 text-white" />
                        </div>
                        <span className="font-bold text-white">DataTrust Audit</span>
                    </Link>
                    <div className="flex items-center gap-4">
                        <a href="mailto:suporte@datatrustauditpro.com" className="text-white/40 hover:text-white/70 text-sm transition-colors hidden sm:block">
                            {isEn ? 'Support' : 'Suporte'}
                        </a>
                        <Link to="/" className="text-white/60 hover:text-white text-sm transition-colors">
                            {isEn ? '← Back' : '← Voltar'}
                        </Link>
                    </div>
                </div>
            </nav>

            <div className="max-w-6xl mx-auto px-6 py-16">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium mb-6">
                        <Zap className="w-4 h-4" />
                        {isEn ? 'Simple, transparent pricing' : 'Preços simples e transparentes'}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 tracking-tight">
                        {isEn ? 'Choose your plan' : 'Escolha seu plano'}
                    </h1>
                    <p className="text-white/50 text-lg max-w-xl mx-auto mb-8">
                        {isEn
                            ? 'Audit GTM compliance and privacy risks. Cancel anytime.'
                            : 'Audite conformidade GTM e riscos de privacidade. Cancele quando quiser.'}
                    </p>

                    {/* ─── Billing cycle toggle ──────────────────────────────────────────── */}
                    <div className="inline-flex items-center bg-white/5 border border-white/10 rounded-full p-1 gap-1">
                        <button
                            onClick={() => setBillingCycle('monthly')}
                            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all ${
                                billingCycle === 'monthly'
                                    ? 'bg-white text-slate-900 shadow-md'
                                    : 'text-white/60 hover:text-white'
                            }`}
                        >
                            {isEn ? 'Monthly' : 'Mensal'}
                        </button>
                        <button
                            onClick={() => setBillingCycle('annual')}
                            className={`px-5 py-2 rounded-full text-sm font-semibold transition-all flex items-center gap-2 ${
                                billingCycle === 'annual'
                                    ? 'bg-white text-slate-900 shadow-md'
                                    : 'text-white/60 hover:text-white'
                            }`}
                        >
                            {isEn ? 'Annual' : 'Anual'}
                            <span className="bg-green-500 text-white text-xs px-2 py-0.5 rounded-full font-bold">
                                {isEn ? '-20%' : '-20%'}
                            </span>
                        </button>
                    </div>
                    {billingCycle === 'annual' && (
                        <p className="text-green-400/80 text-xs mt-3 flex items-center justify-center gap-1.5">
                            <Sparkles className="w-3.5 h-3.5" />
                            {isEn ? 'You save 20% with annual billing — billed once per year' : 'Você economiza 20% com cobrança anual — faturado uma vez por ano'}
                        </p>
                    )}
                    {/* Locale selector — language + currency */}
                    <div className="mt-8 flex flex-col items-center gap-4">
                        <p className="text-white/30 text-xs uppercase tracking-widest font-bold">
                            {isEn ? 'Select your currency' : 'Selecione sua moeda'}
                        </p>
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-1.5 backdrop-blur-sm shadow-2xl">
                            <LocaleSelector compact={false} />
                        </div>
                    </div>
                </div>

                {/* Plan cards */}
                <div className="grid md:grid-cols-3 gap-5 mb-12 items-start">
                    {PLANS.map((plan) => {
                        const features = plan.features[language as 'en' | 'pt'] ?? plan.features.en;
                        const locked = plan.locked[language as 'en' | 'pt'] ?? plan.locked.en;
                        const pricing = PLAN_PRICING[plan.id][billingCycle];
                        const effectiveUsd = billingCycle === 'annual' && plan.id !== 'free'
                            ? Math.round((pricing.usd / 12) * 100) / 100   // show monthly equivalent
                            : pricing.usd;
                        const displayPrice = plan.id === 'free' ? (isEn ? 'Free' : 'Grátis') : formatPrice(effectiveUsd);
                        const planLabel = L(plan.label);
                        const isCurrentPlan = currentPlan?.type === plan.id;
                        const isHovered = hoveredPlan === plan.id;
                        const isSelected = selectedPlan === plan.id || clickedPlan === plan.id;
                        const currentRank = PLAN_RANK[currentPlan?.type ?? 'free'];
                        const planRank = PLAN_RANK[plan.id];
                        const isUpgrade = planRank > currentRank;
                        const isDowngrade = planRank < currentRank;

                        return (
                            <div
                                key={plan.id}
                                onMouseEnter={() => setHoveredPlan(plan.id)}
                                onMouseLeave={() => setHoveredPlan(null)}
                                className={`relative rounded-2xl border overflow-hidden bg-white/5 backdrop-blur-sm transition-all duration-300 ${plan.cardClass} ${
                                    isHovered ? 'shadow-xl' : ''
                                } ${
                                    isCurrentPlan ? 'ring-2 ring-white/30' : ''
                                } ${
                                    isSelected && !isCurrentPlan ? 'ring-2 ring-blue-400/60' : ''
                                }`}
                            >
                                {/* Badge / Current plan indicator */}
                                {isCurrentPlan ? (
                                    <div className="bg-white/20 text-white text-xs font-bold text-center py-2 tracking-widest uppercase flex items-center justify-center gap-1.5">
                                        <Check className="w-3 h-3" />
                                        {isEn ? 'Current Plan' : 'Plano Atual'}
                                    </div>
                                ) : plan.badge ? (
                                    <div className={`bg-gradient-to-r ${plan.gradient} text-white text-xs font-bold text-center py-2 tracking-widest uppercase`}>
                                        {L(plan.badge)}
                                    </div>
                                ) : null}

                                <div className="p-7">
                                    {/* Icon + label */}
                                    <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${plan.gradient} flex items-center justify-center text-white mb-4 shadow-lg`}>
                                        {plan.icon}
                                    </div>
                                    <h2 className="text-xl font-bold text-white">{planLabel}</h2>

                                    {/* Usage cap */}
                                    <div className="flex items-center gap-1.5 mt-2 mb-4">
                                        <Clock className="w-3.5 h-3.5 text-white/30" />
                                        <span className="text-white/40 text-xs">{L(plan.usageCap)}</span>
                                    </div>

                                    {/* Price */}
                                    <div className="flex items-baseline gap-1.5 mb-1">
                                        <span className="text-4xl font-extrabold text-white">{displayPrice}</span>
                                        {plan.id !== 'free' && (
                                            <span className="text-white/40 text-sm">{isEn ? '/mo' : '/mês'}</span>
                                        )}
                                    </div>
                                    {/* Annual billing label */}
                                    {billingCycle === 'annual' && plan.id !== 'free' && (
                                        <div className="mb-3">
                                            <span className="text-green-400/80 text-xs flex items-center gap-1">
                                                <Calendar className="w-3 h-3" />
                                                {isEn
                                                    ? `Billed ${localizePrice(pricing.usd, locale.currencyCode, locale.locale)}/year`
                                                    : `Cobrado ${localizePrice(pricing.usd, locale.currencyCode, locale.locale)}/ano`}
                                                <Badge className="bg-green-500/20 text-green-400 text-xs border-0 ml-1">-20%</Badge>
                                            </span>
                                        </div>
                                    )}

                                    {/* Data visibility bar */}
                                    <div className="mb-6 mt-4">
                                        <div className="flex justify-between text-xs text-white/40 mb-1.5">
                                            <span>{isEn ? 'Data visibility' : 'Visibilidade dos dados'}</span>
                                            <span className={`font-bold ${plan.visibility === 100 ? 'text-green-400' : plan.visibility >= 70 ? 'text-blue-400' : 'text-white/50'}`}>
                                                {plan.visibility}%
                                            </span>
                                        </div>
                                        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full bg-gradient-to-r ${plan.gradient} rounded-full transition-all duration-700`}
                                                style={{ width: `${plan.visibility}%` }}
                                            />
                                        </div>
                                    </div>

                                    {/* CTA */}
                                    <Button
                                        onClick={() => handleSelect(plan.id)}
                                        disabled={isCurrentPlan}
                                        className={`w-full py-5 font-semibold transition-all ${isCurrentPlan ? 'opacity-60 cursor-not-allowed' : plan.btnClass}`}
                                    >
                                        {isCurrentPlan ? (
                                            <><Check className="w-4 h-4 mr-2 inline" />{isEn ? 'Current Plan' : 'Plano Atual'}</>
                                        ) : isUpgrade ? (
                                            <>{isEn ? `Subscribe ${planLabel}` : `Assinar ${planLabel}`}<ArrowRight className="w-4 h-4 ml-2 inline" /></>
                                        ) : isDowngrade ? (
                                            <>{isEn ? `Switch to ${planLabel}` : `Mudar para ${planLabel}`}</>
                                        ) : plan.id === 'free' ? (
                                            isEn ? 'Start free' : 'Começar grátis'
                                        ) : (
                                            <>{isEn ? `Subscribe ${planLabel}` : `Assinar ${planLabel}`}<ArrowRight className="w-4 h-4 ml-2 inline" /></>
                                        )}
                                    </Button>

                                    <div className="mt-6 space-y-2.5">
                                        {features.map((f, i) => (
                                            <div key={`f${i}`} className="flex items-start gap-2.5">
                                                <Check className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                                                <span className="text-white/70 text-sm">{f}</span>
                                            </div>
                                        ))}
                                        {locked.length > 0 && (
                                            <div className="pt-2 mt-2 border-t border-white/5 space-y-2">
                                                {locked.map((f, i) => (
                                                    <div key={`l${i}`} className="flex items-start gap-2.5">
                                                        <Lock className="w-3.5 h-3.5 text-white/15 mt-0.5 flex-shrink-0" />
                                                        <span className="text-white/20 text-sm line-through">{f}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Feature comparison toggle */}
                <div className="text-center mb-10">
                    <button
                        onClick={() => setShowCompare(!showCompare)}
                        className="text-blue-400 hover:text-blue-300 text-sm font-medium inline-flex items-center gap-2 transition-colors"
                    >
                        <TrendingUp className="w-4 h-4" />
                        {showCompare
                            ? (isEn ? 'Hide comparison' : 'Ocultar comparação')
                            : (isEn ? 'View full comparison' : 'Ver comparação completa')}
                    </button>
                </div>

                {showCompare && (
                    <div className="mb-12 overflow-x-auto rounded-2xl border border-white/10 bg-white/5 backdrop-blur-sm">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-white/10">
                                    <th className="text-left text-white/50 font-medium py-4 px-6">{isEn ? 'Feature' : 'Recurso'}</th>
                                    {['Free', 'Pro', 'Premium'].map(h => (
                                        <th key={h} className="text-center text-white font-semibold py-4 px-4 w-32">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARE_ROWS.map((row, i) => (
                                    <tr key={i} className={`border-b border-white/5 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                                        <td className="py-3.5 px-6 text-white/60">{L(row.feature)}</td>
                                        {(['free', 'pro', 'premium'] as const).map((col) => {
                                            const val = (row as Record<string, unknown>)[col];
                                            const isLocked = val === false;
                                            return (
                                                <td key={col} className={`py-3.5 px-4 text-center ${isLocked ? 'opacity-30' : ''}`}>
                                                    {val === true ? (
                                                        <Check className="w-4 h-4 text-green-400 mx-auto" />
                                                    ) : isLocked ? (
                                                        <X className="w-4 h-4 text-white/50 mx-auto" />
                                                    ) : typeof val === 'object' && val !== null && 'en' in val ? (
                                                        <span className="text-white/80 font-medium text-xs">{L(val as { en: string; pt: string })}</span>
                                                    ) : (
                                                        <span className="text-white/80 font-medium text-xs">{String(val)}</span>
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

                {/* Guarantee + trust block */}
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
                    {[
                        { icon: <Shield className="w-6 h-6 text-green-400" />, title: { en: '7-day guarantee', pt: 'Garantia de 7 dias' }, desc: { en: "Not happy? Full refund, no questions.", pt: "Não ficou satisfeito? Reembolso total." } },
                        { icon: <Lock className="w-6 h-6 text-blue-400" />, title: { en: 'Secure checkout', pt: 'Checkout seguro' }, desc: { en: "SSL + Mercado Pago secure processing.", pt: "SSL + processamento seguro Mercado Pago." } },
                        { icon: <FileText className="w-6 h-6 text-amber-400" />, title: { en: 'Cancel anytime', pt: 'Cancele quando quiser' }, desc: { en: "No lock-in. Cancel or switch anytime.", pt: "Sem fidelidade. Cancele a qualquer momento." } },
                        { icon: <Check className="w-6 h-6 text-slate-400" />, title: { en: 'No card storage', pt: 'Nenhum dado salvo' }, desc: { en: "We don't store raw credit card numbers on our servers.", pt: "Não armazenamos os números dos seus cartões de crédito." } },
                    ].map((item, i) => (
                        <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-5 flex flex-col items-center text-center gap-3">
                            <div className="bg-white/5 p-3 rounded-full">{item.icon}</div>
                            <div>
                                <div className="font-semibold text-white text-sm mb-1">{L(item.title)}</div>
                                <div className="text-white/40 text-xs leading-relaxed">{L(item.desc)}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Footer */}
                <div className="text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-white/30 text-xs">
                        <HelpCircle className="w-3.5 h-3.5" />
                        {isEn ? 'Questions?' : 'Dúvidas?'}
                        <a href="mailto:suporte@datatrustauditpro.com" className="text-blue-400 hover:text-blue-300">
                            suporte@datatrustauditpro.com
                        </a>
                    </div>
                    <p className="text-white/15 text-xs max-w-xl mx-auto">
                        {isEn
                            ? 'Indicative technical privacy risk assessment. Does not replace legal advice.'
                            : 'Avaliação técnica indicativa de risco. Não substitui assessoria jurídica.'}
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PricingPage;
