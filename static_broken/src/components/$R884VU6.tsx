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
import { useI18n } from '@/context/I18nContext';

const PlanBadge = () => {
    const { plan, limits, getUsagePercentage, setShowUpgradeModal } = usePlan();
    const { t } = useI18n();

    const getPlanIcon = (planType: PlanType) => {
        switch (planType) {
            case 'free': return <Zap className="h-3 w-3" />;
            case 'pro': return <Crown className="h-3 w-3" />;
            case 'full': return <Crown className="h-3 w-3 text-amber-500" />;
            default: return <Zap className="h-3 w-3" />;
        }
    };

    const getPlanColor = (planType: PlanType) => {
        switch (planType) {
            case 'free': return 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300';
            case 'pro': return 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700';
            case 'full': return 'bg-gradient-to-r from-amber-500 to-orange-600 text-white hover:from-amber-600 hover:to-orange-700';
            default: return 'bg-gray-100 text-gray-700';
        }
    };

    const usagePercentage = getUsagePercentage();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className={`gap-1 ${getPlanColor(plan.type)} shadow-sm transition-all duration-300`}
                >
                    {getPlanIcon(plan.type)}
                    <span className="font-bold">{plan.name}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="flex items-center gap-2">
                    {getPlanIcon(plan.type)}
                    {plan.name} {t('common.audit')}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />

                {/* Usage */}
                <div className="px-2 py-3">
                    <div className="flex justify-between text-xs text-gray-500 mb-1">
                        <span>{t('nav.history')}</span>
                        <span>
                            {limits.auditsPerMonth === -1 || limits.auditsPerMonth > 100 ? (
                                <span className="text-purple-600 font-bold">{t('plan_badge.unlimited')}</span>
                            ) : (
                                `${plan.auditsLimit - plan.auditsRemaining}/${plan.auditsLimit}`
                            )}
                        </span>
                    </div>
                    {(limits.auditsPerMonth !== -1 && limits.auditsPerMonth < 100) && (
                        <Progress value={usagePercentage} className="h-2" />
                    )}
                </div>

                <DropdownMenuSeparator />

                {/* Features resumidas */}
                <div className="px-2 py-2 space-y-1">
                    <div className="flex items-center gap-2 text-xs">
                        <BarChart3 className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-400">
                            {limits.visibilityPercentage}% {t('dashboard.tags_detected')}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                        <Sparkles className="h-3 w-3 text-gray-400" />
                        <span className="text-gray-600 dark:text-gray-400">
                            {limits.deepAnalysis ? t('home.deep_scan') : t('plan_badge.locked_deep_scan')}
                        </span>
                    </div>
                </div>

                {plan.type !== 'full' && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => setShowUpgradeModal(true)}
                        >
                            <Crown className="h-4 w-4 mr-2 text-yellow-500" />
                            <span className="font-bold text-blue-600">{t('nav.upgrade')}</span>
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default PlanBadge;
