import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
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
    Crown,
    Building2,
    ChevronDown,
    Sparkles,
    BarChart3
} from 'lucide-react';
import { usePlan, PlanType } from '@/context/PlanContext';

const PlanBadge = () => {
    const { plan, limits, getUsagePercentage, setShowUpgradeModal } = usePlan();

    const getPlanIcon = (planType: PlanType) => {
        switch (planType) {
            case 'free': return <Zap className="h-3 w-3" />;
            case 'pro': return <Crown className="h-3 w-3" />;
            case 'enterprise': return <Building2 className="h-3 w-3" />;
        }
    };

    const getPlanColor = (planType: PlanType) => {
        switch (planType) {
            case 'free': return 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300';
            case 'pro': return 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700';
            case 'enterprise': return 'bg-gradient-to-r from-purple-500 to-pink-600 text-white hover:from-purple-600 hover:to-pink-700';
        }
    };

    const usagePercentage = getUsagePercentage();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className={`gap-1 ${getPlanColor(plan.type)}`}
                >
                    {getPlanIcon(plan.type)}
                    {plan.name}
                    <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex items-center gap-2">
                    {getPlanIcon(plan.type)}
                    Plano {plan.name}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Usage */}
                <div className="px-2 py-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>Auditorias este mês</span>
                        <span>
                            {limits.auditsPerMonth === -1 ? (
                                <span className="text-purple-600">Ilimitado</span>
                            ) : (
                                `${plan.auditsLimit - plan.auditsRemaining}/${plan.auditsLimit}`
                            )}
                        </span>
                    </div>
                    {limits.auditsPerMonth !== -1 && (
                        <Progress value={usagePercentage} className="h-2" />
                    )}
                </div>

                <DropdownMenuSeparator />

                {/* Features resumidas */}
                <div className="px-2 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                        <BarChart3 className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-400">
                            {limits.auditsPerMonth === -1 ? 'Auditorias ilimitadas' : `${limits.auditsPerMonth} auditorias/mês`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <Sparkles className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-400">
                            {limits.deepAnalysis ? 'Análise PRO ativada' : 'Análise PRO bloqueada'}
                        </span>
                    </div>
                </div>

                {plan.type !== 'enterprise' && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => setShowUpgradeModal(true)}
                        >
                            <Crown className="h-4 w-4 mr-2 text-yellow-500" />
                            <span>Fazer Upgrade</span>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default PlanBadge;
