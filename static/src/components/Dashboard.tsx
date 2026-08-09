import type { ElementType } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
 * Indicador do topo do laudo.
 *
 * Superfície neutra por padrão: `cor` só é passada quando o número significa
 * alguma coisa — achado, ausência de controle, faixa de score. Contagem de
 * inventário (quantas tags existem) fica sem cor, porque não é problema.
 *
 * O valor usa a voz de evidência (monoespaçada, tabular): é medição, e
 * medição alinha em coluna.
 */
const Indicador = ({ rotulo, valor, texto, icone: Icone, cor, nota }: {
    rotulo: string;
    valor?: number;
    texto?: string;
    icone: ElementType;
    cor?: string;
    nota?: string;
}) => (
    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
        <CardContent className="pt-6">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>{rotulo}</p>
                    <p
                        className="voz-evidencia mt-1 text-3xl font-bold leading-none"
                        style={{ color: cor || 'var(--laudo-texto)' }}
                    >
                        {texto ?? valor}
                    </p>
                </div>
                <Icone className="h-6 w-6 shrink-0" style={{ color: cor || 'var(--laudo-texto-fraco)', opacity: cor ? 1 : 0.5 }} />
            </div>
            {nota && (
                <p className="mt-2 text-[11px] leading-snug" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {nota}
                </p>
            )}
        </CardContent>
    </Card>
);

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
    const cor = temAchado ? 'var(--laudo-critico)' : 'var(--laudo-conforme)';
    return (
        <Card
            className="shadow-sm border-l-4"
            style={{
                borderColor: 'var(--laudo-linha)',
                borderLeftColor: cor,
                background: 'var(--laudo-superficie)',
            }}
        >
            <CardHeader className="pb-2">
                <CardTitle
                    className="text-sm font-semibold flex items-center gap-2"
                    style={{ color: 'var(--laudo-texto)' }}
                >
                    <Icone className="w-4 h-4 shrink-0" style={{ color: cor }} />
                    {titulo}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="flex items-end justify-between gap-4">
                    <div className="voz-evidencia text-3xl font-bold" style={{ color: cor }}>
                        {valor}
                    </div>
                    <div className="text-right min-w-0">
                        {/* Selo em contorno, sem preenchimento: destaque é do
                            número, não do rótulo. */}
                        <span
                            className="inline-block rounded border px-2 py-0.5 text-[11px] font-medium"
                            style={{ color: cor, borderColor: cor }}
                        >
                            {temAchado ? rotuloComAchado : rotuloSemAchado}
                        </span>
                        <p className="text-xs mt-1 leading-tight" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            {descricao}
                        </p>
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
            {/* Indicadores do topo.
                Eram quatro gradientes saturados — azul, vermelho, verde/laranja
                e índigo — competindo entre si. Com tudo colorido, nada se
                destaca, e o vermelho aparecia igual tendo achado ou não.
                Agora a superfície é neutra e a cor entra só quando o número
                significa um problema. */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Indicador
                    rotulo={t('dashboard.tags_detected')}
                    valor={result.tags.length}
                    icone={BarChart3}
                    nota="Inventário — não é problema por si"
                />
                <Indicador
                    rotulo="Não conformidades"
                    valor={totalDeViolacoes}
                    icone={AlertTriangle}
                    cor={totalDeViolacoes > 0 ? 'var(--laudo-critico)' : 'var(--laudo-conforme)'}
                    nota={totalDeViolacoes > 0 ? 'Exigem correção' : 'Nada observado nesta visita'}
                />
                <Indicador
                    rotulo="Controle de consentimento"
                    texto={result.privacy.has_consent_tool ? 'Presente' : 'Ausente'}
                    icone={result.privacy.has_consent_tool ? CheckCircle : Shield}
                    cor={result.privacy.has_consent_tool ? 'var(--laudo-conforme)' : 'var(--laudo-critico)'}
                    nota={result.privacy.has_consent_tool
                        ? 'Presença não prova bloqueio'
                        : 'Visitante não tem como recusar'}
                />
                <Indicador
                    rotulo={t('dashboard.score_title')}
                    texto={`${result.score}%`}
                    icone={TrendingUp}
                    cor={corDoScore(result.score)}
                    nota={result.score >= 80 ? 'Adequado' : result.score >= 50 ? 'Precisa de ajuste' : 'Crítico'}
                />
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
                <Card className="shadow-lg" style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                            <PieIcon className="w-5 h-5" style={{ color: 'var(--laudo-carimbo)' }} />
                            Distribuição por tipo
                        </CardTitle>
                        <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
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
                <Card className="shadow-lg" style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                            <BarChart3 className="w-5 h-5" style={{ color: 'var(--laudo-carimbo)' }} />
                            Não conformidades por gravidade
                        </CardTitle>
                        <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
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
            <Card className="shadow-lg" style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                        <Activity className="w-5 h-5" style={{ color: 'var(--laudo-carimbo)' }} />
                        Risco por ordem de carregamento
                    </CardTitle>
                    <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
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
                <Card className="shadow-lg" style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                            <Shield className="w-5 h-5" style={{ color: 'var(--laudo-carimbo)' }} />
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

            {/* Exposição legal.
                Era um card de fundo claro (`from-amber-50`) no meio de um app
                escuro, com emoji e o texto em `text-3xl bold` — dimensionado
                para um valor em reais. Desde que a exposição deixou de inventar
                cifra e passou a citar o critério do art. 52, o conteúdo é um
                parágrafo jurídico: cabe na voz de argumento, não em manchete. */}
            {result.privacy.estimatedRiskExposure && (
                <Card
                    className="shadow-sm border-l-4"
                    style={{
                        borderColor: 'var(--laudo-linha)',
                        borderLeftColor: 'var(--laudo-carimbo)',
                        background: 'var(--laudo-superficie)',
                    }}
                >
                    <CardContent className="pt-6">
                        <p
                            className="text-[11px] uppercase tracking-widest mb-2 voz-evidencia"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            Exposição legal
                        </p>
                        <p
                            className="voz-argumento text-lg"
                            style={{ color: 'var(--laudo-texto)', maxWidth: '68ch' }}
                        >
                            {result.privacy.estimatedRiskExposure}
                        </p>
                        <p className="text-xs mt-3" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Art. 52 da Lei 13.709/2018 (LGPD). O valor efetivo depende do
                            faturamento, da abrangência e dos agravantes do caso concreto.
                        </p>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default Dashboard;
