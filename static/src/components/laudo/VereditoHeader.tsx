import { ShieldAlert, ShieldCheck, ShieldX, Clock, Link2 } from 'lucide-react';
import { comoInstanteUtc } from '@/lib/datas';

/**
 * Topo do laudo.
 *
 * A versão anterior abria com um gradiente azul e o score num círculo. Azul é
 * cor de marca, não de diagnóstico: um site com 12 violações críticas ficava
 * com a mesma moldura bonita de um site limpo, e a primeira coisa que o leitor
 * via era decoração.
 *
 * Aqui a primeira linha é o veredito em texto, a cor vem da gravidade e o
 * score aparece como apoio — não como manchete.
 */

export type Severidade = 'critico' | 'atencao' | 'conforme';

function classificar(violacoesCriticas: number, violacoes: number): Severidade {
    if (violacoesCriticas > 0) return 'critico';
    if (violacoes > 0) return 'atencao';
    return 'conforme';
}

const PALETA: Record<Severidade, {
    faixa: string; texto: string; borda: string; fundo: string;
    icone: typeof ShieldAlert; titulo: string;
}> = {
    critico: {
        faixa: 'bg-rose-600',
        texto: 'text-rose-700 dark:text-rose-300',
        borda: 'border-rose-200 dark:border-rose-900/60',
        fundo: 'bg-rose-50/70 dark:bg-rose-950/30',
        icone: ShieldX,
        titulo: 'Não conforme',
    },
    atencao: {
        faixa: 'bg-amber-500',
        texto: 'text-amber-700 dark:text-amber-300',
        borda: 'border-amber-200 dark:border-amber-900/60',
        fundo: 'bg-amber-50/70 dark:bg-amber-950/30',
        icone: ShieldAlert,
        titulo: 'Requer atenção',
    },
    conforme: {
        faixa: 'bg-emerald-600',
        texto: 'text-emerald-700 dark:text-emerald-300',
        borda: 'border-emerald-200 dark:border-emerald-900/60',
        fundo: 'bg-emerald-50/70 dark:bg-emerald-950/30',
        icone: ShieldCheck,
        titulo: 'Sem achados críticos',
    },
};

interface Props {
    url: string;
    timestamp: string;
    score: number;
    violacoes: number;
    violacoesCriticas: number;
    tags: number;
    cookiesSemConsentimento: number;
    temConsentimento: boolean;
    consentimentoSemInterface?: boolean;
    acoes?: React.ReactNode;
}

const VereditoHeader = ({
    url, timestamp, score, violacoes, violacoesCriticas, tags,
    cookiesSemConsentimento, temConsentimento, consentimentoSemInterface, acoes,
}: Props) => {
    const nivel = classificar(violacoesCriticas, violacoes);
    const p = PALETA[nivel];
    const Icone = p.icone;

    // A frase muda conforme o achado dominante — laudo que diz sempre a mesma
    // coisa parece template.
    const resumo = (() => {
        if (violacoesCriticas > 0 && cookiesSemConsentimento > 0) {
            return `${cookiesSemConsentimento} cookie${cookiesSemConsentimento > 1 ? 's' : ''} de rastreamento ${cookiesSemConsentimento > 1 ? 'foram gravados' : 'foi gravado'} antes de qualquer consentimento.`;
        }
        if (violacoesCriticas > 0) {
            return `${violacoesCriticas} não conformidade${violacoesCriticas > 1 ? 's' : ''} de gravidade crítica ${violacoesCriticas > 1 ? 'exigem' : 'exige'} correção.`;
        }
        if (violacoes > 0) {
            return `${violacoes} ponto${violacoes > 1 ? 's' : ''} de atenção ${violacoes > 1 ? 'identificados' : 'identificado'}.`;
        }
        return 'Nenhuma não conformidade observada nesta varredura.';
    })();

    /* A string do backend não traz fuso ("2026-08-13T02:40:00") e o navegador a
       lia como hora local: o topo do laudo — a linha que diz quando o site foi
       examinado — aparecia três horas adiantada, e perto da meia-noite mudava o
       dia. Sem data legível, o cabeçalho declara a falta; nunca carimba o
       relógio de quem abriu a página. */
    const dataDoExame = comoInstanteUtc(timestamp)?.toLocaleString('pt-BR', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });

    let situacaoConsentimento: string;
    if (consentimentoSemInterface) situacaoConsentimento = 'instalado, sem exibir aviso';
    else if (temConsentimento) situacaoConsentimento = 'presente';
    else situacaoConsentimento = 'ausente';

    return (
        <section className={`rounded-2xl border ${p.borda} ${p.fundo} overflow-hidden`}>
            <div className={`h-1.5 ${p.faixa}`} aria-hidden />

            <div className="p-6 sm:p-8">
                <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                        <div className={`inline-flex items-center gap-2 text-sm font-semibold ${p.texto}`}>
                            <Icone className="h-5 w-5 shrink-0" aria-hidden />
                            {p.titulo}
                        </div>

                        <h1 className="mt-3 text-2xl font-semibold leading-snug text-slate-900 dark:text-slate-50 sm:text-[1.7rem]">
                            {resumo}
                        </h1>

                        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-slate-600 dark:text-slate-400">
                            <span className="inline-flex min-w-0 items-center gap-1.5">
                                <Link2 className="h-4 w-4 shrink-0" aria-hidden />
                                <span className="truncate font-mono text-[0.8rem]">{url}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                                <Clock className="h-4 w-4 shrink-0" aria-hidden />
                                {dataDoExame ?? 'data do exame não registrada'}
                            </span>
                        </div>
                    </div>

                    {/* Score como apoio, não como manchete */}
                    <div className="flex shrink-0 items-center gap-4 lg:flex-col lg:items-end">
                        <div className="text-right">
                            <div className="flex items-baseline gap-1 lg:justify-end">
                                <span className={`text-5xl font-semibold tabular-nums ${p.texto}`}>{score}</span>
                                <span className="text-lg text-slate-400">/100</span>
                            </div>
                            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Conformidade
                            </div>
                        </div>
                    </div>
                </div>

                {/* Números que sustentam o veredito */}
                <dl className="mt-7 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 dark:border-slate-800 dark:bg-slate-800 sm:grid-cols-4">
                    <Numero rotulo="Rastreadores" valor={tags} />
                    <Numero rotulo="Não conformidades" valor={violacoes} destaque={violacoes > 0} />
                    <Numero rotulo="Cookies sem consentimento" valor={cookiesSemConsentimento} destaque={cookiesSemConsentimento > 0} />
                    <Numero rotulo="Consentimento" texto={situacaoConsentimento} destaque={!temConsentimento || !!consentimentoSemInterface} />
                </dl>

                {acoes ? <div className="mt-6 flex flex-wrap gap-2">{acoes}</div> : null}
            </div>
        </section>
    );
};

const Numero = ({ rotulo, valor, texto, destaque }: {
    rotulo: string; valor?: number; texto?: string; destaque?: boolean;
}) => (
    <div className="bg-white p-4 dark:bg-slate-950">
        <dd className={`text-2xl font-semibold tabular-nums ${
            destaque ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
        }`}>
            {texto ?? valor}
        </dd>
        <dt className="mt-1 text-xs leading-tight text-slate-500 dark:text-slate-400">{rotulo}</dt>
    </div>
);

export default VereditoHeader;
