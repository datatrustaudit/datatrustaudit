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

/** Severidade → cor. Mesma escala do backend (`critical`…`low`). */
export const CORES_DE_SEVERIDADE = {
    critical: '#f43f5e',
    high: '#fb923c',
    medium: '#facc15',
    low: '#38bdf8',
} as const;

/** Categorias de tag no gráfico de distribuição. */
export const CORES_DE_CATEGORIA = [
    '#22d3ee', '#3b82f6', '#a78bfa', '#f59e0b', '#f43f5e', '#34d399', '#94a3b8',
];

export const CORES = {
    grade: 'rgba(148, 163, 184, 0.18)',
    eixo: '#94a3b8',
    eixoForte: '#cbd5e1',
    superficie: '#111827',
    borda: 'rgba(148, 163, 184, 0.28)',
    bom: '#22c55e',
    atencao: '#f59e0b',
    ruim: '#f43f5e',
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
    <div className="rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2 shadow-xl backdrop-blur-sm">
        {titulo ? (
            <p className="mb-1 text-sm font-semibold text-slate-100">{titulo}</p>
        ) : null}
        <div className="space-y-0.5 text-xs text-slate-300">{children}</div>
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
