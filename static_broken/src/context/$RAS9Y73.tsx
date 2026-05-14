/**
 * LocaleContext — unified locale detection + manual override system.
 *
 * Detection priority:
 *   1. Saved user preference (localStorage) — manual override wins
 *   2. Timezone (Intl.DateTimeFormat)
 *   3. Browser navigator.language
 *   4. Fallback → en-US + USD
 *
 * Market-facing pricing (USD base):
 *   Pro:     USD 19/mo  → BRL ~R$ 111/mês  | EUR ~€18/mo | GBP ~£15/mo
 *   Premium: USD 49/mo  → BRL ~R$ 287/mês  | EUR ~€46/mo | GBP ~£39/mo
 *
 * For Brazil, we display R$ 97/mês (Pro) and R$ 247/mês (Premium) as
 * market-facing prices. These override the raw conversion.
 */

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SupportedCurrency = 'USD' | 'BRL' | 'EUR' | 'GBP' | 'MXN' | 'ARS' | 'CLP' | 'COP' | 'CAD' | 'AUD';
export type SupportedLanguage = 'pt' | 'en' | 'es' | 'fr' | 'de' | 'it' | 'nl' | 'ar' | 'hi' | 'zh' | 'ja';
export type RegionCode = 'BR' | 'US' | 'EU' | 'UK' | 'OTHER';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['pt', 'en', 'es', 'fr', 'de', 'it', 'nl', 'ar', 'hi', 'zh', 'ja'];

export interface LocaleInfo {
    currencyCode: SupportedCurrency;
    locale: string;
    region: RegionCode;
    language: SupportedLanguage;
}

interface LocaleContextValue {
    locale: LocaleInfo;
    currency: SupportedCurrency;
    language: SupportedLanguage;
    setCurrency: (c: SupportedCurrency) => void;
    setLanguage: (l: SupportedLanguage) => void;
    formatPrice: (usdPrice: number) => string;
    formatBrlPrice: (brl: number) => string;
    isManualOverride: boolean;
    resetToAuto: () => void;
}

// ── Timezone → region map ─────────────────────────────────────────────────────

const TZ_REGION: Record<string, RegionCode> = {
    'America/Sao_Paulo': 'BR', 'America/Manaus': 'BR', 'America/Belem': 'BR',
    'America/Fortaleza': 'BR', 'America/Recife': 'BR', 'America/Noronha': 'BR',
    'America/Maceio': 'BR', 'America/Cuiaba': 'BR', 'America/Porto_Velho': 'BR',
    'America/Boa_Vista': 'BR', 'America/Rio_Branco': 'BR', 'America/Araguaina': 'BR',
    'America/Bahia': 'BR', 'America/Campo_Grande': 'BR',
    'America/New_York': 'US', 'America/Los_Angeles': 'US', 'America/Chicago': 'US',
    'America/Denver': 'US', 'America/Phoenix': 'US', 'America/Anchorage': 'US',
    'Pacific/Honolulu': 'US', 'America/Detroit': 'US', 'America/Indiana/Indianapolis': 'US',
    'Europe/London': 'UK',
    'Europe/Berlin': 'EU', 'Europe/Paris': 'EU', 'Europe/Madrid': 'EU',
    'Europe/Rome': 'EU', 'Europe/Amsterdam': 'EU', 'Europe/Brussels': 'EU',
    'Europe/Vienna': 'EU', 'Europe/Warsaw': 'EU', 'Europe/Lisbon': 'EU',
    'Europe/Athens': 'EU', 'Europe/Helsinki': 'EU', 'Europe/Stockholm': 'EU',
    'Europe/Copenhagen': 'EU', 'Europe/Dublin': 'EU', 'Europe/Zurich': 'EU',
};

// ── Exchange rates (USD base, approx 2025) ─────────────────────────────────

export const CONVERSION_RATES: Record<SupportedCurrency, number> = {
    USD: 1,
    BRL: 5.85,
    EUR: 0.93,
    GBP: 0.80,
    MXN: 17.20,
    ARS: 1050,
    CLP: 950,
    COP: 4200,
    CAD: 1.37,
    AUD: 1.55,
};

/** Market-facing price overrides for Brazil (display value, not converted) */
export const BR_PRICE_OVERRIDES: Record<number, number> = {
    19: 97,    // Pro monthly
    49: 247,   // Premium monthly
    182: 970,  // Pro annual
    470: 2470, // Premium annual
};

// ── Region helpers ─────────────────────────────────────────────────────────────

function detectRegion(tz: string, browserLang: string): RegionCode {
    if (TZ_REGION[tz]) return TZ_REGION[tz];
    if (tz.startsWith('America/')) return browserLang.startsWith('pt') ? 'BR' : 'US';
    if (tz.startsWith('Europe/')) return tz === 'Europe/London' ? 'UK' : 'EU';
    if (browserLang.startsWith('pt')) return 'BR';
    return 'OTHER';
}

function regionToLocaleInfo(region: RegionCode, _browserLang: string): LocaleInfo {
    switch (region) {
        case 'BR': return { currencyCode: 'BRL', locale: 'pt-BR', region, language: 'pt' };
        case 'UK': return { currencyCode: 'GBP', locale: 'en-GB', region, language: 'en' };
        case 'EU': return { currencyCode: 'EUR', locale: 'de-DE', region, language: 'en' };
        case 'US': return { currencyCode: 'USD', locale: 'en-US', region, language: 'en' };
        default:
            return { currencyCode: 'USD', locale: 'en-US', region: 'OTHER', language: 'en' };
    }
}

function detectAutoLocale(): LocaleInfo {
    try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const browserLang = navigator.language;
        const region = detectRegion(tz, browserLang);
        return regionToLocaleInfo(region, browserLang);
    } catch {
        return { currencyCode: 'USD', locale: 'en-US', region: 'OTHER', language: 'en' };
    }
}

// ── Currency locale map ────────────────────────────────────────────────────────

const CURRENCY_LOCALE: Record<SupportedCurrency, string> = {
    USD: 'en-US', BRL: 'pt-BR', EUR: 'de-DE', GBP: 'en-GB',
    MXN: 'es-MX', ARS: 'es-AR', CLP: 'es-CL', COP: 'es-CO',
    CAD: 'en-CA', AUD: 'en-AU',
};

// ── Context ───────────────────────────────────────────────────────────────────

const LocaleContext = createContext<LocaleContextValue | null>(null);

const STORAGE_CURRENCY = 'gtm-locale-currency';
const STORAGE_LANGUAGE  = 'gtm-locale-language';
const STORAGE_OVERRIDE  = 'gtm-locale-manual';

export const LocaleProvider = ({ children }: { children: ReactNode }) => {
    const autoLocale = detectAutoLocale();

    const [currency, setCurrencyState] = useState<SupportedCurrency>(() => {
        const saved = localStorage.getItem(STORAGE_CURRENCY) as SupportedCurrency | null;
        const validCurrencies: SupportedCurrency[] = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'ARS', 'CLP', 'COP', 'CAD', 'AUD'];
        return saved && validCurrencies.includes(saved) ? saved : autoLocale.currencyCode;
    });

    const [language, setLanguageState] = useState<SupportedLanguage>(() => {
        const saved = localStorage.getItem(STORAGE_LANGUAGE) as SupportedLanguage | null;
        return saved && SUPPORTED_LANGUAGES.includes(saved) ? saved : autoLocale.language;
    });

    const [isManualOverride, setIsManualOverride] = useState<boolean>(() =>
        localStorage.getItem(STORAGE_OVERRIDE) === 'true'
    );

    const setCurrency = useCallback((c: SupportedCurrency) => {
        setCurrencyState(c);
        localStorage.setItem(STORAGE_CURRENCY, c);
        localStorage.setItem(STORAGE_OVERRIDE, 'true');
        setIsManualOverride(true);
    }, []);

    const setLanguage = useCallback((l: SupportedLanguage) => {
        setLanguageState(l);
        localStorage.setItem(STORAGE_LANGUAGE, l);
        // Also sync with I18nContext storage key so both contexts agree
        localStorage.setItem('gtm-audit-lang', l);
        localStorage.setItem(STORAGE_OVERRIDE, 'true');
        setIsManualOverride(true);
    }, []);

    const resetToAuto = useCallback(() => {
        setCurrencyState(autoLocale.currencyCode);
        setLanguageState(autoLocale.language);
        localStorage.removeItem(STORAGE_CURRENCY);
        localStorage.removeItem(STORAGE_LANGUAGE);
        localStorage.removeItem(STORAGE_OVERRIDE);
        localStorage.setItem('gtm-audit-lang', autoLocale.language);
        setIsManualOverride(false);
    }, [autoLocale]);

    const locale: LocaleInfo = {
        ...autoLocale,
        currencyCode: currency,
        language,
        locale: CURRENCY_LOCALE[currency] ?? autoLocale.locale,
    };

    const formatPrice = useCallback((usdPrice: number): string => {
        if (usdPrice === 0) return currency === 'BRL' ? 'Grátis' : 'Free';
        let localAmount: number;
        // Use market-facing BR overrides if currency is BRL
        if (currency === 'BRL' && BR_PRICE_OVERRIDES[usdPrice]) {
            localAmount = BR_PRICE_OVERRIDES[usdPrice];
        } else {
            const rate = CONVERSION_RATES[currency] ?? 1;
            localAmount = Math.round(usdPrice * rate);
        }
        return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(localAmount);
    }, [currency]);

    // Format BRL price directly (for the new BRL-primary pricing)
    const formatBrlPrice = useCallback((brl: number): string => {
        if (brl === 0) return 'Free';
        // Convert BRL to selected currency using approximate rate
        if (currency === 'BRL') {
            return `R$ ${brl.toLocaleString('pt-BR')}`;
        }
        const usdEquiv = brl / 5.85;
        return new Intl.NumberFormat(CURRENCY_LOCALE[currency] ?? 'en-US', {
            style: 'currency',
            currency,
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        }).format(usdEquiv * (CONVERSION_RATES[currency] ?? 1));
    }, [currency]);

    return (
        <LocaleContext.Provider value={{
            locale,
            currency,
            language,
            setCurrency,
            setLanguage,
            formatPrice,
            formatBrlPrice,
            isManualOverride,
            resetToAuto,
        }}>
            {children}
        </LocaleContext.Provider>
    );
};

export const useLocaleContext = () => {
    const ctx = useContext(LocaleContext);
    if (!ctx) throw new Error('useLocaleContext must be used within LocaleProvider');
    return ctx;
};

// ── Legacy compatibility: keep useLocale as a thin wrapper ────────────────────

export interface LocaleInfoLegacy {
    currencyCode: string;
    currencySymbol: string;
    locale: string;
    region: RegionCode;
    language: SupportedLanguage;
}

const CURRENCY_SYMBOL: Record<SupportedCurrency, string> = {
    USD: '$', BRL: 'R$', EUR: '€', GBP: '£',
    MXN: 'MX$', ARS: 'ARS$', CLP: 'CLP$', COP: 'COP$',
    CAD: 'CA$', AUD: 'A$',
};

/** @deprecated Use useLocaleContext() instead. Kept for backward compatibility. */
export function useLocale(): LocaleInfoLegacy & { currencyCode: SupportedCurrency } {
    const ctx = useContext(LocaleContext);
    if (ctx) {
        return {
            currencyCode: ctx.currency,
            currencySymbol: CURRENCY_SYMBOL[ctx.currency] ?? '$',
            locale: ctx.locale.locale,
            region: ctx.locale.region,
            language: ctx.locale.language,
        };
    }
    // Fallback if used outside provider (shouldn't happen in production)
    const auto = detectAutoLocale();
    return {
        currencyCode: auto.currencyCode,
        currencySymbol: CURRENCY_SYMBOL[auto.currencyCode] ?? '$',
        locale: auto.locale,
        region: auto.region,
        language: auto.language,
    };
}

export { CURRENCY_SYMBOL };
