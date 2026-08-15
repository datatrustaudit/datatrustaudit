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
 *
 * **Todos os seis eixos são "maior é melhor".** O motor guarda privacidade ao
 * contrário — `privacyRiskScore` é RISCO, 100 = risco máximo — e este painel
 * exibia esse número cru na mesma escala dos outros, onde acima de 80 é verde e
 * "Adequado". O laudo de exemplo, com 11 violações críticas e 4 altas, estampava
 * "Privacidade 74%" em âmbar quando o correto era 26% em vermelho; um site com
 * risco máximo apareceria como "Privacidade 100% — Adequado", em verde. Pior
 * ainda: o "Comece por X" escolhe o MENOR valor, então o eixo mais perigoso
 * virava o de melhor aparência e a recomendação apontava para o lado errado.
 *
 * A resposta agora publica `privacyProtectionScore` já invertido (ver
 * `audit_engine/models.privacy_protection_from_risk`). O campo legado só é lido
 * como fallback, e nesse caminho a inversão é explícita aqui — nunca desenhe
 * `privacyRiskScore` direto.
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

/**
 * Todo eixo é opcional porque "não medido" é uma resposta possível do motor —
 * `compute_event_architecture` devolve `None` para página que não disparou
 * evento nenhum, e `compute_consent_integrity` idem quando o auditor de
 * consentimento não rodou. Exigir número aqui obrigaria quem chama a inventar
 * um: seria 0%, que nesta escala significa "Nada conforme", em vermelho.
 */
export interface ScoresDaAuditoria {
    auditScore?: number;
    trackingQualityScore?: number;
    eventArchitectureScore?: number;
    datalayerQualityScore?: number;
    consentIntegrityScore?: number;
    /** Privacidade na direção dos outros eixos: 100 = nada exposto sem base legal. */
    privacyProtectionScore?: number;
    /** Legado: RISCO cru, 100 = risco máximo. Invertido antes de ir para a tela. */
    privacyRiskScore?: number;
}

type ChaveDeEixo =
    | 'trackingQualityScore'
    | 'eventArchitectureScore'
    | 'datalayerQualityScore'
    | 'consentIntegrityScore'
    | 'privacyProtectionScore'
    | 'auditScore';

interface Eixo {
    chave: ChaveDeEixo;
    titulo: string;
    mede: string;
    /** `null` quando a varredura não trouxe o eixo — a tela diz isso, não chuta 0. */
    leitura: (scores: ScoresDaAuditoria) => number | null;
}

/**
 * Aceita só número (ou string numérica) e prende em 0–100.
 *
 * `Number(undefined)` é `NaN` e `Number(null)` é 0: tratar campo ausente como
 * zero inventaria um achado crítico ("Nada conforme") a partir de dado que
 * ninguém mediu — e ainda faria esse eixo vencer o "Comece por X".
 */
const numeroNaFaixa = (bruto: unknown): number | null => {
    if (typeof bruto !== 'number' && typeof bruto !== 'string') return null;
    if (typeof bruto === 'string' && bruto.trim() === '') return null;
    const n = Number(bruto);
    if (!Number.isFinite(n)) return null;
    return Math.min(100, Math.max(0, Math.round(n)));
};

const leituraDireta =
    (chave: keyof ScoresDaAuditoria) =>
    (scores: ScoresDaAuditoria): number | null =>
        numeroNaFaixa(scores[chave]);

/**
 * Privacidade tem duas fontes possíveis, e elas apontam para lados OPOSTOS.
 * Prefere o campo já invertido; só cai no risco cru quando ele não veio, e aí
 * inverte na hora. Sem fallback silencioso: sem nenhuma das duas chaves, o eixo
 * é "não medido".
 */
const leituraDePrivacidade = (scores: ScoresDaAuditoria): number | null => {
    const protecao = numeroNaFaixa(scores.privacyProtectionScore);
    if (protecao !== null) return protecao;

    const risco = numeroNaFaixa(scores.privacyRiskScore);
    return risco === null ? null : 100 - risco;
};

/** O que cada número quer dizer, em uma linha que o cliente entende. */
const EIXOS: Eixo[] = [
    {
        chave: 'trackingQualityScore',
        titulo: 'Rastreamento',
        mede: 'Tags instaladas de forma correta, sem duplicata nem ID trocado',
        leitura: leituraDireta('trackingQualityScore'),
    },
    {
        chave: 'eventArchitectureScore',
        titulo: 'Eventos',
        mede: 'Nomenclatura e disparo dos eventos de conversão',
        leitura: leituraDireta('eventArchitectureScore'),
    },
    {
        chave: 'datalayerQualityScore',
        titulo: 'DataLayer',
        mede: 'Estrutura e consistência dos dados enviados ao GTM',
        leitura: leituraDireta('datalayerQualityScore'),
    },
    {
        chave: 'consentIntegrityScore',
        titulo: 'Consentimento',
        mede: 'Se o rastreio espera a decisão do visitante antes de coletar',
        leitura: leituraDireta('consentIntegrityScore'),
    },
    {
        chave: 'privacyProtectionScore',
        titulo: 'Privacidade',
        mede: 'Proteção dos dados pessoais — quanto menor, mais cookies e dados expostos sem base legal',
        leitura: leituraDePrivacidade,
    },
    {
        chave: 'auditScore',
        titulo: 'Geral',
        mede: 'Média ponderada dos cinco eixos acima',
        leitura: leituraDireta('auditScore'),
    },
];

const faixaDe = (valor: number): string => {
    if (valor >= 80) return 'Adequado';
    if (valor >= 50) return 'Precisa de ajuste';
    if (valor > 0) return 'Crítico';
    return 'Nada conforme';
};

interface EixoNaTela extends Eixo {
    valor: number | null;
}

const LinhaDoEixo = ({ eixo, valor, ePior }: { eixo: Eixo; valor: number | null; ePior: boolean }) => {
    const naoMedido = valor === null;
    const cor = naoMedido ? 'var(--laudo-texto-fraco)' : corDoScore(valor);
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
                        {naoMedido ? 'Não medido' : faixaDe(valor)}
                    </span>
                    <span className="voz-evidencia text-base font-bold" style={{ color: cor }}>
                        {naoMedido ? '—' : `${valor}%`}
                    </span>
                </span>
            </div>

            {/* Trilho neutro. O `min-width` garante que 0% ainda desenhe um
                traço — barra sem pixel algum lê como falha de renderização, e
                zero aqui é um achado, não um dado ausente. Eixo não medido é o
                único que fica sem preenchimento, e vem rotulado como tal: o
                trilho vazio não pode passar por nota zero. */}
            <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: 'color-mix(in srgb, var(--laudo-linha) 70%, transparent)' }}
            >
                {!naoMedido && (
                    <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                            width: `${Math.max(valor, 0)}%`,
                            minWidth: '3px',
                            backgroundColor: cor,
                        }}
                    />
                )}
            </div>

            <p className="mt-2 text-xs leading-snug" style={{ color: 'var(--laudo-texto-fraco)' }}>
                {naoMedido ? 'Esta varredura não trouxe este eixo.' : eixo.mede}
            </p>
        </div>
    );
};

const PainelDeScores = ({ scores }: { scores: ScoresDaAuditoria }) => {
    const dados: EixoNaTela[] = EIXOS.map((eixo) => ({ ...eixo, valor: eixo.leitura(scores) }));

    // O eixo geral é média dos outros: destacar ele como "o pior" mandaria o
    // cliente corrigir um agregado, não uma causa. Eixo não medido também sai
    // da disputa — "comece pelo que não foi medido" não é recomendação.
    const candidatos = dados.filter(
        (d): d is EixoNaTela & { valor: number } => d.chave !== 'auditScore' && d.valor !== null,
    );
    const pior = candidatos.length
        ? candidatos.reduce((a, b) => (b.valor < a.valor ? b : a))
        : null;

    // Só os eixos medidos entram no radar: um vértice em 0 para dado ausente
    // desenharia conformidade que ninguém apurou. Faltando o eixo, falta o
    // rótulo — a ausência fica visível.
    const radar = dados
        .filter((d) => d.valor !== null)
        .map((d) => ({ axis: d.titulo, value: d.valor, fullMark: 100 }));

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
                    Seis dimensões avaliadas separadamente — cada uma se corrige de um jeito. Em
                    todas, quanto maior o número, melhor.
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
                                ePior={pior?.chave === d.chave && d.valor !== null && d.valor < 80}
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
