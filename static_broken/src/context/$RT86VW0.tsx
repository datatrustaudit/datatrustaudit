import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from '@/context/AuthContext';

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
    showScripts: boolean;          // view-source with exact HTML position — Premium only
    showLineNumbers: boolean;      // line number column in tag table — Premium only
    showViolationDetails: boolean; // LGPD violation details — Pro+
    showHistory: boolean;          // audit history — Premium only
    jsonExport: boolean;           // JSON export — Pro+
    pdfExport: boolean;            // PDF export — Pro+
    excelExport: boolean;          // Excel export — Premium only
    deepAnalysis: boolean;         // AI deep analysis tab — Premium only
    aiChat: boolean;               // AI chat widget
    aiChatMessagesPerDay: number;  // -1 = unlimited
    realTimeAnalysis: boolean;     // real-time mode tab — Premium only
    dashboardDetails: 'basic' | 'partial' | 'full';
    visibilityPercentage: number;  // 10 / 70 / 100
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
            '1 auditoria simples/mês',
            'Dashboard básico',
            '10% de visibilidade dos dados',
            'Contagem de tags detectadas',
            'Score geral resumido',
            'Chat IA limitado (5 msg/dia)'
        ],
        blockedFeatures: [
            'Exportação PDF / JSON / Excel',
            'Detalhes de violações LGPD',
            'Números de linha / posição exata',
            'View-source avançado (debugging)',
            'Deep Scan multi-página',
            'Real-time mode'
        ],
        limits: {
            auditsPerMonth: 1,
            showScripts: false,
            showLineNumbers: false,
            showViolationDetails: false,
            showHistory: false,
            jsonExport: false,
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
        price: 19,
        priceLabel: 'USD $19/mês',
        badge: '⭐',
        color: 'from-blue-500 to-indigo-600',
        features: [
            '2 auditorias completas/mês',
            '70% de visibilidade dos dados',
            'Detalhes completos de violações',
            'Exportação PDF e JSON',
            'Chat IA ilimitado'
        ],
        blockedFeatures: [
            'View-source avançado (posição exata no HTML)',
            'Números de linha / debugging de código',
            'Real-time mode',
            'Exportação Excel',
            'Histórico completo'
        ],
        limits: {
            auditsPerMonth: 2,
            showScripts: false,
            showLineNumbers: false,
            showViolationDetails: true,
            showHistory: false,
            jsonExport: true,
            pdfExport: true,
            excelExport: false,
            deepAnalysis: false,
            aiChat: true,
            aiChatMessagesPerDay: -1,
            realTimeAnalysis: false,
            dashboardDetails: 'partial',
            visibilityPercentage: 70
        }
    },
    full: {
        name: 'Premium',
        price: 49,
        priceLabel: 'USD $49/mês',
        badge: '👑',
        color: 'from-amber-500 to-orange-600',
        features: [
            '3 auditorias/mês',
            '100% de visibilidade dos dados',
            'View-source avançado — posição exata no HTML',
            'Números de linha e debugging de código',
            'Real-time mode (Omnibug-style)',
            'Deep Scan multi-página',
            'Histórico completo de auditorias',
            'Exportação PDF / JSON / Excel',
            'Prioridade de suporte'
        ],
        blockedFeatures: [],
        limits: {
            auditsPerMonth: 3,
            showScripts: true,
            showLineNumbers: true,
            showViolationDetails: true,
            showHistory: true,
            jsonExport: true,
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

// Upgrade copy persuasiva por plano
export const UPGRADE_COPY = {
    free: {
        title: '🔒 Você está vendo apenas 10%',
        subtitle: 'Desbloqueie violações, PDF, JSON e 70% dos dados com o Pro',
        cta: 'Assinar Pro — USD $19/mês',
        urgency: '⚡ Análise completa, 2 auditorias/mês'
    },
    pro: {
        title: '⭐ Falta pouco para o máximo',
        subtitle: 'Acesse view-source, linha de código, Excel e real-time com o Premium',
        cta: 'Upgrade para Premium — USD $49/mês',
        urgency: '🔥 View-source avançado + Excel + Real-time'
    }
};

export const BLURRED_MESSAGES = {
    scripts: 'View-source avançado com posição exata no HTML é exclusivo do Premium',
    showLineNumbers: 'Números de linha disponíveis apenas no Premium',
    history: 'Histórico de auditorias disponível apenas no Premium',
    details: 'Detalhes de violações disponíveis no plano Pro ou superior',
    realtime: 'Análise em tempo real é exclusiva do Premium',
    jsonExport: 'Exportação JSON disponível a partir do plano Pro',
    pdfExport: 'Exportação PDF disponível a partir do plano Pro',
    excelExport: 'Exportação Excel é exclusiva do Premium',
    deepAnalysis: 'Deep Scan avançado disponível apenas no Premium'
};

/**
 * Normalise legacy plan IDs from the backend.
 * The backend stores 'free', 'pro', 'premium' — but our frontend types use 'full' for Premium.
 */
function normalisePlanType(raw: string | undefined | null): PlanType {
    if (!raw) return 'free';
    const lower = raw.toLowerCase();
    if (lower === 'premium' || lower === 'full') return 'full';
    if (lower === 'pro') return 'pro';
    return 'free';
}

interface PlanContextType {
    plan: UserPlan;
    limits: PlanLimits;
    isFeatureAvailable: (feature: keyof PlanLimits) => boolean;
    canPerformAudit: () => boolean;
    useAudit: () => void;
    upgradePlan: (newPlan: PlanType) => void;
    selectPlan: (newPlan: PlanType) => void;
    selectedPlan: PlanType | null;
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
    const { user } = useAuth();

    /**
     * SINGLE SOURCE OF TRUTH: The user's plan comes from the server via AuthContext.
     * We derive local state from `user.plan` — NEVER from localStorage.
     * The only exception is `upgradePlan()` for dev testing, which sets a local override.
     */
    const [devOverridePlan, setDevOverridePlan] = useState<PlanType | null>(null);

    // Determine effective plan: dev override (if set) takes priority, otherwise server truth
    const effectivePlanType: PlanType = devOverridePlan ?? normalisePlanType(user?.plan);
    const config = PLAN_CONFIGS[effectivePlanType];

    const [auditsRemaining, setAuditsRemaining] = useState<number>(config.limits.auditsPerMonth);
    const [showUpgradeModal, setShowUpgradeModal] = useState(false);
    const [blockedFeature, setBlockedFeature] = useState<string | null>(null);

    const [selectedPlan, setSelectedPlanState] = useState<PlanType | null>(() => {
        const saved = localStorage.getItem('gtm-audit-selected-plan');
        return (saved as PlanType) || null;
    });

    // Reset audits when plan changes (e.g., user logs in, or plan upgrades)
    useEffect(() => {
        setAuditsRemaining(config.limits.auditsPerMonth);
    }, [effectivePlanType, config.limits.auditsPerMonth]);

    // Clear dev override when user changes (e.g., logout)
    useEffect(() => {
        setDevOverridePlan(null);
    }, [user?.id]);

    // Reset audits monthly
    useEffect(() => {
        const lastReset = localStorage.getItem('gtm-audit-last-reset');
        const now = new Date();
        const currentMonth = `${now.getFullYear()}-${now.getMonth()}`;

        if (lastReset !== currentMonth) {
            setAuditsRemaining(config.limits.auditsPerMonth);
            localStorage.setItem('gtm-audit-last-reset', currentMonth);
        }
    }, [config.limits.auditsPerMonth]);

    const plan: UserPlan = {
        type: effectivePlanType,
        name: config.name,
        auditsRemaining,
        auditsLimit: config.limits.auditsPerMonth,
        features: Object.entries(config.limits)
            .filter(([, v]) => v === true || (typeof v === 'number' && v > 0))
            .map(([k]) => k),
    };

    const limits = config.limits;

    const selectPlan = (newPlan: PlanType) => {
        setSelectedPlanState(newPlan);
        localStorage.setItem('gtm-audit-selected-plan', newPlan);
    };

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
        return auditsRemaining > 0;
    };

    const useAudit = () => {
        setAuditsRemaining(prev => Math.max(0, prev - 1));
    };

    /**
     * upgradePlan — DEV ONLY local override.
     * In production, plan upgrades happen via the payment flow and /api/auth/me refresh.
     * This only sets a local override for dev testing; it resets on page reload.
     */
    const upgradePlan = (newPlan: PlanType) => {
        const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
        if (isDev) {
            setDevOverridePlan(newPlan);
        }
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
            selectPlan,
            selectedPlan,
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
