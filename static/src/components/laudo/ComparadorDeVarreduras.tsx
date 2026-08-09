/**
 * O que mudou entre duas varreduras do mesmo site.
 *
 * Substitui o `AuditComparator`, que não comparava nada: ele derivava tudo da
 * diferença de contagem e inventava as listas —
 *
 *     newViolations: violationsDiff > 0 ? ['Nova violação detectada'] : []
 *
 * — de modo que três achados corrigidos e três novos davam delta zero e a tela
 * dizia "sem mudança". O diff de verdade acontece no backend
 * (`audit_engine/comparador.py`), item a item, sobre o dado íntegro.
 *
 * A pergunta que esta tela responde é a que o cliente faz depois de mexer no
 * site: "melhorou?". Ela precisa ser respondida na primeira linha.
 */
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle, AlertTriangle, Minus, RefreshCw, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

interface Violacao {
    article?: string;
    description?: string;
    violation?: string;
    tag?: string;
    severity?: string;
    recommendation?: string;
}

interface Diff {
    url: string;
    resumo: string;
    veredito: 'melhorou' | 'regrediu' | 'misto' | 'sem_mudanca';
    corrigidas: Violacao[];
    persistentes: Violacao[];
    novas: Violacao[];
    totais: Record<string, number>;
    score: { antes: number | null; agora: number | null; variacao: number | null };
    tags: { adicionadas: string[]; removidas: string[]; antes: number; agora: number };
    antes: { id: number; data: string | null; score: number | null };
    agora: { id: number; data: string | null; score: number | null };
}

const VEREDITOS = {
    melhorou: { texto: 'Melhorou', cor: 'var(--laudo-conforme)', Icone: CheckCircle },
    regrediu: { texto: 'Regrediu', cor: 'var(--laudo-critico)', Icone: AlertTriangle },
    misto: { texto: 'Corrigiu, mas entrou coisa nova', cor: 'var(--laudo-alto)', Icone: AlertTriangle },
    sem_mudanca: { texto: 'Nada mudou', cor: 'var(--laudo-baixo)', Icone: Minus },
} as const;

const corDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'var(--laudo-critico)'
        : nivel === 'high' ? 'var(--laudo-alto)'
            : nivel === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

const dataCurta = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? '—'
        : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

const ListaDeAchados = ({ titulo, itens, cor, vazio }: {
    titulo: string;
    itens: Violacao[];
    cor: string;
    vazio: string;
}) => (
    <div>
        <p
            className="voz-evidencia text-[11px] uppercase tracking-widest mb-2 flex items-baseline gap-2"
            style={{ color: 'var(--laudo-texto-fraco)' }}
        >
            {titulo}
            <span style={{ color: cor }}>{itens.length}</span>
        </p>
        {itens.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--laudo-texto-fraco)' }}>{vazio}</p>
        ) : (
            <ul className="space-y-2 list-none p-0 m-0">
                {itens.map((v, i) => (
                    <li
                        key={i}
                        className="pl-3 border-l"
                        style={{ borderColor: corDaGravidade(v.severity) }}
                    >
                        <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                            {v.description || v.violation}
                        </p>
                        <p
                            className="voz-evidencia text-[11px] m-0"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            {[v.tag, v.article].filter(Boolean).join(' · ')}
                        </p>
                    </li>
                ))}
            </ul>
        )}
    </div>
);

const ComparadorDeVarreduras = ({ antes, agora }: { antes: number; agora: number }) => {
    const { token } = useAuth();
    const [diff, setDiff] = useState<Diff | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [carregando, setCarregando] = useState(false);

    useEffect(() => {
        let cancelado = false;

        const buscar = async () => {
            setCarregando(true);
            setErro(null);
            try {
                const r = await fetch(`/api/scans/comparar?antes=${antes}&agora=${agora}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                const dados = await r.json().catch(() => null);
                if (!r.ok) {
                    // A mensagem do backend explica o motivo (sites diferentes,
                    // varredura incompleta). Trocá-la por um texto genérico
                    // faria o usuário tentar de novo sem saber o que corrigir.
                    throw new Error(dados?.detail || `O servidor respondeu ${r.status}.`);
                }
                if (!cancelado) setDiff(dados);
            } catch (e) {
                if (!cancelado) setErro((e as Error).message);
            } finally {
                if (!cancelado) setCarregando(false);
            }
        };

        buscar();
        return () => { cancelado = true; };
    }, [antes, agora, token]);

    if (carregando) {
        return (
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6 flex items-center gap-3">
                    <RefreshCw className="h-4 w-4 animate-spin" style={{ color: 'var(--laudo-carimbo)' }} />
                    <span className="text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                        Comparando as duas varreduras…
                    </span>
                </CardContent>
            </Card>
        );
    }

    if (erro) {
        return (
            <Card
                className="border-l-4"
                style={{
                    borderColor: 'var(--laudo-linha)',
                    borderLeftColor: 'var(--laudo-critico)',
                    background: 'var(--laudo-superficie)',
                }}
            >
                <CardContent className="pt-6">
                    <p className="text-sm" style={{ color: 'var(--laudo-texto)' }}>{erro}</p>
                </CardContent>
            </Card>
        );
    }

    if (!diff) return null;

    const { texto, cor, Icone } = VEREDITOS[diff.veredito] ?? VEREDITOS.sem_mudanca;
    const variacao = diff.score.variacao;

    return (
        <div className="space-y-4">

            {/* Veredito */}
            <Card
                className="border-l-4"
                style={{
                    borderColor: 'var(--laudo-linha)',
                    borderLeftColor: cor,
                    background: 'var(--laudo-superficie)',
                }}
            >
                <CardContent className="pt-6">
                    <p
                        className="voz-evidencia text-[11px] uppercase tracking-widest mb-2"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        {diff.url} · {dataCurta(diff.antes.data)} → {dataCurta(diff.agora.data)}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-4">
                        <h3
                            className="voz-argumento text-2xl font-semibold m-0 flex items-center gap-2"
                            style={{ color: cor }}
                        >
                            <Icone className="h-6 w-6 shrink-0" />
                            {texto}
                        </h3>
                        {variacao !== null && (
                            <div className="text-right">
                                <div
                                    className="voz-evidencia text-2xl font-bold leading-none"
                                    style={{
                                        color: variacao > 0 ? 'var(--laudo-conforme)'
                                            : variacao < 0 ? 'var(--laudo-critico)'
                                                : 'var(--laudo-texto-fraco)',
                                    }}
                                >
                                    {variacao > 0 ? '+' : ''}{variacao}
                                </div>
                                <p className="text-[11px] mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    no score ({diff.score.antes} → {diff.score.agora})
                                </p>
                            </div>
                        )}
                    </div>
                    <p className="voz-argumento mt-3 m-0" style={{ color: 'var(--laudo-texto)' }}>
                        {diff.resumo}
                    </p>
                </CardContent>
            </Card>

            {/* As três listas */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6 grid gap-6 md:grid-cols-3">
                    <ListaDeAchados
                        titulo="Corrigidas"
                        itens={diff.corrigidas}
                        cor="var(--laudo-conforme)"
                        vazio="Nenhum achado saiu do laudo."
                    />
                    <ListaDeAchados
                        titulo="Ainda abertas"
                        itens={diff.persistentes}
                        cor="var(--laudo-alto)"
                        vazio="Nada ficou pendente."
                    />
                    <ListaDeAchados
                        titulo="Novas"
                        itens={diff.novas}
                        cor="var(--laudo-critico)"
                        vazio="Nenhuma regressão."
                    />
                </CardContent>
            </Card>

            {/* Tags que entraram ou saíram — costuma ser a causa da regressão */}
            {(diff.tags.adicionadas.length > 0 || diff.tags.removidas.length > 0) && (
                <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardContent className="pt-6">
                        <p
                            className="voz-evidencia text-[11px] uppercase tracking-widest mb-3"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            Mudanças na instalação
                        </p>
                        <div className="flex flex-col gap-2 text-sm">
                            {diff.tags.adicionadas.map(t => (
                                <span key={`+${t}`} className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                                    <ArrowRight className="h-3.5 w-3.5" style={{ color: 'var(--laudo-alto)' }} />
                                    <strong>{t}</strong> entrou no site
                                </span>
                            ))}
                            {diff.tags.removidas.map(t => (
                                <span key={`-${t}`} className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                                    <ArrowRight className="h-3.5 w-3.5" style={{ color: 'var(--laudo-conforme)' }} />
                                    <strong>{t}</strong> saiu do site
                                </span>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default ComparadorDeVarreduras;
