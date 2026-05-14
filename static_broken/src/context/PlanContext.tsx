import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export type PlanType = 'free' | 'pro' | 'full';

export interface UserPlan {
    type: PlanType;
    name: string;
    auditsRemaining: number;
    auditsLimit: number;
    expiresAt?: string;
    features: string[];
}

export interface PlanLimits {
    auditsPerMonth: number;
    showScripts: boolean;
    showLineNumbers: boolean;
    showViolationDetails: boolean;
    showHistory: boolean;
    pdfExport: boolean;
    excelExport: boolean;
    deepAnalysis: boolean;
    aiChat: boolean;
    aiChatMessagesPerDay: number;
    realTimeAnalysis: boolean;
    dashboardDetails: 'basic' | 'partial' | 'full';
    visibilityPercentage: number; // 10%, 50%, 100%
}

export const PLAN_CONFIGS: Record<PlanType, {
    name: string;
    price: number;
    priceLabel: string;
    limits: PlanLimits;
    badge: string;
    color: string;
    features: string[];
    blockedFeatures: string[];
}> = {
    free: {
        name: 'Free',
        price: 0,
        priceLabel: 'Free',
        badge: '🆓',
        color: 'from-gray-400 to-gray-500',
        features: [
            '1 auditoria simples',
            'Dashboard básico',
            '1 detalhe por violação',
            'Chat IA limitado (5 msgs)'
        ],
        blockedFeatures: [
            'Scripts e localizações',
            'Histórico de auditorias',
            'Exportação PDF/Excel',
            'Análise profunda',
            'Real-time tracking'
        ],
        limits: {
            auditsPerMonth: 1,
            showScripts: false,
            showLineNumbers: false,
            showViolationDetails: false,
            showHistory: false,
            pdfExport: false,
            excelExport: false,
            deepAnalysis: false,
            aiChat: true,
            aiChatMessagesPerDay: 5,
            realTimeAnalysis: false,
            dashboardDetails: 'basic',
            visibilityPercentage: 10
        }
    },
    pro: {
        name: 'Pro',
        price: 9,
        priceLabel: '$9/month',
        badge: '⭐',
        color: 'from-blue-500 to-indigo-600',
        features: [
            '2 auditorias completas',
            'Dashboard detalhado',
            'Detalhes de violações',
            'Exportação PDF',
            'Chat IA ilimitado'
        ],
        blockedFeatures: [
            'Histórico de auditorias',
            'Scripts e linhas de código',
            'Exportação Excel',
            'Real-time tracking'
        ],
        limits: {
            auditsPerMonth: 2,
            showScripts: false,
            showLineNumbers: false,
            showViolationDetails: true,
            showHistory: false,
            pdfExport: true,
            excelExport: false,
            deepAnalysis: false,
            aiChat: true,
            aiChatMessagesPerDay: 100,
            realTimeAnalysis: false,
            dashboardDetails: 'partial',
            visibilityPercentage: 50
        }
    },
    full: {
        name: 'Premium',
        price: 25,
        priceLabel: '$25/month',
        badge: '👑',
        color: 'from-amber-500 to-orange-600',
        features: [
            '3 auditorias ilimitadas',
            'Tudo do Pro +',
            'Histórico completo',
            'Scripts e linhas exatas',
            'Exportação Excel',
            'Real-time tracking',
            'Suporte prioritário'
        ],
        blockedFeatures: [],
        limits: {
            auditsPerMonth: 3,
            showScripts: true,
            showLineNumbers: true,
            showViolationDetails: true,
            showHistory: true,
            pdfExport: true,
            excelExport: true,
            deepAnalysis: true,
            aiChat: true,
            aiChatMessagesPerDay: -1,
            realTimeAnalysis: true,
            dashboardDetails: 'full',
            visibilityPercentage: 100
        }
    }
};

// Copy persuasiva para upgrades
export const UPGRADE_COPY = {
    free: {
        title: '🔒 Você está vendo apenas 10%',
        subtitle: 'Desbloqueie o poder completo da análise LGPD',
        cta: 'Começar Free Trial Pro',
        urgency: '⚡ Oferta por tempo limitado: 7 dias grátis!'
    },
    pro: {
        title: '⭐ Falta pouco para o máximo',
        subtitle: 'Veja scripts, linhas de código e histórico completo',
        cta: 'Upgrade para Full',
        urgency: '🔥 50% OFF no primeiro mês!'
    }
};

export const BLURRED_MESSAGES = {
    scripts: 'Scripts e localizações exatas são exclusivos do plano Full',
    history: 'Histórico de auditorias disponível no plano Full',
    details: 'Detalhes completos disponíveis no plano Pro ou superior',
    realtime: 'Análise em tempo real é exclusiva do plano Full',
    export: 'Exportação disponível a partir do plano Pro'
};

interface PlanContextType {
    plan: UserPlan;
    limits: PlanLimits;
    isFeatureAvailable: (feature: keyof PlanLimits) => boolean;
    canPerformAudit: () => boolean;
    useAudit: () => void;
    upgradePlan: (newPlan: PlanType) => void;
    getUsagePercentage: () => number;
    showUpgradeModal: boolean;
    setShowUpgradeModal: (show: boolean) => void;
    blockedFeature: string | null;
    setBlockedFeature: (feature: string | null) => void;
    getVisibility: () => number;
    shouldBlur: (feature: keyof PlanLimits) => boolean;
}

const PlanContext = createContext<PlanContextType | null>(null);

export const usePlan = () => {
    const context = useContext(PlanContext);
    if (!context) {
        throw new Error('usePlan must be used within PlanProvider');
    }
    return context;
};

interface PlanProviderProps {
    children: ReactNode;
}

export const PlanProvider = ({ children }: PlanProviderProps) => {
    const [plan, setPlan] = useState<UserPlan>(() => {
        const saved = localStorage.getItem('gtm-audit-plan');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch {
                return getDefaultPlan();
            }
        }
        return getDefaultPlan();
    });

    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [blockedFeature, setBlockedFeature] = useState<string | null>(null);

    function getDefaultPlan(): UserPlan {
        return {
            type: 'free',
            name: 'Free',
            auditsRemaining: PLAN_CONFIGS.free.limits.auditsPerMonth,
            auditsLimit: PLAN_CONFIGS.free.limits.auditsPerMonth,
            features: ['basic_audit', 'ai_chat_limited']
        };
    }

    const limits = PLAN_CONFIGS[plan.type].limits;

    useEffect(() => {
        localStorage.setItem('gtm-audit-plan', JSON.stringify(plan));
    }, [plan]);

    // Reset audits mensalmente
    useEffect(() => {
        const lastReset = localStorage.getItem('gtm-audit-last-reset');
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;

        if (lastReset !== currentMonth) {
            setPlan(prev => ({
                ...prev,
                auditsRemaining: PLAN_CONFIGS[prev.type].limits.auditsPerMonth
            }));
            localStorage.setItem('gtm-audit-last-reset', currentMonth);
        }
    }, []);

    const isFeatureAvailable = (feature: keyof PlanLimits): boolean => {
        const value = limits[feature];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        return true;
    };

    const shouldBlur = (feature: keyof PlanLimits): boolean => {
        return !isFeatureAvailable(feature);
    };

    const canPerformAudit = (): boolean => {
        return plan.auditsRemaining > 0;
    };

    const useAudit = () => {
        setPlan(prev => ({
            ...prev,
            auditsRemaining: Math.max(0, prev.auditsRemaining - 1)
        }));
    };

    const upgradePlan = (newPlan: PlanType) => {
        const config = PLAN_CONFIGS[newPlan];
        setPlan({
            type: newPlan,
            name: config.name,
            auditsRemaining: config.limits.auditsPerMonth,
            auditsLimit: config.limits.auditsPerMonth,
            features: Object.entries(config.limits)
                .filter(([_, v]) => v === true || (typeof v === 'number' && v > 0))
                .map(([k]) => k)
        });
        setShowUpgradeModal(false);
    };

    const getUsagePercentage = (): number => {
        return ((plan.auditsLimit - plan.auditsRemaining) / plan.auditsLimit) * 100;
    };

    const getVisibility = (): number => {
        return limits.visibilityPercentage;
    };

    return (
        <PlanContext.Provider value={{
            plan,
            limits,
            isFeatureAvailable,
            canPerformAudit,
            useAudit,
            upgradePlan,
            getUsagePercentage,
            showUpgradeModal,
            setShowUpgradeModal,
            blockedFeature,
            setBlockedFeature,
            getVisibility,
            shouldBlur
        }}>
            {children}
        </PlanContext.Provider>
    );
};

export default PlanProvider;
