/**
 * Tema único dos gráficos do laudo.
 *
 * O app roda com `dark` fixo no <html> (AppHeader), mas os gráficos foram
 * escritos para tema claro: `bg-white` no tooltip, `#e2e8f0` na grade,
 * `bg-gray-100` no trilho das barras. Como o texto não tinha cor própria, ele
 * herdava o `--foreground` do dark — branco — e desaparecia dentro do balão
 * branco do tooltip. Em tela o resultado era um retângulo claro com uma linha
 * legível ("Linha: 1", que tinha `text-gray-600`) e o resto invisível.
 *
 * Cor de gráfico não é decoração aqui: é o que separa "crítico" de "baixo" num
 * documento que o cliente usa para priorizar correção. Fica tudo em um lugar
 * só para não divergir de novo.
 */
import type { ReactNode } from 'react';

/**
 * Lê um token da identidade (`index.css`) em valor computado.
 *
 * O recharts pinta em canvas/SVG por atributo, então não aceita `var(--x)`
 * direto — precisa do hex resolvido. Ler do CSS em vez de repetir o hex aqui
 * mantém uma fonte só: a paleta já divergiu entre gráfico, card e tabela.
 */
const token = (nome: string, reserva: string): string => {
    if (typeof window === 'undefined') return reserva;
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return valor || reserva;
};
// Nota: isto roda no import. Se o CSS ainda não tiver sido aplicado, cai no
// valor de reserva — que é propositalmente o mesmo do tema escuro, o único que
// o app usa hoje. Não há diferença visual; o CSS só passa a mandar de fato
// quando existir um segundo tema.

/**
 * Severidade → cor. Mesma escala do backend (`critical`…`low`).
 *
 * Tons queimados, não neon: o laudo é peça técnica, não alarme. E `low` é
 * frio de propósito — achado registrado que não exige ação hoje não deve
 * competir por atenção com o que exige.
 */
export const CORES_DE_SEVERIDADE = {
    critical: token('--laudo-critico', '#E06A60'),
    high: token('--laudo-alto', '#E08B4E'),
    medium: token('--laudo-medio', '#CBAA45'),
    low: token('--laudo-baixo', '#8AA3BC'),
} as const;

/**
 * Categorias de tag no gráfico de distribuição.
 *
 * Frias e dessaturadas: distribuição por tipo é inventário, não problema.
 * Pintá-la com os mesmos tons da gravidade fazia "publicidade" parecer um
 * achado crítico só por ser vermelha.
 */
export const CORES_DE_CATEGORIA = [
    '#6FA3D9', '#7FB0A5', '#9B9BC4', '#8AA3BC', '#6E8CA8', '#A5B5C4', '#7A8894',
];

export const CORES = {
    grade: 'rgba(148, 163, 184, 0.16)',
    eixo: token('--laudo-texto-fraco', '#6E7780'),
    eixoForte: token('--laudo-texto-suave', '#A2AAB3'),
    superficie: token('--laudo-superficie', '#171E24'),
    borda: token('--laudo-linha', '#2B343C'),
    marca: token('--laudo-carimbo', '#6FA3D9'),
    bom: token('--laudo-conforme', '#5FB287'),
    atencao: token('--laudo-alto', '#E08B4E'),
    ruim: token('--laudo-critico', '#E06A60'),
} as const;

/** Verde/âmbar/vermelho por faixa de score. Usado nas barras e no gauge. */
export const corDoScore = (valor: number): string => {
    if (valor >= 80) return CORES.bom;
    if (valor >= 50) return CORES.atencao;
    return CORES.ruim;
};

/** Props de eixo do recharts que todo gráfico do laudo compartilha. */
export const EIXO = {
    stroke: CORES.eixo,
    tick: { fill: CORES.eixo, fontSize: 12 },
    tickLine: false,
    axisLine: { stroke: CORES.grade },
} as const;

export const GRADE = {
    stroke: CORES.grade,
    strokeDasharray: '4 4',
    vertical: false,
} as const;

/**
 * Balão de tooltip legível no escuro.
 *
 * Aceita filhos para o caso de tooltip customizado (a timeline mostra nome da
 * tag, linha e selo de violação); sem filhos, desenha o par nome/valor padrão.
 */
export const BalaoDoGrafico = ({ titulo, children }: { titulo?: ReactNode; children: ReactNode }) => (
    <div
        className="rounded-md border px-3 py-2 shadow-xl backdrop-blur-sm"
        style={{
            borderColor: 'var(--laudo-linha)',
            background: 'color-mix(in srgb, var(--laudo-superficie) 96%, transparent)',
            color: 'var(--laudo-texto)',
        }}
    >
        {titulo ? <p className="mb-1 text-sm font-semibold">{titulo}</p> : null}
        {/* Dado observado em voz de evidência: número de tooltip é medição,
            não prosa. */}
        <div className="voz-evidencia space-y-0.5 text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
            {children}
        </div>
    </div>
);

/** Tooltip padrão: rótulo em cima, série e valor embaixo. */
export const TooltipEscuro = ({ active, payload, label, sufixo = '' }: {
    active?: boolean;
    payload?: Array<{ name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> }>;
    label?: ReactNode;
    sufixo?: string;
}) => {
    if (!active || !payload?.length) return null;
    return (
        <BalaoDoGrafico titulo={label}>
            {payload.map((item, i) => (
                <p key={i} className="flex items-center gap-2">
                    <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color || (item.payload?.color as string) || CORES.eixo }}
                    />
                    <span className="text-slate-400">{item.name}:</span>
                    <span className="font-semibold text-slate-100 tabular-nums">
                        {item.value}{sufixo}
                    </span>
                </p>
            ))}
        </BalaoDoGrafico>
    );
};
