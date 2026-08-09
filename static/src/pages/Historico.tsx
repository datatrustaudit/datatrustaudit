/**
 * Histórico de varreduras e comparação entre duas delas.
 *
 * O menu já linkava para `/history` — mas a rota não existia e o link caía no
 * NotFound. Havia ainda um `AuditComparator` no código que ninguém importava e
 * que, mesmo se importado, não comparava nada: derivava as listas da diferença
 * de contagem, então três achados corrigidos e três novos davam "sem mudança".
 *
 * O diff de verdade é do backend (`GET /api/scans/comparar`), sobre o dado
 * íntegro. Aqui é só a escolha das duas varreduras.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppHeader from '@/components/AppHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Clock, GitCompare, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import ComparadorDeVarreduras from '@/components/laudo/ComparadorDeVarreduras';

interface ItemDoHistorico {
    id: number;
    url: string;
    timestamp: string | null;
    status?: string;
    score: number | null;
}

const dataLonga = (iso: string | null) => {
    if (!iso) return 'data não registrada';
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
        ? 'data não registrada'
        : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

const Historico = () => {
    const { token, isAuthenticated } = useAuth();
    const [itens, setItens] = useState<ItemDoHistorico[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [selecionados, setSelecionados] = useState<number[]>([]);

    useEffect(() => {
        let cancelado = false;
        const buscar = async () => {
            setCarregando(true);
            setErro(null);
            try {
                const r = await fetch('/history', {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });
                if (!r.ok) throw new Error(`O servidor respondeu ${r.status}.`);
                const dados = await r.json();
                if (!cancelado) setItens(dados.history || []);
            } catch (e) {
                if (!cancelado) setErro((e as Error).message);
            } finally {
                if (!cancelado) setCarregando(false);
            }
        };
        if (isAuthenticated) buscar();
        else setCarregando(false);
        return () => { cancelado = true; };
    }, [token, isAuthenticated]);

    /* Agrupa por endereço: comparar só faz sentido dentro do mesmo site, e a
       API recusa o resto. Deixar o usuário escolher duas URLs diferentes para
       depois receber um erro seria desenhar o engano. */
    const porSite = useMemo(() => {
        const mapa = new Map<string, ItemDoHistorico[]>();
        for (const item of itens) {
            if (item.status && item.status !== 'completed') continue;
            const lista = mapa.get(item.url) || [];
            lista.push(item);
            mapa.set(item.url, lista);
        }
        return [...mapa.entries()].map(([url, lista]) => ({
            url,
            varreduras: lista.sort((a, b) =>
                (b.timestamp || '').localeCompare(a.timestamp || '')),
        }));
    }, [itens]);

    const alternar = (id: number, url: string) => {
        setSelecionados(atual => {
            if (atual.includes(id)) return atual.filter(x => x !== id);
            // Selecionar em outro site zera a escolha anterior.
            const doMesmoSite = porSite.find(s => s.url === url)?.varreduras.map(v => v.id) || [];
            const mantidos = atual.filter(x => doMesmoSite.includes(x));
            return [...mantidos, id].slice(-2);
        });
    };

    const [a, b] = [...selecionados].sort((x, y) => {
        const dx = itens.find(i => i.id === x)?.timestamp || '';
        const dy = itens.find(i => i.id === y)?.timestamp || '';
        return dx.localeCompare(dy);
    });

    return (
        <div className="min-h-screen" style={{ background: 'var(--laudo-fundo)' }}>
            <AppHeader />
            <main className="container mx-auto px-4 py-10 max-w-5xl">
                <h1
                    className="voz-argumento text-3xl font-semibold mb-2"
                    style={{ color: 'var(--laudo-texto)' }}
                >
                    Histórico de varreduras
                </h1>
                <p className="mb-8" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '64ch' }}>
                    Escolha duas varreduras do mesmo endereço para ver o que foi corrigido, o
                    que continua aberto e o que apareceu desde a última vez.
                </p>

                {!isAuthenticated ? (
                    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                        <CardContent className="pt-6">
                            <p style={{ color: 'var(--laudo-texto)' }}>
                                Entre na sua conta para ver o histórico.
                            </p>
                            <Button asChild className="mt-4">
                                <Link to="/auth">Entrar</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : carregando ? (
                    <div className="flex items-center gap-3" style={{ color: 'var(--laudo-texto-suave)' }}>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Carregando…
                    </div>
                ) : erro ? (
                    <Card
                        className="border-l-4"
                        style={{
                            borderColor: 'var(--laudo-linha)',
                            borderLeftColor: 'var(--laudo-critico)',
                            background: 'var(--laudo-superficie)',
                        }}
                    >
                        <CardContent className="pt-6">
                            <p style={{ color: 'var(--laudo-texto)' }}>{erro}</p>
                        </CardContent>
                    </Card>
                ) : porSite.length === 0 ? (
                    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                        <CardContent className="pt-6">
                            <p style={{ color: 'var(--laudo-texto)' }}>
                                Nenhuma varredura concluída ainda.
                            </p>
                            <Button asChild className="mt-4">
                                <Link to="/">Auditar um site</Link>
                            </Button>
                        </CardContent>
                    </Card>
                ) : (
                    <div className="space-y-8">
                        {a !== undefined && b !== undefined && (
                            <ComparadorDeVarreduras antes={a} agora={b} />
                        )}

                        {porSite.map(({ url, varreduras }) => (
                            <section key={url}>
                                <h2
                                    className="voz-evidencia text-sm mb-3 flex items-baseline gap-2"
                                    style={{ color: 'var(--laudo-texto)' }}
                                >
                                    {url}
                                    <span className="text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                        {varreduras.length} varredura(s)
                                    </span>
                                </h2>

                                {varreduras.length < 2 && (
                                    <p className="text-sm mb-3" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                        Rode de novo depois de corrigir para poder comparar.
                                    </p>
                                )}

                                <div className="grid gap-2">
                                    {varreduras.map(v => {
                                        const marcado = selecionados.includes(v.id);
                                        return (
                                            <button
                                                key={v.id}
                                                onClick={() => alternar(v.id, url)}
                                                aria-pressed={marcado}
                                                className="flex items-center justify-between gap-4 rounded-md border px-4 py-3 text-left transition-colors"
                                                style={{
                                                    borderColor: marcado ? 'var(--laudo-carimbo)' : 'var(--laudo-linha)',
                                                    background: marcado
                                                        ? 'color-mix(in srgb, var(--laudo-carimbo) 12%, transparent)'
                                                        : 'var(--laudo-superficie)',
                                                }}
                                            >
                                                <span className="flex items-center gap-3 min-w-0">
                                                    <Clock className="h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                                                    <span className="voz-evidencia text-sm" style={{ color: 'var(--laudo-texto)' }}>
                                                        {dataLonga(v.timestamp)}
                                                    </span>
                                                </span>
                                                <span
                                                    className="voz-evidencia text-sm font-bold shrink-0"
                                                    style={{ color: 'var(--laudo-texto-suave)' }}
                                                >
                                                    {v.score !== null ? `${Math.round(v.score)}/100` : '—'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </section>
                        ))}

                        {selecionados.length === 1 && (
                            <p
                                className="flex items-center gap-2 text-sm"
                                style={{ color: 'var(--laudo-texto-fraco)' }}
                            >
                                <GitCompare className="h-4 w-4" />
                                Escolha uma segunda varredura do mesmo endereço para comparar.
                            </p>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
};

export default Historico;
