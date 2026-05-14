/**
 * Subscription context — subscription-ready architecture.
 *
 * Billing flow:
 *   1. User selects plan + billing cycle on /pricing
 *   2. Data saved to localStorage (gtm-selected-plan, gtm-billing-cycle)
 *   3. /checkout reads params + displays full subscription summary
 *   4. "Pagar" → redirect to Mercado Pago hosted checkout (secure redirect)
 *   5. MP returns to /payment/success?plan=X&cycle=Y&ref=MPID
 *   6. This context activateSubscription() is called → plan entitlements applied
 *
 * Annual pricing strategy:
 *   Pro: USD 19/mo or USD 182/yr (20% off = ~USD 15.17/mo)
 *   Premium: USD 49/mo or USD 470/yr (20% off = ~USD 39.17/mo)
 */

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export type SubscriptionPlan = 'free' | 'pro' | 'premium';
export type BillingCycle = 'monthly' | 'annual';
export type SubscriptionStatus = 'inactive' | 'active' | 'pending' | 'failed' | 'cancelled' | 'past_due' | 'trial';

export interface Subscription {
    plan: SubscriptionPlan;
    billingCycle: BillingCycle;
    status: SubscriptionStatus;
    activatedAt: string | null;
    /** Next renewal date ISO string */
    nextRenewalAt: string | null;
    /** In months: 1 for monthly, 12 for annual */
    renewalIntervalMonths: number;
    currency: string | null;
    localPrice: string | null;
    usdPrice: number | null;
    /** Mercado Pago subscription/preapproval ID */
    paymentProviderRef: string | null;
}

interface SubscriptionContextValue {
    subscription: Subscription;
    billingCycle: BillingCycle;
    setBillingCycle: (cycle: BillingCycle) => void;
    activateSubscription: (
        plan: SubscriptionPlan,
        cycle: BillingCycle,
        opts?: { currency?: string; localPrice?: string; usdPrice?: number; providerRef?: string }
    ) => void;
    markFailed: () => void;
    markPending: (plan: SubscriptionPlan, cycle: BillingCycle) => void;
    cancelSubscription: () => void;
    auditQuota: { used: number; max: number };
    consumeAudit: () => boolean;
}

// ── Pricing matrix ───────────────────────────────────────────────────────────
export const PLAN_PRICING: Record<SubscriptionPlan, Record<BillingCycle, { usd: number; savingsPct: number }>> = {
    free: {
        monthly: { usd: 0, savingsPct: 0 },
        annual:  { usd: 0, savingsPct: 0 },
    },
    pro: {
        monthly: { usd: 19,  savingsPct: 0 },
        annual:  { usd: 182, savingsPct: 20 },   // 182/12 ≈ 15.17/mo
    },
    premium: {
        monthly: { usd: 49,  savingsPct: 0 },
        annual:  { usd: 470, savingsPct: 20 },   // 470/12 ≈ 39.17/mo
    },
};

export const QUOTA_MAP: Record<SubscriptionPlan, number> = {
    free: 1,
    pro: 2,
    premium: 3,
};

// ── Defaults ─────────────────────────────────────────────────────────────────
const DEFAULT_SUBSCRIPTION: Subscription = {
    plan: 'free',
    billingCycle: 'monthly',
    status: 'inactive',
    activatedAt: null,
    nextRenewalAt: null,
    renewalIntervalMonths: 1,
    currency: null,
    localPrice: null,
    usdPrice: null,
    paymentProviderRef: null,
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export const SubscriptionProvider = ({ children }: { children: ReactNode }) => {
    const [subscription, setSubscription] = useState<Subscription>(() => {
        try {
            const saved = localStorage.getItem('gtm-subscription');
            if (saved) {
                const parsed = JSON.parse(saved);
                // Migration: add new fields if missing from old storage
                return { ...DEFAULT_SUBSCRIPTION, ...parsed };
            }
        } catch { /* ignore */ }
        return DEFAULT_SUBSCRIPTION;
    });

    // Global billing cycle toggle — persisted across page navigations
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
        opts: { currency?: string; localPrice?: string; usdPrice?: number; providerRef?: string } = {}
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
            currency: opts.currency ?? null,
            localPrice: opts.localPrice ?? null,
            usdPrice: opts.usdPrice ?? null,
            paymentProviderRef: opts.providerRef ?? null,
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
