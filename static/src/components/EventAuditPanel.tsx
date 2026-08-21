import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    Activity,
    ChevronDown,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Info,
    ShoppingCart,
} from 'lucide-react';
import ConfidenceBadge from './ConfidenceBadge';

/* Campos opcionais de propósito: a resposta é cortada por plano e o painel
   precisa dizer "não veio" em vez de exibir o valor mais otimista. */
interface EventParameter {
    name: string;
    value: string | null;
    expectedType: string | null;
    actualType: string | null;
    /** `undefined` quando o motor não avaliou — diferente de aprovado. */
    isValid?: boolean;
    issue: string | null;
}

interface EventFinding {
    name: string;
    source: string;
    validity: string;
    confidence: string;
    detectionMethod: string;
    parametersFound: EventParameter[];
    parameterCount?: number;
    missingRequiredParams: string[];
    missingRecommendedParams: string[];
    occurrenceCount?: number;
    lineNumber: number | null;
    sourceSnippet: string | null;
    isDuplicate: boolean;
}

interface EventAuditData {
    events: EventFinding[];
    totalEvents?: number;
    uniqueEventNames?: number;
    duplicatedEventNames?: number;
    eventsWithIssues?: number;
    ecommerceEventsDetected?: string[];
}

interface EventAuditPanelProps {
    data: EventAuditData | null;
}

const VALIDITY_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
    /* "Válido" prometia mais do que a varredura mediu: `_validate_event`
       devolve `valid` também quando o evento não está no catálogo GA4 e não
       havia obrigatório a exigir — o caso de `gtm.scrollDepth` e de todo
       `page_view` de rede. "Sem apontamento" descreve os dois casos sem
       carimbar conformidade que ninguém apurou. */
    valid: { icon: CheckCircle, label: 'Sem apontamento', color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
    partial: { icon: AlertTriangle, label: 'Parcial', color: 'text-amber-600 bg-amber-50 border-amber-200' },
    malformed: { icon: XCircle, label: 'Malformado', color: 'text-red-600 bg-red-50 border-red-200' },
    no_parameters: { icon: Info, label: 'Sem parâmetros', color: 'text-gray-500 bg-gray-50 border-gray-200' },
};

/** Contador que o motor mediu, ou `null` quando o campo não veio. */
const medido = (bruto: unknown): number | null =>
    typeof bruto === 'number' && Number.isFinite(bruto) ? bruto : null;

/** Agregado ausente não vira zero: zero é medição, ausência é ausência. */
const exibeContador = (valor: number | null) => (valor === null ? 'não informado' : valor);

const EventAuditPanel = ({ data }: EventAuditPanelProps) => {
    const total = medido(data?.totalEvents);
    const listaVazia = !data?.events?.length;

    /* "Nenhum evento detectado" só quando a varredura mediu zero. No plano free
       a resposta traz a lista vazia com o contador cheio, e esta tela anunciava
       ausência de evento ao lado do cartão de resumo dizendo 13 — na mesma
       página. Lista cortada por plano não é ausência de evento. */
    if (!data || (listaVazia && (total === null || total === 0))) {
        return (
            <Card className="shadow-lg border-0">
                <CardContent className="pt-6">
                    <div className="text-center py-12 text-gray-500">
                        <Activity className="w-12 h-12 mx-auto mb-4 opacity-30" />
                        <p className="text-lg font-medium">
                            {total === 0
                                ? 'Nenhum evento GA4 detectado'
                                : 'Esta resposta não trouxe medição de eventos'}
                        </p>
                        <p className="text-sm mt-2 max-w-md mx-auto">
                            Eventos disparados via SPA, backend ou GTM server-side não são observáveis
                            através da análise do código-fonte HTML.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const unicos = medido(data.uniqueEventNames);
    const duplicados = medido(data.duplicatedEventNames);
    const comProblema = medido(data.eventsWithIssues);

    return (
        <div className="space-y-6">
            {/* Summary stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
                    <CardContent className="pt-5 pb-4">
                        <p className="text-blue-100 text-xs uppercase tracking-wide">Total Eventos</p>
                        <p className="text-3xl font-bold mt-1">{exibeContador(total)}</p>
                    </CardContent>
                </Card>
                <Card className="bg-gradient-to-br from-teal-500 to-teal-600 text-white">
                    <CardContent className="pt-5 pb-4">
                        <p className="text-teal-100 text-xs uppercase tracking-wide">Únicos</p>
                        <p className="text-3xl font-bold mt-1">{exibeContador(unicos)}</p>
                    </CardContent>
                </Card>
                <Card className={`bg-gradient-to-br ${duplicados ? 'from-amber-500 to-amber-600' : 'from-gray-400 to-gray-500'} text-white`}>
                    <CardContent className="pt-5 pb-4">
                        <p className="text-white/80 text-xs uppercase tracking-wide">Duplicados</p>
                        <p className="text-3xl font-bold mt-1">{exibeContador(duplicados)}</p>
                    </CardContent>
                </Card>
                {/* Verde só quando a varredura mediu zero problema. Sem medição
                    o cartão fica neutro: escudo verde sobre dado ausente já fez
                    este laudo declarar conformidade que ninguém apurou. */}
                <Card className={`bg-gradient-to-br ${comProblema === null ? 'from-gray-400 to-gray-500' : comProblema > 0 ? 'from-red-500 to-red-600' : 'from-emerald-500 to-emerald-600'} text-white`}>
                    <CardContent className="pt-5 pb-4">
                        <p className="text-white/80 text-xs uppercase tracking-wide">Com Problemas</p>
                        <p className="text-3xl font-bold mt-1">{exibeContador(comProblema)}</p>
                    </CardContent>
                </Card>
            </div>

            {/* E-commerce events highlight */}
            {(data.ecommerceEventsDetected?.length ?? 0) > 0 && (
                <Card className="border-l-4 border-l-teal-500 shadow-md">
                    <CardContent className="pt-5 pb-4">
                        <div className="flex items-center gap-2 mb-3">
                            <ShoppingCart className="w-5 h-5 text-teal-600" />
                            <span className="font-semibold text-teal-700">Eventos E-commerce Detectados</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {(data.ecommerceEventsDetected ?? []).map((name) => (
                                <Badge key={name} className="bg-teal-100 text-teal-800 border-teal-200">
                                    {name}
                                </Badge>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Events table */}
            <Card className="shadow-lg border-0">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Activity className="w-5 h-5" />
                        Eventos Detectados
                    </CardTitle>
                    <CardDescription>
                        {/* A descrição dizia "encontrados no código-fonte" para todos, inclusive
                            os que só existem na rede — método de coleta errado no laudo derruba
                            o achado. Cada linha traz o método real que a varredura usou. */}
                        Eventos observados na varredura: dataLayer da página, chamadas gtag no
                        código servido e requisições de coleta interceptadas
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {/* Chegar aqui com a lista vazia é o corte por plano agindo:
                        o contador veio, o detalhe não. Dizer isso é melhor do
                        que uma área em branco sob o título. */}
                    {listaVazia && (
                        <p className="text-sm text-gray-500">
                            Esta resposta trouxe os contadores, mas não a lista detalhada dos eventos.
                        </p>
                    )}
                    <div className="space-y-3">
                        {(data.events || []).map((event, i) => {
                            const validity = VALIDITY_CONFIG[event.validity] || VALIDITY_CONFIG.no_parameters;
                            const ValidityIcon = validity.icon;

                            return (
                                <Collapsible key={`${event.name}-${i}`}>
                                    <CollapsibleTrigger asChild>
                                        <div className="flex items-center justify-between p-3 rounded-lg border hover:bg-gray-50 cursor-pointer transition-colors group">
                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                <ChevronDown className="w-4 h-4 text-gray-400 transition-transform group-data-[state=open]:rotate-180" />
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <code className="font-mono text-sm font-semibold truncate">
                                                            {event.name}
                                                        </code>
                                                        {/* Repetir não é duplicar. `isDuplicate` marca
                                                            todo nome com mais de um disparo, inclusive
                                                            `gtm.scrollDepth` (25/50/75/100%) e
                                                            `gtm.dom` (um por container) — que repetem
                                                            por design. O selo âmbar "DUP" acusava os
                                                            dois, contradizendo a lista `duplicates`,
                                                            que já exclui esses casos. O selo passa a
                                                            dizer o fato medido: quantas vezes disparou.
                                                            O veredito de duplicidade sai da lista de
                                                            achados, não daqui. */}
                                                        {event.isDuplicate && event.occurrenceCount ? (
                                                            <Badge variant="outline" className="text-[10px] bg-gray-50 text-gray-600 border-gray-200">
                                                                ×{event.occurrenceCount} disparos
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                    <p className="text-xs text-gray-500 mt-0.5">
                                                        via {event.source}
                                                        {event.lineNumber && ` • linha ${event.lineNumber}`}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <Badge variant="outline" className="text-[11px]">
                                                    {event.parameterCount ?? '—'} params
                                                </Badge>
                                                <Badge variant="outline" className={`text-[11px] gap-1 ${validity.color}`}>
                                                    <ValidityIcon className="w-3 h-3" />
                                                    {validity.label}
                                                </Badge>
                                                {/* Sem confiança declarada o selo não aparece: o
                                                    padrão do componente é "Baixa", e afirmar
                                                    confiança baixa é uma medição que ninguém fez. */}
                                                {event.confidence && (
                                                    <ConfidenceBadge
                                                        level={event.confidence as 'high' | 'medium' | 'low'}
                                                        detectionMethod={event.detectionMethod}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    </CollapsibleTrigger>
                                    <CollapsibleContent>
                                        <div className="ml-7 mt-1 p-3 rounded-lg bg-gray-50 border border-gray-100 space-y-3">
                                            {/* Missing params */}
                                            {event.missingRequiredParams.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-red-600 mb-1">
                                                        ❌ Parâmetros obrigatórios ausentes:
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {event.missingRequiredParams.map((p) => (
                                                            <Badge key={p} variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200 font-mono">
                                                                {p}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {event.missingRecommendedParams.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-amber-600 mb-1">
                                                        ⚠️ Parâmetros recomendados ausentes:
                                                    </p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {event.missingRecommendedParams.map((p) => (
                                                            <Badge key={p} variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 font-mono">
                                                                {p}
                                                            </Badge>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Found parameters */}
                                            {event.parametersFound.length > 0 && (
                                                <div>
                                                    <p className="text-xs font-semibold text-gray-600 mb-1">
                                                        Parâmetros encontrados:
                                                    </p>
                                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                                                        {event.parametersFound.map((p) => (
                                                            <div key={p.name} className="flex items-center gap-1 text-[11px]">
                                                                {/* Três estados. O ícone verde só sai
                                                                    quando o motor comparou com um tipo
                                                                    esperado; sem catálogo não há
                                                                    aprovação a dar. */}
                                                                {p.isValid === false || p.issue ? (
                                                                    <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                                                                ) : p.isValid === true && p.expectedType ? (
                                                                    <CheckCircle className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                                                                ) : (
                                                                    <Info className="w-3 h-3 text-gray-400 flex-shrink-0" />
                                                                )}
                                                                <code className="font-mono truncate">{p.name}</code>
                                                                {p.issue && (
                                                                    <span className="text-red-500 truncate">({p.issue})</span>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {/* Source snippet */}
                                            {event.sourceSnippet && (
                                                <div>
                                                    <p className="text-xs font-semibold text-gray-600 mb-1">Código fonte:</p>
                                                    <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded overflow-x-auto">
                                                        {event.sourceSnippet}
                                                    </pre>
                                                </div>
                                            )}
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            );
                        })}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default EventAuditPanel;
