import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
    AlertTriangle,
    Shield,
    Scale,
    FileText,
    DollarSign,
    ExternalLink,
    CheckCircle,
    XCircle,
    AlertCircle,
    BookOpen
} from 'lucide-react';

interface Violation {
    tag: string;
    tagId: string | null;
    violation: string;
    article: string;
    description: string;
    severity: string;
    dataCollected: string[];
    estimatedFine: string;
}

interface LGPDAnalysis {
    violations: Violation[];
    totalViolations: number;
    estimatedTotalFine: string;
    hasConsentTool: boolean;
    hasUniversalAnalytics: boolean;
    complianceScore: number;
}

interface LGPDReportProps {
    lgpdAnalysis: LGPDAnalysis;
    url?: string;
}

const LGPDReport = ({ lgpdAnalysis, url }: LGPDReportProps) => {
    const getSeverityInfo = (severity: string) => {
        const info: Record<string, { icon: JSX.Element; color: string; label: string }> = {
            critical: {
                icon: <XCircle className="w-5 h-5 text-red-500" />,
                color: 'bg-red-100 text-red-800 border-red-300',
                label: 'Crítico'
            },
            high: {
                icon: <AlertTriangle className="w-5 h-5 text-orange-500" />,
                color: 'bg-orange-100 text-orange-800 border-orange-300',
                label: 'Alto'
            },
            medium: {
                icon: <AlertCircle className="w-5 h-5 text-yellow-500" />,
                color: 'bg-yellow-100 text-yellow-800 border-yellow-300',
                label: 'Médio'
            },
            low: {
                icon: <CheckCircle className="w-5 h-5 text-blue-500" />,
                color: 'bg-blue-100 text-blue-800 border-blue-300',
                label: 'Baixo'
            },
            none: {
                icon: <CheckCircle className="w-5 h-5 text-green-500" />,
                color: 'bg-green-100 text-green-800 border-green-300',
                label: 'Nenhum'
            }
        };
        return info[severity] || info.medium;
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600';
        if (score >= 50) return 'text-yellow-600';
        return 'text-red-600';
    };

    const getScoreGrade = (score: number) => {
        if (score >= 90) return { grade: 'A', text: 'Excelente', color: 'bg-green-500' };
        if (score >= 80) return { grade: 'B', text: 'Bom', color: 'bg-green-400' };
        if (score >= 60) return { grade: 'C', text: 'Regular', color: 'bg-yellow-500' };
        if (score >= 40) return { grade: 'D', text: 'Ruim', color: 'bg-orange-500' };
        return { grade: 'F', text: 'Crítico', color: 'bg-red-500' };
    };

    const scoreInfo = getScoreGrade(lgpdAnalysis.complianceScore);

    // Links para artigos da LGPD
    const lgpdLinks: Record<string, string> = {
        'Art. 7º e 8º': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art7',
        'Art. 11': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art11',
        'Art. 26': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art26',
        'Art. 46': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art46',
        'Art. 9º': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art9',
        'Art. 52': 'http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm#art52'
    };

    return (
        <div className="space-y-6">
            {/* Header Card com Score */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-slate-900 to-slate-800 text-white">
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-2xl">
                                <Scale className="h-6 w-6" />
                                Relatório de Conformidade LGPD
                            </CardTitle>
                            <CardDescription className="text-slate-300 mt-1">
                                Lei Geral de Proteção de Dados (Lei 13.709/2018)
                            </CardDescription>
                        </div>
                        <div className="text-center">
                            <div className={`w-20 h-20 rounded-full ${scoreInfo.color} flex items-center justify-center text-3xl font-bold text-white shadow-lg`}>
                                {scoreInfo.grade}
                            </div>
                            <div className="text-sm text-slate-300 mt-1">{scoreInfo.text}</div>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white/10 rounded-lg p-4 text-center">
                            <div className={`text-3xl font-bold ${getScoreColor(lgpdAnalysis.complianceScore)}`}>
                                {lgpdAnalysis.complianceScore}%
                            </div>
                            <div className="text-sm text-slate-300">Score de Conformidade</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center">
                            <div className="text-3xl font-bold text-red-400">
                                {lgpdAnalysis.totalViolations}
                            </div>
                            <div className="text-sm text-slate-300">Violações Encontradas</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center">
                            <div className="text-xl font-bold text-orange-400">
                                {lgpdAnalysis.estimatedTotalFine}
                            </div>
                            <div className="text-sm text-slate-300">Multa Estimada</div>
                        </div>
                        <div className="bg-white/10 rounded-lg p-4 text-center">
                            {lgpdAnalysis.hasConsentTool ? (
                                <CheckCircle className="w-8 h-8 text-green-400 mx-auto" />
                            ) : (
                                <XCircle className="w-8 h-8 text-red-400 mx-auto" />
                            )}
                            <div className="text-sm text-slate-300 mt-2">
                                {lgpdAnalysis.hasConsentTool ? 'CMP Detectado' : 'Sem CMP'}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Alertas Principais */}
            {!lgpdAnalysis.hasConsentTool && (
                <Alert variant="destructive" className="border-red-300 bg-red-50">
                    <Shield className="h-5 w-5" />
                    <AlertTitle>⚠️ Ferramenta de Consentimento Ausente</AlertTitle>
                    <AlertDescription>
                        Nenhuma CMP (Consent Management Platform) foi detectada. Sem ela, <strong>qualquer coleta
                            de dados pessoais viola a LGPD</strong>. Recomendamos implementar Cookiebot, OneTrust, ou Didomi.
                    </AlertDescription>
                </Alert>
            )}

            {lgpdAnalysis.hasUniversalAnalytics && (
                <Alert variant="destructive" className="border-orange-300 bg-orange-50">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                    <AlertTitle className="text-orange-800">⚠️ Universal Analytics Detectado (Obsoleto)</AlertTitle>
                    <AlertDescription className="text-orange-700">
                        O Universal Analytics foi descontinuado em julho de 2023. O uso de tecnologia
                        obsoleta pode ser considerado falha em manter medidas de segurança atualizadas (Art. 46 LGPD).
                    </AlertDescription>
                </Alert>
            )}

            {/* Lista de Violações */}
            <Card className="shadow-lg border-0">
                <CardHeader className="bg-red-50 rounded-t-lg">
                    <CardTitle className="flex items-center gap-2 text-red-800">
                        <AlertTriangle className="h-5 w-5" />
                        Violações Detectadas ({lgpdAnalysis.violations.length})
                    </CardTitle>
                    <CardDescription className="text-red-600">
                        Cada violação pode resultar em multa administrativa conforme Art. 52 da LGPD
                    </CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                    {lgpdAnalysis.violations.length === 0 ? (
                        <div className="text-center py-8">
                            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                            <h3 className="text-xl font-semibold text-green-700">Nenhuma violação detectada!</h3>
                            <p className="text-gray-600 mt-2">O site parece estar em conformidade com a LGPD.</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {lgpdAnalysis.violations.map((violation, index) => {
                                const severityInfo = getSeverityInfo(violation.severity);
                                const articleLink = lgpdLinks[violation.article] || lgpdLinks['Art. 52'];

                                return (
                                    <div
                                        key={index}
                                        className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                                    >
                                        <div className="flex items-start justify-between mb-3">
                                            <div className="flex items-center gap-3">
                                                {severityInfo.icon}
                                                <div>
                                                    <h4 className="font-semibold text-gray-900">{violation.tag}</h4>
                                                    {violation.tagId && (
                                                        <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">
                                                            {violation.tagId}
                                                        </code>
                                                    )}
                                                </div>
                                            </div>
                                            <Badge className={severityInfo.color}>
                                                {severityInfo.label}
                                            </Badge>
                                        </div>

                                        <div className="pl-8 space-y-3">
                                            <div>
                                                <span className="text-sm text-gray-500">Violação:</span>
                                                <p className="text-gray-800">{violation.violation}</p>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <BookOpen className="w-4 h-4 text-blue-600" />
                                                <a
                                                    href={articleLink}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-blue-600 hover:underline flex items-center gap-1"
                                                >
                                                    {violation.article}
                                                    <ExternalLink className="w-3 h-3" />
                                                </a>
                                                <span className="text-sm text-gray-600">- {violation.description}</span>
                                            </div>

                                            {violation.dataCollected && violation.dataCollected.length > 0 && (
                                                <div>
                                                    <span className="text-sm text-gray-500">Dados coletados:</span>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {violation.dataCollected.map((data, i) => (
                                                            <Badge key={i} variant="outline" className="text-xs">
                                                                {data}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex items-center gap-2 p-2 bg-red-50 rounded">
                                                <DollarSign className="w-4 h-4 text-red-600" />
                                                <span className="text-sm text-red-800">
                                                    <strong>Multa estimada:</strong> {violation.estimatedFine}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Informações sobre Multas */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-amber-50 to-orange-50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-amber-800">
                        <DollarSign className="h-5 w-5" />
                        Informações sobre Sanções LGPD
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="grid md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="font-semibold text-amber-900 mb-2">📋 Tipos de Sanções (Art. 52)</h4>
                            <ul className="space-y-2 text-sm text-amber-800">
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-amber-500 rounded-full mt-1.5"></span>
                                    <span><strong>Advertência</strong> - Com prazo para correção</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-orange-500 rounded-full mt-1.5"></span>
                                    <span><strong>Multa simples</strong> - Até 2% do faturamento (máx R$ 50 milhões por infração)</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-red-500 rounded-full mt-1.5"></span>
                                    <span><strong>Multa diária</strong> - Para forçar cumprimento</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-red-700 rounded-full mt-1.5"></span>
                                    <span><strong>Bloqueio/Eliminação</strong> - Dos dados pessoais coletados</span>
                                </li>
                            </ul>
                        </div>
                        <div>
                            <h4 className="font-semibold text-amber-900 mb-2">⚖️ Critérios de Aplicação</h4>
                            <ul className="space-y-2 text-sm text-amber-800">
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5"></span>
                                    <span>Gravidade e natureza das infrações</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5"></span>
                                    <span>Boa-fé e cooperação do infrator</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5"></span>
                                    <span>Vantagem auferida ou pretendida</span>
                                </li>
                                <li className="flex items-start gap-2">
                                    <span className="w-2 h-2 bg-blue-500 rounded-full mt-1.5"></span>
                                    <span>Reincidência e grau de dano causado</span>
                                </li>
                            </ul>
                        </div>
                    </div>

                    <div className="mt-4 p-3 bg-white rounded-lg border border-amber-200">
                        <div className="flex items-center gap-2 text-amber-800">
                            <FileText className="w-5 h-5" />
                            <a
                                href="http://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium hover:underline flex items-center gap-1"
                            >
                                Consultar texto completo da Lei 13.709/2018 (LGPD)
                                <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Recomendações */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-green-50 to-emerald-50">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-green-800">
                        <CheckCircle className="h-5 w-5" />
                        Recomendações de Adequação
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        <div className={`p-3 rounded-lg border ${lgpdAnalysis.hasConsentTool ? 'bg-green-100 border-green-300' : 'bg-red-100 border-red-300'}`}>
                            <div className="flex items-start gap-3">
                                {lgpdAnalysis.hasConsentTool ? (
                                    <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
                                ) : (
                                    <XCircle className="w-5 h-5 text-red-600 mt-0.5" />
                                )}
                                <div>
                                    <strong>1. Implementar CMP (Consent Management Platform)</strong>
                                    <p className="text-sm mt-1">
                                        {lgpdAnalysis.hasConsentTool
                                            ? 'CMP detectado. Verifique se está configurado corretamente antes de todas as tags.'
                                            : 'Instale Cookiebot, OneTrust, ou Didomi como primeira tag do site.'}
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg border bg-yellow-100 border-yellow-300">
                            <div className="flex items-start gap-3">
                                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5" />
                                <div>
                                    <strong>2. Configurar GTM com Consent Mode</strong>
                                    <p className="text-sm mt-1">
                                        Habilite o Consent Mode do Google e configure triggers baseados em consentimento.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg border bg-blue-100 border-blue-300">
                            <div className="flex items-start gap-3">
                                <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
                                <div>
                                    <strong>3. Atualizar Política de Privacidade</strong>
                                    <p className="text-sm mt-1">
                                        Documente todos os dados coletados, finalidades, e base legal para cada tratamento.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="p-3 rounded-lg border bg-purple-100 border-purple-300">
                            <div className="flex items-start gap-3">
                                <FileText className="w-5 h-5 text-purple-600 mt-0.5" />
                                <div>
                                    <strong>4. Mapear Data Layer</strong>
                                    <p className="text-sm mt-1">
                                        Documente todos os eventos e dados pessoais que transitam pelo GTM.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default LGPDReport;
