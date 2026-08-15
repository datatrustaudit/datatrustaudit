import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Activity,
    CheckCircle,
    XCircle,
    AlertTriangle,
    Clock,
    Target,
    Layers,
    RefreshCw,
    MinusCircle,
    FileCode
} from 'lucide-react';

/**
 * Uma requisição registrada pelo navegador durante a varredura
 * (`storage.firingTimeline`). É a única medição de tempo que o motor produz.
 */
interface EventoDeRede {
    order?: number;
    msSincePageStart?: number;
    url?: string;
    owner?: string;
}

interface TagHealth {
    name: string;
    type: string;
    status: 'healthy' | 'warning' | 'critical' | 'unknown';
    score: number;
    issues: string[];
    recommendations: string[];
    /**
     * Intervalo entre o início da página e a PRIMEIRA requisição observada
     * deste fornecedor. `null` quando nenhuma requisição da linha do tempo pôde
     * ser atribuída à tag — e aí a tela declara a ausência, não preenche.
     *
     * Não é tempo de carga do script: é quando a coleta começou.
     */
    primeiraRequisicaoMs: number | null;
    /** URL dessa requisição — é ela que torna o número conferível. */
    primeiraRequisicaoUrl: string | null;
    /**
     * `true` só quando o motor provou o disparo antes do consentimento.
     * `false` é ausência de prova, não prova de conformidade — por isso não
     * vira selo verde na tela.
     */
    disparouAntesDoConsentimento: boolean;
    /** Linha no HTML, ou `null` para tag que só apareceu na rede. */
    lineNumber: number | null;
}

interface TagHealthMonitorProps {
    detectedTags: any[];
    hasConsentTool: boolean;
    /**
     * Linha do tempo de rede medida pelo navegador (`storage.firingTimeline`).
     *
     * Esta aba exibia um tempo por tag vindo de `Math.random()`, com ícone de
     * relógio ao lado. Como a análise rodava no corpo do componente, cada
     * re-render sorteava de novo: o cliente lia "Meta Pixel — 137 ms", anotava,
     * recarregava e lia "91 ms". Num laudo levado ao DPO, número que muda
     * sozinho derruba a credibilidade de todo o resto. O tempo agora sai daqui
     * ou não sai.
     */
    linhaDoTempo?: EventoDeRede[];
}

/**
 * Casa a tag com a primeira requisição que o navegador registrou para o mesmo
 * fornecedor.
 *
 * A chave é o nome do fornecedor, e ela é confiável porque os dois lados saem
 * da MESMA entrada do `VENDOR_CATALOG` no backend: `TagFinding.name` (que vira
 * `tags[].name`) e o `owner` de cada evento da linha do tempo. Requisição de
 * fornecedor fora do catálogo entra na linha do tempo com o host no lugar do
 * nome, e aí não casa com tag nenhuma — que é o resultado certo: melhor ficar
 * sem medição do que atribuir à tag o tempo de outro.
 *
 * Sem `msSincePageStart` numérico o evento é descartado: é o campo que sustenta
 * o número exibido.
 */
const primeiraRequisicaoDaTag = (
    nome: string,
    linhaDoTempo: EventoDeRede[]
): EventoDeRede | null => {
    if (!nome) return null;
    const alvo = nome.trim().toLowerCase();

    let primeira: EventoDeRede | null = null;
    for (const evento of linhaDoTempo) {
        if ((evento.owner || '').trim().toLowerCase() !== alvo) continue;
        if (typeof evento.msSincePageStart !== 'number') continue;
        if (primeira === null || evento.msSincePageStart < (primeira.msSincePageStart as number)) {
            primeira = evento;
        }
    }
    return primeira;
};

const TagHealthMonitor = ({ detectedTags, hasConsentTool, linhaDoTempo }: TagHealthMonitorProps) => {
    // O valor padrão do parâmetro só cobre `undefined`: um `firingTimeline`
    // que chegue `null` (ou em outro formato) derrubaria a aba inteira no
    // `.length`. A ausência não some em silêncio — com a lista vazia, o card
    // exibe em destaque que esta varredura não trouxe medição de rede.
    const eventos = Array.isArray(linhaDoTempo) ? linhaDoTempo : [];

    // Análise de saúde de cada tag. Tudo aqui é função pura das props: duas
    // aberturas da mesma varredura precisam mostrar os mesmos números.
    const analyzeTagHealth = (tag: any): TagHealth => {
        const issues: string[] = [];
        const recommendations: string[] = [];
        let score = 100;

        // `lineNumber` chega 0 quando a tag não existe no HTML (detectada só na
        // rede): o normalizador troca `null` por 0. Comparar direto
        // (`tag.lineNumber < 100`) fazia esse 0 significar "está no <head>" — a
        // ausência do dado virava afirmação sobre onde a tag mora. No laudo de
        // exemplo, 3 das 6 tags recebiam esse rótulo sem nenhuma evidência.
        const linha = typeof tag.lineNumber === 'number' && tag.lineNumber > 0 ? tag.lineNumber : null;

        const evento = primeiraRequisicaoDaTag(tag.name, eventos);
        const ms = evento ? (evento.msSincePageStart as number) : null;

        // Declaração tardia no HTML — só quando a linha existe de fato.
        //
        // `position` não serve de guarda aqui: 0 não significa "primeira tag do
        // documento". É também o valor de quem o detector não localizou no HTML
        // (script vindo de `all_script_urls` entra com posição 0 e linha None),
        // e tag detectada só na rede entra com 10_000_000.
        if (linha !== null && linha > 500) {
            issues.push(`Declarada no fim do HTML, na linha ${linha}`);
            recommendations.push(
                'Confira o disparo na linha do tempo de rede antes de mover a tag: posição no HTML é ordem de declaração, não de execução'
            );
            score -= 15;
        }

        // Consentimento, do achado mais forte para o mais fraco — e nunca os
        // dois, que seria cobrar duas vezes pelo mesmo fato.
        //
        // O peso de 40 é o mesmo do Universal Analytics porque a natureza é a
        // mesma: achado provado, não inferido. Sem ele a aba exibia "Saudável"
        // e score 100 ao lado de "Disparou antes do consentimento" — no laudo
        // de exemplo eram 5 tags nessa situação, com score geral 98. Selo verde
        // sobre violação provada derruba a credibilidade do resto do documento.
        if (tag.isBeforeConsent === true) {
            issues.push(
                ms !== null
                    ? `Disparou antes do consentimento — requisição observada ${ms} ms após o início da página`
                    : 'Disparou antes do consentimento'
            );
            recommendations.push(
                'Bloqueie o disparo até o aceite: Consent Mode v2 ou carregamento condicional pelo CMP'
            );
            score -= 40;
        } else if (!hasConsentTool && tag.lgpdRisk !== 'low') {
            // Sem mecanismo de consentimento na página não há o que aguardar, e
            // todo rastreador é irregular. Note o que a frase NÃO diz: que a tag
            // disparou. Isso só se afirma quando há requisição observada.
            issues.push('Página sem mecanismo de consentimento: não há como esta tag aguardar aceite');
            recommendations.push('Implemente Consent Mode v2 para conformidade com a LGPD');
            score -= 30;
        }

        // Termo inteiro, não substring solta. `includes('ua-')` casaria com
        // qualquer nome que contivesse essas duas letras seguidas de hífen — é
        // o mesmo erro que fez o scanner clicar numa manchete por conter
        // "reject" (ver consent_interaction.classifica_rotulo).
        if (tag.name?.toLowerCase().includes('universal analytics')) {
            issues.push('Universal Analytics detectado (descontinuado)');
            recommendations.push('Migre para Google Analytics 4');
            score -= 40;
        }

        // A checagem de GTM duplicado saiu daqui: era `tag.type === 'gtm'` e o
        // motor nunca emite esse tipo (o do catálogo é `tag_manager`), então o
        // ramo nunca executou. Contar instalações é trabalho do detector de
        // duplicatas do motor, que enxerga o HTML inteiro — não da tela, que
        // recebe a lista já cortada pelo plano e nem recebe `occurrenceCount`.

        // Determinar status
        let status: 'healthy' | 'warning' | 'critical' | 'unknown' = 'healthy';
        if (score < 50) status = 'critical';
        else if (score < 75) status = 'warning';

        return {
            name: tag.name || 'Tag Desconhecida',
            type: tag.type || 'unknown',
            status,
            score: Math.max(0, score),
            issues,
            recommendations,
            primeiraRequisicaoMs: ms,
            primeiraRequisicaoUrl: evento?.url ?? null,
            disparouAntesDoConsentimento: tag.isBeforeConsent === true,
            lineNumber: linha
        };
    };

    const tagHealthData = detectedTags.map(analyzeTagHealth);
    const temTags = tagHealthData.length > 0;

    // Sem tag detectada não existe média: um "0" grande no anel lê como nota
    // péssima, quando o que houve foi ausência de medição.
    const overallScore = temTags
        ? Math.round(tagHealthData.reduce((sum, t) => sum + t.score, 0) / tagHealthData.length)
        : null;

    const healthyCounts = {
        healthy: tagHealthData.filter(t => t.status === 'healthy').length,
        warning: tagHealthData.filter(t => t.status === 'warning').length,
        critical: tagHealthData.filter(t => t.status === 'critical').length
    };

    const comMedicao = tagHealthData.filter(t => t.primeiraRequisicaoMs !== null).length;

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'healthy': return <CheckCircle className="h-5 w-5 text-green-500" />;
            case 'warning': return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
            case 'critical': return <XCircle className="h-5 w-5 text-red-500" />;
            default: return <RefreshCw className="h-5 w-5 text-gray-400" />;
        }
    };

    const getScoreColor = (score: number) => {
        if (score >= 80) return 'text-green-600';
        if (score >= 60) return 'text-yellow-600';
        return 'text-red-600';
    };

    const corDoScoreGeral = overallScore === null ? 'text-gray-400' : getScoreColor(overallScore);

    return (
        <Card className="border-0 shadow-xl dark:bg-gray-900">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white">
                        <Activity className="h-5 w-5" />
                    </div>
                    Monitor de Saúde das Tags
                </CardTitle>
                <CardDescription>
                    Conformidade e boas práticas de cada tag. O tempo exibido é o intervalo entre o
                    início da página e a primeira requisição observada daquele fornecedor durante a
                    varredura — não é tempo de carregamento do script.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* A ausência da medição é dita, nunca preenchida. Esta aba já
                    exibiu um tempo sorteado por tag; sem a linha do tempo de
                    rede, o certo é não mostrar tempo nenhum e explicar por quê. */}
                {eventos.length === 0 && (
                    <Alert>
                        <Clock className="h-4 w-4" />
                        <AlertDescription>
                            Esta varredura não trouxe a linha do tempo de rede. Nenhum tempo por tag é
                            exibido — o laudo não estima o que não mediu.
                        </AlertDescription>
                    </Alert>
                )}

                {/* Score geral */}
                <div className="flex flex-col items-center gap-2">
                    <div className="relative">
                        <svg className="w-32 h-32 transform -rotate-90">
                            <circle
                                cx="64"
                                cy="64"
                                r="56"
                                stroke="currentColor"
                                strokeWidth="12"
                                fill="transparent"
                                className="text-gray-200 dark:text-gray-700"
                            />
                            <circle
                                cx="64"
                                cy="64"
                                r="56"
                                stroke="currentColor"
                                strokeWidth="12"
                                fill="transparent"
                                strokeDasharray={`${2 * Math.PI * 56}`}
                                strokeDashoffset={`${2 * Math.PI * 56 * (1 - (overallScore ?? 0) / 100)}`}
                                className={corDoScoreGeral}
                                strokeLinecap="round"
                            />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                            <div className="text-center">
                                <span className={`text-3xl font-bold ${corDoScoreGeral}`}>
                                    {overallScore === null ? '—' : overallScore}
                                </span>
                                <span className="text-sm text-gray-500 block">Score</span>
                            </div>
                        </div>
                    </div>
                    {!temTags && (
                        <p className="text-sm text-gray-500 text-center">
                            Nenhuma tag foi detectada nesta varredura — não há score a calcular.
                        </p>
                    )}
                </div>

                {temTags && (
                    <>
                        {/* Resumo de status */}
                        <div className="grid grid-cols-4 gap-3">
                            <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-800 text-center">
                                <div className="text-2xl font-bold">{tagHealthData.length}</div>
                                <div className="text-xs text-gray-500">Total Tags</div>
                            </div>
                            <div className="p-3 rounded-xl bg-green-50 dark:bg-green-950/30 text-center">
                                <div className="text-2xl font-bold text-green-600">{healthyCounts.healthy}</div>
                                <div className="text-xs text-green-700 dark:text-green-300">Saudáveis</div>
                            </div>
                            <div className="p-3 rounded-xl bg-yellow-50 dark:bg-yellow-950/30 text-center">
                                <div className="text-2xl font-bold text-yellow-600">{healthyCounts.warning}</div>
                                <div className="text-xs text-yellow-700 dark:text-yellow-300">Alertas</div>
                            </div>
                            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-center">
                                <div className="text-2xl font-bold text-red-600">{healthyCounts.critical}</div>
                                <div className="text-xs text-red-700 dark:text-red-300">Críticos</div>
                            </div>
                        </div>

                        {/* Quantas tags têm medição de rede. Sem esta linha, uma
                            tela cheia de "sem medição" parece defeito da tela.

                            A frase anterior explicava a ausência dizendo que "a
                            varredura não registrou requisição atribuível a elas"
                            — e isso o laudo não sabe. A linha do tempo é um
                            recorte: o motor guarda as 60 primeiras requisições
                            de rastreio (`storage_auditor`, `eventos[:60]`) e
                            `totalTimelineEvents` é contado DEPOIS do corte, então
                            nem o servidor manda quantas ficaram de fora. No laudo
                            de exemplo a lista chega exatamente com 60, o que é o
                            corte batendo. Uma tag que disparou o beacon na 61ª
                            requisição aparecia aqui sob a afirmação de que nada
                            dela foi registrado — negativa fabricada, do mesmo
                            tamanho do tempo sorteado que esta aba exibia antes. */}
                        {eventos.length > 0 && (
                            <p className="text-xs text-gray-500 text-center">
                                {comMedicao} de {tagHealthData.length} tag(s) casaram com alguma
                                requisição da linha do tempo de rede. Para as demais não há requisição
                                correspondente <strong>nesta lista</strong>, o que não prova que não
                                dispararam: a linha do tempo é um recorte das primeiras requisições de
                                rastreio da visita, e requisição de fornecedor fora do catálogo entra
                                nela identificada pelo host, sem casar com o nome da tag.
                            </p>
                        )}
                    </>
                )}

                {/* Alerta se houver problemas críticos */}
                {healthyCounts.critical > 0 && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            <strong>{healthyCounts.critical} tag(s) com problemas críticos</strong> que precisam de atenção imediata.
                            Isso pode afetar seus dados de analytics e conformidade LGPD.
                        </AlertDescription>
                    </Alert>
                )}

                {/* Lista de tags */}
                {temTags && (
                    <div className="space-y-3">
                        <h4 className="font-medium flex items-center gap-2">
                            <Layers className="h-4 w-4" />
                            Análise Individual das Tags
                        </h4>

                        {tagHealthData.map((tag, i) => (
                            <div
                                key={i}
                                className={`p-4 rounded-xl border transition-all hover:shadow-md ${tag.status === 'critical' ? 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10' :
                                        tag.status === 'warning' ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/10' :
                                            'border-gray-200 dark:border-gray-700'
                                    }`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                        {getStatusIcon(tag.status)}
                                        <div>
                                            <h5 className="font-medium">{tag.name}</h5>
                                            <div className="flex gap-2 mt-1 flex-wrap">
                                                <Badge variant="outline" className="text-xs">
                                                    {tag.type}
                                                </Badge>

                                                {/* Badge de tempo só existe quando há medição. */}
                                                {tag.primeiraRequisicaoMs !== null && (
                                                    <Badge variant="outline" className="text-xs">
                                                        <Clock className="h-3 w-3 mr-1" />
                                                        1ª requisição: {tag.primeiraRequisicaoMs} ms
                                                    </Badge>
                                                )}

                                                {/* Antes daqui saía 'head' / 'body' / 'dynamic',
                                                    deduzido do número da linha — dedução que o HTML
                                                    não sustenta. O que existe de observado é a
                                                    linha, e é o que vai para a tela. */}
                                                {tag.lineNumber !== null ? (
                                                    <Badge variant="outline" className="text-xs">
                                                        <FileCode className="h-3 w-3 mr-1" />
                                                        linha {tag.lineNumber}
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-xs text-gray-500">
                                                        sem posição no HTML
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-2xl font-bold ${getScoreColor(tag.score)}`}>
                                            {tag.score}
                                        </div>
                                        <div className="text-xs text-gray-500">score</div>
                                    </div>
                                </div>

                                {/* Progress bar */}
                                <Progress value={tag.score} className="h-2 mb-3" />

                                {/* Issues */}
                                {tag.issues.length > 0 && (
                                    <div className="space-y-1 mb-2">
                                        {tag.issues.map((issue, j) => (
                                            <div key={j} className="text-sm text-red-600 dark:text-red-400 flex items-center gap-1">
                                                <XCircle className="h-3 w-3" />
                                                {issue}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Recommendations */}
                                {tag.recommendations.length > 0 && (
                                    <div className="space-y-1">
                                        {tag.recommendations.map((rec, j) => (
                                            <div key={j} className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                                <Target className="h-3 w-3" />
                                                {rec}
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* O que a varredura observou sobre esta tag. Antes eram dois
                                    selos — "Disparo" derivado do próprio score e "Consent Check"
                                    copiado do site inteiro — que afirmavam por tag coisas que
                                    ninguém tinha medido por tag. */}
                                <div className="flex flex-col gap-1.5 mt-3 pt-3 border-t dark:border-gray-700 text-xs">
                                    <div className="flex items-start gap-1">
                                        {tag.primeiraRequisicaoMs !== null ? (
                                            <>
                                                <CheckCircle className="h-3 w-3 text-green-500 shrink-0 mt-0.5" />
                                                <span>
                                                    Requisição observada {tag.primeiraRequisicaoMs} ms após o início da página
                                                </span>
                                            </>
                                        ) : (
                                            <>
                                                <MinusCircle className="h-3 w-3 text-gray-400 shrink-0 mt-0.5" />
                                                <span className="text-gray-500">
                                                    Nenhuma requisição desta tag foi registrada na linha do tempo de rede — sem medição de tempo
                                                </span>
                                            </>
                                        )}
                                    </div>

                                    {/* A URL é o que torna o número conferível: sem ela, "137 ms"
                                        é palavra do laudo contra a do cliente. */}
                                    {tag.primeiraRequisicaoUrl && (
                                        <div className="font-mono text-[10px] text-gray-500 dark:text-gray-400 break-all pl-4">
                                            {tag.primeiraRequisicaoUrl}
                                        </div>
                                    )}

                                    {/* O disparo antes do consentimento, quando provado, sobe
                                        para a lista de problemas acima — lá ele pesa no score.
                                        Aqui fica só a ausência de prova, e em cinza: o motor
                                        marca esse campo quando enxerga a irregularidade na rede,
                                        então não tê-la é falta de prova, não conformidade. Um
                                        selo verde aqui seria atestado que ninguém emitiu. */}
                                    {!tag.disparouAntesDoConsentimento && (
                                        <div className="flex items-start gap-1">
                                            <MinusCircle className="h-3 w-3 text-gray-400 shrink-0 mt-0.5" />
                                            <span className="text-gray-500">
                                                Sem evidência de disparo antes do consentimento
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

export default TagHealthMonitor;
