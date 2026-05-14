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
 * Botão de desenvolvimento para trocar de plano rapidamente.
 * Apenas visível em ambiente de desenvolvimento.
 */
const DevPlanSwitcher = () => {
    const { plan, upgradePlan, limits } = usePlan();
    const [isOpen, setIsOpen] = useState(false);

    // Só mostra em dev
    const isDev = import.meta.env.DEV || window.location.hostname === 'localhost';

    if (!isDev) return null;

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
                        DEV: {plan.name}
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                    <div className="px-2 py-1.5 text-xs font-medium text-gray-500">
                        Trocar Plano (DEV)
                    </div>
                    <DropdownMenuSeparator />

                    {(['free', 'pro', 'premium'] as PlanType[]).map((planType) => {
                        const config = PLAN_CONFIGS[planType];
                        const isActive = plan.type === planType;

                        return (
                            <DropdownMenuItem
                                key={planType}
                                onClick={() => upgradePlan(planType)}
                                className={`flex items-center justify-between ${isActive ? 'bg-blue-50' : ''}`}
                            >
                                <div className="flex items-center gap-2">
                                    <div className={`w-2 h-2 rounded-full ${planColors[planType]}`} />
                                    {config.name}
                                    {config.price > 0 && (
                                        <span className="text-xs text-gray-400">
                                            ${config.price}/mo
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

                    <div className="px-2 py-1.5 text-xs text-gray-500">
                        <div>Auditorias: {plan.auditsRemaining}/{plan.auditsLimit}</div>
                        <div>Visibilidade: {limits.visibilityPercentage}%</div>
                    </div>
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
};

export default DevPlanSwitcher;
