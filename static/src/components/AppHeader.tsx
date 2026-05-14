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
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Zap,
    Moon,
    Sun,
    Settings,
    User,
    Building2,
    Palette,
    History,
    HelpCircle,
    ExternalLink,
    Github
} from 'lucide-react';
import PlanBadge from './PlanBadge';
import LocaleSelector from './LocaleSelector';

import { useI18n } from '@/context/I18nContext';
import { useAuth } from '@/context/AuthContext';
import { Link } from 'react-router-dom';
import { LogIn, LogOut, DollarSign } from 'lucide-react';

interface ClientConfig {
    companyName: string;
    logoUrl?: string;
    primaryColor?: string;
}

const AppHeader = () => {
    const { language, setLanguage, t } = useI18n();
    const { user, isAuthenticated, logout } = useAuth();
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [clientConfig, setClientConfig] = useState<ClientConfig>({
        companyName: 'DataTrust Audit',
        logoUrl: '',
        primaryColor: '#3B82F6'
    });
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [tempConfig, setTempConfig] = useState(clientConfig);

    // Load settings from localStorage
    useEffect(() => {
        const savedTheme = localStorage.getItem('gtm-audit-theme');
        const savedConfig = localStorage.getItem('gtm-audit-config');

        if (savedTheme === 'dark') {
            setIsDarkMode(true);
            document.documentElement.classList.add('dark');
        }

        if (savedConfig) {
            try {
                const config = JSON.parse(savedConfig);
                setClientConfig(config);
                setTempConfig(config);
            } catch (e) {
                console.error('Error parsing config', e);
            }
        }
    }, []);

    const toggleDarkMode = () => {
        const newMode = !isDarkMode;
        setIsDarkMode(newMode);

        if (newMode) {
            document.documentElement.classList.add('dark');
            localStorage.setItem('gtm-audit-theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('gtm-audit-theme', 'light');
        }
    };

    const saveSettings = () => {
        setClientConfig(tempConfig);
        localStorage.setItem('gtm-audit-config', JSON.stringify(tempConfig));
        setIsSettingsOpen(false);
    };

    return (
        <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-gray-950/80 backdrop-blur-xl shadow-[0_4px_30px_rgba(0,0,0,0.3)]">
            <div className="container mx-auto px-4">
                <div className="flex h-16 items-center justify-between">
                    {/* Logo & Brand */}
                    <Link to="/" className="flex items-center gap-3 group">
                        <div className="flex items-center gap-2">
                            {clientConfig.logoUrl ? (
                                <img
                                    src={clientConfig.logoUrl}
                                    alt={clientConfig.companyName}
                                    className="h-8 w-auto"
                                />
                            ) : (
                                <div
                                    className="p-2 rounded-xl text-white shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300"
                                    style={{
                                        background: `linear-gradient(135deg, ${clientConfig.primaryColor}, ${clientConfig.primaryColor}dd)`,
                                    }}
                                >
                                    <Zap className="h-5 w-5" />
                                </div>
                            )}
                            <div>
                                <h1 className="font-bold text-lg text-white tracking-tight flex items-center gap-2">
                                    {clientConfig.companyName}
                                    <Badge className="bg-white/10 text-white/40 border-white/5 text-[10px]">
                                        v2.0
                                    </Badge>
                                </h1>
                                <p className="text-[10px] text-blue-400 font-medium -mt-0.5 opacity-90">
                                    Auditoria de Tags & LGPD
                                </p>
                            </div>
                        </div>
                    </Link>

                    {/* Right Actions */}
                    <div className="flex items-center gap-2">
                        {/* Locale Selector (Language + Currency) */}
                        <LocaleSelector compact />

                        
                        {/* Plan Badge */}
                        <PlanBadge />

                        {/* Pricing Link */}
                        <Link to="/pricing">
                            <Button variant="ghost" size="sm" className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400 hover:text-blue-700 font-semibold text-xs flex">
                                <DollarSign className="h-3.5 w-3.5" />
                                {language === 'pt' ? 'Planos' : 'Pricing'}
                            </Button>
                        </Link>

                        {/* Auth buttons */}
                        {isAuthenticated ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="sm" className="flex items-center gap-1.5 rounded-full px-2">
                                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-xs">
                                            {user?.name?.[0]?.toUpperCase() ?? 'U'}
                                        </div>
                                        <span className="text-sm font-medium hidden md:block max-w-[100px] truncate">{user?.name}</span>
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-52">
                                    <DropdownMenuLabel className="text-xs text-gray-500 truncate">{user?.email}</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem asChild>
                                        <Link to="/pricing"><DollarSign className="h-4 w-4 mr-2" />{language === 'pt' ? 'Planos' : 'Plans'}</Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuItem asChild>
                                        <Link to="/settings"><Settings className="h-4 w-4 mr-2" />{language === 'pt' ? 'Configurações' : 'Settings'}</Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={logout} className="text-red-500 focus:text-red-500">
                                        <LogOut className="h-4 w-4 mr-2" />{language === 'pt' ? 'Sair' : 'Sign out'}
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            <Link to="/auth">
                                <Button size="sm" className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg hover:from-blue-600 hover:to-indigo-700 text-xs font-semibold h-8 px-4">
                                    <LogIn className="h-3.5 w-3.5 mr-1.5" />
                                    {language === 'pt' ? 'Entrar' : 'Sign In'}
                                </Button>
                            </Link>
                        )}

                        {/* Dark Mode Toggle */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleDarkMode}
                            className="rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                        >
                            {isDarkMode ? (
                                <Sun className="h-5 w-5 text-yellow-500" />
                            ) : (
                                <Moon className="h-5 w-5 text-gray-600" />
                            )}
                        </Button>

                        {/* Settings Dialog */}
                        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
                            <DialogTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                    <Settings className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="sm:max-w-md">
                                <DialogHeader>
                                    <DialogTitle className="flex items-center gap-2">
                                        <Building2 className="h-5 w-5" />
                                        Configurações do Cliente
                                    </DialogTitle>
                                    <DialogDescription>
                                        Personalize a ferramenta com sua marca
                                    </DialogDescription>
                                </DialogHeader>
                                <div className="space-y-4 py-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="companyName">Nome da Empresa/Cliente</Label>
                                        <Input
                                            id="companyName"
                                            value={tempConfig.companyName}
                                            onChange={(e) => setTempConfig({
                                                ...tempConfig,
                                                companyName: e.target.value
                                            })}
                                            placeholder="Sua Empresa"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="logoUrl">URL do Logo (opcional)</Label>
                                        <Input
                                            id="logoUrl"
                                            value={tempConfig.logoUrl || ''}
                                            onChange={(e) => setTempConfig({
                                                ...tempConfig,
                                                logoUrl: e.target.value
                                            })}
                                            placeholder="https://exemplo.com/logo.png"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="primaryColor" className="flex items-center gap-2">
                                            <Palette className="h-4 w-4" />
                                            Cor Primária
                                        </Label>
                                        <div className="flex gap-2">
                                            <Input
                                                id="primaryColor"
                                                type="color"
                                                value={tempConfig.primaryColor}
                                                onChange={(e) => setTempConfig({
                                                    ...tempConfig,
                                                    primaryColor: e.target.value
                                                })}
                                                className="w-16 h-10 p-1 cursor-pointer"
                                            />
                                            <Input
                                                value={tempConfig.primaryColor}
                                                onChange={(e) => setTempConfig({
                                                    ...tempConfig,
                                                    primaryColor: e.target.value
                                                })}
                                                placeholder="#3B82F6"
                                                className="flex-1"
                                            />
                                        </div>
                                    </div>
                                </div>
                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setIsSettingsOpen(false)}>
                                        Cancelar
                                    </Button>
                                    <Button onClick={saveSettings}>
                                        Salvar
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>

                        {/* More Options Dropdown */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
                                >
                                    <User className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuLabel>Opções</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem>
                                    <History className="mr-2 h-4 w-4" />
                                    Histórico de Auditorias
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                    <HelpCircle className="mr-2 h-4 w-4" />
                                    Ajuda & Documentação
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem>
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    API Docs
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                    <Github className="mr-2 h-4 w-4" />
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
