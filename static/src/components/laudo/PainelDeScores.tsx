/**
 * Os seis eixos da auditoria, em barra e em radar.
 *
 * A versão anterior desenhava seis trilhos `bg-gray-100` — branco puro sobre o
 * fundo escuro do app — e nada mais. Barra em 0% ficava indistinguível de barra
 * quebrada: "Tracking" e "Consent" apareciam como faixas brancas vazias, sem
 * dizer se o valor era zero ou se o dado não tinha chegado.
 *
 * Além do contraste, faltava o principal: "DataLayer 60%" não informa nada a
 * quem vai corrigir. Cada eixo agora diz o que mede e o que aquela faixa
 * significa, e o pior deles vem marcado — é por onde começar.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
    PolarAngleAxis,
    PolarGrid,
    PolarRadiusAxis,
    Radar,
    RadarChart,
    ResponsiveContainer,
    Tooltip,
} from 'recharts';
import { Shield, ArrowRight } from 'lucide-react';
import { CORES, TooltipEscuro, corDoScore } from './tema-dos-graficos';

export interface ScoresDaAuditoria {
    auditScore: number;
    trackingQualityScore: number;
    eventArchitectureScore: number;
    datalayerQualityScore: number;
    consentIntegrityScore: number;
    privacyRiskScore: number;
}

interface Eixo {
    chave: keyof ScoresDaAuditoria;
    titulo: string;
    mede: string;
}

/** O que cada número quer dizer, em uma linha que o cliente entende. */
const EIXOS: Eixo[] = [
    {
        chave: 'trackingQualityScore',
        titulo: 'Rastreamento',
        mede: 'Tags instaladas de forma correta, sem duplicata nem ID trocado',
    },
    {
        chave: 'eventArchitectureScore',
        titulo: 'Eventos',
        mede: 'Nomenclatura e disparo dos eventos de conversão',
    },
    {
        chave: 'datalayerQualityScore',
        titulo: 'DataLayer',
        mede: 'Estrutura e consistência dos dados enviados ao GTM',
    },
    {
        chave: 'consentIntegrityScore',
        titulo: 'Consentimento',
        mede: 'Se o rastreio espera a decisão do visitante antes de coletar',
    },
    {
        chave: 'privacyRiskScore',
        titulo: 'Privacidade',
        mede: 'Cookies, storage e dados pessoais expostos sem base legal',
    },
    {
        chave: 'auditScore',
        titulo: 'Geral',
        mede: 'Média ponderada dos cinco eixos acima',
    },
];

const faixaDe = (valor: number): string => {
    if (valor >= 80) return 'Adequado';
    if (valor >= 50) return 'Precisa de ajuste';
    if (valor > 0) return 'Crítico';
    return 'Nada conforme';
};

const LinhaDoEixo = ({ eixo, valor, ePior }: { eixo: Eixo; valor: number; ePior: boolean }) => {
    const cor = corDoScore(valor);
    return (
        <div
            className={`rounded-lg border p-3 transition-colors ${
                ePior
                    ? 'border-rose-500/40 bg-rose-500/5'
                    : 'border-transparent hover:border-slate-700/60 hover:bg-slate-800/30'
            }`}
        >
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold text-slate-100">{eixo.titulo}</span>
                <span className="flex items-baseline gap-2">
                    <span className="text-xs text-slate-400">{faixaDe(valor)}</span>
                    <span className="text-base font-bold tabular-nums" style={{ color: cor }}>
                        {valor}%
                    </span>
                </span>
            </div>

            {/* Trilho escuro. O `min-width` garante que 0% ainda desenhe um
                traço — barra sem pixel algum lê como falha de renderização, e
                zero aqui é um achado, não um dado ausente. */}
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                        width: `${Math.max(valor, 0)}%`,
                        minWidth: '3px',
                        backgroundColor: cor,
                        boxShadow: `0 0 12px ${cor}55`,
                    }}
                />
            </div>

            <p className="mt-2 text-xs leading-snug text-slate-400">{eixo.mede}</p>
        </div>
    );
};

const PainelDeScores = ({ scores }: { scores: ScoresDaAuditoria }) => {
    // Clamp em 0–100: score fora da faixa (ou `NaN` de campo ausente) esticava
    // a barra além do trilho e imprimia "NaN%" ao lado.
    const dados = EIXOS.map((eixo) => {
        const bruto = Number(scores[eixo.chave]);
        return {
            ...eixo,
            valor: Number.isFinite(bruto) ? Math.min(100, Math.max(0, Math.round(bruto))) : 0,
        };
    });

    // O eixo geral é média dos outros: destacar ele como "o pior" mandaria o
    // cliente corrigir um agregado, não uma causa.
    const especificos = dados.filter((d) => d.chave !== 'auditScore');
    const pior = especificos.reduce((a, b) => (b.valor < a.valor ? b : a), especificos[0]);

    const radar = dados.map((d) => ({ axis: d.titulo, value: d.valor, fullMark: 100 }));

    return (
        <Card className="border-slate-800 bg-slate-900/40 shadow-lg">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-slate-100">
                    <Shield className="h-5 w-5 text-cyan-400" />
                    Scores de auditoria
                </CardTitle>
                <CardDescription className="text-slate-400">
                    Seis dimensões avaliadas separadamente — cada uma se corrige de um jeito
                </CardDescription>
            </CardHeader>
            <CardContent>
                {pior && pior.valor < 80 && (
                    <div className="mb-5 flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                        <p className="text-sm leading-snug text-slate-200">
                            <span className="font-semibold text-rose-300">Comece por {pior.titulo}</span>
                            {' '}— é o eixo mais frágil ({pior.valor}%). {pior.mede}.
                        </p>
                    </div>
                )}

                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="space-y-2">
                        {dados.map((d) => (
                            <LinhaDoEixo
                                key={d.chave}
                                eixo={d}
                                valor={d.valor}
                                ePior={pior?.chave === d.chave && d.valor < 80}
                            />
                        ))}
                    </div>

                    <div className="flex min-h-[300px] items-center justify-center">
                        <ResponsiveContainer width="100%" height={340}>
                            <RadarChart data={radar} outerRadius="72%">
                                <PolarGrid stroke={CORES.grade} />
                                <PolarAngleAxis
                                    dataKey="axis"
                                    tick={{ fontSize: 12, fill: CORES.eixoForte }}
                                />
                                <PolarRadiusAxis
                                    angle={30}
                                    domain={[0, 100]}
                                    tick={{ fontSize: 10, fill: CORES.eixo }}
                                    axisLine={false}
                                />
                                <Radar
                                    name="Score"
                                    dataKey="value"
                                    stroke="#22d3ee"
                                    fill="#22d3ee"
                                    fillOpacity={0.22}
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: '#22d3ee', strokeWidth: 0 }}
                                />
                                <Tooltip content={<TooltipEscuro sufixo="%" />} />
                            </RadarChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default PainelDeScores;
