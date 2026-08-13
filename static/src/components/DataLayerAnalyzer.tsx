/**
 * O que foi observado no dataLayer da página.
 *
 * A versão anterior **inventava**: a partir das tags detectadas, montava um
 * `view_item` com SKU, nome de produto e preço, um `purchase` com valor, e
 * apresentava como se tivesse sido lido da página. O comentário dizia
 * `// Gerar eventos do dataLayer baseado nas tags`.
 *
 * Evento de compra fabricado num laudo de conformidade é pior do que não ter a
 * aba: o cliente conferiria no próprio site, não acharia o pedido, e perderia
 * a confiança em tudo — inclusive nos achados verdadeiros.
 *
 * O que o motor entrega de verdade são duas coisas, e as duas são valiosas:
 *
 * - `events`: eventos capturados com nome, parâmetros presentes e ausentes,
 *   e o veredito de validade (`datalayer_auditor` e `event_auditor`).
 * - `datalayerFindings`: os problemas encontrados — dado pessoal exposto,
 *   e-commerce malformado, ordem de inicialização errada, chave sobrescrita.
 *
 * Quando não há nada, a tela diz que não há. Página sem dataLayer é comum e
 * não é defeito da varredura.
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Database, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Info } from 'lucide-react';

interface AchadoDeDataLayer {
    type?: string;
    severity?: string;
    keys?: string[];
    snippet?: string;
    description?: string;
}

interface EventoObservado {
    name?: string;
    validity?: string;
    parametersFound?: Array<{ name?: string; value?: any; isValid?: boolean; issue?: string | null }>;
    missingRequiredParams?: string[];
    missingRecommendedParams?: string[];
    lineNumber?: number | null;
    occurrenceCount?: number;
    isDuplicate?: boolean;
}

interface Props {
    url: string;
    eventos?: EventoObservado[];
    achados?: AchadoDeDataLayer[];
}

const ROTULO_DO_ACHADO: Record<string, string> = {
    pii_exposure: 'Dado pessoal no dataLayer',
    ecommerce_malformed: 'Estrutura de e-commerce fora do padrão',
    init_order_issue: 'dataLayer inicializado na ordem errada',
    overwritten: 'dataLayer sobrescrito',
};

const corDaGravidade = (n?: string) =>
    n === 'critical' ? 'var(--laudo-critico)'
        : n === 'high' ? 'var(--laudo-alto)'
            : n === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

const rotuloDaValidade = (v?: string) =>
    v === 'valid' ? { texto: 'Completo', cor: 'var(--laudo-conforme)' }
        : v === 'partial' ? { texto: 'Faltam parâmetros', cor: 'var(--laudo-alto)' }
            : v === 'malformed' ? { texto: 'Malformado', cor: 'var(--laudo-critico)' }
                : { texto: 'Sem parâmetros', cor: 'var(--laudo-medio)' };

const Evento = ({ evento }: { evento: EventoObservado }) => {
    const [aberto, setAberto] = useState(false);
    const validade = rotuloDaValidade(evento.validity);
    const faltando = [
        ...(evento.missingRequiredParams || []),
        ...(evento.missingRecommendedParams || []),
    ];

    return (
        <li className="border-l-2 pl-3" style={{ borderColor: validade.cor }}>
            <button onClick={() => setAberto(v => !v)} className="flex w-full items-baseline gap-2 text-left">
                {aberto
                    ? <ChevronDown className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    : <ChevronRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}
                <span className="voz-evidencia text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                    {evento.name}
                </span>
                <span
                    className="voz-evidencia text-[10px] uppercase tracking-wider rounded border px-1.5"
                    style={{ color: validade.cor, borderColor: validade.cor }}
                >
                    {validade.texto}
                </span>
                {evento.isDuplicate && (
                    <span className="text-[10px]" style={{ color: 'var(--laudo-alto)' }}>
                        disparou {evento.occurrenceCount}×
                    </span>
                )}
                {evento.lineNumber != null && (
                    <span className="voz-evidencia text-[10px] ml-auto shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        linha {evento.lineNumber}
                    </span>
                )}
            </button>

            {aberto && (
                <div className="mt-2 pl-5 space-y-2">
                    {(evento.parametersFound || []).length > 0 && (
                        <div>
                            <p className="voz-evidencia text-[10px] uppercase tracking-widest m-0 mb-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                Parâmetros enviados
                            </p>
                            <ul className="space-y-0.5 list-none p-0 m-0">
                                {(evento.parametersFound || []).map((p, i) => (
                                    <li key={i} className="voz-evidencia text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        {p.name}
                                        {p.issue && (
                                            <span style={{ color: 'var(--laudo-alto)' }}> — {p.issue}</span>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {faltando.length > 0 && (
                        <div>
                            <p className="voz-evidencia text-[10px] uppercase tracking-widest m-0 mb-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                Faltando
                            </p>
                            <p className="voz-evidencia text-xs m-0" style={{ color: 'var(--laudo-alto)' }}>
                                {faltando.join(', ')}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
};

const DataLayerAnalyzer = ({ url, eventos = [], achados = [] }: Props) => {
    const temAlgo = eventos.length > 0 || achados.length > 0;

    return (
        <div className="space-y-4">
            {achados.length > 0 && (
                <Card
                    className="border-l-4"
                    style={{
                        borderColor: 'var(--laudo-linha)',
                        borderLeftColor: 'var(--laudo-critico)',
                        background: 'var(--laudo-superficie)',
                    }}
                >
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base" style={{ color: 'var(--laudo-texto)' }}>
                            <AlertTriangle className="h-4 w-4" style={{ color: 'var(--laudo-critico)' }} />
                            Problemas no dataLayer
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-3 list-none p-0 m-0">
                            {achados.map((a, i) => (
                                <li key={i} className="border-l-2 pl-3" style={{ borderColor: corDaGravidade(a.severity) }}>
                                    <p className="text-sm font-medium m-0" style={{ color: 'var(--laudo-texto)' }}>
                                        {ROTULO_DO_ACHADO[a.type || ''] || a.type}
                                    </p>
                                    {a.description && (
                                        <p className="text-sm mt-0.5 m-0" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '70ch' }}>
                                            {a.description}
                                        </p>
                                    )}
                                    {(a.keys || []).length > 0 && (
                                        <p className="voz-evidencia text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                            chave(s): {(a.keys || []).join(', ')}
                                        </p>
                                    )}
                                    {a.snippet && (
                                        <pre
                                            className="voz-evidencia text-[11px] mt-1.5 overflow-x-auto rounded p-2 m-0"
                                            style={{ background: 'var(--laudo-fundo)', color: 'var(--laudo-texto-suave)' }}
                                        >
                                            {a.snippet}
                                        </pre>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}

            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                        <Database className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                        Eventos observados
                    </CardTitle>
                    <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
                        Capturados durante a visita a {url}, sem interação — clique, rolagem e
                        compra não acontecem numa varredura automática.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {eventos.length > 0 ? (
                        <ul className="space-y-3 list-none p-0 m-0">
                            {eventos.map((e, i) => <Evento key={`${e.name}-${i}`} evento={e} />)}
                        </ul>
                    ) : (
                        <div className="flex items-start gap-3">
                            {temAlgo
                                ? <Info className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }} />
                                : <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-conforme)' }} />}
                            <div>
                                <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                                    Nenhum evento foi disparado no carregamento desta página.
                                </p>
                                <p className="text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '66ch' }}>
                                    Isso é comum e não indica erro: a maioria dos eventos de conversão
                                    depende de ação do visitante. Para auditar o funil completo, use a
                                    aba Trajeto e grave o percurso pelo site.
                                </p>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default DataLayerAnalyzer;
