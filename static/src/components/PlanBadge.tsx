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
            case 'premium': return <Crown className="h-3 w-3 text-amber-500" />;
            default: return <Zap className="h-3 w-3" />;
        }
    };

    const getPlanColor = (planType: PlanType) => {
        switch (planType) {
            case 'free': return 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10';
            case 'pro': return 'bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20';
            case 'premium': return 'bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0 shadow-lg shadow-amber-500/20 hover:from-amber-600 hover:to-orange-700';
            default: return 'bg-white/5 text-white/60';
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
                                <span className="text-purple-600 font-bold">∞ Ilimitado</span>
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
                            {limits.deepAnalysis ? t('home.deep_scan') : 'Locked: Deep Scan'}
                        </span>
                    </div>
                </div>

                {plan.type !== 'premium' && (
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
