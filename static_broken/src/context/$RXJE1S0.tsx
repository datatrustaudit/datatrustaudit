/**
 * Subscription context — BRL-primary pricing architecture.
 *
 * Plans: free | pro | premium | custom
 * Billing: monthly | annual (20% off annual)
 *
 * Pro:     R$97/mo  → R$931.20/yr (~R$77.60/mo equivalent)
 * Premium: R$247/mo → R$2,371.20/yr (~R$197.60/mo equivalent)
 */

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type SubscriptionPlan = 'free' | 'pro' | 'premium' | 'custom';
// 'full' kept as alias for backward compatibility with localStorage
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'inactive' | 'active' | 'pending' | 'proof_submitted' | 'failed' | 'cancelled' | 'past_due' | 'trial';

export interface Subscription {
    plan: SubscriptionPlan;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;
    activatedAt: string | null;
    nextRenewalAt: string | null;
    renewalIntervalMonths: number;
    currency: string | null;
    localPrice: string | null;
    brlPrice: number | null;
    paymentReference: string | null;
}

interface SubscriptionContextValue {
    subscription: Subscription;
    billingCycle: BillingCycle;
    setBillingCycle: (cycle: BillingCycle) => void;
    activateSubscription: (
        plan: SubscriptionPlan,
        cycle: BillingCycle,
        opts?: { currency?: string; localPrice?: string; brlPrice?: number; reference?: string }
    ) => void;
    markFailed: () => void;
    markPending: (plan: SubscriptionPlan, cycle: BillingCycle) => void;
    cancelSubscription: () => void;
    auditQuota: { used: number; max: number };
    consumeAudit: () => boolean;
}

// ── BRL Pricing matrix ─────────────────────────────────────────────────────
export const PRO_BRL = 97;
export const PREMIUM_BRL = 247;
export const ANNUAL_DISCOUNT = 0.20; // 20% off

export const PLAN_PRICING: Record<SubscriptionPlan, Record<BillingCycle, { brl: number; savingsPct: number; annualTotal?: number }>> = {
    free: {
        monthly: { brl: 0, savingsPct: 0 },
        annual:  { brl: 0, savingsPct: 0 },
    },
    pro: {
        monthly: { brl: PRO_BRL, savingsPct: 0 },
        annual:  {
            brl: Math.round((PRO_BRL * 12 * (1 - ANNUAL_DISCOUNT)) / 12),  // monthly equiv
            annualTotal: Math.round(PRO_BRL * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100,
            savingsPct: 20,
        },
    },
    premium: {
        monthly: { brl: PREMIUM_BRL, savingsPct: 0 },
        annual:  {
            brl: Math.round((PREMIUM_BRL * 12 * (1 - ANNUAL_DISCOUNT)) / 12),
            annualTotal: Math.round(PREMIUM_BRL * 12 * (1 - ANNUAL_DISCOUNT) * 100) / 100,
            savingsPct: 20,
        },
    },
    custom: {
        monthly: { brl: 0, savingsPct: 0 },
        annual:  { brl: 0, savingsPct: 0 },
    },
};

// Legacy USD alias (kept for any remaining UI that references usd)
export const PLAN_PRICING_USD_EQUIV = {
    pro: { monthly: 19, annual: 182 },
    premium: { monthly: 49, annual: 470 },
};

export const QUOTA_MAP: Record<SubscriptionPlan, number> = {
    free: 1,
    pro: 2,
    premium: 999, // unlimited / enterprise
    custom: 999,
};

const DEFAULT_SUBSCRIPTION: Subscription = {
    plan: 'free',
    billingCycle: 'monthly',
    status: 'inactive',
    activatedAt: null,
    nextRenewalAt: null,
    renewalIntervalMonths: 1,
    currency: null,
    localPrice: null,
    brlPrice: null,
    paymentReference: null,
};

/** Normalise legacy plan IDs stored in localStorage */
function normalisePlan(raw: string): SubscriptionPlan {
    if (raw === 'full') return 'premium'; // legacy alias
    if (['free', 'pro', 'premium', 'custom'].includes(raw)) return raw as SubscriptionPlan;
    return 'free';
}

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
    const [subscription, setSubscription] = useState<Subscription>(() => {
        try {
            const saved = localStorage.getItem('gtm-subscription');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Migrate old 'full' plan → 'premium'
                parsed.plan = normalisePlan(parsed.plan ?? 'free');
                return { ...DEFAULT_SUBSCRIPTION, ...parsed };
            }
        } catch { /* ignore */ }
        return DEFAULT_SUBSCRIPTION;
    });

    const [billingCycle, setBillingCycleState] = useState<BillingCycle>(() => {
        return (localStorage.getItem('gtm-billing-cycle') as BillingCycle) ?? 'monthly';
    });

    const [auditUsed, setAuditUsed] = useState<number>(() =>
        parseInt(localStorage.getItem('gtm-audit-count') ?? '0', 10)
    );

    useEffect(() => {
        localStorage.setItem('gtm-subscription', JSON.stringify(subscription));
    }, [subscription]);

    const setBillingCycle = useCallback((cycle: BillingCycle) => {
        setBillingCycleState(cycle);
        localStorage.setItem('gtm-billing-cycle', cycle);
    }, []);

    // Monthly audit quota reset
    useEffect(() => {
        const lastReset = localStorage.getItem('gtm-audit-reset-month');
        const currentMonth = new Date().toISOString().slice(0, 7);
        if (lastReset !== currentMonth) {
            setAuditUsed(0);
            localStorage.setItem('gtm-audit-count', '0');
            localStorage.setItem('gtm-audit-reset-month', currentMonth);
        }
    }, []);

    const activateSubscription = useCallback((
        plan: SubscriptionPlan,
        cycle: BillingCycle,
        opts: { currency?: string; localPrice?: string; brlPrice?: number; reference?: string } = {}
    ) => {
        const now = new Date();
        const renewal = new Date(now);
        const intervalMonths = cycle === 'annual' ? 12 : 1;
        renewal.setMonth(renewal.getMonth() + intervalMonths);

        setSubscription({
            plan,
            billingCycle: cycle,
            status: 'active',
            activatedAt: now.toISOString(),
            nextRenewalAt: renewal.toISOString(),
            renewalIntervalMonths: intervalMonths,
            currency: opts.currency ?? 'BRL',
            localPrice: opts.localPrice ?? null,
            brlPrice: opts.brlPrice ?? null,
            paymentReference: opts.reference ?? null,
        });
        setBillingCycleState(cycle);
        localStorage.setItem('gtm-billing-cycle', cycle);
        localStorage.removeItem('gtm-checkout-state');
    }, []);

    const markPending = useCallback((plan: SubscriptionPlan, cycle: BillingCycle) => {
        setSubscription(prev => ({ ...prev, plan, billingCycle: cycle, status: 'pending' }));
    }, []);

    const markFailed = useCallback(() => {
        setSubscription(prev => ({ ...prev, status: 'failed' }));
    }, []);

    const cancelSubscription = useCallback(() => {
        setSubscription(DEFAULT_SUBSCRIPTION);
        localStorage.removeItem('gtm-subscription');
    }, []);

    const consumeAudit = useCallback((): boolean => {
        const max = QUOTA_MAP[subscription.plan];
        if (auditUsed >= max) return false;
        const next = auditUsed + 1;
        setAuditUsed(next);
        localStorage.setItem('gtm-audit-count', String(next));
        return true;
    }, [subscription.plan, auditUsed]);

    return (
        <SubscriptionContext.Provider value={{
            subscription,
            billingCycle,
            setBillingCycle,
            activateSubscription,
            markFailed,
            markPending,
            cancelSubscription,
            auditQuota: { used: auditUsed, max: QUOTA_MAP[subscription.plan] },
            consumeAudit,
        }}>
            {children}
        </SubscriptionContext.Provider>
    );
};

export const useSubscription = () => {
    const ctx = useContext(SubscriptionContext);
    if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
    return ctx;
};
