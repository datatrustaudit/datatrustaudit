import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import pt from '../translations/pt.json';
import en from '../translations/en.json';
import es from '../translations/es.json';
import fr from '../translations/fr.json';
import de from '../translations/de.json';
import it from '../translations/it.json';
import nl from '../translations/nl.json';
import ar from '../translations/ar.json';
import hi from '../translations/hi.json';
import zh from '../translations/zh.json';
import ja from '../translations/ja.json';

export type Language = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'nl' | 'ar' | 'hi' | 'zh' | 'ja';
export const SUPPORTED_LANGUAGES: Language[] = ['pt', 'en', 'es', 'fr', 'de', 'it', 'nl', 'ar', 'hi', 'zh', 'ja'];

interface I18nContextType {
    language: Language;
    t: (key: string) => string;
    setLanguage: (lang: Language) => void;
}

const translations: Record<Language, Record<string, unknown>> = { pt, en, es, fr, de, it, nl, ar, hi, zh, ja };

const I18nContext = createContext<I18nContextType | null>(null);

export const I18nProvider = ({ children }: { children: ReactNode }) => {
    const [language, setLanguageState] = useState<Language>(() => {
        // 1. Respect previously saved preference
        const saved = localStorage.getItem('gtm-audit-lang');
        if (saved && SUPPORTED_LANGUAGES.includes(saved as Language)) return saved as Language;

        // 2. Suggest based on browser locale (but default to EN for anything non-PT)
        const browserLang = navigator.language.split('-')[0].toLowerCase() as Language;
        if (SUPPORTED_LANGUAGES.includes(browserLang)) return browserLang;

        // 3. Hard default: English
        return 'en';
    });

    const setLanguage = (lang: Language) => {
        if (!SUPPORTED_LANGUAGES.includes(lang)) return;
        setLanguageState(lang);
    };

    useEffect(() => {
        localStorage.setItem('gtm-audit-lang', language);
        document.documentElement.lang = language;
    }, [language]);

    const t = (keyPath: string): string => {
        // Walk nested translation object
        const keys = keyPath.split('.');
        const walk = (obj: Record<string, unknown>): string | undefined => {
            let current: unknown = obj;
            for (const key of keys) {
                if (!current || typeof current !== 'object') return undefined;
                current = (current as Record<string, unknown>)[key];
            }
            return typeof current === 'string' ? current : undefined;
        };

        // Try current language
        const result = walk(translations[language]);
        if (result !== undefined) return result;

        // Fallback to English
        if (language !== 'en') {
            const enResult = walk(translations.en);
            if (enResult !== undefined) return enResult;
        }

        // Last resort: humanize key
        const lastKey = keys[keys.length - 1];
        const humanized = lastKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        console.warn(`[i18n] Missing key: "${keyPath}"`);
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
