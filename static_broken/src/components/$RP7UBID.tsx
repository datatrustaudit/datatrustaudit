import { useState } from 'react';
import { useLocaleContext, SupportedCurrency } from '@/context/LocaleContext';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DollarSign, ChevronDown, Check } from 'lucide-react';

type CurrencyOption = { code: SupportedCurrency; label: string; symbol: string; flag: string };

const CURRENCIES: CurrencyOption[] = [
    { code: 'BRL', label: 'Real (BRL)',        symbol: 'R$',   flag: '🇧🇷' },
    { code: 'USD', label: 'Dollar (USD)',      symbol: '$',    flag: '🇺🇸' },
    { code: 'EUR', label: 'Euro (EUR)',        symbol: '€',    flag: '🇪🇺' },
    { code: 'GBP', label: 'Pound (GBP)',       symbol: '£',    flag: '🇬🇧' },
    { code: 'MXN', label: 'Peso MX (MXN)',     symbol: 'MX$',  flag: '🇲🇽' },
    { code: 'ARS', label: 'Peso AR (ARS)',     symbol: 'ARS$', flag: '🇦🇷' },
    { code: 'CLP', label: 'Peso CL (CLP)',    symbol: 'CLP$', flag: '🇨🇱' },
    { code: 'COP', label: 'Peso CO (COP)',    symbol: 'COP$', flag: '🇨🇴' },
    { code: 'CAD', label: 'Dollar CA (CAD)',   symbol: 'CA$',  flag: '🇨🇦' },
    { code: 'AUD', label: 'Dollar AU (AUD)',   symbol: 'A$',   flag: '🇦🇺' },
];

interface CurrencySelectorProps {
    className?: string;
    variant?: 'ghost' | 'outline' | 'solid';
}

const CurrencySelector = ({ className, variant = 'outline' }: CurrencySelectorProps) => {
    const { currency, setCurrency } = useLocaleContext();
    const [open, setOpen] = useState(false);

    const currentCurrency = CURRENCIES.find(c => c.code === currency) ?? CURRENCIES[0];

    const getVariantClasses = () => {
        switch (variant) {
            case 'ghost':
                return 'bg-transparent hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border-none';
            case 'solid':
                return 'bg-slate-900 dark:bg-slate-800 text-white border-transparent hover:bg-slate-800 dark:hover:bg-slate-700';
            default:
                // outline
                return 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800';
        }
    };

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    id="currency-selector-trigger"
                    className={`
                        flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                        transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50
                        ${getVariantClasses()}
                        ${className || ''}
                    `}
                >
                    <span className="flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 dark:bg-slate-800 text-xs">
                        {currentCurrency.symbol}
                    </span>
                    <span className="tracking-wide">{currentCurrency.code}</span>
                    <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
            </DropdownMenuTrigger>

            <DropdownMenuContent
                align="end"
                className="w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white shadow-xl rounded-xl p-1"
            >
                <DropdownMenuLabel className="text-slate-500 dark:text-slate-400 text-[10px] uppercase tracking-widest font-semibold px-3 py-2 flex items-center gap-1.5">
                    <DollarSign className="w-3 h-3" />
                    Currency
                </DropdownMenuLabel>
                {CURRENCIES.map(c => (
                    <DropdownMenuItem
                        key={c.code}
                        onClick={() => setCurrency(c.code)}
                        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg mx-1 my-0.5"
                    >
                        <span className="flex items-center gap-2.5">
                            <span className="text-base leading-none">{c.flag}</span>
                            <span className="text-sm font-medium">{c.label}</span>
                        </span>
                        {currency === c.code && <Check className="w-4 h-4 text-blue-500" />}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default CurrencySelector;
