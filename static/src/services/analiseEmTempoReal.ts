/**
 * Fonte de dados da aba "Tempo Real".
 *
 * Substitui o `omnibugRealDataService`, que produziu o pior defeito possível
 * num produto de conformidade: a aba afirmava "100% conforme" para um site que
 * o scan Rápido reprovava com 22 achados.
 *
 * Duas causas, ambas de leitura:
 *
 * 1. Chamava `/analyze` — o motor legado do `main.py`, que compara posição no
 *    HTML — enquanto o scan Rápido usa `/api/audit` (`audit_engine`), que
 *    intercepta a rede, lê cookie via `context.cookies()` e clica em "Recusar".
 *    Dois motores, duas respostas para o mesmo site.
 * 2. Lia `data.lgpdAnalysis.violations`, chave que `/analyze` nunca devolveu —
 *    a resposta usa `privacy`. O optional chaining transformava isso em lista
 *    vazia silenciosa: zero violações, CMP sempre "não detectado", score alto
 *    do motor fraco. Nada estourava, nada aparecia no log.
 *
 * Agora a aba consome exatamente a mesma resposta do scan Rápido. Se os
 * números divergirem de novo, é bug no motor — não em dois motores.
 *
 * Também sai daqui a lista de proxies de terceiros (allorigins, cors-anywhere,
 * thingproxy): mandar a URL do cliente para intermediário sem contrato não cabe
 * num produto que audita tratamento de dados.
 */
import type { OmnibugAnalysisResult, OmnibugEvent, OmnibugScript, LGPDViolation } from '@/types/omnibug';

/** Resposta de `/api/audit` — só os campos que esta aba consome. */
interface RespostaDaAuditoria {
    success?: boolean;
    message?: string;
    errorCode?: string;
    url?: string;
    score?: number;
    tags?: any[];
    events?: any[];
    violations?: any[];
    summary?: Record<string, any>;
    privacy?: Record<string, any>;
    storage?: Record<string, any>;
    recommendations?: any[];
    scanMethod?: string;
}

export class FalhaNaAnalise extends Error {
    constructor(mensagem: string, readonly codigo?: string) {
        super(mensagem);
        this.name = 'FalhaNaAnalise';
    }
}

const PIXEL_POR_TIPO: Record<string, OmnibugEvent['pixelType']> = {
    analytics: 'GA4',
    advertising: 'Meta',
    marketing: 'Meta',
    tag_manager: 'GA4',
    heatmap: 'Microsoft',
};

const CATEGORIA_POR_TIPO: Record<string, OmnibugEvent['category']> = {
    analytics: 'analytics',
    advertising: 'advertising',
    marketing: 'advertising',
};

const severidadeValida = (valor: unknown): LGPDViolation['severity'] => {
    const nivel = String(valor || '').toLowerCase();
    return (nivel === 'critical' || nivel === 'high' || nivel === 'medium' || nivel === 'low')
        ? nivel
        : 'medium';
};

/** Aceita snake_case e camelCase: `raw_data` e a resposta da API divergem. */
const campo = (origem: Record<string, any> | undefined, ...nomes: string[]): any => {
    if (!origem) return undefined;
    for (const nome of nomes) {
        if (origem[nome] !== undefined && origem[nome] !== null) return origem[nome];
    }
    return undefined;
};

const paraViolacao = (v: any): LGPDViolation => ({
    severity: severidadeValida(v?.severity),
    article: campo(v, 'article', 'legalBasis', 'base_legal') || 'LGPD',
    description: campo(v, 'violation', 'description', 'title') || 'Não conformidade observada',
    evidence: campo(v, 'evidence', 'tag', 'detail', 'tagName') || '',
    recommendation: campo(v, 'recommendation', 'howToFix', 'como_corrigir') || '',
    // Sem valor inventado: a LGPD não tem tabela por tipo de violação, e o
    // laudo já traz o critério do art. 52 no lugar de um número pronto.
    estimatedFine: '',
    dataTypes: campo(v, 'dataTypes', 'data_types') || [],
});

const paraEvento = (tag: any, indice: number): OmnibugEvent => {
    const tipo = String(campo(tag, 'type', 'category') || 'custom');
    const antesDoConsentimento = Boolean(campo(tag, 'isBeforeConsent', 'is_before_consent'));
    return {
        name: campo(tag, 'name', 'vendor') || `Tag ${indice + 1}`,
        eventType: 'event',
        timestamp: new Date().toISOString(),
        parameters: {
            tagId: campo(tag, 'tagId', 'tag_id') || '',
            linha: campo(tag, 'lineNumber', 'line_number') ?? null,
        },
        requiredParams: [],
        missingParams: [],
        malformedParams: [],
        beforeConsent: antesDoConsentimento,
        ga4PropertyId: campo(tag, 'tagId', 'tag_id') || '',
        category: CATEGORIA_POR_TIPO[tipo] || 'custom',
        pixelType: PIXEL_POR_TIPO[tipo] || 'GA4',
        networkRequest: { url: '', method: 'GET', headers: {}, payload: null },
        dataLayerState: [],
        violations: antesDoConsentimento
            ? [{
                severity: 'high',
                article: 'Art. 7º, I da LGPD',
                description: 'Carregou antes de qualquer manifestação do titular',
                evidence: campo(tag, 'context', 'evidence') || '',
                recommendation: 'Condicionar o disparo ao aceite registrado pelo CMP',
                estimatedFine: '',
                dataTypes: [],
            }]
            : [],
    };
};

const paraScript = (tag: any, indice: number): OmnibugScript => ({
    name: campo(tag, 'name', 'vendor') || `Script ${indice + 1}`,
    type: (campo(tag, 'type') || 'custom') as OmnibugScript['type'],
    vendor: (campo(tag, 'vendor') || 'Other') as OmnibugScript['vendor'],
    scriptSrc: campo(tag, 'scriptSrc', 'matchedPattern', 'matched_pattern') || '',
    inlineCode: String(campo(tag, 'context') || '').substring(0, 400),
    position: indice + 1,
    loadTime: 0,
    beforeConsent: Boolean(campo(tag, 'isBeforeConsent', 'is_before_consent')),
    dataCollected: campo(tag, 'dataCollected', 'data_collected') || [],
    cookiesSet: [],
    networkRequests: [],
    dataTransfers: [],
    lgpdViolations: [],
    realTimeData: { activeConnections: 0, dataFlow: [], userIdentifiers: [] },
});

/** Cookie observado pelo motor → formato da aba, agrupado por finalidade. */
const agruparCookies = (storage: Record<string, any> | undefined) => {
    const vazio = { essential: [], analytics: [], marketing: [], uncategorized: [] } as OmnibugAnalysisResult['cookies'];
    const lista = campo(storage, 'cookiesWithoutConsent', 'cookies_without_consent') || [];
    if (!Array.isArray(lista)) return vazio;

    for (const c of lista) {
        const item = {
            name: campo(c, 'name') || '',
            value: campo(c, 'value') || '',
            domain: campo(c, 'domain') || '',
            secure: Boolean(campo(c, 'secure')),
        };
        const finalidade = String(campo(c, 'purpose', 'category', 'finalidade') || '').toLowerCase();
        if (finalidade.includes('analytic') || finalidade.includes('análise') || finalidade.includes('analise')) {
            vazio.analytics.push(item);
        } else if (finalidade.includes('market') || finalidade.includes('publicid') || finalidade.includes('advertis')) {
            vazio.marketing.push(item);
        } else if (finalidade.includes('essenc') || finalidade.includes('necess')) {
            vazio.essential.push(item);
        } else {
            vazio.uncategorized.push(item);
        }
    }
    return vazio;
};

const converter = (data: RespostaDaAuditoria, url: string, tempoDeCarga: number): OmnibugAnalysisResult => {
    const tags: any[] = Array.isArray(data.tags) ? data.tags : [];
    const privacy = data.privacy || {};
    const summary = data.summary || {};

    // A lista de violações vem cortada pelo plano; a contagem, não. Usar a
    // lista para contar era o que zerava o gráfico no free.
    const violacoes: any[] = Array.isArray(data.violations) && data.violations.length
        ? data.violations
        : (campo(privacy, 'violations') || []);
    const totalReal = campo(summary, 'violationsCount', 'totalViolations')
        ?? campo(privacy, 'totalViolations')
        ?? violacoes.length;

    const temCmp = Boolean(campo(privacy, 'hasConsentTool', 'cmpDetected') ?? campo(summary, 'consentDetected'));
    const antesDoConsentimento = tags.filter(t => campo(t, 'isBeforeConsent', 'is_before_consent'));

    return {
        url: data.url || url,
        timestamp: new Date().toISOString(),
        events: tags.map(paraEvento),
        scripts: tags.map(paraScript),
        dataLayer: [],
        cookies: agruparCookies(data.storage),
        consentMechanism: {
            detected: temCmp,
            type: temCmp ? 'binary' : 'none',
            vendor: campo(privacy, 'cmpName') || (temCmp ? 'Detectado' : 'Não detectado'),
            // Posição no HTML não prova bloqueio: a prova é não haver disparo
            // antes do aceite, e o scanner nunca clica em "aceitar".
            beforeScripts: antesDoConsentimento.length === 0,
            compliant: temCmp && antesDoConsentimento.length === 0 && totalReal === 0,
            issues: violacoes
                .slice(0, 5)
                .map(v => campo(v, 'violation', 'description', 'title'))
                .filter(Boolean),
        },
        networkActivity: {
            totalRequests: tags.length,
            analyticsRequests: tags.filter(t => campo(t, 'type') === 'analytics').length,
            advertisingRequests: tags.filter(t => ['advertising', 'marketing'].includes(String(campo(t, 'type')))).length,
            dataTransfers: antesDoConsentimento.length,
        },
        compliance: {
            score: Number(data.score ?? 0),
            violations: violacoes.map(paraViolacao),
            recommendations: (data.recommendations || [])
                .map((r: any) => campo(r, 'recommendation', 'title', 'description'))
                .filter(Boolean)
                .slice(0, 6),
        },
        performance: {
            loadTime: tempoDeCarga,
            scriptCount: tags.length,
            trackingImpact: tags.length > 10 ? 'Alto' : tags.length > 5 ? 'Médio' : 'Baixo',
        },
    };
};

/**
 * Roda a auditoria pela mesma rota do scan Rápido.
 *
 * Não existe fallback que devolva resultado: análise que não aconteceu tem de
 * aparecer como falha, nunca como "nada encontrado". A versão anterior
 * devolvia um relatório zerado quando o backend caía, e a tela apresentava
 * isso como site sem problema.
 */
export const analisarEmTempoReal = async (
    url: string,
    opcoes: { token?: string | null; plano?: string; signal?: AbortSignal } = {},
): Promise<OmnibugAnalysisResult> => {
    const inicio = Date.now();

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opcoes.token) headers['Authorization'] = `Bearer ${opcoes.token}`;

    let resposta: Response;
    try {
        resposta = await fetch('/api/audit', {
            method: 'POST',
            headers,
            body: JSON.stringify({ url, plan: opcoes.plano }),
            signal: opcoes.signal,
        });
    } catch (erro) {
        if ((erro as Error).name === 'AbortError') throw erro;
        throw new FalhaNaAnalise(`Não foi possível falar com o servidor: ${(erro as Error).message}`);
    }

    let data: RespostaDaAuditoria | null = null;
    try {
        data = await resposta.json();
    } catch {
        data = null;
    }

    if (!resposta.ok) {
        throw new FalhaNaAnalise(
            data?.message || `O servidor respondeu ${resposta.status}.`,
            data?.errorCode,
        );
    }
    if (!data || data.success === false) {
        throw new FalhaNaAnalise(
            data?.message || 'A auditoria não pôde ser concluída para esta URL.',
            data?.errorCode,
        );
    }

    return converter(data, url, Date.now() - inicio);
};
