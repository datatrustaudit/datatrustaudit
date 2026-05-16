import { PlanType } from '../context/PlanContext';

export interface PlanPricing {
    monthly: number;
    annual: number;
    savingsPct: number;
}

export interface PlanConfig {
    id: PlanType;
    labelKey: string;
    badgeKey: string;
    visibility: number;
    auditsPerMonth: number;
    featuresKeys: string[];
    lockedKeys: string[];
    pricing: PlanPricing;
}

export const PRICING_CONFIG: Record<PlanType, PlanConfig> = {
    free: {
        id: 'free',
        labelKey: 'plans.free.label',
        badgeKey: 'plans.free.badge',
        visibility: 10,
        auditsPerMonth: 1,
        featuresKeys: [
            'plans.free.feature1',
            'plans.free.feature2',
            'plans.free.feature3',
            'plans.free.feature4',
            'plans.free.feature5',
        ],
        lockedKeys: [
            'plans.free.locked1',
            'plans.free.locked2',
            'plans.free.locked3',
            'plans.free.locked4',
            'plans.free.locked5',
        ],
        pricing: {
            monthly: 0,
            annual: 0,
            savingsPct: 0,
        }
    },
    pro: {
        id: 'pro',
        labelKey: 'plans.pro.label',
        badgeKey: 'plans.pro.badge',
        visibility: 70,
        auditsPerMonth: 2,
        featuresKeys: [
            'plans.pro.feature1',
            'plans.pro.feature2',
            'plans.pro.feature3',
            'plans.pro.feature4',
            'plans.pro.feature5',
        ],
        lockedKeys: [
            'plans.pro.locked1',
            'plans.pro.locked2',
            'plans.pro.locked3',
            'plans.pro.locked4',
        ],
        pricing: {
            monthly: 19,
            annual: 182,
            savingsPct: 20,
        }
    },
    premium: {
        id: 'premium',
        labelKey: 'plans.premium.label',
        badgeKey: 'plans.premium.badge',
        visibility: 100,
        auditsPerMonth: 3,
        featuresKeys: [
            'plans.premium.feature1',
            'plans.premium.feature2',
            'plans.premium.feature3',
            'plans.premium.feature4',
            'plans.premium.feature5',
            'plans.premium.feature6',
            'plans.premium.feature7',
        ],
        lockedKeys: [],
        pricing: {
            monthly: 49,
            annual: 470,
            savingsPct: 20,
        }
    }
};
