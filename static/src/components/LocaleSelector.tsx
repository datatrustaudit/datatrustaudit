/**
 * LocaleSelector — compact language + currency switcher for AppHeader.
 * Uses LocaleContext for persistent preference storage.
 * 
 * Compact mode: single dropdown combining language + currency (for header)
 * Expanded mode: two side-by-side select dropdowns (for pricing page)
 */

import { useState } from 'react';
import { useLocaleContext, SupportedCurrency, SupportedLanguage } from '@/context/LocaleContext';
import { useI18n } from '@/context/I18nContext';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Globe, ChevronDown, Check, RotateCcw, DollarSign } from 'lucide-react';

const LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
    { code: 'pt-BR', label: 'Português (BR)', flag: '🇧🇷' },
    { code: 'en', label: 'English',        flag: '🇺🇸' },
    { code: 'es', label: 'Español',        flag: '🇪🇸' },
    { code: 'fr', label: 'Français',       flag: '🇫🇷' },
    { code: 'de', label: 'Deutsch',        flag: '🇩🇪' },
    { code: 'it', label: 'Italiano',       flag: '🇮🇹' },
    { code: 'zh', label: '中文',           flag: '🇨🇳' },
    { code: 'ar', label: 'العربية',        flag: '🇸🇦' },
    { code: 'hi', label: 'हिन्दी',         flag: '🇮🇳' },
    { code: 'ja', label: '日本語',         flag: '🇯🇵' },
];

const CURRENCIES: { code: SupportedCurrency; label: string; symbol: string; flag: string }[] = [
    { code: 'BRL', label: 'BRL (R$)',      symbol: 'R$', flag: '🇧🇷' },
    { code: 'USD', label: 'USD ($)',       symbol: '$',  flag: '🇺🇸' },
    { code: 'EUR', label: 'EUR (€)',       symbol: '€',  flag: '🇪🇺' },
    { code: 'GBP', label: 'GBP (£)',       symbol: '£',  flag: '🇬🇧' },
    { code: 'MXN', label: 'MXN ($)',       symbol: '$',  flag: '🇲🇽' },
    { code: 'ARS', label: 'ARS ($)',       symbol: '$',  flag: '🇦🇷' },
    { code: 'CLP', label: 'CLP ($)',       symbol: '$',  flag: '🇨🇱' },
    { code: 'COP', label: 'COP ($)',       symbol: '$',  flag: '🇨🇴' },
    { code: 'CAD', label: 'CAD ($)',       symbol: '$',  flag: '🇨🇦' },
    { code: 'AUD', label: 'AUD ($)',       symbol: '$',  flag: '🇦🇺' },
];

interface LocaleSelectorProps {
    /** Show in compact mode (header) or expanded mode (pricing page) */
    compact?: boolean;
}

const LocaleSelector = ({ compact = true }: LocaleSelectorProps) => {
    const { currency, language, setCurrency, setLanguage, isManualOverride, resetToAuto } = useLocaleContext();
    const { setLanguage: setI18nLanguage, t } = useI18n();
    const [open, setOpen] = useState(false);

    const currentLang = LANGUAGES.find(l => l.code === language);
    const currentCurrency = CURRENCIES.find(c => c.code === currency);
    const currentLanguageCode = currentLang?.code === 'pt-BR' ? 'PT' : currentLang?.code.toUpperCase();

    const handleSetLanguage = (lang: SupportedLanguage) => {
        setLanguage(lang);
        setI18nLanguage(lang);
    };

    if (!compact) {
        // Expanded mode for Pricing page — two clean dropdown selects
        return (
            <div className="flex flex-col sm:flex-row gap-4 w-full max-w-lg mx-auto">
                {/* Language Dropdown */}
                <div className="flex-1 space-y-2">
                    <label className="text-white/40 text-[10px] uppercase tracking-widest font-bold block">
                        Idioma
                    </label>
                    <div className="relative">
                        <select
                            value={language}
                            onChange={(e) => handleSetLanguage(e.target.value as SupportedLanguage)}
                            className="w-full appearance-none bg-[#111827] border border-white/10 text-white text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 cursor-pointer hover:border-white/20 transition-colors"
                        >
                            {LANGUAGES.map(l => (
                                <option key={l.code} value={l.code}>
                                    {l.flag}  {l.label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                    </div>
                </div>

                {/* Currency Dropdown */}
                <div className="flex-1 space-y-2">
                    <label className="text-white/40 text-[10px] uppercase tracking-widest font-bold block">
                        Moeda
                    </label>
                    <div className="relative">
                        <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
                            className="w-full appearance-none bg-[#111827] border border-white/10 text-white text-sm rounded-xl px-4 py-3 pr-10 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 cursor-pointer hover:border-white/20 transition-colors"
                        >
                            {CURRENCIES.map(c => (
                                <option key={c.code} value={c.code}>
                                    {c.flag}  {c.label}
                                </option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40 pointer-events-none" />
                    </div>
                </div>

                {/* Reset to auto */}
                {isManualOverride && (
                    <div className="flex items-end">
                        <button
                            onClick={resetToAuto}
                            className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white/30 hover:text-white/60 text-xs transition-all hover:scale-105"
                            title={t('locale.reset')}
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Compact dropdown version for AppHeader
    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/80 hover:text-white text-sm font-medium">
                    <Globe className="w-4 h-4 text-blue-400" />
                    <span className="hidden sm:inline">{currentLanguageCode}</span>
                    <span className="text-white/20">|</span>
                    <span>{currentCurrency?.symbol} {currentCurrency?.code}</span>
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="end"
                className="w-64 bg-slate-900/95 border-white/10 backdrop-blur-2xl text-white shadow-2xl p-2"
            >
                <div className="max-h-[80vh] overflow-y-auto custom-scrollbar">
                    {/* Language section */}
                    <DropdownMenuLabel className="text-white/30 text-[10px] uppercase tracking-widest font-bold px-3 py-2 flex items-center gap-2">
                        <Globe className="w-3 h-3" />
                        {t('locale.language')}
                    </DropdownMenuLabel>
                    <div className="grid grid-cols-1 gap-1">
                        {LANGUAGES.map(l => (
                            <DropdownMenuItem
                                key={l.code}
                                onClick={() => handleSetLanguage(l.code)}
                                className={`flex items-center justify-between px-3 py-2.5 cursor-pointer rounded-lg transition-colors ${
                                    language === l.code ? 'bg-blue-500/20 text-blue-400' : 'hover:bg-white/5 focus:bg-white/5 text-white/70'
                                }`}
                            >
                                <span className="flex items-center gap-3">
                                    <span className="text-lg leading-none">{l.flag}</span>
                                    <span className="text-sm font-medium">{l.label}</span>
                                </span>
                                {language === l.code && <Check className="w-4 h-4" />}
                            </DropdownMenuItem>
                        ))}
                    </div>

                    <DropdownMenuSeparator className="bg-white/5 my-2" />

                    {/* Currency section */}
                    <DropdownMenuLabel className="text-white/30 text-[10px] uppercase tracking-widest font-bold px-3 py-2 flex items-center gap-2">
                        <DollarSign className="w-3 h-3" />
                        {t('locale.currency')}
                    </DropdownMenuLabel>
                    <div className="grid grid-cols-2 gap-1 px-1">
                        {CURRENCIES.map(c => (
                            <DropdownMenuItem
                                key={c.code}
                                onClick={() => setCurrency(c.code)}
                                className={`flex items-center gap-2 px-2.5 py-2 cursor-pointer rounded-lg transition-colors ${
                                    currency === c.code ? 'bg-indigo-500/20 text-indigo-400' : 'hover:bg-white/5 focus:bg-white/5 text-white/60'
                                }`}
                            >
                                <span className="text-xs font-bold w-8">{c.symbol}</span>
                                <span className="text-xs font-medium">{c.code}</span>
                                {currency === c.code && <Check className="w-3 h-3 ml-auto" />}
                            </DropdownMenuItem>
                        ))}
                    </div>

                    {/* Reset to auto */}
                    {isManualOverride && (
                        <>
                            <DropdownMenuSeparator className="bg-white/5 my-2" />
                            <DropdownMenuItem
                                onClick={resetToAuto}
                                className="flex items-center gap-2 px-3 py-3 cursor-pointer hover:bg-white/5 focus:bg-white/5 text-white/30 hover:text-white/60 rounded-lg"
                            >
                                <RotateCcw className="w-4 h-4" />
                                <span className="text-xs font-medium">{t('locale.reset')}</span>
                            </DropdownMenuItem>
                        </>
                    )}
                </div>
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default LocaleSelector;
