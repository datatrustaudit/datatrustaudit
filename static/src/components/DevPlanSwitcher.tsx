import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Crown, Zap, Bug, User } from 'lucide-react';
import { usePlan, PlanType, PLAN_CONFIGS } from '@/context/PlanContext';

/**
 * Dev-only plan switcher button (bottom-left corner).
 * Only visible in development environment.
 */
const DevPlanSwitcher = () => {
    const { plan, upgradePlan, limits, effectivePlan } = usePlan();
    const [isOpen, setIsOpen] = useState(false);
    const [recusa, setRecusa] = useState<string | null>(null);

    const trocar = async (planType: PlanType) => {
        setRecusa(await upgradePlan(planType));
    };

    const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';
    if (!isDev) return null;

    // Admin users use AdminPlanTesting instead
    if (plan.isAdmin) return null;

    const planIcons: Record<PlanType, JSX.Element> = {
        free: <Zap className="h-4 w-4" />,
        pro: <Crown className="h-4 w-4" />,
        premium: <Crown className="h-4 w-4 text-amber-500" />
    };

    const planColors: Record<PlanType, string> = {
        free: 'bg-gray-500',
        pro: 'bg-blue-500',
        premium: 'bg-amber-500'
    };

    return (
        <div className="fixed bottom-4 left-4 z-50">
            <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="bg-yellow-100 border-yellow-400 text-yellow-800 hover:bg-yellow-200 shadow-lg"
                    >
                        <Bug className="h-4 w-4 mr-2" />
                        {/* O crachá mostra o plano EFETIVO — o mesmo que decide
                            os cadeados. Mostrar `plan.name` (estado local) fazia
                            ele anunciar "Premium" enquanto o gate cortava como
                            free. Se os dois divergirem, é aqui que se vê. */}
                        DEV: {effectivePlan}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    <div className="px-2 py-1.5 text-xs font-medium text-gray-500">
                        Trocar Plano (DEV)
                    </div>
                    <DropdownMenuSeparator />

                    {(['free', 'pro', 'premium'] as PlanType[]).map((planType) => {
                        const config = PLAN_CONFIGS[planType];
                        const isActive = effectivePlan === planType;

                        return (
                            <DropdownMenuItem
                                key={planType}
                                onSelect={(e) => { e.preventDefault(); void trocar(planType); }}
                                className={`flex items-center justify-between ${isActive ? 'bg-blue-50' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${planColors[planType]}`} />
                                    {config.name}
                                    {/* O preço vinha com "/mês" — a cobrança é
                                        pagamento único desde a mudança do
                                        checkout. */}
                                    {config.price > 0 && (
                                        <span className="text-xs text-gray-400">
                                            R$ {String(config.price).replace('.', ',')}
                                        </span>
                                    )}
                                </div>
                                {isActive && (
                                    <Badge variant="secondary" className="text-xs">
                                        Ativo
                                    </Badge>
                                )}
                            </DropdownMenuItem>
                        );
                    })}

                    <DropdownMenuSeparator />

                    {recusa && (
                        <div className="px-2 py-1.5 text-xs text-red-600 dark:text-red-400 max-w-[13rem] whitespace-normal">
                            {recusa}
                        </div>
                    )}

                    <div className="px-2 py-1.5 text-xs text-gray-500">
                        <div>Escaneamentos: {plan.scansLimit === -1 ? 'Ilimitado' : `${plan.scansRemaining}/${plan.scansLimit}`}</div>
                        <div>Visibilidade: {limits.visibilityPercentage}%</div>
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

export default DevPlanSwitcher;
