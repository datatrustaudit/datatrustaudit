import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Legend,
    LineChart,
    Line,
    Area,
    AreaChart
} from 'recharts';
import {
    Shield,
    AlertTriangle,
    CheckCircle,
    TrendingUp,
    BarChart3,
    PieChart as PieIcon,
    Activity
} from 'lucide-react';

interface DashboardProps {
    result: {
        tags: any[];
        typeCounts: Record<string, number>;
        lgpdAnalysis: {
            violations: any[];
            totalViolations: number;
            estimatedTotalFine: string;
            hasConsentTool: boolean;
            complianceScore: number;
        };
        score: number;
        loadingOrder: any[];
    };
}

const Dashboard = ({ result }: DashboardProps) => {
    // Dados para o gráfico de pizza de tipos de tags
    const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#6B7280'];

    const pieData = Object.entries(result.typeCounts).map(([type, count], index) => {
        const labels: Record<string, string> = {
            consent: 'Consentimento',
            tag_manager: 'Tag Manager',
            analytics: 'Analytics',
            advertising: 'Publicidade',
            heatmap: 'Heatmap',
            support: 'Suporte',
            custom: 'Customizado'
        };
        return {
            name: labels[type] || type,
            value: count,
            color: COLORS[index % COLORS.length]
        };
    });

    // Dados para gráfico de barras de severidade
    const severityData = [
        {
            name: 'Crítico',
            count: result.lgpdAnalysis.violations.filter(v => v.severity === 'critical').length,
            color: '#EF4444'
        },
        {
            name: 'Alto',
            count: result.lgpdAnalysis.violations.filter(v => v.severity === 'high').length,
            color: '#F97316'
        },
        {
            name: 'Médio',
            count: result.lgpdAnalysis.violations.filter(v => v.severity === 'medium').length,
            color: '#EAB308'
        },
        {
            name: 'Baixo',
            count: result.lgpdAnalysis.violations.filter(v => v.severity === 'low').length,
            color: '#3B82F6'
        }
    ];

    // Dados para timeline de carregamento
    const timelineData = result.tags.map((tag, index) => ({
        position: index + 1,
        name: tag.name.length > 15 ? tag.name.substring(0, 15) + '...' : tag.name,
        fullName: tag.name,
        lineNumber: tag.lineNumber,
        risk: tag.lgpdRisk === 'critical' ? 100 :
            tag.lgpdRisk === 'high' ? 75 :
                tag.lgpdRisk === 'medium' ? 50 : 25,
        isViolation: tag.isBeforeConsent ? 1 : 0
    }));

    // Score gauge data
    const scoreData = [
        { name: 'Score', value: result.score },
        { name: 'Remaining', value: 100 - result.score }
    ];

    const getScoreColor = (score: number) => {
        if (score >= 80) return '#10B981';
        if (score >= 50) return '#EAB308';
        return '#EF4444';
    };

    return (
        <div className="space-y-6">
            {/* Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-100 text-sm">Total Tags</p>
                                <p className="text-3xl font-bold">{result.tags.length}</p>
                            </div>
                            <BarChart3 className="w-10 h-10 text-blue-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-red-500 to-red-600 text-white">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-red-100 text-sm">Violações LGPD</p>
                                <p className="text-3xl font-bold">{result.lgpdAnalysis.totalViolations}</p>
                            </div>
                            <AlertTriangle className="w-10 h-10 text-red-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className={`bg-gradient-to-br ${result.lgpdAnalysis.hasConsentTool ? 'from-green-500 to-green-600' : 'from-orange-500 to-orange-600'} text-white`}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white/80 text-sm">CMP Status</p>
                                <p className="text-xl font-bold">
                                    {result.lgpdAnalysis.hasConsentTool ? 'Detectado' : 'Ausente'}
                                </p>
                            </div>
                            {result.lgpdAnalysis.hasConsentTool ? (
                                <CheckCircle className="w-10 h-10 text-green-200" />
                            ) : (
                                <Shield className="w-10 h-10 text-orange-200" />
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-indigo-100 text-sm">Score LGPD</p>
                                <p className="text-3xl font-bold">{result.score}%</p>
                            </div>
                            <TrendingUp className="w-10 h-10 text-indigo-200" />
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Row */}
            <div className="grid md:grid-cols-2 gap-6">
                {/* Pie Chart - Tipos de Tags */}
                <Card className="shadow-lg border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <PieIcon className="w-5 h-5" />
                            Distribuição por Tipo
                        </CardTitle>
                        <CardDescription>
                            Categorias de tags detectadas no site
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <PieChart>
                                <Pie
                                    data={pieData}
                                    cx="50%"
                                    cy="50%"
                                    labelLine={false}
                                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                                    outerRadius={100}
                                    fill="#8884d8"
                                    dataKey="value"
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Bar Chart - Severidade das Violações */}
                <Card className="shadow-lg border-0">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="w-5 h-5" />
                            Violações por Severidade
                        </CardTitle>
                        <CardDescription>
                            Distribuição das violações LGPD por nível de risco
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={300}>
                            <BarChart data={severityData}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey="name" />
                                <YAxis allowDecimals={false} />
                                <Tooltip />
                                <Bar dataKey="count" name="Quantidade">
                                    {severityData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Timeline Chart - Ordem de Carregamento */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        Timeline de Risco por Posição de Carregamento
                    </CardTitle>
                    <CardDescription>
                        Nível de risco LGPD de cada tag na ordem em que são carregadas
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="position" label={{ value: 'Posição', position: 'bottom' }} />
                            <YAxis
                                domain={[0, 100]}
                                tickFormatter={(value) => {
                                    if (value === 100) return 'Crítico';
                                    if (value === 75) return 'Alto';
                                    if (value === 50) return 'Médio';
                                    if (value === 25) return 'Baixo';
                                    return '';
                                }}
                            />
                            <Tooltip
                                content={({ active, payload }) => {
                                    if (active && payload && payload.length) {
                                        const data = payload[0].payload;
                                        return (
                                            <div className="bg-white p-3 rounded-lg shadow-lg border">
                                                <p className="font-semibold">{data.fullName}</p>
                                                <p className="text-sm text-gray-600">Linha: {data.lineNumber}</p>
                                                <p className="text-sm">
                                                    Risco: {data.risk === 100 ? 'Crítico' :
                                                        data.risk === 75 ? 'Alto' :
                                                            data.risk === 50 ? 'Médio' : 'Baixo'}
                                                </p>
                                                {data.isViolation === 1 && (
                                                    <Badge className="mt-1 bg-red-100 text-red-800">Violação LGPD</Badge>
                                                )}
                                            </div>
                                        );
                                    }
                                    return null;
                                }}
                            />
                            <defs>
                                <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.8} />
                                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.2} />
                                </linearGradient>
                            </defs>
                            <Area
                                type="monotone"
                                dataKey="risk"
                                stroke="#8884d8"
                                fill="url(#riskGradient)"
                                name="Nível de Risco"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Score Gauge */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Shield className="w-5 h-5" />
                        Score de Conformidade LGPD
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-center">
                        <div className="relative">
                            <ResponsiveContainer width={250} height={250}>
                                <PieChart>
                                    <Pie
                                        data={scoreData}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={80}
                                        outerRadius={100}
                                        startAngle={180}
                                        endAngle={0}
                                        dataKey="value"
                                    >
                                        <Cell fill={getScoreColor(result.score)} />
                                        <Cell fill="#E5E7EB" />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                <div className="text-4xl font-bold" style={{ color: getScoreColor(result.score) }}>
                                    {result.score}%
                                </div>
                                <div className="text-sm text-gray-500">
                                    {result.score >= 80 ? 'Bom' : result.score >= 50 ? 'Regular' : 'Crítico'}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="flex justify-center gap-6 mt-4">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <span className="text-sm text-gray-600">80-100: Bom</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                            <span className="text-sm text-gray-600">50-79: Regular</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-red-500"></div>
                            <span className="text-sm text-gray-600">0-49: Crítico</span>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Multa Estimada Destaque */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
                <CardContent className="pt-6">
                    <div className="text-center">
                        <p className="text-amber-800 text-lg mb-2">💰 Multa Estimada Total</p>
                        <p className="text-3xl font-bold text-amber-900">
                            {result.lgpdAnalysis.estimatedTotalFine}
                        </p>
                        <p className="text-sm text-amber-700 mt-2">
                            Baseado no Art. 52 da Lei 13.709/2018 (LGPD)
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default Dashboard;
