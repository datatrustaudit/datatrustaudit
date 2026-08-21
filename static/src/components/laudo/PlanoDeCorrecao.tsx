/**
 * O que poderia estar melhor — o plano de correção do laudo.
 *
 * O motor já escreve a correção de cada achado; a tela mostrava pouco. O caso
 * mais caro estava em `recommendations[]`: o `map` que montava a lista lia
 * `title` e `description` e descartava `howToFix`, então o laudo apontava o
 * problema e calava sobre a solução — que vinha pronta, a um nome de
 * propriedade de distância.
 *
 * Cinco analisadores diferentes apontam correção, cada um com sua forma. Aqui
 * eles viram uma lista só, **ordenada por gravidade e não por origem**: quem
 * lê quer saber por onde começar, não de qual módulo do backend o achado veio.
 *
 * A regra que manda: nada é preenchido por suposição. Achado sem passo a passo
 * é declarado sem passo a passo. Inventar correção técnica errada é pior do que
 * não dar nenhuma — o cliente mexe no site e quebra o rastreamento.
 *
 * Ligação na tela (todos os campos já existem na resposta de `/api/audit`):
 *
 *     <PlanoDeCorrecao
 *         recomendacoes={resultado.recommendations}
 *         achadosDeGtm={resultado.gtmQuality?.findings}
 *         achadosDeConsentimento={resultado.consent?.findings}
 *         achadosDeDataLayer={resultado.datalayerFindings}
 *         problemasDeOrdem={resultado.storage?.orderIssues}
 *         achadosDaRecusa={resultado.storage?.rejectionFindings}
 *         guiasBloqueados={resultado.storage?.guidesLocked}
 *         detalheCortadoPeloPlano={resultado.showsDetail === false}
 *     />
 *
 * As props recebem a forma crua da API de propósito. Pedir ao chamador que
 * "mapeie para o que a tela precisa" foi exatamente o que perdeu o `howToFix`.
 *
 * Sobre dado pessoal na tela: os dois campos que poderiam trazer PII do
 * visitante já chegam tratados pelo motor — o `snippet` de `datalayerFindings`
 * passa por `_trecho_seguro`/`mascarador` no servidor, e a `evidence` dos
 * achados de armazenamento é montada com nome de cookie, domínio e URL já
 * cortada. Esta tela não acrescenta campo cru nenhum, e é para continuar
 * assim: `parametersFound[].value` e `sourceSnippet` não entram aqui.
 */
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, Clock, Gauge, Lock, Scale, Wrench } from 'lucide-react';

/* ─────────────────────────── Formas do motor ─────────────────────────────── */

/** Guia de correção completo — `audit_engine/guia_de_correcao.py`. */
interface GuiaDoMotor {
    whatIsWrong?: string | null;
    whyItMatters?: string | null;
    howToFix?: string[] | null;
    codeExample?: string | null;
    howToVerify?: string | null;
    legalBasis?: string | null;
    effort?: string | null;
    ownedBy?: string | null;
}

/**
 * Achado de analisador. Mesma forma em `consent.findings`,
 * `gtmQuality.findings`, `storage.orderIssues` e `storage.rejectionFindings`.
 *
 * `evidence` é `string` na maioria dos achados e objeto nos da recusa
 * (`{ buttonLabels: [...] }`) — os dois precisam ser tratados.
 */
export interface AchadoDoMotor {
    check?: string;
    label?: string;
    /** ok | warning | critical | not_detected — e `high` nos problemas de ordem. */
    status?: string;
    description?: string;
    evidence?: string | Record<string, unknown> | null;
    recommendation?: string | null;
    confidence?: string;
    guide?: GuiaDoMotor | null;
}

/** `datalayerFindings[]` tem forma própria: `type`/`severity`, sem `check`. */
export interface AchadoDeDataLayer {
    type?: string;
    severity?: string;
    keys?: string[];
    snippet?: string | null;
    description?: string;
    confidence?: string;
}

/** `recommendations[]` já achatada por `api/audit._issue_from_recommendation`. */
export interface RecomendacaoDoMotor {
    severity?: string;
    title?: string;
    description?: string;
    impact?: string;
    howToFix?: string;
    confidence?: string;
    planRequirement?: string | null;
}

interface Props {
    recomendacoes?: RecomendacaoDoMotor[] | null;
    achadosDeGtm?: AchadoDoMotor[] | null;
    achadosDeConsentimento?: AchadoDoMotor[] | null;
    achadosDeDataLayer?: AchadoDeDataLayer[] | null;
    problemasDeOrdem?: AchadoDoMotor[] | null;
    achadosDaRecusa?: AchadoDoMotor[] | null;
    /**
     * `storage.guidesLocked` — o plano gratuito recebe o achado sem o passo a
     * passo. Sem esse aviso, guia ausente por corte de plano fica igual a guia
     * que o motor não gerou, e o cliente não tem como saber a diferença.
     */
    guiasBloqueados?: boolean;
    /**
     * `showsDetail === false` — o plano gratuito.
     *
     * Sem esta informação a tela mente por omissão: `api/audit` zera
     * `recommendations` e anula `storage` inteiro no gratuito, e uma lista
     * vazia é indistinguível de análise que rodou sem apontar nada. A seção
     * chegou a declarar "rodou, nada a corrigir" sobre sete recomendações que
     * o motor tinha escrito — conformidade afirmada sobre dado que o plano
     * cortou. `gtmQuality`, `consent` e `datalayerFindings` não são cortados,
     * e por isso continuam sendo lidos pelo estado real da lista.
     */
    detalheCortadoPeloPlano?: boolean;
}

/* ────────────────────────────── Gravidade ────────────────────────────────── */

type Gravidade = 'critical' | 'high' | 'medium' | 'low' | 'indefinida';

const ORDEM_DE_GRAVIDADE: Record<Gravidade, number> = {
    critical: 0, high: 1, medium: 2, low: 3, indefinida: 4,
};

/** Concorda com "gravidade": "gravidade crítica". */
const ROTULO_DE_GRAVIDADE: Record<Gravidade, string> = {
    critical: 'crítica',
    high: 'alta',
    medium: 'média',
    low: 'baixa',
    indefinida: 'não classificada',
};

/**
 * Concorda com "ponto": "3 pontos críticos".
 *
 * Existe separado porque a forma feminina sozinha vira outra palavra na
 * contagem: "2 críticas" se lê como duas críticas, não como dois pontos de
 * gravidade crítica.
 */
const ROTULO_CONTADO: Record<Gravidade, [string, string]> = {
    critical: ['crítico', 'críticos'],
    high: ['alto', 'altos'],
    medium: ['médio', 'médios'],
    low: ['baixo', 'baixos'],
    indefinida: ['não classificado', 'não classificados'],
};

const COR_DE_GRAVIDADE: Record<Gravidade, string> = {
    critical: 'var(--laudo-critico)',
    high: 'var(--laudo-alto)',
    medium: 'var(--laudo-medio)',
    low: 'var(--laudo-baixo)',
    indefinida: 'var(--laudo-baixo)',
};

/**
 * `status` dos analisadores e `severity` das recomendações caem na mesma escala.
 *
 * `warning` vira média porque é o "poderia estar melhor" do motor — não é
 * violação, mas também não é conformidade. `info` vira baixa: fica registrado
 * sem competir por atenção com o que exige ação hoje.
 */
const GRAVIDADE_POR_NIVEL: Record<string, Gravidade> = {
    critical: 'critical',
    high: 'high',
    warning: 'medium',
    medium: 'medium',
    low: 'low',
    info: 'low',
};

/** Níveis que não são problema: nada a corrigir, nada a listar aqui. */
const NIVEIS_SEM_PROBLEMA = new Set(['ok', 'not_detected', 'passed', 'ignored']);

/**
 * Nível cru → gravidade. Nível desconhecido vira `indefinida`, nunca "média".
 *
 * Adivinhar a gravidade de um status novo do backend carimbaria uma prioridade
 * que ninguém mediu, num documento em que a ordem dos itens é a recomendação.
 */
const gravidadeDe = (nivel?: string | null): Gravidade => {
    const chave = (nivel || '').trim().toLowerCase();
    return GRAVIDADE_POR_NIVEL[chave] || 'indefinida';
};

/* ────────────────────────────── Confiança ───────────────────────────────── */

/**
 * Todo achado e toda recomendação trazem `confidence`, e a seção descartava o
 * campo inteiro.
 *
 * O custo disso é concreto: `reject_all_unverifiable` chega com
 * `confidence: "low"` e descrição que diz, em inglês, que o botão de recusar
 * *não pôde ser confirmado* — e aparecia na lista como um ponto de gravidade
 * média igual a qualquer outro. Num laudo, apresentar indício não confirmado
 * com a mesma cara de fato apurado é o que faz o cliente duvidar também dos
 * achados verdadeiros.
 */
type Confianca = 'high' | 'medium' | 'low';

const ROTULO_DE_CONFIANCA: Record<Confianca, string> = {
    high: 'alta', medium: 'média', low: 'baixa',
};

const ORDEM_DE_CONFIANCA: Record<Confianca, number> = { high: 0, medium: 1, low: 2 };

/** Valor fora da escala vira ausência declarada, nunca um nível chutado. */
const confiancaDe = (valor?: string | null): Confianca | undefined => {
    const chave = (valor || '').trim().toLowerCase();
    return chave === 'high' || chave === 'medium' || chave === 'low' ? chave : undefined;
};

/* ───────────────────── Texto genérico que o backend injeta ───────────────── */

/*
 * `api/audit._issue_from_recommendation` preenche `impact` e `howToFix` com
 * frase de reserva quando o motor não escreveu nada. O fallback nunca falha, e
 * é justamente isso que esconde o campo ausente: a tela exibe uma orientação
 * que ninguém gerou. Aqui as duas frases são tratadas como ausência.
 */
const ORIENTACAO_DE_RESERVA = 'review the implementation in gtm, ga4, cmp, and site source.';
const IMPACTO_DE_RESERVA =
    'may affect analytics data quality, privacy compliance, or debugging reliability.';

const ehTextoDeReserva = (texto: string, reserva: string) =>
    texto.trim().toLowerCase().replace(/\s+/g, ' ') === reserva;

/* ────────────────────────────── Normalização ─────────────────────────────── */

type Origem =
    | 'Teste de recusa'
    | 'Ordem de carregamento'
    | 'Consentimento'
    | 'Google Tag Manager'
    | 'dataLayer'
    | 'Recomendação do motor';

/**
 * Um par de evidência já pronto para a tela.
 *
 * `rotulo` vazio é o caso da `evidence` que veio como texto solto. Os valores
 * nunca são reescritos aqui: o que aparece é exatamente o que o motor gravou.
 */
interface ParDeEvidencia {
    rotulo: string;
    valores: string[];
    /** Quantos itens ficaram de fora do recorte — exibido, nunca engolido. */
    omitidos: number;
}

interface ItemDeCorrecao {
    chave: string;
    titulo: string;
    gravidade: Gravidade;
    /** Um problema pode chegar por dois analisadores; a tela mostra os dois. */
    origens: Origem[];
    confianca?: Confianca;
    oQueEstaErrado?: string;
    porQueImporta?: string;
    comoCorrigir: string[];
    exemplo?: string;
    comoVerificar?: string;
    baseLegal?: string;
    esforco?: string;
    quemResolve?: string;
    evidencia: ParDeEvidencia[];
    /** Guia cortado pelo plano, e não guia inexistente — a diferença importa. */
    guiaBloqueadoPeloPlano?: boolean;
}

const limpo = (valor?: string | null): string | undefined => {
    const texto = (valor || '').trim();
    return texto ? texto : undefined;
};

/**
 * Nomes das chaves de `evidence` em português.
 *
 * Traduzir o rótulo é legenda, não interpretação: o valor exibido continua
 * sendo exatamente o que o motor gravou. Chave fora desta lista aparece com o
 * nome cru — inventar tradução para chave nova esconderia que ela apareceu.
 */
const ROTULO_DA_EVIDENCIA: Record<string, string> = {
    cookies: 'Cookies gravados',
    requests: 'Requisições de rastreamento',
    storageKeys: 'Chaves de armazenamento',
    buttonLabels: 'Rótulos de botão encontrados',
};

/**
 * Quantos valores de uma mesma chave a tela mostra.
 *
 * O motor já corta em 20 (`storage_auditor.auditar_recusa`), e vinte URLs de
 * até 200 caracteres coladas numa linha só viravam um parágrafo ilegível de
 * quatro mil caracteres. O resto não some em silêncio: a contagem do que ficou
 * de fora vai na tela.
 */
const VALORES_DE_EVIDENCIA_VISIVEIS = 6;

/**
 * `evidence` em pares legíveis, ou lista vazia.
 *
 * Objeto vazio (`{ buttonLabels: [] }` é o caso real do achado
 * `cmp_present_no_ui`) não é evidência: renderizá-lo como "{}" daria ao leitor
 * a impressão de que algo foi observado.
 */
const paresDaEvidencia = (evidencia: AchadoDoMotor['evidence']): ParDeEvidencia[] => {
    const texto = typeof evidencia === 'string' ? limpo(evidencia) : undefined;
    if (texto) return [{ rotulo: '', valores: [texto], omitidos: 0 }];

    if (evidencia && typeof evidencia === 'object') {
        return Object.entries(evidencia)
            .map(([chave, valor]) => {
                const todos = (Array.isArray(valor) ? valor : [valor])
                    .map(item => String(item ?? '').trim())
                    .filter(Boolean);
                if (!todos.length) return null;
                return {
                    rotulo: ROTULO_DA_EVIDENCIA[chave] || chave,
                    valores: todos.slice(0, VALORES_DE_EVIDENCIA_VISIVEIS),
                    omitidos: Math.max(0, todos.length - VALORES_DE_EVIDENCIA_VISIVEIS),
                };
            })
            .filter((par): par is ParDeEvidencia => par !== null);
    }
    return [];
};

/** Achado de analisador → item do plano. `null` quando não é problema. */
const doAchado = (
    achado: AchadoDoMotor,
    origem: Origem,
    indice: number,
    guiasBloqueados: boolean,
): ItemDeCorrecao | null => {
    const nivel = (achado.status || '').trim().toLowerCase();
    if (NIVEIS_SEM_PROBLEMA.has(nivel)) return null;

    const guia = achado.guide || null;
    const passos = (guia?.howToFix || []).map(passo => (passo || '').trim()).filter(Boolean);
    // Sem guia, a linha única de `recommendation` é o que o motor tem a dizer.
    const recomendacao = limpo(achado.recommendation);
    const comoCorrigir = passos.length ? passos : recomendacao ? [recomendacao] : [];

    return {
        chave: achado.check ? `check:${achado.check}` : `${origem}:${indice}`,
        titulo: limpo(achado.label) || limpo(achado.check) || 'Achado sem título',
        gravidade: gravidadeDe(achado.status),
        origens: [origem],
        confianca: confiancaDe(achado.confidence),
        oQueEstaErrado: limpo(guia?.whatIsWrong),
        porQueImporta: limpo(guia?.whyItMatters) || limpo(achado.description),
        comoCorrigir,
        exemplo: limpo(guia?.codeExample),
        comoVerificar: limpo(guia?.howToVerify),
        baseLegal: limpo(guia?.legalBasis),
        esforco: limpo(guia?.effort),
        quemResolve: limpo(guia?.ownedBy),
        evidencia: paresDaEvidencia(achado.evidence),
        // Achado de armazenamento sem guia quando o plano corta guias: a
        // orientação existe no motor, o plano é que não a entrega.
        guiaBloqueadoPeloPlano:
            guiasBloqueados &&
            !guia &&
            (origem === 'Teste de recusa' || origem === 'Ordem de carregamento'),
    };
};

/** `datalayerFindings[]` → item. Forma diferente: `type` no lugar de `check`. */
const doDataLayer = (achado: AchadoDeDataLayer, indice: number): ItemDeCorrecao | null => {
    const nivel = (achado.severity || '').trim().toLowerCase();
    if (NIVEIS_SEM_PROBLEMA.has(nivel)) return null;

    const chaves = (achado.keys || []).filter(Boolean);
    return {
        chave: achado.type ? `datalayer:${achado.type}` : `dataLayer:${indice}`,
        titulo: chaves.length
            ? `dataLayer: ${chaves.join(', ')}`
            : limpo(achado.type) || 'Achado do dataLayer',
        gravidade: gravidadeDe(achado.severity),
        origens: ['dataLayer'],
        confianca: confiancaDe(achado.confidence),
        porQueImporta: limpo(achado.description),
        // O analisador de dataLayer não escreve correção. Dizer isso é melhor
        // do que montar um passo a passo plausível a partir do tipo do achado.
        comoCorrigir: [],
        // O trecho já vem mascarado do servidor (`_trecho_seguro`): o achado
        // de PII aponta a chave, nunca o valor. Não reescrever aqui.
        evidencia: paresDaEvidencia(achado.snippet ?? null),
    };
};

/**
 * `recommendations[]` → item.
 *
 * A chave é o próprio título: duas recomendações com o mesmo título são a
 * mesma recomendação emitida duas vezes, e devem aparecer uma vez só.
 */
const daRecomendacao = (rec: RecomendacaoDoMotor): ItemDeCorrecao => {
    const correcao = limpo(rec.howToFix);
    const impacto = limpo(rec.impact);
    const titulo = limpo(rec.title) || 'Recomendação sem título';

    return {
        chave: `rec:${titulo.toLowerCase()}`,
        titulo,
        gravidade: gravidadeDe(rec.severity),
        origens: ['Recomendação do motor'],
        confianca: confiancaDe(rec.confidence),
        porQueImporta:
            limpo(rec.description) ||
            (impacto && !ehTextoDeReserva(impacto, IMPACTO_DE_RESERVA) ? impacto : undefined),
        comoCorrigir:
            correcao && !ehTextoDeReserva(correcao, ORIENTACAO_DE_RESERVA) ? [correcao] : [],
        // `recommendations[]` não carrega evidência: o campo não existe na
        // forma que `_issue_from_recommendation` entrega.
        evidencia: [],
    };
};

/**
 * Junta dois itens que descrevem o mesmo problema.
 *
 * Mantém a gravidade mais alta: o motor de recomendações rebaixa todo achado de
 * GTM para `high`, enquanto o próprio analisador marcou `critical`. Num plano de
 * correção, a ordem é a recomendação — rebaixar aqui mudaria por onde começar.
 */
const juntar = (base: ItemDeCorrecao, outro: ItemDeCorrecao): ItemDeCorrecao => ({
    ...base,
    gravidade:
        ORDEM_DE_GRAVIDADE[outro.gravidade] < ORDEM_DE_GRAVIDADE[base.gravidade]
            ? outro.gravidade
            : base.gravidade,
    // As duas origens ficam registradas: um ponto confirmado por dois
    // analisadores é mais forte do que um, e quem confere o laudo precisa
    // saber onde procurar cada metade.
    origens: [...base.origens, ...outro.origens.filter(o => !base.origens.includes(o))],
    // Confiança pelo caminho mais forte, pelo mesmo motivo: a observação que
    // provou o problema não fica menos certa porque outra rota o inferiu.
    confianca:
        base.confianca && outro.confianca
            ? (ORDEM_DE_CONFIANCA[outro.confianca] < ORDEM_DE_CONFIANCA[base.confianca]
                ? outro.confianca
                : base.confianca)
            : base.confianca || outro.confianca,
    oQueEstaErrado: base.oQueEstaErrado || outro.oQueEstaErrado,
    porQueImporta: base.porQueImporta || outro.porQueImporta,
    comoCorrigir: base.comoCorrigir.length ? base.comoCorrigir : outro.comoCorrigir,
    exemplo: base.exemplo || outro.exemplo,
    comoVerificar: base.comoVerificar || outro.comoVerificar,
    baseLegal: base.baseLegal || outro.baseLegal,
    esforco: base.esforco || outro.esforco,
    quemResolve: base.quemResolve || outro.quemResolve,
    evidencia: base.evidencia.length ? base.evidencia : outro.evidencia,
    guiaBloqueadoPeloPlano: base.guiaBloqueadoPeloPlano || outro.guiaBloqueadoPeloPlano,
});

/**
 * Texto de descrição em forma comparável.
 *
 * Serve para casar o mesmo problema chegando por dois caminhos: o
 * `recommendation_engine` copia a descrição do achado de GTM palavra por
 * palavra, e o achado `cmp_present_no_ui` sai tanto em `consent.findings`
 * quanto em `storage.rejectionFindings`. Texto curto fica de fora: frase
 * genérica repetida entre achados distintos juntaria dois problemas em um.
 *
 * A assinatura é o texto **inteiro**, não um prefixo. Comparar só os 200
 * primeiros caracteres juntava dois achados diferentes que compartilham a
 * abertura — e item juntado por engano é item que some do plano, ou seja,
 * problema que ninguém corrige. O motor copia a descrição palavra por palavra
 * (`recommendation_engine`: `detail=f.description`), então a igualdade exata
 * casa os casos reais sem esse risco.
 */
const assinaturaDoTexto = (texto?: string): string | null => {
    const normalizado = (texto || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return normalizado.length >= 40 ? normalizado : null;
};

/* ──────────────────────────────── Tela ───────────────────────────────────── */

interface Procedencia {
    origem: string;
    /**
     * ausente  = a varredura não trouxe a análise;
     * vazia    = rodou e não apontou nada;
     * cortada  = rodou, e o plano contratado não entrega o resultado;
     * contribuiu = alimentou a lista acima.
     *
     * "vazia" e "cortada" pareciam a mesma coisa na tela e afirmam o oposto:
     * uma diz que não há o que corrigir, a outra que não dá para saber.
     */
    estado: 'ausente' | 'vazia' | 'cortada' | 'contribuiu';
    itens: number;
}

const PlanoDeCorrecao = ({
    recomendacoes,
    achadosDeGtm,
    achadosDeConsentimento,
    achadosDeDataLayer,
    problemasDeOrdem,
    achadosDaRecusa,
    guiasBloqueados = false,
    detalheCortadoPeloPlano = false,
}: Props) => {

    /* Ordem de leitura das fontes: as mais completas primeiro, para que elas
       sejam a base quando o mesmo problema chegar por dois caminhos. Só os
       achados de armazenamento (recusa e ordem) carregam o guia com passo a
       passo, exemplo de código e teste de verificação. */
    const brutos: ItemDeCorrecao[] = [
        ...(achadosDaRecusa || []).map((a, i) => doAchado(a, 'Teste de recusa', i, guiasBloqueados)),
        ...(problemasDeOrdem || []).map((a, i) => doAchado(a, 'Ordem de carregamento', i, guiasBloqueados)),
        ...(achadosDeConsentimento || []).map((a, i) => doAchado(a, 'Consentimento', i, guiasBloqueados)),
        ...(achadosDeGtm || []).map((a, i) => doAchado(a, 'Google Tag Manager', i, guiasBloqueados)),
        ...(achadosDeDataLayer || []).map((a, i) => doDataLayer(a, i)),
        ...(recomendacoes || []).map(r => daRecomendacao(r)),
    ].filter((item): item is ItemDeCorrecao => item !== null);

    /* Deduplicação em dois passos, os dois por igualdade exata — casar por
       semelhança juntaria problemas diferentes, e um achado que some do plano é
       um achado que ninguém corrige. */
    const porChave = new Map<string, ItemDeCorrecao>();
    for (const item of brutos) {
        const existente = porChave.get(item.chave);
        porChave.set(item.chave, existente ? juntar(existente, item) : item);
    }

    const porTexto = new Map<string, string>();   // assinatura → chave do item
    const itens: ItemDeCorrecao[] = [];
    for (const item of porChave.values()) {
        const assinatura = assinaturaDoTexto(item.porQueImporta);
        const chaveAnterior = assinatura ? porTexto.get(assinatura) : undefined;
        if (chaveAnterior) {
            const posicao = itens.findIndex(i => i.chave === chaveAnterior);
            if (posicao >= 0) {
                itens[posicao] = juntar(itens[posicao], item);
                continue;
            }
        }
        if (assinatura) porTexto.set(assinatura, item.chave);
        itens.push(item);
    }

    /* Ordena por gravidade preservando a ordem de origem dentro da faixa: o
       motor já ordena por prioridade, e embaralhar isso trocaria a sugestão de
       por onde começar. */
    const ordenados = itens
        .map((item, i) => ({ item, i }))
        .sort((a, b) =>
            ORDEM_DE_GRAVIDADE[a.item.gravidade] - ORDEM_DE_GRAVIDADE[b.item.gravidade] || a.i - b.i)
        .map(({ item }) => item);

    const contagem = ordenados.reduce<Record<string, number>>((acc, item) => {
        acc[item.gravidade] = (acc[item.gravidade] || 0) + 1;
        return acc;
    }, {});

    /* Procedência: quais análises alimentaram este plano, quais rodaram sem
       apontar nada, quais o plano não entrega e quais não vieram nesta
       varredura. Sem isso, "nenhum ponto a corrigir" se confunde com "a
       análise não rodou" — e as duas frases têm consequências opostas para
       quem responde pelo site.

       O terceiro elemento diz se o plano gratuito corta esta fonte. É preciso
       ser exato: `api/audit._normalize_audit_response` zera `recommendations`
       e anula `storage` inteiro (de onde saem recusa e ordem) quando
       `showsDetail` é falso, mas deixa `consent`, `gtmQuality` e
       `datalayerFindings` passarem. Marcar as três últimas como cortadas
       esconderia uma análise que de fato rodou e não achou nada. */
    const contribuicoes: Array<[string, unknown[] | null | undefined, boolean]> = [
        ['Teste de recusa', achadosDaRecusa, true],
        ['Ordem de carregamento', problemasDeOrdem, true],
        ['Consentimento', achadosDeConsentimento, false],
        ['Google Tag Manager', achadosDeGtm, false],
        ['dataLayer', achadosDeDataLayer, false],
        ['Recomendações do motor', recomendacoes, true],
    ];
    const procedencia: Procedencia[] = contribuicoes.map(([origem, lista, cortaNoGratuito]) => {
        if (detalheCortadoPeloPlano && cortaNoGratuito) {
            return { origem, estado: 'cortada', itens: 0 };
        }
        if (!Array.isArray(lista)) return { origem, estado: 'ausente', itens: 0 };
        // Conta o que a fonte trouxe de acionável, não o tamanho da lista: os
        // analisadores devolvem também as verificações aprovadas.
        const acionaveis = lista.filter(entrada => {
            const nivel = String(
                (entrada as AchadoDoMotor)?.status ?? (entrada as AchadoDeDataLayer)?.severity ?? '',
            ).trim().toLowerCase();
            return !NIVEIS_SEM_PROBLEMA.has(nivel);
        }).length;
        return {
            origem,
            estado: acionaveis > 0 ? 'contribuiu' : 'vazia',
            itens: acionaveis,
        };
    });

    /* Frase do estado vazio, montada a partir do que de fato aconteceu com
       cada fonte. A versão anterior tinha só duas saídas — "nada veio" ou "as
       análises rodaram e nada apontaram" — e a segunda afirmava conformidade
       em nome de análises que podiam nem ter chegado. */
    const analisesQueRodaram = procedencia.filter(p => p.estado === 'vazia').length;
    const fontesCortadas = procedencia.filter(p => p.estado === 'cortada').length;
    const fontesAusentes = procedencia.filter(p => p.estado === 'ausente').length;

    const frasePlanoVazio = (() => {
        if (analisesQueRodaram === 0) {
            return fontesCortadas > 0
                ? 'Nenhuma das análises que alimentam o plano de correção chegou nesta resposta: parte não foi entregue pelo plano contratado. Isto não é um atestado de conformidade.'
                : 'Esta varredura não trouxe as análises que alimentam o plano de correção. A lista abaixo mostra o que foi e o que não foi examinado.';
        }
        const ressalva =
            fontesCortadas > 0 && fontesAusentes > 0
                ? ' Outras não vieram nesta varredura ou não são entregues no plano contratado — ver a lista abaixo.'
                : fontesCortadas > 0
                    ? ' Outras não são entregues no plano contratado — ver a lista abaixo.'
                    : fontesAusentes > 0
                        ? ' Outras não vieram nesta varredura — ver a lista abaixo.'
                        : '';
        return (
            `${analisesQueRodaram === 1 ? 'A análise que rodou' : `As ${analisesQueRodaram} análises que rodaram`} ` +
            'não apontaram ponto de correção nesta página, no que foi observado nesta visita.' +
            ressalva
        );
    })();

    return (
        <div className="space-y-5">

            {/* Cabeçalho: quantos pontos, em que gravidade. */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p className="t-etiqueta mb-2">O que poderia estar melhor</p>
                    <div className="flex flex-wrap items-baseline justify-between gap-4">
                        <h2 className="t-secao voz-argumento m-0" style={{ color: 'var(--laudo-texto)' }}>
                            {ordenados.length === 0
                                ? 'Nenhum ponto de correção apontado'
                                : `${ordenados.length} ${ordenados.length === 1 ? 'ponto a corrigir' : 'pontos a corrigir'}`}
                        </h2>
                        {ordenados.length > 0 && (
                            <ul className="flex flex-wrap gap-x-4 gap-y-1 list-none p-0 m-0">
                                {(Object.keys(ORDEM_DE_GRAVIDADE) as Gravidade[])
                                    .filter(nivel => (contagem[nivel] || 0) > 0)
                                    .map(nivel => (
                                        <li
                                            key={nivel}
                                            className="voz-evidencia text-[11px] uppercase tracking-wider"
                                            style={{ color: COR_DE_GRAVIDADE[nivel] }}
                                        >
                                            {contagem[nivel]}{' '}
                                            {ROTULO_CONTADO[nivel][contagem[nivel] > 1 ? 1 : 0]}
                                        </li>
                                    ))}
                            </ul>
                        )}
                    </div>
                    <p className="t-apoio mt-3 m-0">
                        {ordenados.length === 0
                            ? frasePlanoVazio
                            /* "quando o motor gerou" não é ressalva de rodapé:
                               parte dos achados chega sem passo a passo, e
                               prometer correção para todos faria o leitor
                               tomar a ausência por falha da tela. */
                            : 'Em ordem de gravidade, não por origem: o que resolver primeiro vem primeiro. Cada ponto traz o que está errado, por que importa e — quando o motor gerou a orientação — o que fazer.'}
                    </p>

                    {/* Plano incompleto por contrato, dito no topo e não no
                        rodapé: um plano de correção que parece completo e não
                        é vale menos do que um que declara o próprio recorte. */}
                    {fontesCortadas > 0 && (
                        <p
                            className="t-apoio mt-3 m-0 flex items-start gap-2"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                            <span>
                                {fontesCortadas === 1
                                    ? 'Uma das análises que alimentam este plano não é entregue no plano gratuito.'
                                    : `${fontesCortadas} das análises que alimentam este plano não são entregues no plano gratuito.`}
                                {' '}O que falta está identificado na lista de procedência, ao final.
                            </span>
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* A lista. */}
            {ordenados.length > 0 && (
                <ol className="space-y-4 list-none p-0 m-0">
                    {ordenados.map((item, indice) => {
                        const cor = COR_DE_GRAVIDADE[item.gravidade];
                        const temOrientacao = item.comoCorrigir.length > 0 || !!item.exemplo;

                        return (
                            <li key={item.chave}>
                                <Card
                                    className="border-l-4"
                                    style={{
                                        borderColor: 'var(--laudo-linha)',
                                        borderLeftColor: cor,
                                        background: 'var(--laudo-superficie)',
                                    }}
                                >
                                    <CardContent className="pt-6">

                                        {/* Identificação do ponto */}
                                        <div className="flex gap-3">
                                            <span
                                                className="voz-evidencia text-sm font-bold shrink-0 pt-0.5"
                                                style={{ color: 'var(--laudo-texto-fraco)', minWidth: '2.5ch' }}
                                            >
                                                {String(indice + 1).padStart(2, '0')}
                                            </span>
                                            <div className="min-w-0 flex-1">
                                                <h3
                                                    className="voz-argumento text-lg font-semibold leading-snug m-0"
                                                    style={{ color: 'var(--laudo-texto)', maxWidth: '58ch' }}
                                                >
                                                    {item.titulo}
                                                </h3>

                                                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2">
                                                    <span
                                                        className="voz-evidencia text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
                                                        style={{ color: cor }}
                                                    >
                                                        <AlertTriangle className="h-3 w-3" />
                                                        gravidade {ROTULO_DE_GRAVIDADE[item.gravidade]}
                                                    </span>
                                                    <span
                                                        className="voz-evidencia text-[10px] uppercase tracking-wider"
                                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                                    >
                                                        {item.origens.join(' + ')}
                                                    </span>
                                                    {/* Confiança do próprio motor. Achado
                                                        marcado como incerto precisa chegar
                                                        marcado como incerto. */}
                                                    {item.confianca && (
                                                        <span
                                                            className="voz-evidencia text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
                                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                                        >
                                                            <Gauge className="h-3 w-3" />
                                                            confiança {ROTULO_DE_CONFIANCA[item.confianca]}
                                                        </span>
                                                    )}
                                                    {item.esforco && (
                                                        <span
                                                            className="voz-evidencia text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
                                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                                        >
                                                            <Clock className="h-3 w-3" />
                                                            esforço {item.esforco}
                                                        </span>
                                                    )}
                                                    {item.quemResolve && (
                                                        <span
                                                            className="voz-evidencia text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
                                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                                        >
                                                            <Wrench className="h-3 w-3" />
                                                            {item.quemResolve}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* O que está errado, em uma frase sem jargão. Só o
                                                    guia escreve isso; achado sem guia vai direto ao
                                                    "por que importa". */}
                                                {item.oQueEstaErrado && (
                                                    <p
                                                        className="voz-argumento text-sm mt-3 m-0"
                                                        style={{ color: 'var(--laudo-texto)', maxWidth: '66ch' }}
                                                    >
                                                        {item.oQueEstaErrado}
                                                    </p>
                                                )}

                                                {item.porQueImporta && (
                                                    <p
                                                        className="voz-argumento text-sm mt-2 m-0"
                                                        style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}
                                                    >
                                                        {item.porQueImporta}
                                                    </p>
                                                )}

                                                {/* Confiança baixa é o próprio motor dizendo que não
                                                    conseguiu confirmar. Sem esta linha, indício e
                                                    fato apurado saem com a mesma cara — e quem lê
                                                    não tem como separar os dois. */}
                                                {item.confianca === 'low' && (
                                                    <p
                                                        className="text-xs mt-3 m-0"
                                                        style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '66ch' }}
                                                    >
                                                        Confiança baixa: a varredura não conseguiu confirmar este
                                                        ponto. Trate como indício a verificar, não como fato apurado.
                                                    </p>
                                                )}

                                                {/* Evidência: o que disparou o achado. É o que
                                                    permite conferir em vez de acreditar. */}
                                                {item.evidencia.length > 0 && (
                                                    <dl
                                                        className="text-xs mt-3 px-3 py-2 rounded m-0 space-y-1.5"
                                                        style={{ background: 'var(--sup-2)' }}
                                                    >
                                                        {item.evidencia.map(par => (
                                                            <div key={par.rotulo || 'texto'}>
                                                                {par.rotulo && (
                                                                    <dt
                                                                        className="voz-evidencia text-[10px] uppercase tracking-wider"
                                                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                                                    >
                                                                        {par.rotulo}
                                                                    </dt>
                                                                )}
                                                                <dd
                                                                    className="voz-evidencia m-0 overflow-x-auto"
                                                                    style={{ color: 'var(--laudo-texto-suave)' }}
                                                                >
                                                                    {par.valores.map((valor, i) => (
                                                                        <span key={i} className="block break-all">
                                                                            {valor}
                                                                        </span>
                                                                    ))}
                                                                    {/* O recorte é dito. Um "..." mudo faria
                                                                        o leitor tomar a amostra pelo total. */}
                                                                    {par.omitidos > 0 && (
                                                                        <span
                                                                            className="block"
                                                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                                                        >
                                                                            +{par.omitidos} não exibido
                                                                            {par.omitidos > 1 ? 's' : ''} aqui
                                                                        </span>
                                                                    )}
                                                                </dd>
                                                            </div>
                                                        ))}
                                                    </dl>
                                                )}
                                            </div>
                                        </div>

                                        {/* Como corrigir — o motivo desta seção existir. */}
                                        <div
                                            className="mt-4 ml-0 sm:ml-[calc(2.5ch+0.75rem)] pl-4 border-l"
                                            style={{ borderColor: temOrientacao ? 'var(--laudo-carimbo)' : 'var(--laudo-linha)' }}
                                        >
                                            <p
                                                className="voz-evidencia text-[10px] uppercase tracking-widest mb-2 m-0"
                                                style={{ color: temOrientacao ? 'var(--laudo-carimbo)' : 'var(--laudo-texto-fraco)' }}
                                            >
                                                Como corrigir
                                            </p>

                                            {item.comoCorrigir.length > 0 && (
                                                <ol className="space-y-1.5 list-none p-0 m-0">
                                                    {item.comoCorrigir.map((passo, i) => (
                                                        <li key={i} className="flex gap-2.5 text-sm">
                                                            {/* Numerar só quando há mais de um passo:
                                                                "1." sozinho sugere que faltam os outros. */}
                                                            {item.comoCorrigir.length > 1 && (
                                                                <span
                                                                    className="voz-evidencia shrink-0"
                                                                    style={{ color: 'var(--laudo-carimbo)' }}
                                                                >
                                                                    {i + 1}.
                                                                </span>
                                                            )}
                                                            <span style={{ color: 'var(--laudo-texto)', maxWidth: '64ch' }}>
                                                                {passo}
                                                            </span>
                                                        </li>
                                                    ))}
                                                </ol>
                                            )}

                                            {/* Código pronto para copiar, quando o guia traz. */}
                                            {item.exemplo && (
                                                <pre
                                                    className="voz-evidencia text-xs mt-3 p-3 rounded overflow-x-auto whitespace-pre"
                                                    style={{
                                                        background: 'var(--sup-2)',
                                                        color: 'var(--laudo-texto)',
                                                        border: '1px solid var(--laudo-linha)',
                                                    }}
                                                >
                                                    {item.exemplo}
                                                </pre>
                                            )}

                                            {/* Ausência dita, nunca preenchida: um passo a passo
                                                inventado faz o cliente mexer no site e quebrar o
                                                rastreamento — pior do que não orientar. */}
                                            {!temOrientacao && (
                                                <p
                                                    className="text-sm m-0 inline-flex items-start gap-2"
                                                    style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '64ch' }}
                                                >
                                                    {item.guiaBloqueadoPeloPlano && (
                                                        <Lock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                                    )}
                                                    {/* Duas ausências diferentes, e a distinção
                                                        importa: uma o motor não escreveu, a outra
                                                        o plano não entrega. A segunda frase fala
                                                        do que `guidesLocked` de fato prova — que
                                                        o corte é do plano — sem afirmar que existe
                                                        um guia catalogado para este achado. */}
                                                    <span>
                                                        {item.guiaBloqueadoPeloPlano
                                                            ? 'O passo a passo destes achados não é entregue no plano gratuito. O que está acima é o que a varredura observou.'
                                                            : 'A orientação para este ponto não foi gerada por esta varredura.'}
                                                    </span>
                                                </p>
                                            )}

                                            {item.comoVerificar && (
                                                <p
                                                    className="text-sm mt-3 m-0 flex items-start gap-2"
                                                    style={{ color: 'var(--laudo-texto-suave)', maxWidth: '64ch' }}
                                                >
                                                    <CheckCircle
                                                        className="h-3.5 w-3.5 shrink-0 mt-0.5"
                                                        style={{ color: 'var(--laudo-conforme)' }}
                                                    />
                                                    <span>
                                                        <span
                                                            className="voz-evidencia text-[10px] uppercase tracking-widest block"
                                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                                        >
                                                            Como confirmar que resolveu
                                                        </span>
                                                        {item.comoVerificar}
                                                    </span>
                                                </p>
                                            )}

                                            {item.baseLegal && (
                                                <p
                                                    className="text-xs mt-3 m-0 flex items-start gap-2"
                                                    style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '64ch' }}
                                                >
                                                    <Scale className="h-3.5 w-3.5 shrink-0" />
                                                    <span>{item.baseLegal}</span>
                                                </p>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </li>
                        );
                    })}
                </ol>
            )}

            {/* Procedência das análises. */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p className="t-etiqueta mb-3">De onde vem este plano</p>
                    <ul className="grid gap-2 sm:grid-cols-2 list-none p-0 m-0">
                        {procedencia.map(fonte => (
                            <li key={fonte.origem} className="flex items-baseline gap-2 text-sm">
                                <span
                                    className="voz-evidencia shrink-0 text-xs"
                                    style={{
                                        color: fonte.estado === 'contribuiu'
                                            ? 'var(--laudo-texto)'
                                            : 'var(--laudo-texto-fraco)',
                                        minWidth: '3ch',
                                    }}
                                >
                                    {/* Traço para "não sei", número só para o que
                                        foi contado de fato. Zero ao lado de uma
                                        fonte cortada pelo plano seria a leitura
                                        errada: "examinado e limpo". */}
                                    {fonte.estado === 'contribuiu' || fonte.estado === 'vazia'
                                        ? fonte.itens
                                        : '—'}
                                </span>
                                <span style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {fonte.origem}
                                    {fonte.estado === 'ausente' && (
                                        <span style={{ color: 'var(--laudo-texto-fraco)' }}>
                                            {' '}· não veio nesta varredura
                                        </span>
                                    )}
                                    {fonte.estado === 'cortada' && (
                                        <span
                                            className="inline-flex items-baseline gap-1"
                                            style={{ color: 'var(--laudo-texto-fraco)' }}
                                        >
                                            {' '}· não entregue no plano gratuito
                                        </span>
                                    )}
                                    {fonte.estado === 'vazia' && (
                                        <span style={{ color: 'var(--laudo-texto-fraco)' }}>
                                            {' '}· rodou, nada a corrigir
                                        </span>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>

                    {/* O mesmo problema chega por dois analisadores em alguns casos
                        (o achado de GTM vira também recomendação). Somar as fontes
                        acima e não bater com o total da lista é esperado. */}
                    {ordenados.length > 0 && (
                        <p className="t-apoio mt-4 m-0">
                            Pontos que chegaram por mais de um analisador aparecem uma vez só, com a
                            gravidade mais alta atribuída a eles.
                        </p>
                    )}
                </CardContent>
            </Card>

            {/* Alcance. Declarar o limite é o que separa laudo de propaganda. */}
            <p className="text-xs leading-relaxed" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '72ch' }}>
                Este plano cobre o que a varredura observou na página analisada, em uma visita,
                sem aceitar o aviso de cookies e sem login. Páginas internas, área autenticada e
                checkout podem exigir correções que não aparecem aqui.
            </p>
        </div>
    );
};

export default PlanoDeCorrecao;
