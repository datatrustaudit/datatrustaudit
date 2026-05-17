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
            'plans.free.features.audits',
            'plans.free.features.dashboard',
            'plans.free.features.visibility',
            'plans.free.features.tag_count',
            'plans.free.features.summary_score',
            'plans.free.features.ai_chat',
        ],
        lockedKeys: [
            'plans.free.locked.exports',
            'plans.free.locked.lgpd_details',
            'plans.free.locked.history',
            'plans.free.locked.view_source',
            'plans.free.locked.html_location',
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
            'plans.pro.features.audits',
            'plans.pro.features.dashboard',
            'plans.pro.features.visibility',
            'plans.pro.features.violation_details',
            'plans.pro.features.exports',
            'plans.pro.features.ai_chat',
            'plans.pro.features.recommendations',
            'plans.pro.features.analysis',
        ],
        lockedKeys: [
            'plans.pro.locked.view_source_html',
            'plans.pro.locked.line_numbers',
            'plans.pro.locked.realtime',
            'plans.pro.locked.deep_scan',
            'plans.pro.locked.excel_export',
            'plans.pro.locked.support_priority',
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
            'plans.premium.features.audits',
            'plans.premium.features.visibility',
            'plans.premium.features.all_pro',
            'plans.premium.features.view_source_html',
            'plans.premium.features.line_numbers',
            'plans.premium.features.realtime',
            'plans.premium.features.deep_scan',
            'plans.premium.features.history',
            'plans.premium.features.exports',
            'plans.premium.features.support_priority',
            'plans.premium.features.advanced_recommendations',
            'plans.premium.features.lgpd_analysis',
        ],
        lockedKeys: [],
        pricing: {
            monthly: 49,
            annual: 470,
            savingsPct: 20,
        }
    }
};
