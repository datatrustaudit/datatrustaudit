/**
 * LanguageSelector — premium language pill for navbar.
 * Shows flag + language code with a polished dropdown.
 * Adapts to both light and dark contexts via theme-aware styling.
 */

import { useState, useRef, useEffect } from 'react';
import { useLocaleContext, SupportedLanguage } from '@/context/LocaleContext';
import { useI18n } from '@/context/I18nContext';
import { Globe, ChevronDown, Check } from 'lucide-react';

type LangOption = { code: SupportedLanguage; label: string; flag: string; short: string };

const LANGUAGES: LangOption[] = [
    { code: 'pt', label: 'Português (BR)',    flag: '🇧🇷', short: 'PT' },
    { code: 'en', label: 'English',          flag: '🇺🇸', short: 'EN' },
    { code: 'es', label: 'Español',           flag: '🇪🇸', short: 'ES' },
    { code: 'fr', label: 'Français',          flag: '🇫🇷', short: 'FR' },
    { code: 'de', label: 'Deutsch',           flag: '🇩🇪', short: 'DE' },
    { code: 'it', label: 'Italiano',          flag: '🇮🇹', short: 'IT' },
    { code: 'nl', label: 'Nederlands',        flag: '🇳🇱', short: 'NL' },
    { code: 'ar', label: 'العربية',            flag: '🇸🇦', short: 'AR' },
    { code: 'hi', label: 'हिन्दी',              flag: '🇮🇳', short: 'HI' },
    { code: 'zh', label: '中文',               flag: '🇨🇳', short: 'ZH' },
    { code: 'ja', label: '日本語',              flag: '🇯🇵', short: 'JA' },
];

interface LanguageSelectorProps {
    compact?: boolean;
    className?: string;
}

const LanguageSelector = ({ compact = true, className }: LanguageSelectorProps) => {
    const { language, setLanguage } = useLocaleContext();
    const { setLanguage: setI18nLanguage } = useI18n();
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const currentLang = LANGUAGES.find(l => l.code === language) ?? LANGUAGES[0];

    const handleSetLanguage = (lang: SupportedLanguage) => {
        setLanguage(lang);
        setI18nLanguage(lang);
        setOpen(false);
    };

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        if (open) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [open]);

    // Close on Escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        if (open) document.addEventListener('keydown', handleEsc);
        return () => document.removeEventListener('keydown', handleEsc);
    }, [open]);

    // Inline (pill row) variant for pricing/plans pages
    if (!compact) {
        return (
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
                        {l.flag} {l.short}
                    </button>
                ))}
            </div>
        );
    }

    return (
        <div ref={containerRef} className="relative">
            {/* Trigger button */}
            <button
                id="language-selector-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Language: ${currentLang.label}`}
                onClick={() => setOpen(!open)}
                className={className ?? `
                    inline-flex items-center gap-1.5
                    h-8 px-2.5
                    rounded-[10px]
                    bg-gray-100/80 dark:bg-white/[0.07]
                    border border-gray-200/60 dark:border-white/[0.12]
                    text-gray-700 dark:text-white/90
                    text-xs font-semibold
                    transition-all duration-200 ease-out
                    hover:bg-gray-200/80 dark:hover:bg-white/[0.12]
                    hover:border-gray-300 dark:hover:border-white/[0.22]
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-1 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-950
                    active:scale-[0.97]
                    select-none cursor-pointer
                `}
            >
                <span className="text-sm leading-none">{currentLang.flag}</span>
                <span className="tracking-wide hidden sm:inline">{currentLang.short}</span>
                <ChevronDown
                    className={`w-3 h-3 text-gray-400 dark:text-white/35 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
                />
            </button>

            {/* Dropdown */}
            {open && (
                <div
                    role="listbox"
                    aria-activedescendant={`lang-${currentLang.code}`}
                    className="
                        absolute right-0 top-full mt-2 z-50
                        w-52
                        rounded-xl
                        bg-white dark:bg-slate-900
                        border border-gray-200/80 dark:border-white/[0.1]
                        shadow-xl shadow-black/10 dark:shadow-black/40
                        backdrop-blur-2xl
                        overflow-hidden
                        animate-in fade-in slide-in-from-top-2 duration-150
                    "
                >
                    {/* Header */}
                    <div className="
                        flex items-center gap-1.5
                        px-3 py-2.5
                        text-[10px] uppercase tracking-widest font-semibold
                        text-gray-400 dark:text-white/35
                        border-b border-gray-100 dark:border-white/[0.06]
                        bg-gray-50/80 dark:bg-white/[0.03]
                    ">
                        <Globe className="w-3 h-3" />
                        Language
                    </div>

                    {/* Options */}
                    <div className="max-h-[280px] overflow-y-auto py-1 scrollbar-thin">
                        {LANGUAGES.map(l => {
                            const isActive = language === l.code;
                            return (
                                <button
                                    key={l.code}
                                    id={`lang-${l.code}`}
                                    role="option"
                                    aria-selected={isActive}
                                    onClick={() => handleSetLanguage(l.code)}
                                    className={`
                                        flex items-center justify-between w-full
                                        px-3 py-2 mx-0
                                        text-sm
                                        transition-colors duration-100
                                        cursor-pointer
                                        ${isActive
                                            ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium'
                                            : 'text-gray-700 dark:text-white/75 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
                                        }
                                    `}
                                >
                                    <span className="flex items-center gap-2.5">
                                        <span className="text-base leading-none">{l.flag}</span>
                                        <span>{l.label}</span>
                                    </span>
                                    {isActive && <Check className="w-3.5 h-3.5 text-blue-500 dark:text-blue-400 shrink-0" />}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default LanguageSelector;
