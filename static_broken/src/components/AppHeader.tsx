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

interface ClientConfig {
    companyName: string;
    logoUrl?: string;
    primaryColor?: string;
}

const AppHeader = () => {
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [clientConfig, setClientConfig] = useState<ClientConfig>({
        companyName: 'GTM Audit Pro',
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
        <header className="sticky top-0 z-50 w-full border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-950/80 backdrop-blur-xl">
            <div className="container mx-auto px-4">
                <div className="flex h-16 items-center justify-between">
                    {/* Logo & Brand */}
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                            {clientConfig.logoUrl ? (
                                <img
                                    src={clientConfig.logoUrl}
                                    alt={clientConfig.companyName}
                                    className="h-8 w-auto"
                                />
                            ) : (
                                <div
                                    className="p-2 rounded-xl text-white shadow-lg"
                                    style={{
                                        background: `linear-gradient(135deg, ${clientConfig.primaryColor}, ${clientConfig.primaryColor}dd)`,
                                        boxShadow: `0 4px 14px ${clientConfig.primaryColor}40`
                                    }}
                                >
                                    <Zap className="h-5 w-5" />
                                </div>
                            )}
                            <div>
                                <h1 className="font-bold text-lg bg-gradient-to-r from-gray-900 to-gray-600 dark:from-white dark:to-gray-400 bg-clip-text text-transparent">
                                    {clientConfig.companyName}
                                </h1>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">
                                    Auditoria de Tags & LGPD
                                </p>
                            </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] hidden sm:flex">
                            v2.0
                        </Badge>
                    </div>

                    {/* Right Actions */}
                    <div className="flex items-center gap-2">
                        {/* Plan Badge */}
                        <PlanBadge />

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
