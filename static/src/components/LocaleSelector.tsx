/**
 * LocaleSelector — compact language + currency switcher for AppHeader.
 * Uses LocaleContext for persistent preference storage.
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
    { code: 'pt', label: 'Português (BR)', flag: '🇧🇷' },
    { code: 'en', label: 'English',        flag: '🇺🇸' },
    { code: 'es', label: 'Español',        flag: '🇪🇸' },
    { code: 'fr', label: 'Français',       flag: '🇫🇷' },
    { code: 'zh', label: '中文',           flag: '🇨🇳' },
    { code: 'de', label: 'Deutsch',        flag: '🇩🇪' },
    { code: 'it', label: 'Italiano',       flag: '🇮🇹' },
    { code: 'ar', label: 'العربية',        flag: '🇸🇦' },
    { code: 'hi', label: 'हिन्दी',         flag: '🇮🇳' },
    { code: 'ja', label: '日本語',         flag: '🇯🇵' },
];

const CURRENCIES: { code: SupportedCurrency; label: string; symbol: string; flag: string }[] = [
    { code: 'BRL', label: 'Real (BRL)',    symbol: 'R$', flag: '🇧🇷' },
    { code: 'USD', label: 'Dollar (USD)',  symbol: '$',  flag: '🇺🇸' },
    { code: 'EUR', label: 'Euro (EUR)',    symbol: '€',  flag: '🇪🇺' },
    { code: 'GBP', label: 'Pound (GBP)',   symbol: '£',  flag: '🇬🇧' },
    { code: 'MXN', label: 'Peso (MXN)',    symbol: '$',  flag: '🇲🇽' },
    { code: 'ARS', label: 'Peso (ARS)',    symbol: '$',  flag: '🇦🇷' },
    { code: 'CLP', label: 'Peso (CLP)',    symbol: '$',  flag: '🇨🇱' },
    { code: 'COP', label: 'Peso (COP)',    symbol: '$',  flag: '🇨🇴' },
    { code: 'CAD', label: 'Dollar (CAD)',  symbol: '$',  flag: '🇨🇦' },
    { code: 'AUD', label: 'Dollar (AUD)',  symbol: '$',  flag: '🇦🇺' },
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

    const handleSetLanguage = (lang: SupportedLanguage) => {
        setLanguage(lang);
        setI18nLanguage(lang); // keep I18nContext in sync
    };

    if (!compact) {
        // Expanded inline version for Pricing page
        return (
            <div className="flex flex-col gap-6 w-full max-w-2xl mx-auto">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Language Selection */}
                    <div className="space-y-3">
                        <label className="text-white/40 text-[10px] uppercase tracking-widest font-bold block">
                            {t('locale.language')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {LANGUAGES.map(l => (
                                <button
                                    key={l.code}
                                    onClick={() => handleSetLanguage(l.code)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 border ${
                                        language === l.code
                                            ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]'
                                            : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white'
                                    }`}
                                >
                                    <span>{l.flag}</span>
                                    <span>{l.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Currency Selection */}
                    <div className="space-y-3">
                        <label className="text-white/40 text-[10px] uppercase tracking-widest font-bold block">
                            {t('locale.currency')}
                        </label>
                        <div className="flex flex-wrap gap-2">
                            {CURRENCIES.map(c => (
                                <button
                                    key={c.code}
                                    onClick={() => setCurrency(c.code)}
                                    className={`px-4 py-2 rounded-xl text-sm font-medium transition-all flex items-center gap-2 border ${
                                        currency === c.code
                                            ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.3)]'
                                            : 'bg-white/5 border-white/10 text-white/60 hover:border-white/20 hover:text-white'
                                    }`}
                                >
                                    <span>{c.flag}</span>
                                    <span>{c.code} ({c.symbol})</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {isManualOverride && (
                    <div className="flex justify-center">
                        <button
                            onClick={resetToAuto}
                            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/30 hover:text-white/60 text-xs transition-all hover:scale-105"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {t('locale.reset')}
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
                    <span className="hidden sm:inline">{currentLang?.code.toUpperCase()}</span>
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
