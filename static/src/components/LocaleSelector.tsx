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
import { Globe, ChevronDown, Check, RotateCcw } from 'lucide-react';

const LANGUAGES: { code: SupportedLanguage; label: string; flag: string }[] = [
    { code: 'pt', label: 'Português (BR)', flag: '🇧🇷' },
    { code: 'en', label: 'English',        flag: '🇺🇸' },
];

const CURRENCIES: { code: SupportedCurrency; label: string; symbol: string; flag: string }[] = [
    { code: 'BRL', label: 'Real (BRL)',    symbol: 'R$', flag: '🇧🇷' },
    { code: 'USD', label: 'Dollar (USD)',  symbol: '$',  flag: '🇺🇸' },
    { code: 'EUR', label: 'Euro (EUR)',    symbol: '€',  flag: '🇪🇺' },
    { code: 'GBP', label: 'Pound (GBP)',  symbol: '£',  flag: '🇬🇧' },
];

interface LocaleSelectorProps {
    /** Show in compact mode (header) or expanded mode (pricing page) */
    compact?: boolean;
}

const LocaleSelector = ({ compact = true }: LocaleSelectorProps) => {
    const { currency, language, setCurrency, setLanguage, isManualOverride, resetToAuto } = useLocaleContext();
    const { setLanguage: setI18nLanguage } = useI18n();
    const [open, setOpen] = useState(false);

    const currentLang = LANGUAGES.find(l => l.code === language);
    const currentCurrency = CURRENCIES.find(c => c.code === currency);

    const handleSetLanguage = (lang: SupportedLanguage) => {
        setLanguage(lang);
        setI18nLanguage(lang); // keep I18nContext in sync
    };

    if (!compact) {
        // Expanded inline version for Pricing page sidebar
        return (
            <div className="flex flex-wrap gap-3 items-center">
                {/* Language pills */}
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
                    {LANGUAGES.map(l => (
                        <button
                            key={l.code}
                            onClick={() => handleSetLanguage(l.code)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                language === l.code
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-white/60 hover:text-white'
                            }`}
                        >
                            {l.flag} {l.code.toUpperCase()}
                        </button>
                    ))}
                </div>

                {/* Currency pills */}
                <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
                    {CURRENCIES.map(c => (
                        <button
                            key={c.code}
                            onClick={() => setCurrency(c.code)}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                currency === c.code
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-white/60 hover:text-white'
                            }`}
                        >
                            {c.symbol} {c.code}
                        </button>
                    ))}
                </div>

                {isManualOverride && (
                    <button
                        onClick={resetToAuto}
                        className="flex items-center gap-1 text-white/30 hover:text-white/60 text-xs transition-colors"
                        title="Reset to auto-detected"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Auto
                    </button>
                )}
            </div>
        );
    }

    // Compact dropdown version for AppHeader
    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/70 hover:text-white text-xs font-medium">
                    <Globe className="w-3.5 h-3.5" />
                    <span>{currentLang?.flag} {currentCurrency?.symbol}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="end"
                className="w-52 bg-slate-900/95 border-white/10 backdrop-blur-xl text-white"
            >
                {/* Language section */}
                <DropdownMenuLabel className="text-white/40 text-xs font-medium px-3 py-2 flex items-center gap-1.5">
                    <Globe className="w-3 h-3" />
                    Language
                </DropdownMenuLabel>
                {LANGUAGES.map(l => (
                    <DropdownMenuItem
                        key={l.code}
                        onClick={() => handleSetLanguage(l.code)}
                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 text-white/80 hover:text-white rounded-md mx-1"
                    >
                        <span className="flex items-center gap-2">
                            <span>{l.flag}</span>
                            <span className="text-sm">{l.label}</span>
                        </span>
                        {language === l.code && <Check className="w-3.5 h-3.5 text-blue-400" />}
                    </DropdownMenuItem>
                ))}

                <DropdownMenuSeparator className="bg-white/10 my-1" />

                {/* Currency section */}
                <DropdownMenuLabel className="text-white/40 text-xs font-medium px-3 py-2">
                    Currency
                </DropdownMenuLabel>
                {CURRENCIES.map(c => (
                    <DropdownMenuItem
                        key={c.code}
                        onClick={() => setCurrency(c.code)}
                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 text-white/80 hover:text-white rounded-md mx-1"
                    >
                        <span className="flex items-center gap-2">
                            <span>{c.flag}</span>
                            <span className="text-sm">{c.label}</span>
                        </span>
                        {currency === c.code && <Check className="w-3.5 h-3.5 text-blue-400" />}
                    </DropdownMenuItem>
                ))}

                {/* Reset to auto */}
                {isManualOverride && (
                    <>
                        <DropdownMenuSeparator className="bg-white/10 my-1" />
                        <DropdownMenuItem
                            onClick={resetToAuto}
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-white/10 focus:bg-white/10 text-white/40 hover:text-white/60 rounded-md mx-1"
                        >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span className="text-xs">Reset to auto-detected</span>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default LocaleSelector;
