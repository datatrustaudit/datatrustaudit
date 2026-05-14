import { useEffect } from 'react';
import { useSearchParams, Link, useNavigate } from 'react-router-dom';
import { useSubscription, SubscriptionPlan } from '@/context/SubscriptionContext';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import { Clock, RefreshCw, Tag, Mail } from 'lucide-react';

const PaymentPending = () => {
    const [params] = useSearchParams();
    const { markPending } = useSubscription();
    const { language } = useI18n();
    const navigate = useNavigate();

    const planId = (params.get('plan') ?? localStorage.getItem('gtm-selected-plan') ?? 'pro') as SubscriptionPlan;
    const planName = planId === 'full' ? 'Premium' : planId === 'pro' ? 'Pro' : 'Free';

    useEffect(() => {
        markPending(planId);
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4">
            <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-amber-500/8 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md text-center">
                {/* Animated pending icon */}
                <div className="mx-auto w-20 h-20 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center mb-6 shadow-lg shadow-amber-500/20">
                    <Clock className="w-10 h-10 text-amber-400 animate-pulse" />
                </div>

                <h1 className="text-3xl font-bold text-white mb-2">
                    {language === 'pt' ? 'Pagamento em processamento' : 'Payment processing'}
                </h1>
                <p className="text-white/50 mb-2">
                    {language === 'pt'
                        ? `Seu pagamento do plano ${planName} está sendo processado.`
                        : `Your ${planName} plan payment is being processed.`}
                </p>
                <p className="text-white/30 text-sm mb-8">
                    {language === 'pt'
                        ? 'Pagamentos via PIX podem levar alguns minutos. Sua assinatura será ativada automaticamente assim que o pagamento for confirmado.'
                        : 'PIX payments may take a few minutes. Your subscription will be activated automatically once payment is confirmed.'}
                </p>

                {/* Status card */}
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-5 mb-6 text-left space-y-3">
                    <div className="flex items-center gap-2.5">
                        <Tag className="w-4 h-4 text-amber-400" />
                        <span className="text-white font-semibold">DataTrust Audit — {planName}</span>
                        <span className="ml-auto bg-amber-500/20 text-amber-300 text-xs font-bold px-2 py-0.5 rounded-full">
                            {language === 'pt' ? 'Pendente' : 'Pending'}
                        </span>
                    </div>
                    <div className="text-white/40 text-xs flex items-start gap-2">
                        <Mail className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                        {language === 'pt'
                            ? 'Você receberá um e-mail de confirmação assim que o pagamento for processado.'
                            : 'You will receive a confirmation email once the payment is processed.'}
                    </div>
                </div>

                <div className="space-y-3">
                    <Button
                        onClick={() => navigate('/')}
                        variant="outline"
                        className="w-full border-white/20 text-white hover:bg-white/5 py-5 font-medium"
                    >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        {language === 'pt' ? 'Verificar status e continuar' : 'Check status and continue'}
                    </Button>
                    <p className="text-white/20 text-xs">
                        {language === 'pt' ? 'Dúvidas? ' : 'Questions? '}
                        <a href="mailto:suporte@gtmauditpro.com" className="text-blue-400 hover:text-blue-300">
                            suporte@gtmauditpro.com
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PaymentPending;
