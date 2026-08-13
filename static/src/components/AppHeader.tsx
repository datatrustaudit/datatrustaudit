import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Zap,
    Settings,
    History,
    HelpCircle,
    ExternalLink,
    Github,
    LogIn,
    LogOut,
    DollarSign
} from 'lucide-react';
import PlanBadge from './PlanBadge';
import MarcaDataTrust from './MarcaDataTrust';
import LocaleSelector from './LocaleSelector';

import { useI18n } from '@/context/I18nContext';
import { useAuth } from '@/context/AuthContext';
import { Link } from 'react-router-dom';

const AppHeader = () => {
    const { t } = useI18n();
    const { user, isAuthenticated, logout } = useAuth();

    // Force dark mode on mount — app is dark-only
    useEffect(() => {
        document.documentElement.classList.add('dark');
    }, []);

    /* Barra translúcida com desfoque forte e saturação — o conteúdo por baixo
       continua legível como forma, não como detalhe. A sombra pesada saiu: ela
       criava uma borda dupla com a linha de baixo e empurrava o header para
       fora da página, em vez de deixá-lo pertencer a ela. */
    return (
        <header
            className="sticky top-0 z-50 w-full border-b"
            style={{
                background: 'color-mix(in srgb, var(--laudo-fundo) 72%, transparent)',
                backdropFilter: 'saturate(180%) blur(20px)',
                WebkitBackdropFilter: 'saturate(180%) blur(20px)',
                borderColor: 'color-mix(in srgb, var(--laudo-linha) 60%, transparent)',
            }}
        >
            <div className="container mx-auto px-4">
                <div className="flex h-16 items-center justify-between">
                    {/* Marca.
                        Era um JPG de 1024×1024 (465 KB) exibido em 36×36, sem
                        transparência: sobre o header escuro virava um quadrado
                        com fundo próprio, e por isso parecia ter sumido. Agora
                        é SVG — nítido em qualquer tamanho, alguns bytes, e
                        herda a cor do texto.

                        O selo com "v2.0" e a linha de tagline saíram: número de
                        versão é informação de quem constrói, não de quem usa, e
                        duas linhas de texto ao lado do símbolo competiam entre
                        si num espaço de 16px de altura. */}
                    <Link
                        to="/"
                        className="flex items-center text-white/95 transition-opacity hover:opacity-80"
                        aria-label="DataTrust Audit — início"
                    >
                        <MarcaDataTrust />
                    </Link>

                    {/* Right Actions */}
                    <div className="flex items-center gap-2 md:gap-4">
                        {/* Desktop Nav */}
                        <nav className="hidden lg:flex items-center gap-6 mr-4">
                            <Link to="/pricing" className="text-sm font-medium text-white/60 hover:text-white transition-colors">
                                {t('nav.pricing')}
                            </Link>
                            {/* `/dashboard` nunca existiu como rota e caía no
                                NotFound — mesmo caso do antigo link de
                                histórico. O que o usuário chama de painel é a
                                lista de varreduras dele. */}
                            {isAuthenticated && (
                                <Link to="/historico" className="text-sm font-medium text-white/60 hover:text-white transition-colors">
                                    {t('nav.dashboard')}
                                </Link>
                            )}
                        </nav>

                        {/* Locale Selector (Language + Currency) */}
                        <LocaleSelector compact />

                        <div className="h-4 w-[1px] bg-white/10 mx-1 hidden sm:block" />

                        {/* Plan Badge */}
                        <PlanBadge />

                        {/* Auth buttons */}
                        {isAuthenticated ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button className="flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 p-1.5 pr-3 hover:bg-white/10 transition-all">
                                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs shadow-inner">
                                            {user?.name?.[0]?.toUpperCase() ?? 'U'}
                                        </div>
                                        <span className="text-xs font-semibold text-white/80 hidden md:block max-w-[100px] truncate">{user?.name}</span>
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-56 bg-slate-900/95 border-white/10 backdrop-blur-2xl text-white">
                                    <DropdownMenuLabel className="px-3 py-2">
                                        <p className="text-xs font-bold text-white/30 uppercase tracking-widest">{t('nav.account')}</p>
                                        <p className="text-sm font-medium truncate mt-1">{user?.email}</p>
                                    </DropdownMenuLabel>
                                    <DropdownMenuSeparator className="bg-white/5" />
                                    <DropdownMenuItem asChild className="focus:bg-white/5 cursor-pointer">
                                        <Link to="/pricing" className="flex items-center w-full">
                                            <DollarSign className="h-4 w-4 mr-2 text-blue-400" />
                                            {t('nav.pricing')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="focus:bg-white/5 cursor-pointer">
                                        <Link to="/settings" className="flex items-center w-full">
                                            <Settings className="h-4 w-4 mr-2 text-slate-400" />
                                            {t('nav.settings')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild className="focus:bg-white/5 cursor-pointer">
                                        {/* `/historico`, não `/history`: esta é o
                                            endpoint da API e devolve JSON. */}
                                        <Link to="/historico" className="flex items-center w-full">
                                            <History className="h-4 w-4 mr-2 text-slate-400" />
                                            {t('nav.history')}
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator className="bg-white/5" />
                                    <DropdownMenuItem onClick={logout} className="text-red-400 focus:bg-red-500/10 focus:text-red-400 cursor-pointer">
                                        <LogOut className="h-4 w-4 mr-2" />
                                        {t('nav.logout')}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Link to="/auth">
                                <Button size="sm" className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg hover:shadow-blue-500/40 hover:scale-105 active:scale-95 transition-all text-xs font-bold h-9 px-5 rounded-xl border-t border-white/20">
                                    <LogIn className="h-4 w-4 mr-2" />
                                    {t('nav.login')}
                                </Button>
                            </Link>
                        )}

                        {/* Help / Resources */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-xl hover:bg-white/5 text-white/40 hover:text-white"
                                >
                                    <HelpCircle className="h-5 w-5" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56 bg-slate-900/95 border-white/10 backdrop-blur-2xl text-white">
                                <DropdownMenuLabel className="text-xs font-bold text-white/30 uppercase tracking-widest px-3 py-2">
                                    {t('nav.resources')}
                                </DropdownMenuLabel>
                                <DropdownMenuItem className="focus:bg-white/5 cursor-pointer">
                                    <HelpCircle className="mr-2 h-4 w-4 text-blue-400" />
                                    {t('nav.docs')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-white/5" />
                                <DropdownMenuItem className="focus:bg-white/5 cursor-pointer">
                                    <ExternalLink className="mr-2 h-4 w-4 text-slate-400" />
                                    API Docs
                                </DropdownMenuItem>
                                <DropdownMenuItem className="focus:bg-white/5 cursor-pointer">
                                    <Github className="mr-2 h-4 w-4 text-slate-400" />
                                    GitHub
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            </div>
        </header>
    );
};

export default AppHeader;
