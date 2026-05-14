import { useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useSubscription, SubscriptionPlan } from '@/context/SubscriptionContext';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import { CheckCircle, Tag, Zap, ArrowRight, Download, ExternalLink } from 'lucide-react';

const PaymentSuccess = () => {
    const [params] = useSearchParams();
    const { activateSubscription, subscription } = useSubscription();
    const { language } = useI18n();
    const navigate = useNavigate();

    const planId = (params.get('plan') ?? localStorage.getItem('gtm-selected-plan') ?? 'pro') as SubscriptionPlan;
    const cycleParam = (params.get('cycle') ?? localStorage.getItem('gtm-billing-cycle') ?? 'monthly') as import('@/context/SubscriptionContext').BillingCycle;
    const currency = params.get('currency') ?? 'USD';
    const localPrice = params.get('price') ?? undefined;
    const providerRef = params.get('ref') ?? undefined;

    useEffect(() => {
        activateSubscription(planId, cycleParam, { currency, localPrice, providerRef });
        localStorage.removeItem('gtm-selected-plan');
    }, []);

    const planName = planId === 'full' ? 'Premium' : planId === 'pro' ? 'Pro' : 'Free';
    const isAnnual = cycleParam === 'annual';
    const renewalDays = isAnnual ? 365 : 30;

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
            {/* Background glow */}
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-green-500/10 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md text-center">
                {/* Success icon */}
                <div className="mx-auto w-20 h-20 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-6 shadow-lg shadow-green-500/20">
                    <CheckCircle className="w-10 h-10 text-green-400" />
                </div>

                <h1 className="text-3xl font-bold text-white mb-2">
                    {language === 'pt' ? 'Pagamento confirmado!' : 'Payment confirmed!'}
                </h1>
                <p className="text-white/50 mb-2">
                    {language === 'pt'
                        ? `Seu plano ${planName} foi ativado com sucesso.`
                        : `Your ${planName} plan has been successfully activated.`}
                </p>
                <p className="text-white/30 text-sm mb-8">
                    {language === 'pt'
                        ? 'Un e-mail de confirmação foi enviado para sua conta.'
                        : 'A confirmation email has been sent to your account.'}
                </p>

                {/* Plan activated badge */}
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 mb-6 text-left">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center">
                            <Tag className="w-4 h-4 text-white" />
                        </div>
                        <div>
                            <div className="font-bold text-white">DataTrust Audit — {planName}</div>
                            <div className="text-green-400 text-xs font-semibold">
                                {language === 'pt' ? '✓ Assinatura ativa' : '✓ Subscription active'}
                            </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs text-white/50">
                        <div>
                            <div className="text-white/30 mb-0.5">{language === 'pt' ? 'Ativação' : 'Activated'}</div>
                            <div>{new Date().toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en-US')}</div>
                        </div>
                        <div>
                            <div className="text-white/30 mb-0.5">{language === 'pt' ? 'Próxima renovação' : 'Next renewal'}</div>
                            <div>{new Date(Date.now() + renewalDays * 24 * 60 * 60 * 1000).toLocaleDateString(language === 'pt' ? 'pt-BR' : 'en-US')}</div>
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <Button
                        onClick={() => navigate('/')}
                        className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white py-5 font-semibold shadow-lg shadow-green-500/25"
                    >
                        <Zap className="w-4 h-4 mr-2" />
                        {language === 'pt' ? 'Iniciar primeira auditoria' : 'Start your first audit'}
                        <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>

                    <p className="text-white/20 text-xs">
                        {language === 'pt'
                            ? 'Precisa de ajuda? '
                            : 'Need help? '}
                        <a href="mailto:suporte@gtmauditpro.com" className="text-blue-400 hover:text-blue-300">
                            suporte@gtmauditpro.com
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PaymentSuccess;
