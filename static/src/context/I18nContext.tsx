import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import pt from '../translations/pt.json';
import en from '../translations/en.json';

type Language = 'pt' | 'en';

interface I18nContextType {
    language: Language;
    t: (key: string) => string;
    setLanguage: (lang: Language) => void;
}

const translations: Record<Language, Record<string, unknown>> = { pt, en };

/**
 * Flat fallback map for keys that might be missing from translation files.
 * Prevents raw key strings from ever reaching the UI (e.g. "home.audit_button").
 */
const FALLBACK_PT: Record<string, string> = {
    'home.audit_button': 'Auditar',
    'home.audit_btn': 'Auditar',
    'home.analyzing': 'Analisando...',
    'home.audit_description': 'Detecte violações de privacidade e riscos LGPD automaticamente.',
    'home.deep_scan': 'Deep Scan',
    'nav.login': 'Entrar',
    'nav.signup': 'Cadastrar',
    'nav.pricing': 'Planos',
    'nav.change_plan': 'Mudar plano',
    'buttons.copy': 'Copiar',
    'buttons.export_pdf': 'PDF',
    'buttons.export_excel': 'Excel',
    'buttons.export_json': 'JSON',
    'buttons.pay_now': 'Pagar agora',
    'buttons.fix_with_ai': 'Corrigir com IA',
    'features.locked': 'Bloqueado',
    'features.premium_badge': 'PRO',
    'features.upgrade_to_unlock': 'Faça upgrade para desbloquear',
    'plans.most_popular': 'Mais Popular',
    'plans.best_value': 'Melhor Custo-Benefício',
    'plans.change_plan': 'Mudar plano',
    'subscription.active': 'Ativo',
    'subscription.pending': 'Pendente',
    'errors.blocked_403': 'O site bloqueia análises automáticas. Use a aba Upload ou View-Source.',
};

const FALLBACK_EN: Record<string, string> = {
    'home.audit_button': 'Audit',
    'home.audit_btn': 'Audit',
    'home.analyzing': 'Analyzing...',
    'home.audit_description': 'Automatically detect privacy violations and LGPD/GDPR compliance risks.',
    'home.deep_scan': 'Deep Scan',
    'nav.login': 'Login',
    'nav.signup': 'Sign Up',
    'nav.pricing': 'Pricing',
    'nav.change_plan': 'Change plan',
    'buttons.copy': 'Copy',
    'buttons.export_pdf': 'PDF',
    'buttons.export_excel': 'Excel',
    'buttons.export_json': 'JSON',
    'buttons.pay_now': 'Pay now',
    'buttons.fix_with_ai': 'Fix with AI',
    'features.locked': 'Locked',
    'features.premium_badge': 'PRO',
    'features.upgrade_to_unlock': 'Upgrade to unlock',
    'plans.most_popular': 'Most Popular',
    'plans.best_value': 'Best Value',
    'plans.change_plan': 'Change plan',
    'subscription.active': 'Active',
    'subscription.pending': 'Pending',
    'errors.blocked_403': 'This site blocks automated analysis. Use the Upload or View-Source tab.',
};

const FALLBACKS: Record<Language, Record<string, string>> = { pt: FALLBACK_PT, en: FALLBACK_EN };

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguage] = useState<Language>(() => {
        const saved = localStorage.getItem('gtm-audit-lang');
        if (saved && (saved === 'pt' || saved === 'en')) return saved as Language;
        const browserLang = navigator.language.split('-')[0];
        return browserLang === 'pt' ? 'pt' : 'en';
    });

    useEffect(() => {
        localStorage.setItem('gtm-audit-lang', language);
        document.documentElement.lang = language;
    }, [language]);

    const t = (keyPath: string): string => {
        // Walk the nested object
        const keys = keyPath.split('.');
        let current: unknown = translations[language];
        for (const key of keys) {
            if (current === null || typeof current !== 'object') { current = undefined; break; }
            current = (current as Record<string, unknown>)[key];
        }
        if (typeof current === 'string') return current;

        // Try fallback map for this language
        const fb = FALLBACKS[language][keyPath];
        if (fb) return fb;

        // Try opposite language's translation
        const altLang: Language = language === 'pt' ? 'en' : 'pt';
        let altCurrent: unknown = translations[altLang];
        for (const key of keys) {
            if (altCurrent === null || typeof altCurrent !== 'object') { altCurrent = undefined; break; }
            altCurrent = (altCurrent as Record<string, unknown>)[key];
        }
        if (typeof altCurrent === 'string') return altCurrent;

        // Last resort: humanize the last segment of the key
        const lastKey = keys[keys.length - 1];
        const humanized = lastKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        console.warn(`[i18n] Missing key: "${keyPath}" — showing: "${humanized}"`);
        return humanized;
    };

    return (
        <I18nContext.Provider value={{ language, t, setLanguage }}>
            {children}
        </I18nContext.Provider>
    );
};

export const useI18n = () => {
    const context = useContext(I18nContext);
    if (!context) throw new Error('useI18n must be used within I18nProvider');
    return context;
};
