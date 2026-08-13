import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAuth } from './AuthContext';

export type PlanType = 'free' | 'pro' | 'premium';
export type EffectivePlan = PlanType | 'admin';

export interface UserPlan {
    type: PlanType;
    name: string;
    scansRemaining: number;
    scansLimit: number;
    expiresAt?: string;
    features: string[];
    isAdmin?: boolean;
    subscriptionStatus?: string;
    effectivePlan?: EffectivePlan;
    weeklyResetAt?: string;
}

export interface PlanLimits {
    scansPerWeek: number;          // -1 = unlimited
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
    // 50 / 75 / 100 — precisa espelhar VISIBILIDADE_POR_PLANO de
    // audit_engine/guia_de_correcao.py. O backend JÁ corta a lista antes de
    // enviar; este número serve para exibir a mensagem de limite, não para
    // cortar de novo — cortar duas vezes deixava o plano free vendo 15% do
    // laudo em vez de 50%.
    visibilityPercentage: number;
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
        priceLabel: 'Grátis',
        badge: '🆓',
        color: 'from-gray-400 to-gray-500',
        features: [
            '10 escaneamentos por semana',
            'Veredito do site em uma frase',
            'Quantas não conformidades existem, e a gravidade',
            'O artigo da LGPD que o site contraria',
            'Chat IA limitado (5 msg/dia)'
        ],
        blockedFeatures: [
            'Qual tag causa cada problema, e em que linha',
            'Cookies gravados antes do aceite, um a um',
            'Passo a passo da correção, com o código pronto',
            'Exportação PDF / JSON / Excel',
            'Histórico e comparação entre varreduras'
        ],
        limits: {
            scansPerWeek: 10,
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
            visibilityPercentage: 0
        }
    },
    // Descontinuado: ninguém novo assina. Fica com acesso total por respeito
    // a quem assinou antes — rebaixar quem já pagou seria quebra de acordo.
    pro: {
        name: 'Pro',
        price: 97,
        priceLabel: 'Plano descontinuado',
        badge: '⭐',
        color: 'from-blue-500 to-indigo-600',
        features: [
            '50 escaneamentos por semana',
            'Laudo completo, achado a achado',
            'Detalhes completos de violações',
            'Exportação PDF e JSON',
            'Chat IA ilimitado',
            'Recomendações de correção',
            'Análise de tags, eventos e privacidade'
        ],
        blockedFeatures: [
            'View-source avançado (posição exata no HTML)',
            'Números de linha / debugging de código',
            'Real-time mode',
            'Deep Scan multi-página',
            'Exportação Excel',
            'Prioridade de suporte'
        ],
        limits: {
            scansPerWeek: 50,
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
            visibilityPercentage: 100
        }
    },
    premium: {
        name: 'Premium',
        price: 247,
        priceLabel: 'R$ 247 — pagamento único',
        badge: '👑',
        color: 'from-amber-500 to-orange-600',
        features: [
            '200 escaneamentos por semana',
            'Laudo completo: cada achado, sua tag e sua linha',
            'Cookies e storage gravados antes do aceite',
            'View-source avançado — posição exata no HTML',
            'Números de linha e debugging de código',
            'Real-time mode (Omnibug-style)',
            'Deep Scan multi-página',
            'Histórico completo de escaneamentos',
            'Exportação PDF / JSON / Excel',
            'Prioridade de suporte',
            'Recomendações avançadas de correção',
            'Análise completa de LGPD/GDPR'
        ],
        blockedFeatures: [],
        limits: {
            scansPerWeek: 200,
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

// Admin limits — unlocks everything
const ADMIN_LIMITS: PlanLimits = {
    scansPerWeek: -1,
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
    visibilityPercentage: 100,
};

// Upgrade copy persuasiva por plano
/* O convite ao upgrade fala do que falta saber, não de percentual.
   "Você está vendo 30%" convida a comparar frações; "sabemos onde está cada
   problema" convida a resolver — e é o que o cliente quer. O preço vem de
   GET /api/payments/plans; os valores aqui são só reserva da primeira
   renderização. */
export const UPGRADE_COPY = {
    free: {
        title: 'Sabemos onde está cada problema',
        subtitle: 'O laudo completo mostra a tag responsável, a linha no código e o passo a passo da correção.',
        cta: 'Ver o laudo completo',
        urgency: 'Pagamento único, sem mensalidade'
    },
    pro: {
        title: 'Falta a evidência no código-fonte',
        subtitle: 'O Premium abre a posição exata no HTML, a exportação em Excel e a captura do funil logado.',
        cta: 'Conhecer o Premium',
        urgency: 'Pagamento único, sem mensalidade'
    }
};

export const BLURRED_MESSAGES = {
    scripts: 'View-source avançado com posição exata no HTML é exclusivo do Premium',
    showLineNumbers: 'Números de linha disponíveis apenas no Premium',
    history: 'Histórico de escaneamentos disponível apenas no Premium',
    details: 'O laudo detalhado está no plano Premium',
    realtime: 'Análise em tempo real é exclusiva do Premium',
    jsonExport: 'Exportação JSON está no plano Premium',
    pdfExport: 'Exportação PDF está no plano Premium',
    excelExport: 'Exportação Excel é exclusiva do Premium',
    deepAnalysis: 'Deep Scan avançado disponível apenas no Premium'
};

/**
 * Compute the effective plan for feature gating.
 * Admin preview mode can simulate any plan for testing.
 */
export function getEffectivePlan(
    user: { is_admin?: boolean; plan?: string } | null,
    adminPreviewPlan: PlanType | null
): EffectivePlan {
    if (user?.is_admin && adminPreviewPlan) return adminPreviewPlan;
    if (user?.is_admin) return 'admin';
    return (user?.plan as PlanType) || 'free';
}

interface PlanContextType {
    plan: UserPlan;
    limits: PlanLimits;
    effectivePlan: EffectivePlan;
    adminPreviewPlan: PlanType | null;
    setAdminPreviewPlan: (plan: PlanType | null) => void;
    isFeatureAvailable: (feature: keyof PlanLimits) => boolean;
    canPerformAudit: () => boolean;
    useAudit: () => void;
    /** Devolve null se trocou; a mensagem do impedimento, se não. */
    upgradePlan: (newPlan: PlanType) => Promise<string | null>;
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
    const { user, token, refreshProfile } = useAuth();
    const [adminPreviewPlan, setAdminPreviewPlan] = useState<PlanType | null>(null);

    const [plan, setPlan] = useState<UserPlan>(() => {
        const saved = localStorage.getItem('gtm-audit-plan');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && typeof parsed === 'object' && parsed.type && PLAN_CONFIGS[parsed.type as PlanType]) {
                    return parsed;
                }
                if (parsed && typeof parsed === 'string' && PLAN_CONFIGS[parsed as PlanType]) {
                    const type = parsed as PlanType;
                    return {
                        type,
                        name: PLAN_CONFIGS[type].name,
                        scansRemaining: PLAN_CONFIGS[type].limits.scansPerWeek,
                        scansLimit: PLAN_CONFIGS[type].limits.scansPerWeek,
                        features: PLAN_CONFIGS[type].features || []
                    };
                }
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
            scansRemaining: PLAN_CONFIGS.free.limits.scansPerWeek,
            scansLimit: PLAN_CONFIGS.free.limits.scansPerWeek,
            features: ['basic_audit', 'ai_chat_limited']
        };
    }

    const [selectedPlan, setSelectedPlanState] = useState<PlanType | null>(() => {
        const saved = localStorage.getItem('gtm-audit-selected-plan');
        return (saved as PlanType) || null;
    });

    const selectPlan = (newPlan: PlanType) => {
        setSelectedPlanState(newPlan);
        localStorage.setItem('gtm-audit-selected-plan', newPlan);
    };

    // Sync plan from authenticated user data
    useEffect(() => {
        if (user) {
            const userPlanType = (user.plan as PlanType) || 'free';
            const isAdmin = Boolean(user.is_admin);
            const scansLimit = user.scans_limit ?? PLAN_CONFIGS[userPlanType]?.limits.scansPerWeek ?? 10;
            const scansUsed = user.scans_used ?? 0;

            setPlan({
                type: userPlanType,
                name: isAdmin ? 'Admin' : (PLAN_CONFIGS[userPlanType]?.name || 'Free'),
                scansRemaining: scansLimit === -1 ? -1 : Math.max(0, scansLimit - scansUsed),
                scansLimit: scansLimit,
                isAdmin: isAdmin,
                subscriptionStatus: user.subscription_status,
                effectivePlan: user.effective_plan as EffectivePlan,
                features: PLAN_CONFIGS[userPlanType]?.features || [],
            });
        }
    }, [user]);

    // Compute effective plan for feature gating
    const effectivePlan = getEffectivePlan(
        user ? { is_admin: user.is_admin, plan: user.plan } : (plan.isAdmin ? { is_admin: true, plan: plan.type } : null),
        adminPreviewPlan
    );

    // Resolve limits based on effective plan
    const limits: PlanLimits = (() => {
        if (effectivePlan === 'admin') return ADMIN_LIMITS;
        return PLAN_CONFIGS[effectivePlan as PlanType]?.limits || PLAN_CONFIGS.free.limits;
    })();

    useEffect(() => {
        localStorage.setItem('gtm-audit-plan', JSON.stringify(plan));
    }, [plan]);

    // Reset scans weekly (for non-authenticated fallback)
    useEffect(() => {
        if (user) return; // Skip reset if user is loaded from backend
        const lastReset = localStorage.getItem('gtm-audit-last-reset');
        const now = new Date();
        const currentWeek = `${now.getFullYear()}-W${Math.ceil((now.getDate() + new Date(now.getFullYear(), now.getMonth(), 1).getDay()) / 7)}-${now.getMonth()}`;

        if (lastReset !== currentWeek) {
            setPlan(prev => ({
                ...prev,
                scansRemaining: PLAN_CONFIGS[prev.type].limits.scansPerWeek
            }));
            localStorage.setItem('gtm-audit-last-reset', currentWeek);
        }
    }, [user]);

    const isFeatureAvailable = (feature: keyof PlanLimits): boolean => {
        if (effectivePlan === 'admin') return true;
        const value = limits[feature];
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value !== 0;
        return true;
    };

    const shouldBlur = (feature: keyof PlanLimits): boolean => {
        return !isFeatureAvailable(feature);
    };

    const canPerformAudit = (): boolean => {
        if (effectivePlan === 'admin' || plan.isAdmin) return true;
        return limits.scansPerWeek === -1 || plan.scansRemaining > 0;
    };

    const useAudit = () => {
        if (effectivePlan === 'admin' || plan.isAdmin) return; // Admin never consumes credits
        setPlan(prev => ({
            ...prev,
            scansRemaining: prev.scansLimit === -1 ? -1 : Math.max(0, prev.scansRemaining - 1)
        }));
    };

    /* Troca o plano no banco — e só então na tela.
       A ordem importa. Antes o estado local mudava primeiro e a chamada ao
       backend era decorativa: `if (r.ok) refreshProfile()`, sem `else`. Quando
       a rota não respondia — servidor desatualizado sem ela, sessão expirada,
       produção onde ela nem existe — nada era dito. O crachá passava a exibir
       "DEV: Premium" enquanto `effectivePlan` continuava lendo `user.plan` do
       backend, ou seja free: cadeado em toda aba paga, ao lado de um crachá
       que jurava ser premium.

       Agora a promessa só é feita depois de cumprida, e o motivo da recusa
       chega a quem apertou o botão. Devolve o texto do erro, ou null se deu
       certo — quem chama decide como mostrar. */
    const upgradePlan = async (newPlan: PlanType): Promise<string | null> => {
        const config = PLAN_CONFIGS[newPlan];

        const aplicarLocalmente = () => {
            setPlan(prev => ({
                ...prev,
                type: newPlan,
                name: config.name,
                scansRemaining: config.limits.scansPerWeek,
                scansLimit: config.limits.scansPerWeek,
                features: Object.entries(config.limits)
                    .filter(([_, v]) => v === true || (typeof v === 'number' && v > 0))
                    .map(([k]) => k)
            }));
            setShowUpgradeModal(false);
        };

        /* Sem sessão não há plano para trocar: o backend trata anônimo como
           free sempre, e mudar o estado local só produziria a contradição
           acima. Melhor dizer que precisa entrar. */
        if (!token) {
            return 'Entre na sua conta para trocar de plano — sem sessão o servidor trata todo mundo como free.';
        }

        try {
            const r = await fetch('/api/auth/dev/plano', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ plan: newPlan }),
            });
            if (!r.ok) {
                if (r.status === 404 || r.status === 405) {
                    return 'A rota de troca de plano não respondeu. Em desenvolvimento, reinicie o backend; em produção ela não existe mesmo.';
                }
                return `O servidor recusou a troca de plano (HTTP ${r.status}).`;
            }
            await refreshProfile?.();
            aplicarLocalmente();
            return null;
        } catch {
            return 'Não foi possível falar com o servidor para trocar o plano.';
        }
    };

    const getUsagePercentage = (): number => {
        if (plan.scansLimit === -1) return 0;
        return ((plan.scansLimit - plan.scansRemaining) / plan.scansLimit) * 100;
    };

    const getVisibility = (): number => {
        return limits.visibilityPercentage;
    };

    return (
        <PlanContext.Provider value={{
            plan,
            limits,
            effectivePlan,
            adminPreviewPlan,
            setAdminPreviewPlan,
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
