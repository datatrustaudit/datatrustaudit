import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Crown, Sparkles, Zap } from 'lucide-react';
import { usePlan, PlanLimits } from '@/context/PlanContext';
import { usePricing } from '@/hooks/usePricing';
import { useNavigate } from 'react-router-dom';

interface FeatureGateProps {
    feature: keyof PlanLimits;
    featureName: string;
    children: ReactNode;
    fallback?: ReactNode;
    /** Which plan unlocks this: 'pro' | 'premium' (default: 'premium') */
    requiredPlan?: 'pro' | 'premium';
}

/** Maps a PlanLimits key to the plan that first unlocks it */
const FEATURE_UNLOCK_PLAN: Partial<Record<keyof PlanLimits, 'pro' | 'premium'>> = {
    showViolationDetails: 'pro',
    jsonExport: 'pro',
    pdfExport: 'pro',
    showScripts: 'premium',
    showLineNumbers: 'premium',
    showHistory: 'premium',
    excelExport: 'premium',
    deepAnalysis: 'premium',
    realTimeAnalysis: 'premium',
};

const FeatureGate = ({
    feature,
    featureName,
    children,
    fallback,
    requiredPlan,
}: FeatureGateProps) => {
    const { isFeatureAvailable, setShowUpgradeModal, setBlockedFeature, plan } = usePlan();
    const navigate = useNavigate();

    const isAvailable = isFeatureAvailable(feature);

    const handleUpgradeClick = () => {
        setBlockedFeature(feature as string);
        setShowUpgradeModal(true);
    };

    if (isAvailable) return <>{children}</>;
    if (fallback) return <>{fallback}</>;

    const unlockPlan = requiredPlan ?? FEATURE_UNLOCK_PLAN[feature] ?? 'premium';
    const isPro = unlockPlan === 'pro';

    /* O preço vem de GET /api/payments/plans — é a mesma tabela que monta a
       cobrança. Escrito à mão aqui, ele dizia "Pro a partir de R$ 49,90/mês"
       enquanto o checkout cobrava R$ 247 à vista: preço errado, plano
       descontinuado e cobrança que já não é mensal. */
    const { pricing } = usePricing();
    const precoPremium = pricing?.plans?.premium;
    const valorFormatado = precoPremium
        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
            .format(precoPremium.pix)
        : null;

    /* As chaves precisam ser exatamente as de `unlockPlan`.
       A segunda chamava-se `full`, então `planLabels['premium']` vinha
       `undefined` e o `target.color` da linha seguinte levantava TypeError.
       Quem pagava a conta era o error boundary: as abas IA PRO e Timeline —
       as duas que exigem premium — trocavam o laudo inteiro por "Algo deu
       errado durante a auditoria", e a varredura se perdia. As features de
       nível pro não passavam por aqui, então o cadeado delas desenhava
       normalmente e o defeito parecia intermitente.

       O tipo explícito faz o compilador cobrar a correspondência: com
       `Record<'pro' | 'premium', …>`, renomear uma chave vira erro de
       typecheck em vez de tela branca. */
    const planLabels: Record<'pro' | 'premium', { name: string; color: string; icon: ReactNode }> = {
        pro: { name: 'Premium', color: 'from-blue-500 to-indigo-600', icon: <Zap className="h-4 w-4" /> },
        premium: { name: 'Premium', color: 'from-amber-500 to-orange-600', icon: <Crown className="h-4 w-4" /> },
    };
    const target = planLabels[unlockPlan];

    const featureCopies: Partial<Record<keyof PlanLimits, { title: string; desc: string }>> = {
        showScripts: {
            title: '📍 Análise view-source avançada',
            desc: 'Localiza posição exata das tags no HTML para debugging preciso — exclusivo do Premium',
        },
        showLineNumbers: {
            title: '🔢 Debugging de Alta Precisão',
            desc: 'Veja exatamente em qual linha o script foi carregado — exclusivo do Premium',
        },
        /* "disponível no Pro" convidava para um plano que ninguém mais pode
           assinar: o Pro está descontinuado e a tela de preços nem o exibe.
           O cliente lia o convite e não encontrava onde comprar. */
        showViolationDetails: {
            title: '⚠️ Detalhes de violações LGPD',
            desc: 'Qual tag causa cada violação, em que linha, e como corrigir — no Premium',
        },
        pdfExport: {
            title: '📄 Exportação PDF profissional',
            desc: 'Laudo pronto para enviar ao cliente — no Premium',
        },
        jsonExport: {
            title: '📦 Exportação JSON',
            desc: 'Dados completos para integrar com seus sistemas — no Premium',
        },
        excelExport: {
            title: '📊 Exportação Excel',
            desc: 'Planilha detalhada para análise customizada — exclusivo do Premium',
        },
        deepAnalysis: {
            title: '🔬 Deep Scan multi-página',
            desc: 'Auditoria completa em todo o site — exclusivo do Premium',
        },
        realTimeAnalysis: {
            title: '⚡ Real-time mode',
            desc: 'Capture eventos ao vivo estilo Omnibug — exclusivo do Premium',
        },
        showHistory: {
            title: '📚 Histórico completo',
            desc: 'Compare auditorias ao longo do tempo — exclusivo do Premium',
        },
    };

    const copy = featureCopies[feature] ?? {
        title: `🔒 ${featureName}`,
        desc: `Esta funcionalidade está disponível no plano ${target.name}`,
    };

    return (
        <Card className="border-2 border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
            <CardContent className="flex flex-col items-center justify-center py-10 text-center gap-4">
                {/* Lock icon */}
                <div className={`w-14 h-14 rounded-full bg-gradient-to-br ${target.color} flex items-center justify-center shadow-lg`}>
                    <Lock className="h-7 w-7 text-white" />
                </div>

                {/* Badge */}
                <Badge className={`bg-gradient-to-r ${target.color} text-white gap-1`}>
                    {target.icon}
                    Exclusivo do {target.name}
                </Badge>

                {/* Copy */}
                <div>
                    <h3 className="text-base font-semibold text-gray-800 dark:text-gray-200 mb-1">
                        {copy.title}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                        {copy.desc}
                    </p>
                </div>

                {/* Preço. Some enquanto a tabela do servidor não chega: melhor
                    não mostrar valor nenhum do que mostrar um que o checkout
                    vai contrariar. */}
                {valorFormatado && (
                    <p className="text-xs text-gray-400">
                        Plano {target.name} por <strong>{valorFormatado}</strong> no PIX,
                        pagamento único
                    </p>
                )}

                {/* CTA */}
                <div className="flex gap-2">
                    <Button
                        onClick={handleUpgradeClick}
                        size="sm"
                        className={`bg-gradient-to-r ${target.color} text-white hover:opacity-90`}
                    >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Ver planos
                    </Button>
                    <Button
                        onClick={() => navigate('/pricing')}
                        size="sm"
                        variant="outline"
                    >
                        Comparar planos
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

export default FeatureGate;
