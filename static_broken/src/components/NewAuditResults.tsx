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
    FileSpreadsheet
} from 'lucide-react';
import ScriptTimeline from './ScriptTimeline';
import LGPDReport from './LGPDReport';
import AIChat from './AIChat';
import Dashboard from './Dashboard';
import PDFExport from './PDFExport';
import DeepAnalysisPanel from './DeepAnalysisPanel';
import FeatureGate from './FeatureGate';
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
    lgpdAnalysis: {
        violations: any[];
        totalViolations: number;
        estimatedTotalFine: string;
        hasConsentTool: boolean;
        hasUniversalAnalytics: boolean;
        complianceScore: number;
    };
    score: number;
    summary: {
        totalTags: number;
        consentDetected: boolean;
        hasUniversalAnalytics: boolean;
        violationsCount: number;
        estimatedFine: string;
    };
}

interface NewAuditResultsProps {
    result: NewAuditResult;
}

const NewAuditResults = ({ result }: NewAuditResultsProps) => {
    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600 bg-green-100';
        if (score >= 50) return 'text-yellow-600 bg-yellow-100';
        return 'text-red-600 bg-red-100';
    };

    const handleCopyReport = () => {
        const report = `
GTM Audit Report
================
URL: ${result.url}
Data: ${new Date(result.timestamp).toLocaleString('pt-BR')}

Score de Conformidade: ${result.score}%
Total de Tags: ${result.tagCount}
Violações LGPD: ${result.lgpdAnalysis.totalViolations}
Multa Estimada: ${result.lgpdAnalysis.estimatedTotalFine}

Tags Detectadas:
${result.tags.map(t => `- ${t.name} (${t.type}) - Linha ${t.lineNumber}`).join('\n')}

Violações:
${result.lgpdAnalysis.violations.map(v => `- ${v.tag}: ${v.violation} (${v.article})`).join('\n')}
    `.trim();

        navigator.clipboard.writeText(report);
        toast({
            title: "Relatório copiado!",
            description: "O relatório foi copiado para a área de transferência."
        });
    };

    const handleExportJSON = () => {
        const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gtm-audit-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({
            title: "Exportado!",
            description: "O relatório foi exportado em formato JSON."
        });
    };

    const handleExportPDF = async () => {
        try {
            toast({ title: "Gerando PDF...", description: "Aguarde, isso pode levar alguns segundos." });
            const response = await fetch('/export/pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ result })
            });
            if (!response.ok) throw new Error('Erro ao gerar PDF');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gtm-audit-${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: "PDF Exportado!", description: "O relatório profissional foi baixado." });
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível gerar o PDF.", variant: "destructive" });
        }
    };

    const handleExportExcel = async () => {
        try {
            toast({ title: "Gerando Excel...", description: "Aguarde, isso pode levar alguns segundos." });
            const response = await fetch('/export/excel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ result })
            });
            if (!response.ok) throw new Error('Erro ao gerar Excel');
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `gtm-audit-${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: "Excel Exportado!", description: "O relatório detalhado foi baixado." });
        } catch (error) {
            toast({ title: "Erro", description: "Não foi possível gerar o Excel.", variant: "destructive" });
        }
    };

    return (
        <div className="space-y-6">
            {/* Header com resumo */}
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
                            <p className="text-blue-100 text-sm mt-2">Score LGPD</p>
                        </div>
                    </div>

                    {/* Stats rápidas */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-3xl font-bold">{result.tagCount}</div>
                            <div className="text-sm text-blue-100">Tags Detectadas</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-3xl font-bold text-red-300">
                                {result.lgpdAnalysis.totalViolations}
                            </div>
                            <div className="text-sm text-blue-100">Violações LGPD</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            {result.lgpdAnalysis.hasConsentTool ? (
                                <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
                            ) : (
                                <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
                            )}
                            <div className="text-sm text-blue-100 mt-2">
                                {result.lgpdAnalysis.hasConsentTool ? 'CMP OK' : 'Sem CMP'}
                            </div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center backdrop-blur-sm">
                            <div className="text-lg font-bold text-orange-300">
                                {result.lgpdAnalysis.estimatedTotalFine}
                            </div>
                            <div className="text-sm text-blue-100">Multa Estimada</div>
                        </div>
                    </div>

                    {/* Botões de ação */}
                    <div className="flex gap-2 mt-6 flex-wrap">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleCopyReport}
                            className="flex items-center gap-2"
                        >
                            <Copy className="w-4 h-4" />
                            Copiar
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleExportJSON}
                            className="flex items-center gap-2"
                        >
                            <Download className="w-4 h-4" />
                            JSON
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleExportPDF}
                            className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-800"
                        >
                            <FileText className="w-4 h-4" />
                            PDF
                        </Button>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleExportExcel}
                            className="flex items-center gap-2 bg-green-100 hover:bg-green-200 text-green-800"
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                            Excel
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Tags por tipo */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" />
                        Tags Detectadas por Categoria
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-3">
                        {Object.entries(result.typeCounts).map(([type, count]) => {
                            const typeLabels: Record<string, { label: string; color: string }> = {
                                consent: { label: '🔐 Consentimento', color: 'bg-green-100 text-green-800 border-green-300' },
                                tag_manager: { label: '📦 Tag Manager', color: 'bg-blue-100 text-blue-800 border-blue-300' },
                                analytics: { label: '📊 Analytics', color: 'bg-purple-100 text-purple-800 border-purple-300' },
                                advertising: { label: '📢 Publicidade', color: 'bg-orange-100 text-orange-800 border-orange-300' },
                                heatmap: { label: '🔥 Heatmap', color: 'bg-red-100 text-red-800 border-red-300' },
                                support: { label: '💬 Suporte', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' }
                            };
                            const info = typeLabels[type] || { label: type, color: 'bg-gray-100 text-gray-800' };
                            return (
                                <Badge key={type} className={`${info.color} text-base px-4 py-2`}>
                                    {info.label}: {count}
                                </Badge>
                            );
                        })}
                    </div>

                    {/* Duplicatas */}
                    {result.duplicates && result.duplicates.length > 0 && (
                        <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <h4 className="font-semibold text-yellow-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4" />
                                ⚠️ Tags Duplicadas Detectadas
                            </h4>
                            <div className="mt-2 space-y-1">
                                {result.duplicates.map((dup, i) => (
                                    <div key={i} className="text-sm text-yellow-700">
                                        {dup.tag}: {dup.count}x - {dup.recommendation}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Tabs com detalhes */}
            <Tabs defaultValue="dashboard" className="w-full">
                <TabsList className="grid w-full grid-cols-5">
                    <TabsTrigger value="dashboard" className="flex items-center gap-2">
                        <PieChart className="w-4 h-4" />
                        Dashboard
                    </TabsTrigger>
                    <TabsTrigger value="deep" className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4" />
                        Análise PRO
                    </TabsTrigger>
                    <TabsTrigger value="timeline" className="flex items-center gap-2">
                        <Clock className="w-4 h-4" />
                        Timeline
                    </TabsTrigger>
                    <TabsTrigger value="lgpd" className="flex items-center gap-2">
                        <Shield className="w-4 h-4" />
                        LGPD
                    </TabsTrigger>
                    <TabsTrigger value="details" className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Tags
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="dashboard" className="mt-6">
                    <Dashboard result={result} />
                </TabsContent>

                <TabsContent value="deep" className="mt-6">
                    <FeatureGate feature="deepAnalysis" featureName="Análise PRO">
                        <DeepAnalysisPanel
                            url={result.url}
                            detectedTags={result.tags}
                            hasConsentTool={result.lgpdAnalysis.hasConsentTool}
                        />
                    </FeatureGate>
                </TabsContent>

                <TabsContent value="timeline" className="mt-6">
                    <ScriptTimeline
                        tags={result.tags}
                        loadingOrder={result.loadingOrder}
                        hasConsentTool={result.lgpdAnalysis.hasConsentTool}
                    />
                </TabsContent>

                <TabsContent value="lgpd" className="mt-6">
                    <LGPDReport
                        lgpdAnalysis={result.lgpdAnalysis}
                        url={result.url}
                    />
                </TabsContent>


                <TabsContent value="details" className="mt-6">
                    <Card className="shadow-lg border-0">
                        <CardHeader>
                            <CardTitle>📋 Lista Completa de Tags</CardTitle>
                            <CardDescription>
                                Todas as tags detectadas no código fonte do site
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse">
                                    <thead>
                                        <tr className="border-b-2 border-gray-200">
                                            <th className="text-left p-3 font-semibold">Posição</th>
                                            <th className="text-left p-3 font-semibold">Tag</th>
                                            <th className="text-left p-3 font-semibold">Tipo</th>
                                            <th className="text-left p-3 font-semibold">Linha</th>
                                            <th className="text-left p-3 font-semibold">ID/Padrão</th>
                                            <th className="text-left p-3 font-semibold">Risco LGPD</th>
                                            <th className="text-left p-3 font-semibold">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {result.tags.map((tag, index) => (
                                            <tr key={index} className={`border-b border-gray-100 hover:bg-gray-50 ${tag.isBeforeConsent ? 'bg-red-50' : ''
                                                }`}>
                                                <td className="p-3">
                                                    <Badge variant="outline">{index + 1}</Badge>
                                                </td>
                                                <td className="p-3 font-medium">{tag.name}</td>
                                                <td className="p-3">
                                                    <Badge className={
                                                        tag.type === 'consent' ? 'bg-green-100 text-green-800' :
                                                            tag.type === 'tag_manager' ? 'bg-blue-100 text-blue-800' :
                                                                tag.type === 'analytics' ? 'bg-purple-100 text-purple-800' :
                                                                    tag.type === 'advertising' ? 'bg-orange-100 text-orange-800' :
                                                                        tag.type === 'heatmap' ? 'bg-red-100 text-red-800' :
                                                                            'bg-gray-100 text-gray-800'
                                                    }>
                                                        {tag.type}
                                                    </Badge>
                                                </td>
                                                <td className="p-3">
                                                    <code className="text-sm bg-gray-100 px-2 py-0.5 rounded">
                                                        {tag.lineNumber}
                                                    </code>
                                                </td>
                                                <td className="p-3">
                                                    <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                                                        {tag.tagId || tag.matchedPattern.substring(0, 20)}
                                                    </code>
                                                </td>
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
                                                        <Badge className="bg-red-100 text-red-800">
                                                            ❌ Violação
                                                        </Badge>
                                                    ) : (
                                                        <Badge className="bg-green-100 text-green-800">
                                                            ✅ OK
                                                        </Badge>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Chat IA flutuante */}
            <AIChat
                context={{
                    violations: result.lgpdAnalysis.totalViolations,
                    score: result.score,
                    hasConsentTool: result.lgpdAnalysis.hasConsentTool,
                    tags: result.tags,
                    estimatedFine: result.lgpdAnalysis.estimatedTotalFine
                }}
            />
        </div>
    );
};

export default NewAuditResults;
