import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
    CheckCircle,
    XCircle,
    AlertTriangle,
    Box,
    Code2,
} from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';

interface GTMQualityFinding {
    check: string;
    label: string;
    status: string;
    description: string;
    evidence: string | null;
    recommendation: string | null;
    confidence: string;
}

interface GTMQualityData {
    containers: string[];
    containerCount: number;
    hasNoscript: boolean;
    datalayerInitBeforeGtm: boolean;
    datalayerOverwritten: boolean;
    gtmInHead: boolean;
    gtmLoadedMultipleTimes: boolean;
    findings: GTMQualityFinding[];
    score: number;
}

interface GTMQualityPanelProps {
    data: GTMQualityData | null;
}

const STATUS_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    ok: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200' },
    warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200' },
    critical: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200' },
};

const GTMQualityPanel = ({ data }: GTMQualityPanelProps) => {
    if (!data || data.containerCount === 0) {
        return (
            <Card className="shadow-lg border-0">
                <CardContent className="pt-6">
                    <div className="text-center py-12 text-gray-500">
                        <Box className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p className="text-lg font-medium">Nenhum container GTM detectado</p>
                        <p className="text-sm mt-2">
                            O site não utiliza Google Tag Manager ou o container é carregado dinamicamente.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const scoreColor = data.score >= 80 ? 'text-emerald-600' : data.score >= 50 ? 'text-amber-600' : 'text-red-600';
    const progressColor = data.score >= 80 ? 'bg-emerald-500' : data.score >= 50 ? 'bg-amber-500' : 'bg-red-500';

    return (
        <div className="space-y-6">
            {/* Score + Containers Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="md:col-span-2 shadow-lg border-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Box className="w-5 h-5" />
                            Qualidade GTM
                        </CardTitle>
                        <CardDescription>Avaliação da implementação do Google Tag Manager</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4 mb-4">
                            <div className={`text-4xl font-bold ${scoreColor}`}>{data.score}%</div>
                            <div className="flex-1">
                                <Progress value={data.score} className="h-3" />
                            </div>
                        </div>
                        <style>{`.progress-bar-fill [data-state="complete"],.progress-bar-fill [role="progressbar"] > div { background: var(--bar-color) !important; }`}</style>
                    </CardContent>
                </Card>

                <Card className="shadow-lg border-0">
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-sm">
                            <Code2 className="w-4 h-4" />
                            Containers
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {data.containers.map((id) => (
                                <Badge key={id} className="bg-blue-100 text-blue-800 border-blue-200 font-mono mr-2">
                                    {id}
                                </Badge>
                            ))}
                            {data.gtmLoadedMultipleTimes && (
                                <p className="text-xs text-red-600 mt-2 flex items-center gap-1">
                                    <AlertTriangle className="w-3 h-3" />
                                    Container duplicado detectado
                                </p>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Quick checklist */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="text-lg">Checklist de Implementação</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                            { label: 'Tag <noscript> presente', ok: data.hasNoscript },
                            { label: 'dataLayer inicializado antes do GTM', ok: data.datalayerInitBeforeGtm },
                            { label: 'GTM no <head>', ok: data.gtmInHead },
                            { label: 'Container único (sem duplicação)', ok: !data.gtmLoadedMultipleTimes },
                            { label: 'dataLayer não sobrescrito', ok: !data.datalayerOverwritten },
                        ].map((item) => (
                            <div
                                key={item.label}
                                className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                    item.ok
                                        ? 'bg-emerald-50 border-emerald-200'
                                        : 'bg-red-50 border-red-200'
                                }`}
                            >
                                {item.ok ? (
                                    <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                                ) : (
                                    <XCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
                                )}
                                <span className={`text-sm font-medium ${item.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                                    {item.label}
                                </span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Detailed findings */}
            {data.findings.length > 0 && (
                <Card className="shadow-lg border-0">
                    <CardHeader>
                        <CardTitle className="text-lg">Detalhes da Análise</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            {data.findings.map((finding, i) => {
                                const sc = STATUS_CONFIG[finding.status] || STATUS_CONFIG.warning;
                                const StatusIcon = sc.icon;

                                return (
                                    <div
                                        key={`${finding.check}-${i}`}
                                        className={`p-4 rounded-lg border ${sc.bg}`}
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 flex-1">
                                                <StatusIcon className={`w-5 h-5 mt-0.5 flex-shrink-0 ${sc.color}`} />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm">{finding.label}</p>
                                                    <p className="text-sm text-gray-600 mt-1">{finding.description}</p>
                                                    {finding.evidence && (
                                                        <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded mt-2 overflow-x-auto max-w-full">
                                                            {finding.evidence}
                                                        </pre>
                                                    )}
                                                    {finding.recommendation && (
                                                        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded p-2 mt-2">
                                                            💡 {finding.recommendation}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            <ConfidenceBadge
                                                level={finding.confidence as 'high' | 'medium' | 'low'}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default GTMQualityPanel;
