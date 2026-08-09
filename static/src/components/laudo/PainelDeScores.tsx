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
            className="rounded-md border p-3 transition-colors"
            style={{
                // Só o eixo mais frágil recebe cor: destacar todos é não
                // destacar nenhum.
                borderColor: ePior ? 'color-mix(in srgb, var(--laudo-critico) 40%, transparent)' : 'transparent',
                background: ePior ? 'color-mix(in srgb, var(--laudo-critico) 6%, transparent)' : 'transparent',
            }}
        >
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                    {eixo.titulo}
                </span>
                <span className="flex items-baseline gap-2">
                    <span className="text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        {faixaDe(valor)}
                    </span>
                    <span className="voz-evidencia text-base font-bold" style={{ color: cor }}>
                        {valor}%
                    </span>
                </span>
            </div>

            {/* Trilho neutro. O `min-width` garante que 0% ainda desenhe um
                traço — barra sem pixel algum lê como falha de renderização, e
                zero aqui é um achado, não um dado ausente. */}
            <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'color-mix(in srgb, var(--laudo-linha) 70%, transparent)' }}
            >
                <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                        width: `${Math.max(valor, 0)}%`,
                        minWidth: '3px',
                        backgroundColor: cor,
                    }}
                />
            </div>

            <p className="mt-2 text-xs leading-snug" style={{ color: 'var(--laudo-texto-fraco)' }}>
                {eixo.mede}
            </p>
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
        <Card
            className="shadow-lg"
            style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
        >
            <CardHeader>
                <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                    {/* Ícone na cor da marca: é navegação, não achado. */}
                    <Shield className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                    Scores de auditoria
                </CardTitle>
                <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Seis dimensões avaliadas separadamente — cada uma se corrige de um jeito
                </CardDescription>
            </CardHeader>
            <CardContent>
                {pior && pior.valor < 80 && (
                    <div
                        className="mb-5 flex items-start gap-3 rounded-md border p-3"
                        style={{
                            borderColor: 'color-mix(in srgb, var(--laudo-critico) 30%, transparent)',
                            background: 'color-mix(in srgb, var(--laudo-critico) 8%, transparent)',
                        }}
                    >
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-critico)' }} />
                        <p className="text-sm leading-snug" style={{ color: 'var(--laudo-texto)' }}>
                            <span className="font-semibold" style={{ color: 'var(--laudo-critico)' }}>
                                Comece por {pior.titulo}
                            </span>
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
                                {/* O radar desenha o perfil do site, não um
                                    achado: fica na cor da marca. */}
                                <Radar
                                    name="Score"
                                    dataKey="value"
                                    stroke={CORES.marca}
                                    fill={CORES.marca}
                                    fillOpacity={0.18}
                                    strokeWidth={2}
                                    dot={{ r: 3, fill: CORES.marca, strokeWidth: 0 }}
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
