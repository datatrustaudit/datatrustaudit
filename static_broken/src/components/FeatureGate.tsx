import { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Lock, Crown, Sparkles } from 'lucide-react';
import { usePlan, PlanLimits } from '@/context/PlanContext';

interface FeatureGateProps {
    feature: keyof PlanLimits;
    featureName: string;
    children: ReactNode;
    fallback?: ReactNode;
}

const FeatureGate = ({ feature, featureName, children, fallback }: FeatureGateProps) => {
    const { isFeatureAvailable, setShowUpgradeModal, setBlockedFeature } = usePlan();

    const isAvailable = isFeatureAvailable(feature);

    const handleUpgradeClick = () => {
        setBlockedFeature(featureName);
        setShowUpgradeModal(true);
    };

    if (isAvailable) {
        return <>{children}</>;
    }

    if (fallback) {
        return <>{fallback}</>;
    }

    return (
        <Card className="border-2 border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/50">
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-700 flex items-center justify-center mb-4">
                    <Lock className="h-8 w-8 text-gray-400" />
                </div>

                <Badge variant="secondary" className="mb-2">
                    <Crown className="h-3 w-3 mr-1" />
                    Premium
                </Badge>

                <h3 className="text-lg font-semibold text-gray-700 dark:text-gray-300 mb-2">
                    {featureName}
                </h3>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4 max-w-xs">
                    Esta funcionalidade está disponível apenas nos planos Pro e Enterprise.
                </p>

                <Button
                    onClick={handleUpgradeClick}
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700"
                >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Fazer Upgrade
                </Button>
            </CardContent>
        </Card>
    );
};

export default FeatureGate;
