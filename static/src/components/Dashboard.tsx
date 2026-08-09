import type { ElementType } from 'react';
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
import { useI18n } from '@/context/I18nContext';
import { usePlan } from '@/context/PlanContext';
import PainelDeScores from './laudo/PainelDeScores';
import {
    BalaoDoGrafico,
    CORES,
    CORES_DE_CATEGORIA,
    CORES_DE_SEVERIDADE,
    EIXO,
    GRADE,
    TooltipEscuro,
    corDoScore,
} from './laudo/tema-dos-graficos';

interface DashboardProps {
    result: {
        tags: any[];
        typeCounts: Record<string, number>;
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
        };
        loadingOrder: any[];
        summary: {
            piiExposureCount?: number;
            securityIssuesCount?: number;
            /* Contagem agregada que sobrevive ao corte por plano — no free a
               lista `privacy.violations` vem truncada e o gráfico montado a
               partir dela ficava zerado ao lado do contador cheio. */
            violationsBySeverity?: Record<string, number>;
        };
    };
}

/**
 * Indicador cujo tom acompanha o resultado.
 *
 * O selo era fixo: "Risco Crítico" aparecia piscando ao lado de um zero. Num
 * laudo, alarme falso custa mais caro que achado omitido — quem confere uma vez
 * e vê que não era nada passa a duvidar do resto.
 */
const CartaoDeRisco = ({ titulo, descricao, valor, rotuloComAchado, rotuloSemAchado, icone: Icone }: {
    titulo: string;
    descricao: string;
    valor: number;
    rotuloComAchado: string;
    rotuloSemAchado: string;
    icone: ElementType;
}) => {
    const temAchado = valor > 0;
    return (
        <Card className={`shadow-sm border-l-4 ${temAchado ? 'border-l-rose-500' : 'border-l-emerald-500'}`}>
            <CardHeader className="pb-2">
                <CardTitle className={`text-sm font-semibold flex items-center gap-2 ${
                    temAchado ? 'text-rose-700 dark:text-rose-300' : 'text-slate-600 dark:text-slate-300'
                }`}>
                    <Icone className="w-4 h-4 shrink-0" />
                    {titulo}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-end justify-between gap-4">
                    <div className={`text-3xl font-bold tabular-nums ${
                        temAchado ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'
                    }`}>
                        {valor}
                    </div>
                    <div className="text-right min-w-0">
                        <Badge
                            variant={temAchado ? 'destructive' : 'outline'}
                            className={temAchado ? '' : 'text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'}
                        >
                            {temAchado ? rotuloComAchado : rotuloSemAchado}
                        </Badge>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-tight">{descricao}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

const Dashboard = ({ result }: DashboardProps) => {
    const { t } = useI18n();
    const { limits } = usePlan();
    
    const visibilityPercentage = limits.visibilityPercentage || 100;
    const isTruncated = visibilityPercentage < 100;
    const visibleCount = Math.ceil(result.tags.length * (visibilityPercentage / 100));
    const visibleTags = result.tags.slice(0, visibleCount);
    
    // Dados para o gráfico de pizza de tipos de tags
    const pieData = Object.entries(result.typeCounts || {}).map(([type, count], index) => {
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
            color: CORES_DE_CATEGORIA[index % CORES_DE_CATEGORIA.length]
        };
    });

    /* Severidade: preferir o agregado do backend.
       Contar em cima de `privacy.violations` zerava o gráfico no plano free,
       porque a lista chega truncada — o painel exibia "22 violações" ao lado
       de quatro barras vazias. O agregado viaja inteiro em qualquer plano; a
       contagem local fica só como fallback para resposta antiga em cache. */
    const agregado = result.summary?.violationsBySeverity;
    const contarLocal = (nivel: string) =>
        result.privacy.violations.filter(v => v.severity === nivel).length;
    const quantidadeDe = (nivel: keyof typeof CORES_DE_SEVERIDADE) =>
        agregado?.[nivel] ?? contarLocal(nivel);

    const severityData = ([
        ['critical', 'Crítico'],
        ['high', 'Alto'],
        ['medium', 'Médio'],
        ['low', 'Baixo'],
    ] as const).map(([nivel, rotulo]) => ({
        name: rotulo,
        count: quantidadeDe(nivel),
        color: CORES_DE_SEVERIDADE[nivel],
    }));

    const totalDeViolacoes = severityData.reduce((soma, item) => soma + item.count, 0);

    // Dados para timeline de carregamento (limited by visibility)
    const timelineData = visibleTags.map((tag, index) => {
        const tagName = tag.name || tag.vendor || 'Unknown Tag';
        return {
            position: index + 1,
            name: tagName.length > 15 ? tagName.substring(0, 15) + '...' : tagName,
            fullName: tagName,
            lineNumber: tag.lineNumber || 0,
            risk: tag.lgpdRisk === 'critical' ? 100 :
                tag.lgpdRisk === 'high' ? 75 :
                    tag.lgpdRisk === 'medium' ? 50 : 25,
            isViolation: tag.isBeforeConsent ? 1 : 0
        };
    });

    // Score gauge data
    const scoreData = [
        { name: 'Score', value: result.score },
        { name: 'Remaining', value: 100 - result.score }
    ];

    return (
        <div className="space-y-6">
            {/* Header Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-blue-100 text-sm">{t('dashboard.tags_detected')}</p>
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
                                <p className="text-red-100 text-sm">Violações de Privacidade</p>
                                <p className="text-3xl font-bold">{result.privacy.total_violations}</p>
                            </div>
                            <AlertTriangle className="w-10 h-10 text-red-200" />
                        </div>
                    </CardContent>
                </Card>

                <Card className={`bg-gradient-to-br ${result.privacy.has_consent_tool ? 'from-green-500 to-green-600' : 'from-orange-500 to-orange-600'} text-white`}>
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-white/80 text-sm">CMP Status</p>
                                <p className="text-xl font-bold">
                                    {result.privacy.has_consent_tool ? 'Detectado' : 'Ausente'}
                                </p>
                            </div>
                            {result.privacy.has_consent_tool ? (
                                <CheckCircle className="w-10 h-10 text-green-200" />
                            ) : (
                                <Shield className="w-10 h-10 text-orange-200" />
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white shadow-xl">
                    <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-indigo-100 text-sm">{t('dashboard.score_title')}</p>
                                <p className="text-3xl font-bold">{result.score}%</p>
                            </div>
                            <div className="relative">
                                <TrendingUp className="w-10 h-10 text-indigo-200" />
                                <Badge className="absolute -top-1 -right-1 bg-white text-indigo-600 border-indigo-200 text-[10px] px-1">PRO</Badge>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Indicadores de risco.
                O selo acompanha o número: mostrar "Risco Crítico" piscando ao
                lado de um zero é alarme falso, e alarme falso faz o cliente
                duvidar dos achados verdadeiros. Zero achados merece ser dito
                como resultado bom, não disfarçado de ameaça. */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <CartaoDeRisco
                    titulo="Dados pessoais expostos"
                    descricao="E-mail, CPF ou telefone trafegando em texto claro"
                    valor={result.summary?.piiExposureCount || 0}
                    rotuloComAchado="Risco crítico"
                    rotuloSemAchado="Nada encontrado"
                    icone={AlertTriangle}
                />
                <CartaoDeRisco
                    titulo="Scripts sem proteção de integridade"
                    descricao="Carregados por HTTP ou sem verificação de origem"
                    valor={result.summary?.securityIssuesCount || 0}
                    rotuloComAchado="Risco de injeção"
                    rotuloSemAchado="Nada encontrado"
                    icone={Shield}
                />
            </div>

            {/* Charts Row */}
            <div className="grid md:grid-cols-2 gap-6">
                {/* Pie Chart - Tipos de Tags */}
                <Card className="shadow-lg border-slate-800 bg-slate-900/40">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-100">
                            <PieIcon className="w-5 h-5 text-cyan-400" />
                            Distribuição por tipo
                        </CardTitle>
                        <CardDescription className="text-slate-400">
                            {result.tags.length} tag(s) detectada(s), agrupadas por finalidade
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
                                    /* O rótulo antigo saía com a cor herdada do
                                       tema e sumia sobre a fatia clara. */
                                    label={({ percent }) => `${((percent ?? 0) * 100).toFixed(0)}%`}
                                    innerRadius={55}
                                    outerRadius={100}
                                    paddingAngle={2}
                                    dataKey="value"
                                    stroke="#0f172a"
                                    strokeWidth={2}
                                >
                                    {pieData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.color} />
                                    ))}
                                </Pie>
                                <Tooltip content={<TooltipEscuro />} />
                                <Legend
                                    iconType="circle"
                                    formatter={(value) => (
                                        <span className="text-xs text-slate-300">{value}</span>
                                    )}
                                />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Bar Chart - Severidade das Violações */}
                <Card className="shadow-lg border-slate-800 bg-slate-900/40">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-100">
                            <BarChart3 className="w-5 h-5 text-rose-400" />
                            Não conformidades por gravidade
                        </CardTitle>
                        <CardDescription className="text-slate-400">
                            {totalDeViolacoes > 0
                                ? `${totalDeViolacoes} achado(s) — as barras à esquerda exigem correção antes de ir ao ar`
                                : 'Nenhuma não conformidade observada nesta varredura'}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {totalDeViolacoes === 0 ? (
                            <div className="flex h-[300px] flex-col items-center justify-center gap-3 text-center">
                                <CheckCircle className="h-12 w-12 text-emerald-500" />
                                <p className="text-sm text-slate-300">
                                    Nada fora de conformidade no que foi observado.
                                </p>
                                <p className="max-w-xs text-xs text-slate-500">
                                    A varredura cobre a página inicial sem aceitar o banner de
                                    consentimento. Páginas internas podem carregar outras tags.
                                </p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={severityData} margin={{ top: 12, right: 8, left: -12, bottom: 0 }}>
                                    <CartesianGrid {...GRADE} />
                                    <XAxis dataKey="name" {...EIXO} />
                                    <YAxis allowDecimals={false} {...EIXO} />
                                    <Tooltip
                                        cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                                        content={<TooltipEscuro />}
                                    />
                                    <Bar dataKey="count" name="Achados" radius={[6, 6, 0, 0]} maxBarSize={64}>
                                        {severityData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={entry.color} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Timeline Chart - Ordem de Carregamento */}
            <Card className="shadow-lg border-slate-800 bg-slate-900/40">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-slate-100">
                        <Activity className="w-5 h-5 text-amber-400" />
                        Risco por ordem de carregamento
                    </CardTitle>
                    <CardDescription className="text-slate-400">
                        Cada ponto é uma tag, na ordem em que entra na página. Passe o mouse
                        para ver qual é e em que linha do HTML está.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                        <AreaChart data={timelineData} margin={{ top: 12, right: 12, left: 4, bottom: 16 }}>
                            <CartesianGrid {...GRADE} />
                            <XAxis
                                dataKey="position"
                                {...EIXO}
                                label={{
                                    value: 'Posição na página',
                                    position: 'insideBottom',
                                    offset: -10,
                                    fill: CORES.eixo,
                                    fontSize: 12,
                                }}
                            />
                            <YAxis
                                domain={[0, 100]}
                                ticks={[25, 50, 75, 100]}
                                {...EIXO}
                                width={64}
                                tickFormatter={(value) => {
                                    if (value === 100) return 'Crítico';
                                    if (value === 75) return 'Alto';
                                    if (value === 50) return 'Médio';
                                    if (value === 25) return 'Baixo';
                                    return '';
                                }}
                            />
                            <Tooltip
                                cursor={{ stroke: CORES.eixo, strokeDasharray: '3 3' }}
                                content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const data = payload[0].payload;
                                    /* A cor sai direto da severidade. Derivar de
                                       `corDoScore(100 - risk)` pintava "Baixo"
                                       de âmbar, contradizendo a legenda. */
                                    const [nivel, cor] = data.risk === 100
                                        ? ['Crítico', CORES_DE_SEVERIDADE.critical]
                                        : data.risk === 75 ? ['Alto', CORES_DE_SEVERIDADE.high]
                                            : data.risk === 50 ? ['Médio', CORES_DE_SEVERIDADE.medium]
                                                : ['Baixo', CORES_DE_SEVERIDADE.low];
                                    return (
                                        <BalaoDoGrafico titulo={data.fullName}>
                                            <p>Linha do HTML: <span className="text-slate-100">{data.lineNumber || '—'}</span></p>
                                            <p>
                                                Risco:{' '}
                                                <span className="font-semibold" style={{ color: cor }}>
                                                    {nivel}
                                                </span>
                                            </p>
                                            {data.isViolation === 1 && (
                                                <p className="mt-1.5 inline-flex rounded bg-rose-500/15 px-2 py-0.5 font-medium text-rose-300">
                                                    Carregou antes do consentimento
                                                </p>
                                            )}
                                        </BalaoDoGrafico>
                                    );
                                }}
                            />
                            <defs>
                                <linearGradient id="riskGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.55} />
                                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02} />
                                </linearGradient>
                            </defs>
                            <Area
                                type="monotone"
                                dataKey="risk"
                                stroke="#fb7185"
                                strokeWidth={2}
                                fill="url(#riskGradient)"
                                name="Nível de risco"
                                dot={{ r: 3, fill: '#fb7185', strokeWidth: 0 }}
                                activeDot={{ r: 5, fill: '#fff', stroke: '#fb7185', strokeWidth: 2 }}
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                </CardContent>
            </Card>

            {/* Seis eixos, ou o medidor único quando o motor não os calculou */}
            {result.scores ? (
                <PainelDeScores scores={result.scores} />
            ) : (
                <Card className="shadow-lg border-slate-800 bg-slate-900/40">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-slate-100">
                            <Shield className="w-5 h-5 text-cyan-400" />
                            Score de conformidade LGPD
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
                                            stroke="none"
                                        >
                                            <Cell fill={corDoScore(result.score)} />
                                            <Cell fill="#1e293b" />
                                        </Pie>
                                    </PieChart>
                                </ResponsiveContainer>
                                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-center">
                                    <div className="text-4xl font-bold" style={{ color: corDoScore(result.score) }}>
                                        {result.score}%
                                    </div>
                                    <div className="text-sm text-slate-400">
                                        {result.score >= 80 ? 'Adequado' : result.score >= 50 ? 'Precisa de ajuste' : 'Crítico'}
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="flex flex-wrap justify-center gap-6 mt-4">
                            {([
                                [CORES.bom, '80-100: adequado'],
                                [CORES.atencao, '50-79: precisa de ajuste'],
                                [CORES.ruim, '0-49: crítico'],
                            ] as const).map(([cor, rotulo]) => (
                                <div key={rotulo} className="flex items-center gap-2">
                                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cor }} />
                                    <span className="text-sm text-slate-400">{rotulo}</span>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Multa Estimada Destaque */}
            <Card className="shadow-lg border-0 bg-gradient-to-r from-amber-50 to-orange-50 border-amber-200">
                <CardContent className="pt-6">
                    <div className="text-center">
                        <p className="text-amber-800 text-lg mb-2">💰 Exposição de Risco Estimado</p>
                        <p className="text-3xl font-bold text-amber-900">
                            {result.privacy.estimatedRiskExposure}
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
