import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    BarChart3,
    Shield,
    Clock,
    FileText,
    Download,
    AlertTriangle,
    CheckCircle,
    Copy,
    Globe,
    PieChart,
    Sparkles,
    FileSpreadsheet,
    Lock,
    Activity,
    Box,
} from 'lucide-react';
import ScriptTimeline from './ScriptTimeline';
import LGPDReport from './LGPDReport';
import AIChat from './AIChat';
import Dashboard from './Dashboard';
import PDFExport from './PDFExport';
import DeepAnalysisPanel from './DeepAnalysisPanel';
import FeatureGate from './FeatureGate';
import EventAuditPanel from './EventAuditPanel';
import GTMQualityPanel from './GTMQualityPanel';
import DataQualityNotes from './DataQualityNotes';
import { useI18n } from '@/context/I18nContext';
import { usePlan } from '@/context/PlanContext';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/hooks/use-toast';

interface Tag {
    id: string;
    name: string;
    type: string;
    position: number;
    lineNumber: number;
    matchedPattern: string;
    tagId: string | null;
    dataCollected: string[];
    lgpdRisk: string;
    context: string;
    isBeforeConsent: boolean;
}

interface NewAuditResult {
    url: string;
    timestamp: string;
    tags: Tag[];
    tagCount: number;
    typeCounts: Record<string, number>;
    duplicates: any[];
    loadingOrder: any[];
    privacy: {
        jurisdiction: string;
        framework: string;
        confidenceLevel: string;
        consentRisks: string[];
        disclosureGaps: string[];
        violations: any[];
        total_violations: number;
        estimatedRiskExposure: string;
        has_consent_tool: boolean;
        has_universal_analytics: boolean;
        compliance_score: number;
    };
    score: number;
    scores?: {
        auditScore: number;
        trackingQualityScore: number;
        eventArchitectureScore: number;
        datalayerQualityScore: number;
        consentIntegrityScore: number;
        privacyRiskScore: number;
        tagDuplicationRisk?: number;
        estimatedBusinessImpact?: string;
    };
    gtmQuality?: any;
    events?: any;
    consentAudit?: any;
    recommendations?: any[];
    dataQualityNotes?: any[];
    summary: {
        totalTags: number;
        consentDetected: boolean;
        consentModeV2?: boolean;
        hasUniversalAnalytics: boolean;
        violationsCount: number;
        estimatedFine: string;
        piiExposureCount?: number;
        securityIssuesCount?: number;
        eventsDetected?: number;
        duplicatesDetected?: number;
    };
    pageReports?: any[];
}

/** Locked export button — shows lock icon and opens upgrade modal on click */
const LockedExportButton = ({ label, icon: Icon, feature, onUpgrade }: {
    label: string;
    icon: React.ElementType;
    feature: string;
    onUpgrade: (f: string) => void;
}) => (
    <Button
        variant="ghost"
        size="sm"
        onClick={() => onUpgrade(feature)}
        className="flex items-center gap-2 opacity-50 cursor-not-allowed border border-dashed border-gray-300 dark:border-gray-600"
        title={`Bloqueado — faça upgrade para acessar ${label}`}
    >
        <Lock className="w-3 h-3" />
        <Icon className="w-4 h-4" />
        {label}
    </Button>
);

const NewAuditResults = ({ result, scanId }: { result: NewAuditResult, scanId?: string }) => {
    const { t } = useI18n();
    const { limits, isFeatureAvailable, setShowUpgradeModal, setBlockedFeature } = usePlan();
    const { token } = useAuth();

    const handleUpgradeLock = (feature: string) => {
        setBlockedFeature(feature);
        setShowUpgradeModal(true);
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600 bg-green-100';
        if (score >= 50) return 'text-yellow-600 bg-yellow-100';
        return 'text-red-600 bg-red-100';
    };

    const handleCopyReport = () => {
        // Free users get a summary-only copy (no violation details)
        const violationsText = limits.showViolationDetails
            ? result.privacy.violations.map(v => `- ${v.tag}: ${v.violation} (${v.article})`).join('\n')
            : `${result.privacy.total_violations} violação(ões) — faça upgrade para detalhes completos`;

        const tagsText = limits.showLineNumbers
            ? result.tags.map(t => `- ${t.name} (${t.type}) — Linha ${t.lineNumber}`).join('\n')
            : result.tags.map(t => `- ${t.name} (${t.type})`).join('\n');

        const report = `
DataTrust Audit Report
================
URL: ${result.url}
Data: ${new Date(result.timestamp).toLocaleString('pt-BR')}

Score de Conformidade: ${result.score}%
Total de Tags: ${result.tagCount}
Violações Detectadas: ${result.privacy.total_violations}
Exposição Estimada: ${result.privacy.estimatedRiskExposure}
Jurisdição: ${result.privacy.jurisdiction} (${result.privacy.framework})

Tags Detectadas:
${tagsText}

Violações:
${violationsText}
        `.trim();

        navigator.clipboard.writeText(report);
        toast({ title: 'Relatório copiado!', description: 'Resumo copiado para a área de transferência.' });
    };

    const handleExportJSON = () => {
        // Strip sensitive data for lower plans
        const exportData = limits.showViolationDetails
            ? result
            : { ...result, privacy: { ...result.privacy, violations: [] } };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'Exportado!', description: 'Relatório exportado em formato JSON.' });
    };

    const handleExportPDF = async () => {
        if (!scanId) {
            toast({ title: 'Aviso', description: 'Exportação indisponível para esta análise não-salva.' });
            return;
        }

        try {
            toast({ title: 'Gerando PDF...', description: 'Aguarde, isso pode levar alguns segundos.' });
            const response = await fetch(`/api/exports/pdf/${scanId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 403) {
                     handleUpgradeLock('exportPDF');
                     return;
                }
                throw new Error('Erro ao gerar PDF');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: 'PDF Exportado!', description: 'Relatório profissional baixado.' });
        } catch {
            toast({ title: 'Erro', description: 'Não foi possível gerar o PDF.', variant: 'destructive' });
        }
    };

    const handleExportExcel = async () => {
        if (!scanId) {
            toast({ title: 'Aviso', description: 'Exportação indisponível para esta análise não-salva.' });
            return;
        }

        try {
            toast({ title: 'Gerando Excel...', description: 'Aguarde, isso pode levar alguns segundos.' });
            const response = await fetch(`/api/exports/excel/${scanId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 403) {
                     handleUpgradeLock('exportExcel');
                     return;
                }
                throw new Error('Erro ao gerar Excel');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: 'Excel Exportado!', description: 'Planilha detalhada baixada.' });
        } catch {
            toast({ title: 'Erro', description: 'Não foi possível gerar o Excel.', variant: 'destructive' });
        }
    };

    // Slice tags list by plan visibility percentage
    const visibleTagCount = Math.max(1, Math.ceil(result.tags.length * (limits.visibilityPercentage / 100)));
    const visibleTags = result.tags.slice(0, visibleTagCount);
    const hasMoreTags = visibleTagCount < result.tags.length;

    return (
        <div className="space-y-6">
            {/* ─── Header banner ─── */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-blue-600 to-indigo-700 text-white overflow-hidden">
                <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-2xl font-bold mb-2 flex items-center gap-2">
                                <Globe className="w-6 h-6" />
                                Resultado da Auditoria
                            </h2>
                            <p className="text-blue-100 flex items-center gap-2">
                                <code className="bg-white/20 px-2 py-1 rounded text-sm">{result.url}</code>
                            </p>
                            <p className="text-blue-200 text-sm mt-2">
                                {new Date(result.timestamp).toLocaleString('pt-BR')}
                            </p>
                        </div>
                        <div className="text-center">
                            <div className={`w-24 h-24 rounded-full flex items-center justify-center text-4xl font-bold ${getScoreColor(result.score)} shadow-lg`}>
                                {result.score}
                            </div>
                            <p className="text-blue-100 text-sm mt-2">{t('dashboard.score_title')}</p>
                        </div>
                    </div>

                    {/* Quick stats */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mt-6">
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-3xl font-bold">{result.tagCount}</div>
                            <div className="text-sm text-blue-100">{t('dashboard.tags_detected')}</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-3xl font-bold text-red-300">{result.privacy.total_violations}</div>
                            <div className="text-sm text-blue-100">Violações</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-3xl font-bold text-cyan-300">{result.summary?.eventsDetected ?? 0}</div>
                            <div className="text-sm text-blue-100">Eventos GA4</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            {result.privacy.has_consent_tool ? (
                                <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
                            ) : (
                                <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
                            )}
                            <div className="text-sm text-blue-100 mt-2">
                                {result.privacy.has_consent_tool ? 'CMP OK' : 'Sem CMP'}
                            </div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            {limits.showViolationDetails ? (
                                <div className="text-lg font-bold text-orange-300 line-clamp-2 leading-tight mt-1">{result.privacy.estimatedRiskExposure}</div>
                            ) : (
                                <button
                                    onClick={() => handleUpgradeLock('showViolationDetails')}
                                    className="text-lg font-bold text-orange-300 blur-sm select-none cursor-pointer hover:blur-none transition-all mt-1"
                                    title="Faça upgrade para ver o risco estimado"
                                >
                                    Risco Estimado: Moderado
                                </button>
                            )}
                            <div className="text-sm text-blue-100 mt-1">Exposição</div>
                        </div>
                    </div>

                    {/* ─── Export buttons (plan-gated) ─── */}
                    <div className="flex gap-2 mt-6 flex-wrap">
                        {/* Copy: always available */}
                        <Button variant="secondary" size="sm" onClick={handleCopyReport} className="flex items-center gap-2">
                            <Copy className="w-4 h-4" />
                            {t('buttons.copy')}
                        </Button>

                        {/* JSON: Pro+ */}
                        {isFeatureAvailable('jsonExport') ? (
                            <Button variant="secondary" size="sm" onClick={handleExportJSON} className="flex items-center gap-2">
                                <Download className="w-4 h-4" />
                                {t('buttons.export_json')}
                            </Button>
                        ) : (
                            <LockedExportButton label={t('buttons.export_json')} icon={Download} feature="jsonExport" onUpgrade={handleUpgradeLock} />
                        )}

                        {/* PDF: Pro+ */}
                        {isFeatureAvailable('pdfExport') ? (
                            <Button variant="secondary" size="sm" onClick={handleExportPDF} className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-800">
                                <FileText className="w-4 h-4" />
                                {t('buttons.export_pdf')}
                            </Button>
                        ) : (
                            <LockedExportButton label={t('buttons.export_pdf')} icon={FileText} feature="pdfExport" onUpgrade={handleUpgradeLock} />
                        )}

                        {/* Excel: Premium only */}
                        {isFeatureAvailable('excelExport') ? (
                            <Button variant="secondary" size="sm" onClick={handleExportExcel} className="flex items-center gap-2 bg-green-100 hover:bg-green-200 text-green-800">
                                <FileSpreadsheet className="w-4 h-4" />
                                {t('buttons.export_excel')}
                            </Button>
                        ) : (
                            <LockedExportButton label={t('buttons.export_excel')} icon={FileSpreadsheet} feature="excelExport" onUpgrade={handleUpgradeLock} />
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* ─── Tags by type ─── */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Tags Detectadas por Categoria
                        <Badge variant="outline" className="ml-auto text-xs">
                            {limits.visibilityPercentage}% visível
                        </Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-3">
                        {Object.entries(result.typeCounts).map(([type, count]) => {
                            const typeLabels: Record<string, { label: string; color: string }> = {
                                consent: { label: '🔐 Consentimento', color: 'bg-green-100 text-green-800 border-green-300' },
                                tag_manager: { label: '📦 Tag Manager', color: 'bg-blue-100 text-blue-800 border-blue-300' },
                                analytics: { label: '📊 Analytics', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' },
                                advertising: { label: '📢 Publicidade', color: 'bg-orange-100 text-orange-800 border-orange-300' },
                                heatmap: { label: '🔥 Heatmap', color: 'bg-red-100 text-red-800 border-red-300' },
                                support: { label: '💬 Suporte', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' },
                            };
                            const info = typeLabels[type] || { label: type, color: 'bg-gray-100 text-gray-800' };
                            return (
                                <Badge key={type} className={`${info.color} text-base px-4 py-2`}>
                                    {info.label}: {count}
                                </Badge>
                            );
                        })}
                    </div>

                    {/* Duplicates — Pro+ */}
                    {result.duplicates && result.duplicates.length > 0 && (
                        <FeatureGate feature="showViolationDetails" featureName="Tags duplicadas">
                            <div className="mt-6 rounded-2xl overflow-hidden border border-orange-200 bg-orange-50/50 shadow-sm relative">
                                <div className="absolute top-0 left-0 w-1 h-full bg-orange-500" />
                                <div className="p-5">
                                    <h4 className="font-semibold text-orange-900 flex items-center gap-2 mb-3">
                                        <AlertTriangle className="w-5 h-5 text-orange-600" />
                                        Alerta de Qualidade: Tags Duplicadas Detectadas
                                    </h4>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {result.duplicates.map((dup, i) => (
                                            <div key={i} className="bg-white border border-orange-100 rounded-xl p-4 flex flex-col gap-2 shadow-sm">
                                                <div className="flex justify-between items-start">
                                                    <span className="font-medium text-slate-800 break-all pr-2">{dup.tag}</span>
                                                    <Badge variant="destructive" className="bg-orange-100 text-orange-800 border bg-orange-200 border-none shrink-0">
                                                        {dup.count}x disparos
                                                    </Badge>
                                                </div>
                                                <p className="text-sm text-slate-600 border-t border-slate-100 pt-2 mt-1">
                                                    <span className="font-medium text-orange-700">Recomendação:</span> {dup.recommendation}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </FeatureGate>
                    )}
                </CardContent>
            </Card>

            {/* ─── Main tabs ─── */}
            <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="flex flex-wrap w-full h-auto gap-1 p-1">
                    <TabsTrigger value="dashboard" className="flex items-center gap-1.5 text-xs">
                        <PieChart className="w-3.5 h-3.5" />
                        {t('nav.dashboard')}
                    </TabsTrigger>

                    <TabsTrigger value="events" className="flex items-center gap-1.5 text-xs">
                        <Activity className="w-3.5 h-3.5" />
                        Eventos
                    </TabsTrigger>

                    <TabsTrigger value="gtm-quality" className="flex items-center gap-1.5 text-xs">
                        <Box className="w-3.5 h-3.5" />
                        GTM Quality
                    </TabsTrigger>

                    <TabsTrigger value="deep" className="flex items-center gap-1.5 text-xs">
                        <Sparkles className="w-3.5 h-3.5" />
                        IA PRO
                        {!isFeatureAvailable('deepAnalysis') && <Lock className="w-3 h-3 opacity-50" />}
                    </TabsTrigger>

                    <TabsTrigger value="timeline" className="flex items-center gap-1.5 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        Timeline
                        {!isFeatureAvailable('showLineNumbers') && <Lock className="w-3 h-3 opacity-50" />}
                    </TabsTrigger>

                    <TabsTrigger value="lgpd" className="flex items-center gap-1.5 text-xs">
                        <Shield className="w-3.5 h-3.5" />
                        Privacidade
                    </TabsTrigger>

                    {result.pageReports && (
                        <TabsTrigger value="deep-scan" className="flex items-center gap-1.5 text-xs">
                            <Globe className="w-3.5 h-3.5" />
                            {t('home.tab_deep')}
                        </TabsTrigger>
                    )}

                    <TabsTrigger value="details" className="flex items-center gap-1.5 text-xs">
                        <FileText className="w-3.5 h-3.5" />
                        {t('common.results')}
                    </TabsTrigger>
                </TabsList>

                {/* Dashboard */}
                <TabsContent value="dashboard" className="mt-6">
                    <Dashboard result={result} />
                </TabsContent>

                {/* Events */}
                <TabsContent value="events" className="mt-6">
                    <EventAuditPanel data={result.events || null} />
                </TabsContent>

                {/* GTM Quality */}
                <TabsContent value="gtm-quality" className="mt-6">
                    <GTMQualityPanel data={result.gtmQuality || null} />
                </TabsContent>

                {/* AI Deep Analysis — Premium only */}
                <TabsContent value="deep" className="mt-6">
                    <FeatureGate feature="deepAnalysis" featureName="Análise PRO">
                        <DeepAnalysisPanel
                            url={result.url}
                            detectedTags={result.tags}
                            hasConsentTool={result.privacy.has_consent_tool}
                        />
                    </FeatureGate>
                </TabsContent>

                {/* Timeline — Premium only */}
                <TabsContent value="timeline" className="mt-6">
                    <FeatureGate feature="showLineNumbers" featureName="Script Timeline com linha de código">
                        <ScriptTimeline
                            tags={result.tags}
                            loadingOrder={result.loadingOrder}
                            hasConsentTool={result.privacy.has_consent_tool}
                        />
                    </FeatureGate>
                </TabsContent>

                <TabsContent value="lgpd" className="mt-6">
                    <FeatureGate feature="showViolationDetails" featureName="Relatório de Privacidade completo">
                        <LGPDReport 
                            lgpdAnalysis={{
                                ...result.privacy,
                                totalViolations: result.privacy.total_violations,
                                hasConsentTool: result.privacy.has_consent_tool,
                                hasUniversalAnalytics: result.privacy.has_universal_analytics,
                                complianceScore: result.privacy.compliance_score
                            } as any} 
                            url={result.url} 
                        />
                    </FeatureGate>
                </TabsContent>

                {/* Deep Scan multi-page — Premium */}
                {result.pageReports && (
                    <TabsContent value="deep-scan" className="mt-6">
                        <FeatureGate feature="deepAnalysis" featureName="Deep Scan multi-página">
                            <DeepAnalysisPanel
                                url={result.url}
                                detectedTags={result.tags}
                                hasConsentTool={result.privacy.has_consent_tool}
                                pages={result.pageReports}
                                ga4PropertyId={result.tags.find(t => t.name.includes('GA4'))?.tagId || ''}
                            />
                        </FeatureGate>
                    </TabsContent>
                )}

                {/* Tag details table */}
                <TabsContent value="details" className="mt-6">
                    <Card className="shadow-lg border-0">
                        <CardHeader>
                            <CardTitle>📋 Lista de Tags Detectadas</CardTitle>
                            <CardDescription>
                                {hasMoreTags ? (
                                    <span className="flex items-center gap-2">
                                        <Lock className="w-3 h-3" />
                                        Mostrando {visibleTagCount} de {result.tags.length} tags ({limits.visibilityPercentage}% visível —{' '}
                                        <button
                                            className="text-blue-600 underline hover:no-underline"
                                            onClick={() => handleUpgradeLock('showViolationDetails')}
                                        >
                                            faça upgrade para ver todas
                                        </button>
                                        )
                                    </span>
                                ) : (
                                    `${result.tags.length} tags detectadas no código fonte`
                                )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-gray-200">
                                            <th className="text-left p-3 font-semibold">#</th>
                                            <th className="text-left p-3 font-semibold">Tag</th>
                                            <th className="text-left p-3 font-semibold">Tipo</th>
                                            <th className="text-left p-3 font-semibold flex items-center gap-1.5">
                                                Linha
                                                {!isFeatureAvailable('showLineNumbers') && <Lock className="w-3 h-3 text-amber-500" />}
                                            </th>
                                            {/* Tag ID / pattern — Pro+ */}
                                            {isFeatureAvailable('showViolationDetails') && (
                                                <th className="text-left p-3 font-semibold">ID/Padrão</th>
                                            )}
                                            <th className="text-left p-3 font-semibold">Risco LGPD</th>
                                            <th className="text-left p-3 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleTags.map((tag, index) => (
                                            <tr
                                                key={index}
                                                className={`border-b border-gray-100 hover:bg-gray-50 ${tag.isBeforeConsent ? 'bg-red-50' : ''}`}
                                            >
                                                <td className="p-3">
                                                    <Badge variant="outline">{index + 1}</Badge>
                                                </td>
                                                <td className="p-3 font-medium">{tag.name}</td>
                                                <td className="p-3">
                                                    <Badge className={
                                                        tag.type === 'consent' ? 'bg-green-100 text-green-800' :
                                                            tag.type === 'tag_manager' ? 'bg-blue-100 text-blue-800' :
                                                                tag.type === 'analytics' ? 'bg-indigo-100 text-indigo-800' :
                                                                    tag.type === 'advertising' ? 'bg-orange-100 text-orange-800' :
                                                                        tag.type === 'heatmap' ? 'bg-red-100 text-red-800' :
                                                                            'bg-gray-100 text-gray-800'
                                                    }>
                                                        {tag.type}
                                                    </Badge>
                                                </td>
                                                <td className="p-3">
                                                    {isFeatureAvailable('showLineNumbers') ? (
                                                        <code className="text-sm bg-gray-100 px-2 py-0.5 rounded">{tag.lineNumber}</code>
                                                    ) : (
                                                        <Badge variant="outline" className="text-[10px] uppercase bg-amber-50 text-amber-600 border-amber-200 gap-1 opacity-70 cursor-pointer hover:opacity-100 transition-opacity" onClick={() => handleUpgradeLock('showLineNumbers')}>
                                                            <Lock className="w-2.5 h-2.5" />
                                                            Premium
                                                        </Badge>
                                                    )}
                                                </td>
                                                {/* ID/Pattern — Pro+ */}
                                                {isFeatureAvailable('showViolationDetails') && (
                                                    <td className="p-3">
                                                        <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                                                            {tag.tagId || tag.matchedPattern.substring(0, 20)}
                                                        </code>
                                                    </td>
                                                )}
                                                <td className="p-3">
                                                    <Badge className={
                                                        tag.lgpdRisk === 'critical' ? 'bg-red-100 text-red-800' :
                                                            tag.lgpdRisk === 'high' ? 'bg-orange-100 text-orange-800' :
                                                                tag.lgpdRisk === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                                                                    'bg-green-100 text-green-800'
                                                    }>
                                                        {tag.lgpdRisk}
                                                    </Badge>
                                                </td>
                                                <td className="p-3">
                                                    {tag.isBeforeConsent ? (
                                                        <Badge className="bg-red-100 text-red-800">❌ Violação</Badge>
                                                    ) : (
                                                        <Badge className="bg-green-100 text-green-800">✅ OK</Badge>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}

                                        {/* Locked rows hint */}
                                        {hasMoreTags && (
                                            <tr className="border-b border-dashed border-gray-200 bg-gray-50/50">
                                                <td colSpan={7} className="p-3 text-center">
                                                    <button
                                                        className="flex items-center gap-2 mx-auto text-sm text-gray-400 hover:text-blue-600"
                                                        onClick={() => handleUpgradeLock('showViolationDetails')}
                                                    >
                                                        <Lock className="w-3 h-3" />
                                                        + {result.tags.length - visibleTagCount} tags ocultas — faça upgrade para ver todas
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Data Quality Notes */}
            {result.dataQualityNotes && result.dataQualityNotes.length > 0 && (
                <DataQualityNotes notes={result.dataQualityNotes} />
            )}

            {/* AI Chat */}
            <AIChat
                context={{
                    violations: result.privacy.total_violations,
                    score: result.score,
                    hasConsentTool: result.privacy.has_consent_tool,
                    tags: result.tags,
                    estimatedFine: result.privacy.estimatedRiskExposure,
                    url: result.url,
                    piiExposure: result.summary?.piiExposureCount || 0,
                    securityIssues: result.summary?.securityIssuesCount || 0,
                    isDeepScan: !!result.pageReports,
                }}
            />
        </div>
    );
};

export default NewAuditResults;
