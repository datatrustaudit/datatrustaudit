/**
 * AdminPlanTesting — Admin-only panel for plan testing and preview.
 * Shows real admin profile status and allows previewing Free/Pro/Premium.
 * Only visible to admin users (is_admin=true).
 */
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { usePlan, PlanType, PLAN_CONFIGS, getEffectivePlan } from '@/context/PlanContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Shield, Eye, EyeOff, Crown, Star, Tag, Zap,
    ChevronDown, ChevronUp, CheckCircle2, AlertCircle, XCircle
} from 'lucide-react';

const AdminPlanTesting = () => {
    const { user } = useAuth();
    const { plan, limits, effectivePlan, adminPreviewPlan, setAdminPreviewPlan } = usePlan();
    const [isExpanded, setIsExpanded] = useState(false);

    // Only show for admin users
    if (!user?.is_admin) return null;

    const previewPlans: { id: PlanType | null; label: string; icon: JSX.Element; color: string; desc: string }[] = [
        {
            id: null,
            label: 'Real Admin',
            icon: <Shield className="w-4 h-4" />,
            color: 'from-emerald-500 to-teal-600',
            desc: 'Unlimited • All features'
        },
        {
            id: 'free',
            label: 'Preview Free',
            icon: <Tag className="w-4 h-4" />,
            color: 'from-gray-400 to-gray-500',
            desc: '30% visibility • 10/week • R$ 0'
        },
        {
            id: 'pro',
            label: 'Preview Pro',
            icon: <Star className="w-4 h-4" />,
            color: 'from-blue-500 to-indigo-600',
            desc: '70% visibility • 50/week • R$ 49,90/mês'
        },
        {
            id: 'premium',
            label: 'Preview Premium',
            icon: <Crown className="w-4 h-4" />,
            color: 'from-amber-500 to-orange-600',
            desc: '100% visibility • 200/week • R$ 149,90/mês'
        },
    ];

    const statusColor = user.subscription_status === 'active'
        ? 'text-green-400'
        : user.subscription_status === 'pending'
            ? 'text-yellow-400'
            : 'text-red-400';

    const StatusIcon = user.subscription_status === 'active'
        ? CheckCircle2
        : user.subscription_status === 'pending'
            ? AlertCircle
            : XCircle;

    return (
        <div className="fixed bottom-4 left-4 z-50 max-w-sm">
            {/* Toggle button */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-bold shadow-lg backdrop-blur-sm hover:bg-emerald-500/30 transition-all"
            >
                <Shield className="w-4 h-4" />
                Admin Plan Testing
                {adminPreviewPlan && (
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 text-[10px]">
                        <Eye className="w-3 h-3 mr-1" />
                        {adminPreviewPlan}
                    </Badge>
                )}
                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
            </button>

            {/* Expanded panel */}
            {isExpanded && (
                <div className="mt-2 bg-slate-900/95 border border-white/10 rounded-2xl p-4 backdrop-blur-xl shadow-2xl space-y-4 animate-in slide-in-from-bottom-2">
                    {/* Real profile status */}
                    <div className="space-y-2">
                        <div className="text-white/30 text-[10px] uppercase tracking-widest font-bold">
                            Real Profile
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="text-white/50">Email:</div>
                            <div className="text-white font-medium truncate">{user.email}</div>

                            <div className="text-white/50">Name:</div>
                            <div className="text-white font-medium">{user.name}</div>

                            <div className="text-white/50">Status:</div>
                            <div className={`font-bold flex items-center gap-1 ${statusColor}`}>
                                <StatusIcon className="w-3 h-3" />
                                {user.subscription_status}
                            </div>

                            <div className="text-white/50">Effective:</div>
                            <div className="text-white font-bold">
                                {effectivePlan === 'admin' ? (
                                    <span className="text-emerald-400">Admin</span>
                                ) : (
                                    <span className="text-blue-400">{effectivePlan}</span>
                                )}
                            </div>

                            <div className="text-white/50">Scans:</div>
                            <div className="text-white font-medium">
                                {plan.scansLimit === -1 ? (
                                    <span className="text-emerald-400 font-bold">Unlimited</span>
                                ) : (
                                    `${plan.scansRemaining}/${plan.scansLimit}`
                                )}
                            </div>

                            <div className="text-white/50">Visibility:</div>
                            <div className="text-white font-medium">{limits.visibilityPercentage}%</div>
                        </div>
                    </div>

                    {/* Preview mode selector */}
                    <div className="space-y-2">
                        <div className="text-white/30 text-[10px] uppercase tracking-widest font-bold">
                            Preview Mode
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            {previewPlans.map((p) => {
                                const isActive = adminPreviewPlan === p.id;
                                return (
                                    <button
                                        key={p.label}
                                        onClick={() => setAdminPreviewPlan(p.id)}
                                        className={`flex flex-col items-start gap-1 p-2.5 rounded-xl border text-left transition-all ${
                                            isActive
                                                ? 'bg-white/10 border-white/20 ring-1 ring-blue-400/50'
                                                : 'bg-white/5 border-white/10 hover:bg-white/10'
                                        }`}
                                    >
                                        <div className="flex items-center gap-1.5">
                                            <div className={`p-1 rounded-md bg-gradient-to-br ${p.color} text-white`}>
                                                {p.icon}
                                            </div>
                                            <span className="text-white text-xs font-bold">{p.label}</span>
                                        </div>
                                        <span className="text-white/40 text-[10px] leading-tight">{p.desc}</span>
                                        {isActive && (
                                            <Badge className="bg-blue-500/20 text-blue-400 border-0 text-[9px] h-4 px-1.5">
                                                Active
                                            </Badge>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Warning */}
                    {adminPreviewPlan && (
                        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2.5 flex items-start gap-2">
                            <Eye className="w-3.5 h-3.5 text-yellow-400 mt-0.5 flex-shrink-0" />
                            <p className="text-yellow-300/80 text-[10px] leading-relaxed">
                                Preview mode active — you're seeing the app as a <strong>{adminPreviewPlan}</strong> user.
                                This does not change your real plan.
                            </p>
                        </div>
                    )}

                    {/* Dev env helper */}
                    {import.meta.env.DEV && (
                        <div className="border-t border-white/5 pt-3">
                            <div className="text-white/30 text-[10px] uppercase tracking-widest font-bold mb-1.5">
                                Admin Test Access
                            </div>
                            <div className="text-white/40 text-[10px] space-y-0.5">
                                <div>Email: {user.email}</div>
                                <div>Password: configured in .env</div>
                            </div>
                        </div>
                    )}

                    {!import.meta.env.DEV && (
                        <div className="border-t border-white/5 pt-3">
                            <p className="text-white/20 text-[10px]">
                                Admin credentials are configured securely through environment variables.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AdminPlanTesting;
