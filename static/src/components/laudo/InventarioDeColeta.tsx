/**
 * "O que estão coletando do seu visitante" — o inventário de terceiros.
 *
 * Esta é a pergunta que o dono do site realmente tem, e que o laudo nunca
 * respondia direto: **quem está pegando dado meu, o que exatamente, e quando
 * começou.** O motor já respondia — `tags[]` traz fornecedor, campos
 * coletados, método de detecção, a URL do beacon e se a análise de
 * consentimento apontou a tag. A tela lia três desses campos e jogava o resto
 * fora.
 *
 * O agrupamento é por **fornecedor**, não por tag, porque é assim que a
 * pergunta é feita: ninguém pergunta "o que a Google Ads Conversion leva",
 * pergunta "o que o Google leva". Uma empresa com quatro tags aparece como uma
 * empresa com quatro tags, não como quatro linhas soltas.
 *
 * ── A regra que manda aqui ──────────────────────────────────────────────
 * Tudo nesta tela é rastreável até algo que a varredura observou, **e cada
 * afirmação carrega a força da prova que a sustenta.** Nenhum campo é
 * derivado, inferido ou completado com valor plausível. Onde o dado não veio,
 * a tela **diz** que não veio — inclusive quando isso deixa um espaço feio.
 * Este produto já exibiu cookie com validade inventada e um `purchase` com SKU
 * que ninguém viu; num laudo levado ao DPO, um dado plausível e falso contamina
 * a parte correta junto.
 *
 * Três distinções que esta tela é obrigada a respeitar, porque a resposta
 * mistura as três num campo só:
 *
 * 1. **`dataCollected` não é medição.** Ele vem do `VENDOR_CATALOG` do motor
 *    (`audit_engine/tag_detector.py`), fixo por fornecedor: é a descrição do
 *    que aquela tag coleta, não a leitura do que trafegou nesta visita. A tela
 *    apresenta a lista com essa procedência escrita. Anunciá-la como "o que
 *    saiu do navegador do visitante" seria o mesmo defeito do `purchase`
 *    inventado, só que com aparência de catálogo.
 * 2. **`privacyRisk` também é do catálogo**, não uma avaliação deste site.
 * 3. **`isBeforeConsent` tem duas origens de força muito diferente.**
 *    `_find_tags_before_consent` (orchestrator) marca a tag quando ela disparou
 *    de fato durante a visita — prova de rede — **ou** quando ela apenas
 *    aparece antes do CMP no HTML, **ou** quando não há CMP nenhum na página.
 *    Só o primeiro caso permite escrever "enviou dados sem consentimento". Os
 *    outros dois são apontamento da análise, e o CLAUDE.md é explícito:
 *    posição no HTML não prova bloqueio de consentimento.
 *
 * E **não se deduz o fornecedor a partir do `id` da tag.** O catálogo mora no
 * motor e essa é a única fonte. Um segundo mapa aqui divergiria do primeiro —
 * foi o que aconteceu com a tabela de preço, que chegou a existir em três
 * lugares com três valores.
 *
 * ── O que esta tela deliberadamente NÃO mostra ──────────────────────────
 * `sourceBlock` (o trecho de HTML em volta da tag) vem na resposta e fica de
 * fora: são ±3 linhas do código de outro site, que podem carregar dado do
 * visitante. A evidência conferível é a URL da requisição e o padrão que casou.
 */
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
    Radio, FileCode2, Globe, ChevronDown, ChevronRight,
    AlertTriangle, Info, Database, EyeOff,
} from 'lucide-react';

/* ────────────────────────────────────────────────────────────────────────
   Forma do dado
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Uma tag como o motor a entrega.
 *
 * Os campos vêm em camelCase pela resposta de `/api/audit` e em snake_case
 * quando a origem é `scan.raw_data` (que é `jsonable_encoder` da dataclass, e
 * ignora o `to_dict()` camelCase). Ler só um dos formatos devolve vazio em
 * silêncio — já fez o PDF sair com as colunas de risco em branco. Por isso
 * cada leitura abaixo passa por `campo()`, que aceita os dois.
 *
 * Tudo é opcional de propósito: esta tela não decide o que a varredura
 * conseguiu medir, ela relata.
 */
export interface TagObservada {
    id?: string | null;
    name?: string | null;
    vendor?: string | null;
    type?: string | null;
    confidence?: string | null;
    detectionMethod?: string | null;
    detection_method?: string | null;
    occurrenceCount?: number | null;
    occurrence_count?: number | null;
    lineNumber?: number | null;
    line_number?: number | null;
    matchedPattern?: string | null;
    matched_pattern?: string | null;
    tagId?: string | null;
    tag_id?: string | null;
    dataCollected?: string[] | null;
    data_collected?: string[] | null;
    privacyRisk?: string | null;
    privacy_risk?: string | null;
    lgpdRisk?: string | null;
    lgpd_risk?: string | null;
    isBeforeConsent?: boolean | null;
    is_before_consent?: boolean | null;
    isHardcoded?: boolean | null;
    is_hardcoded?: boolean | null;
    position?: number | null;
}

interface NotaDeQualidade {
    limitation?: string;
    reason?: string;
    affectedAreas?: string[];
}

interface Props {
    /**
     * `tags[]` da resposta de `/api/audit`.
     *
     * ATENÇÃO a quem liga esta seção: a normalização de `AuditContainer.tsx`
     * **descarta** `vendor`, `detectionMethod`, `occurrenceCount`,
     * `confidence`, `privacyRisk` e `isHardcoded` ao montar `result.tags`, e
     * ainda troca `isBeforeConsent` ausente por `false` e `lgpdRisk` ausente
     * por `'medium'`. Entregar aquela lista aqui faz o agrupamento cair inteiro
     * no balde "fornecedor não informado" e apaga a distinção entre prova de
     * rede e presença no código — que é o que sustenta os achados. Passe a
     * lista crua da resposta, ou amplie a normalização antes.
     */
    tags: TagObservada[];
    /**
     * `summary` da resposta. Só `totalTags` é usado, e por um motivo que já
     * custou caro em outras telas: **a lista `tags` é cortada pelo plano**
     * (`api/audit.py`: free recebe `[]`, pro recebe uma fração), enquanto
     * `summary.totalTags` guarda o que o motor realmente encontrou. Contar
     * pela lista faz a tela dizer "nenhuma tag encontrada" para um site com
     * seis — que é declarar conformidade sobre dado que o próprio produto
     * escondeu.
     */
    resumo?: { totalTags?: number | null } | null;
    /**
     * `showsDetail` da resposta: o plano recebe a lista item a item, ou só o
     * veredito e as contagens. É o mesmo booleano que decide o corte no
     * backend (`plano_ve_detalhe`).
     */
    mostraDetalhe?: boolean;
    /** `planLimitNotice` da resposta — a frase que explica o corte ao usuário. */
    avisoDePlano?: string | null;
    /**
     * `dataQualityNotes` da resposta: as limitações que o motor declara sobre a
     * própria varredura. Aparecem sempre que existem, não só quando a lista sai
     * vazia — uma lista de seis fornecedores também precisa dizer que coleta
     * feita pelo servidor não é observável, senão o leitor entende "estas são
     * todas as empresas que recebem dados".
     */
    notasDeQualidade?: NotaDeQualidade[];
    /**
     * `scanMethod` — `browser`, `har`, `static_fallback`, `html_fallback` ou
     * `html_source`. Muda radicalmente o que era possível observar: sem
     * navegador não há requisição de rede, e sem requisição não há prova de
     * envio.
     */
    metodoDaVarredura?: string | null;
}

/* ────────────────────────────────────────────────────────────────────────
   Leitura defensiva
   ──────────────────────────────────────────────────────────────────────── */

/** Primeiro valor que não é `null`/`undefined`. Zero e `false` passam. */
const campo = <T,>(...candidatos: Array<T | null | undefined>): T | undefined => {
    for (const v of candidatos) {
        if (v !== null && v !== undefined) return v;
    }
    return undefined;
};

/** Texto com conteúdo de verdade, ou `undefined`. String vazia não é dado. */
const texto = (v: unknown): string | undefined => {
    if (typeof v !== 'string') return undefined;
    const limpo = v.trim();
    return limpo.length > 0 ? limpo : undefined;
};

/* ────────────────────────────────────────────────────────────────────────
   Vocabulário
   ──────────────────────────────────────────────────────────────────────── */

/**
 * Método de detecção → o que ele prova.
 *
 * Esta distinção é o coração da seção, e não é sutil: **rede prova contato com
 * o fornecedor, código prova presença.** Uma tag encontrada no HTML pode nunca
 * ter disparado; uma requisição interceptada é o navegador do visitante
 * falando com o servidor do fornecedor durante a visita — e a visita aconteceu
 * sem ninguém clicar em "aceitar", porque o scanner não clica. É a evidência
 * que o cliente confere sozinho no DevTools, e a que sustenta o achado diante
 * de um DPO.
 *
 * A lista cobre os valores que o motor escreve para uma **tag**:
 * `tag_detector.py` usa `network_request`, `script_url` e `source`;
 * `models.py` declara ainda `script_pattern` e `inferred` como valores
 * possíveis do campo. `dom` e `window_global` existem como constante no código
 * mas nenhuma tag é criada com eles — descrever aqui o que eles provariam
 * seria escrever prova para detecção que não acontece. Valor fora da lista cai
 * em `metodoDesconhecido()`, que mostra o código cru em vez de inventar uma
 * explicação.
 */
const METODOS: Record<string, { titulo: string; prova: string; forte: boolean }> = {
    network_request: {
        titulo: 'Requisição capturada na rede',
        prova: 'O navegador do visitante contatou o servidor do fornecedor durante a visita — pedido HTTP interceptado, não dedução. Todo pedido leva junto o IP do visitante e o endereço da página.',
        forte: true,
    },
    script_url: {
        titulo: 'Script carregado da origem do fornecedor',
        prova: 'A página busca o arquivo no servidor do fornecedor. Prova o carregamento; o que a tag envia depois fica por conta da requisição de rede.',
        forte: true,
    },
    source: {
        titulo: 'Assinatura no código da página',
        prova: 'O trecho está no HTML entregue. Prova a presença — não prova que chegou a disparar.',
        forte: false,
    },
    script_pattern: {
        titulo: 'Padrão de código em script embutido',
        prova: 'Código do fornecedor escrito dentro da própria página. Prova a presença — não prova que chegou a disparar.',
        forte: false,
    },
    inferred: {
        titulo: 'Indício indireto',
        prova: 'A varredura não conseguiu confirmar esta tag por leitura direta. Trate como pista, não como achado.',
        forte: false,
    },
};

const metodoDesconhecido = (codigo: string) => ({
    titulo: `Método não catalogado: ${codigo}`,
    prova: 'Esta tela não conhece este código de detecção. O valor acima é o que o motor registrou, sem tradução.',
    forte: false,
});

/** Categoria da tag. Os oito valores do catálogo do motor. */
const CATEGORIAS: Record<string, string> = {
    advertising: 'Publicidade',
    analytics: 'Analytics',
    tag_manager: 'Gerenciador de tags',
    marketing: 'Marketing',
    heatmap: 'Mapa de calor / gravação de sessão',
    ab_testing: 'Teste A/B',
    consent: 'Consentimento',
    support: 'Atendimento',
};

const CONFIANCA: Record<string, string> = {
    high: 'confiança alta',
    medium: 'confiança média',
    low: 'confiança baixa',
};

/**
 * Campos coletados → português.
 *
 * O motor guarda esses rótulos em inglês no `VENDOR_CATALOG` (as linhas já em
 * português vêm da detecção em domínio próprio). Traduzir aqui é apresentação,
 * não invenção: o conjunto é fechado e vem do catálogo — este mapa cobre hoje
 * exatamente os 75 rótulos que ele contém. Rótulo que não estiver no mapa é
 * exibido **como veio** — melhor uma palavra em inglês na tela do que um chute
 * em português num documento de conformidade.
 */
const CAMPOS_COLETADOS: Record<string, string> = {
    'app events': 'Eventos do aplicativo',
    'audiences': 'Públicos',
    'auto-tracking of all events': 'Rastreio automático de todos os eventos',
    'b2b conversions': 'Conversões B2B',
    'b2b leads': 'Leads B2B',
    'browser fingerprint': 'Impressão digital do navegador',
    'browsing behaviour': 'Comportamento de navegação',
    'chat': 'Chat',
    'chat conversations': 'Conversas de chat',
    'chat history': 'Histórico de chat',
    'chat messages': 'Mensagens de chat',
    'click maps': 'Mapas de clique',
    'click recordings': 'Gravações de clique',
    'cohorts': 'Coortes',
    'company identification (ip)': 'Identificação da empresa (por IP)',
    'consent preferences': 'Preferências de consentimento',
    'console logs': 'Logs do console',
    'conversion events': 'Eventos de conversão',
    'conversion forms': 'Formulários de conversão',
    'conversions': 'Conversões',
    'cross-site remarketing': 'Remarketing entre sites',
    'custom audiences': 'Públicos personalizados',
    'custom events': 'Eventos personalizados',
    'demographics': 'Dados demográficos',
    'e-commerce data': 'Dados de e-commerce',
    'email': 'E-mail',
    'email tracking': 'Rastreio de e-mail',
    'event data': 'Dados de eventos',
    'events': 'Eventos',
    'experiments': 'Experimentos',
    'form data': 'Dados de formulário',
    'forms': 'Formulários',
    'funnels': 'Funis',
    'geographic location': 'Localização geográfica',
    'heatmaps': 'Mapas de calor',
    'high-fidelity session recordings': 'Gravações de sessão em alta fidelidade',
    'ip address': 'Endereço IP',
    'interest audiences': 'Públicos por interesse',
    'keystrokes': 'Teclas digitadas',
    'lead identification': 'Identificação de leads',
    'leads': 'Leads',
    'mouse movement': 'Movimento do mouse',
    'navigation behaviour': 'Comportamento de navegação',
    'navigation data': 'Dados de navegação',
    'navigation properties': 'Propriedades de navegação',
    'pageviews': 'Visualizações de página',
    'persistent cookies': 'Cookies persistentes',
    'product events': 'Eventos de produto',
    'products viewed': 'Produtos visualizados',
    'professional remarketing': 'Remarketing profissional',
    'props': 'Props (variáveis do Adobe)',
    'purchase behaviour': 'Comportamento de compra',
    'purchase behaviour tracking': 'Rastreio do comportamento de compra',
    'push notifications': 'Notificações push',
    'remarketing': 'Remarketing',
    'remarketing data': 'Dados de remarketing',
    'retargeting': 'Retargeting',
    'scoring': 'Pontuação de lead (scoring)',
    'screen recording': 'Gravação de tela',
    'scroll depth': 'Profundidade de rolagem',
    'session recordings': 'Gravações de sessão',
    'sessions': 'Sessões',
    'snapchat audiences': 'Públicos do Snapchat',
    'support tickets': 'Tickets de suporte',
    'tailored audiences': 'Públicos personalizados (Tailored Audiences)',
    'test variations': 'Variações de teste',
    'user attributes': 'Atributos do usuário',
    'user behaviour': 'Comportamento do usuário',
    'user identity': 'Identidade do usuário',
    'user interactions': 'Interações do usuário',
    'user journey': 'Jornada do usuário',
    'user name': 'Nome do usuário',
    'user profile': 'Perfil do usuário',
    'visitor id': 'Identificador do visitante',
    'evars': 'eVars (variáveis do Adobe)',
};

const traduzirCampo = (bruto: string): string =>
    CAMPOS_COLETADOS[bruto.trim().toLowerCase()] || bruto.trim();

/* ────────────────────────────────────────────────────────────────────────
   Gravidade
   ──────────────────────────────────────────────────────────────────────── */

const ORDEM_DE_RISCO: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, none: 4 };

const corDoRisco = (nivel?: string) =>
    nivel === 'critical' ? 'var(--laudo-critico)'
        : nivel === 'high' ? 'var(--laudo-alto)'
            : nivel === 'medium' ? 'var(--laudo-medio)'
                : nivel === 'low' ? 'var(--laudo-baixo)'
                    : nivel === 'none' ? 'var(--laudo-conforme)'
                        : 'var(--laudo-texto-fraco)';

const rotuloDoRisco = (nivel?: string) =>
    nivel === 'critical' ? 'Risco crítico'
        : nivel === 'high' ? 'Risco alto'
            : nivel === 'medium' ? 'Risco médio'
                : nivel === 'low' ? 'Risco baixo'
                    : nivel === 'none' ? 'Sem risco de privacidade'
                        : 'Risco não classificado';

/* O selo de risco precisa dizer de onde o rótulo vem. O valor é fixo por
   fornecedor no `VENDOR_CATALOG` — é a classificação daquele tipo de tag, e não
   uma medição deste site. Sem essa frase, um "Risco crítico" ao lado de uma
   evidência de rede lê como veredito da varredura. */
const PROCEDENCIA_DO_RISCO =
    'Classificação do fornecedor no catálogo do motor, fixa por tipo de tag. Não é uma medição deste site.';

/* ────────────────────────────────────────────────────────────────────────
   Leitura de uma tag
   ──────────────────────────────────────────────────────────────────────── */

/** O que a tela precisa de uma tag, já lido nos dois formatos de chave. */
interface TagLida {
    chave: string;
    nome?: string;
    fornecedor?: string;
    categoria?: string;
    confianca?: string;
    metodo?: string;
    ocorrencias?: number;
    linha?: number;
    evidencia?: string;
    identificador?: string;
    campos: string[];
    risco?: string;
    antesDoConsentimento?: boolean;
    noCodigoDaPagina?: boolean;
}

/** Fornecedor ausente tem um balde próprio, nomeado — não um nome inventado. */
const SEM_FORNECEDOR = '__sem_fornecedor__';

/**
 * A tag foi vista falando com o fornecedor durante a visita.
 *
 * É o único caso em que a tela pode escrever "enviou dados sem consentimento":
 * existe requisição HTTP capturada. Sem isso, `isBeforeConsent` continua sendo
 * um apontamento legítimo da análise — mas de outra força.
 */
const temProvaDeRede = (tag: TagLida) => tag.metodo === 'network_request';

const lerTag = (t: TagObservada, indice: number): TagLida => {
    const camposBrutos = campo<string[]>(t.dataCollected, t.data_collected) || [];

    /* `privacyRisk` primeiro: é o campo que o motor preenche por tag. O
       `lgpdRisk` é o mesmo valor na resposta de hoje, e serve de reserva para
       quem entregar só ele. Ausentes, o risco fica `undefined` e a tela diz
       "não classificado" — em vez do `'medium'` que a normalização assume, que
       é um palpite com cara de medição. */
    const risco = texto(campo(t.privacyRisk, t.privacy_risk, t.lgpdRisk, t.lgpd_risk));

    /* Linha 0 não existe: a numeração do motor é 1-based e a normalização
       converte `null` em `0`. Tratar 0 como ausente evita a tela afirmar
       "linha 0 do HTML", que não é lugar nenhum. */
    const linhaBruta = campo<number>(t.lineNumber, t.line_number);
    const linha = typeof linhaBruta === 'number' && linhaBruta > 0 ? linhaBruta : undefined;

    const ocorrenciasBrutas = campo<number>(t.occurrenceCount, t.occurrence_count);
    const antes = campo(t.isBeforeConsent, t.is_before_consent);
    const noCodigo = campo(t.isHardcoded, t.is_hardcoded);

    return {
        chave: `${texto(t.id) || 'tag'}-${indice}`,
        nome: texto(t.name),
        fornecedor: texto(t.vendor),
        categoria: texto(t.type),
        confianca: texto(t.confidence),
        metodo: texto(campo(t.detectionMethod, t.detection_method)),
        ocorrencias: typeof ocorrenciasBrutas === 'number' && ocorrenciasBrutas > 0
            ? ocorrenciasBrutas
            : undefined,
        linha,
        evidencia: texto(campo(t.matchedPattern, t.matched_pattern)),
        identificador: texto(campo(t.tagId, t.tag_id)),
        campos: Array.isArray(camposBrutos)
            ? camposBrutos.filter(c => typeof c === 'string' && c.trim().length > 0)
            : [],
        risco,
        /* Booleano só quando é booleano. `undefined` significa "a varredura não
           registrou", e a tela diz isso — não "não". O laudo já respondeu "Não"
           para todo site porque um campo que nunca era escrito ficava `False`. */
        antesDoConsentimento: typeof antes === 'boolean' ? antes : undefined,
        noCodigoDaPagina: typeof noCodigo === 'boolean' ? noCodigo : undefined,
    };
};

/* ────────────────────────────────────────────────────────────────────────
   Pedaços da tela
   ──────────────────────────────────────────────────────────────────────── */

/** Etiqueta pequena com fundo translúcido da própria cor. */
const Selo = ({ cor, children, titulo }: {
    cor: string;
    children: React.ReactNode;
    titulo?: string;
}) => (
    <span
        title={titulo}
        className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium leading-5"
        style={{
            color: cor,
            borderColor: `color-mix(in srgb, ${cor} 45%, transparent)`,
            background: `color-mix(in srgb, ${cor} 12%, transparent)`,
        }}
    >
        {children}
    </span>
);

/** Frase de ausência. Some do fluxo visual, mas está escrita. */
const NaoMedido = ({ children }: { children: React.ReactNode }) => (
    <p className="flex items-start gap-1.5 text-[12px] italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
        <Info className="mt-[3px] h-3 w-3 shrink-0" />
        <span>{children}</span>
    </p>
);

/**
 * A evidência crua: a URL da requisição, o trecho que casou no código ou a
 * frase que o motor montou para a detecção em domínio próprio.
 *
 * Fica em voz de evidência (mono) porque é para conferir caractere por
 * caractere no DevTools, não para ler. Vem truncada porque uma URL de beacon
 * ocupa a largura inteira do cartão e afoga o resto da linha.
 *
 * O motor guarda esse campo cortado na origem — 80 caracteres no caminho comum
 * (`req.url[:80]`, `m.group(0)[:80]`), 200 quando concatena uma observação —
 * então o texto expandido é **o que ficou registrado**, não necessariamente o
 * valor inteiro. A tela diz isso em vez de apresentar um trecho cortado como se
 * fosse completo.
 */
const Evidencia = ({ valor }: { valor: string }) => {
    const [inteira, setInteira] = useState(false);

    /* O motor às vezes anexa uma observação à evidência, separada por " | "
       (ex.: "…gtag/js?id=G-XXXX | first-party: stats.g.doubleclick.net"). São
       fatos distintos; empilhados leem melhor do que numa linha só. */
    const partes = valor.split(' | ').map(p => p.trim()).filter(Boolean);
    const longa = valor.length > 78;

    return (
        <div
            className="rounded-md border px-3 py-2"
            style={{ borderColor: 'var(--sup-borda)', background: 'var(--sup-2)' }}
        >
            <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="t-etiqueta">Evidência registrada</span>
                {longa && (
                    <button
                        type="button"
                        onClick={() => setInteira(v => !v)}
                        className="shrink-0 text-[11px] underline underline-offset-2"
                        style={{ color: 'var(--laudo-carimbo)' }}
                    >
                        {inteira ? 'recolher' : 'ver inteira'}
                    </button>
                )}
            </div>

            {partes.map((parte, i) => (
                <p
                    key={i}
                    className={`voz-evidencia text-[11.5px] leading-relaxed ${inteira ? 'break-all' : 'truncate'}`}
                    style={{ color: 'var(--laudo-texto-suave)' }}
                    title={parte}
                >
                    {parte}
                </p>
            ))}

            {inteira && (
                <p className="mt-2 text-[11px] italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Valor como o motor o registrou. A varredura guarda apenas os primeiros
                    caracteres do que casou, então este trecho pode ser menor que o original.
                </p>
            )}
        </div>
    );
};

/* ────────────────────────────────────────────────────────────────────────
   Uma tag
   ──────────────────────────────────────────────────────────────────────── */

const LinhaDaTag = ({ tag }: { tag: TagLida }) => {
    const [aberta, setAberta] = useState(false);

    const metodo = tag.metodo
        ? (METODOS[tag.metodo] || metodoDesconhecido(tag.metodo))
        : undefined;

    const IconeDoMetodo = tag.metodo === 'network_request' ? Radio
        : tag.metodo === 'script_url' ? Globe
            : FileCode2;

    const cor = corDoRisco(tag.risco);
    const disparouSemAceite = tag.antesDoConsentimento === true && temProvaDeRede(tag);
    const apontadaSemAceite = tag.antesDoConsentimento === true && !temProvaDeRede(tag);

    return (
        <div
            className="rounded-lg border"
            style={{ borderColor: 'var(--sup-borda)', background: 'var(--sup-1)' }}
        >
            {/* Cabeçalho clicável: o essencial cabe aqui; o detalhe abre. */}
            <button
                type="button"
                onClick={() => setAberta(v => !v)}
                className="flex w-full items-start gap-3 px-4 py-3 text-left"
            >
                {aberta
                    ? <ChevronDown className="mt-1 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    : <ChevronRight className="mt-1 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}

                <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                            {tag.nome || 'Tag sem nome na resposta'}
                        </span>
                        {tag.categoria && (
                            <span className="text-[12px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                · {CATEGORIAS[tag.categoria] || tag.categoria}
                            </span>
                        )}
                    </span>

                    <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Selo cor={cor} titulo={PROCEDENCIA_DO_RISCO}>{rotuloDoRisco(tag.risco)}</Selo>

                        {/* Duas marcas diferentes para o mesmo campo, porque a prova
                            por trás dele é diferente. Ver o cabeçalho do arquivo. */}
                        {disparouSemAceite && (
                            <Selo
                                cor="var(--laudo-critico)"
                                titulo="Requisição capturada durante a visita. O scanner nunca clica em 'aceitar', então nada do que ele observou teve consentimento."
                            >
                                <AlertTriangle className="h-3 w-3" />
                                Contatou o fornecedor sem consentimento
                            </Selo>
                        )}
                        {apontadaSemAceite && (
                            <Selo
                                cor="var(--laudo-alto)"
                                titulo="A análise de consentimento apontou esta tag — por não haver CMP na página, ou por ela ser declarada antes do banner. Esta varredura não capturou requisição que prove o disparo."
                            >
                                <AlertTriangle className="h-3 w-3" />
                                Apontada pela análise de consentimento
                            </Selo>
                        )}

                        {metodo?.forte && (
                            <Selo cor="var(--laudo-carimbo)" titulo={metodo.prova}>
                                <IconeDoMetodo className="h-3 w-3" />
                                {metodo.titulo}
                            </Selo>
                        )}
                    </span>
                </span>
            </button>

            {aberta && (
                <div
                    className="space-y-4 border-t px-4 py-4"
                    style={{ borderColor: 'var(--sup-borda)' }}
                >
                    {/* ── O que o catálogo diz que ela coleta ───────────── */}
                    <div>
                        <p className="t-etiqueta mb-2">O que esta tag coleta, segundo o catálogo</p>
                        {tag.campos.length > 0 ? (
                            <>
                                <div className="flex flex-wrap gap-1.5">
                                    {tag.campos.map((c, i) => (
                                        <span
                                            key={i}
                                            className="rounded border px-2 py-0.5 text-[12px]"
                                            style={{
                                                borderColor: 'var(--sup-borda)',
                                                background: 'var(--sup-2)',
                                                color: 'var(--laudo-texto-suave)',
                                            }}
                                        >
                                            {traduzirCampo(c)}
                                        </span>
                                    ))}
                                </div>
                                <p className="mt-1.5 text-[11.5px] italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    Descrição do produto do fornecedor, fixa no catálogo do motor.
                                    A varredura provou a presença desta tag; o conteúdo de cada
                                    envio não é lido.
                                </p>
                            </>
                        ) : (
                            <NaoMedido>
                                O catálogo do motor não descreve a coleta desta tag, e a varredura
                                não lê o conteúdo dos envios. Não há o que listar aqui.
                            </NaoMedido>
                        )}
                    </div>

                    {/* ── Como foi detectada ────────────────────────────── */}
                    <div>
                        <p className="t-etiqueta mb-2">Como foi detectada</p>
                        {metodo ? (
                            <div className="flex items-start gap-2">
                                <IconeDoMetodo
                                    className="mt-[3px] h-3.5 w-3.5 shrink-0"
                                    style={{ color: metodo.forte ? 'var(--laudo-carimbo)' : 'var(--laudo-texto-fraco)' }}
                                />
                                <div className="min-w-0">
                                    <p className="text-[13px] font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                        {metodo.titulo}
                                        {tag.confianca && (
                                            <span className="font-normal" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                {' '}— {CONFIANCA[tag.confianca] || `confiança ${tag.confianca}`}
                                            </span>
                                        )}
                                    </p>
                                    <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        {metodo.prova}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <NaoMedido>
                                A resposta não trouxe o método de detecção desta tag. Sem ele
                                não dá para dizer se a prova é de contato com o fornecedor
                                (rede) ou de presença (código).
                            </NaoMedido>
                        )}
                    </div>

                    {/* ── Evidência ─────────────────────────────────────── */}
                    {tag.evidencia ? (
                        <Evidencia valor={tag.evidencia} />
                    ) : (
                        <NaoMedido>
                            Sem trecho de evidência registrado para esta tag.
                        </NaoMedido>
                    )}

                    {/* ── Ficha ─────────────────────────────────────────── */}
                    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        <Ficha rotulo="Identificador da conta">
                            {tag.identificador
                                ? <span className="voz-evidencia">{tag.identificador}</span>
                                /* "não exposto na página" seria uma afirmação sobre a
                                   página; o que se sabe é que a varredura não capturou. */
                                : <Ausente>não capturado nesta varredura</Ausente>}
                        </Ficha>

                        <Ficha rotulo="Instalações detectadas">
                            {tag.ocorrencias !== undefined
                                ? <span className="tabular-nums">{tag.ocorrencias}</span>
                                : <Ausente>não contabilizado</Ausente>}
                        </Ficha>

                        <Ficha rotulo="Linha no HTML">
                            {tag.linha !== undefined
                                ? <span className="voz-evidencia tabular-nums">{tag.linha}</span>
                                /* Tag detectada só pela rede não tem linha — mas o campo
                                   também vem vazio por outras razões. Declarar "fora do
                                   HTML" seria escolher uma delas sem prova. */
                                : <Ausente>não registrada</Ausente>}
                        </Ficha>

                        <Ficha rotulo="Análise de consentimento">
                            {disparouSemAceite
                                ? <span style={{ color: 'var(--laudo-critico)' }}>
                                    requisição capturada durante a visita, sem nenhum aceite
                                </span>
                                : apontadaSemAceite
                                    ? <span style={{ color: 'var(--laudo-alto)' }}>
                                        apontada — sem requisição capturada que prove o disparo
                                    </span>
                                    : tag.antesDoConsentimento === false
                                        /* `false` NÃO quer dizer "disparou depois do aceite":
                                           a análise só avalia analytics, publicidade, mapa de
                                           calor e marketing, e as demais categorias saem daqui
                                           com `false` sem terem sido olhadas. A frase diz o que
                                           o campo garante, e nada além. */
                                        ? <span>não apontada pela análise de consentimento</span>
                                        : <Ausente>não registrado nesta varredura</Ausente>}
                        </Ficha>

                        {/* Só aparece quando é booleano de verdade. O campo vem
                            nulo na maioria das varreduras, e "não" seria uma
                            afirmação que ninguém mediu. */}
                        {tag.noCodigoDaPagina !== undefined && (
                            <Ficha rotulo="Origem da tag">
                                {tag.noCodigoDaPagina
                                    ? 'escrita direto no código da página'
                                    : 'injetada por gerenciador de tags'}
                            </Ficha>
                        )}
                    </dl>
                </div>
            )}
        </div>
    );
};

const Ficha = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
    <div className="min-w-0">
        <dt className="t-etiqueta">{rotulo}</dt>
        <dd className="mt-0.5 break-words text-[12.5px]" style={{ color: 'var(--laudo-texto)' }}>
            {children}
        </dd>
    </div>
);

const Ausente = ({ children }: { children: React.ReactNode }) => (
    <span className="italic" style={{ color: 'var(--laudo-texto-fraco)' }}>{children}</span>
);

/* ────────────────────────────────────────────────────────────────────────
   Um fornecedor
   ──────────────────────────────────────────────────────────────────────── */

interface GrupoDeFornecedor {
    fornecedor: string;
    tags: TagLida[];
    piorRisco?: string;
    camposDoFornecedor: string[];
    /** Tags com `isBeforeConsent` e requisição capturada: prova de contato. */
    quantasContataram: number;
    /** Tags com `isBeforeConsent` sem prova de rede: apontamento da análise. */
    quantasApontadas: number;
    temProvaDeRede: boolean;
}

const BlocoDoFornecedor = ({ grupo }: { grupo: GrupoDeFornecedor }) => {
    const anonimo = grupo.fornecedor === SEM_FORNECEDOR;
    const cor = corDoRisco(grupo.piorRisco);

    return (
        <Card
            className="overflow-hidden border-l-[3px]"
            style={{
                borderColor: 'var(--laudo-linha)',
                borderLeftColor: cor,
                background: 'var(--laudo-superficie)',
            }}
        >
            <CardContent className="space-y-4 p-5">

                {/* Quem */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h4 className="t-secao" style={{ color: 'var(--laudo-texto)' }}>
                        {anonimo ? 'Fornecedor não informado na resposta' : grupo.fornecedor}
                    </h4>
                    <span className="text-[12px] tabular-nums" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        {grupo.tags.length} {grupo.tags.length === 1 ? 'tag' : 'tags'}
                    </span>
                </div>

                {anonimo && (
                    <NaoMedido>
                        Estas tags chegaram sem o campo <span className="voz-evidencia">vendor</span>.
                        O nome da empresa por trás delas existe no catálogo do motor, mas não veio
                        nesta resposta — e esta tela não o deduz a partir do identificador da tag,
                        para não criar uma segunda fonte de verdade que possa divergir da primeira.
                    </NaoMedido>
                )}

                {/* O que o catálogo diz que este fornecedor coleta */}
                <div>
                    <p className="t-etiqueta mb-2">
                        {anonimo
                            ? 'O que estas tags coletam, segundo o catálogo'
                            : `O que as tags de ${grupo.fornecedor} coletam, segundo o catálogo`}
                    </p>
                    {grupo.camposDoFornecedor.length > 0 ? (
                        <>
                            <div className="flex flex-wrap gap-1.5">
                                {grupo.camposDoFornecedor.map((c, i) => (
                                    <span
                                        key={i}
                                        className="rounded-md border px-2.5 py-1 text-[12.5px]"
                                        style={{
                                            borderColor: `color-mix(in srgb, ${cor} 32%, var(--sup-borda))`,
                                            background: `color-mix(in srgb, ${cor} 9%, transparent)`,
                                            color: 'var(--laudo-texto)',
                                        }}
                                    >
                                        {traduzirCampo(c)}
                                    </span>
                                ))}
                            </div>
                            {/* Sem esta linha, a lista lê como leitura do tráfego —
                                que é exatamente o defeito do `purchase` inventado. */}
                            <p className="mt-2 text-[11.5px] italic" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                Esta lista descreve o produto de rastreamento, e vem fixa do
                                catálogo do motor. O que a varredura observou está em cada tag
                                abaixo: como foi detectada e a evidência registrada. O conteúdo
                                de cada envio não é lido por esta auditoria.
                            </p>
                        </>
                    ) : (
                        <NaoMedido>
                            O catálogo do motor não descreve a coleta das tags deste fornecedor.
                            A presença está registrada; a descrição da coleta, não.
                        </NaoMedido>
                    )}
                </div>

                {/* Os fatos que mudam a conversa com o DPO — cada um com sua força */}
                <div className="flex flex-wrap gap-1.5">
                    {grupo.quantasContataram > 0 && (
                        <Selo cor="var(--laudo-critico)" titulo="Requisição HTTP capturada durante a visita, e o scanner nunca clica em 'aceitar'.">
                            <AlertTriangle className="h-3 w-3" />
                            {grupo.quantasContataram === 1
                                ? '1 tag contatou o fornecedor sem consentimento'
                                : `${grupo.quantasContataram} tags contataram o fornecedor sem consentimento`}
                        </Selo>
                    )}
                    {grupo.quantasApontadas > 0 && (
                        <Selo cor="var(--laudo-alto)" titulo="Apontadas pela análise de consentimento — sem requisição capturada que prove o disparo.">
                            {grupo.quantasApontadas === 1
                                ? '1 tag apontada pela análise de consentimento'
                                : `${grupo.quantasApontadas} tags apontadas pela análise de consentimento`}
                        </Selo>
                    )}
                    {grupo.temProvaDeRede && (
                        <Selo cor="var(--laudo-carimbo)" titulo="Requisição HTTP capturada durante a visita.">
                            <Radio className="h-3 w-3" />
                            Contato observado na rede
                        </Selo>
                    )}
                </div>

                {/* As tags */}
                <div className="space-y-2 pt-1">
                    {grupo.tags.map(tag => <LinhaDaTag key={tag.chave} tag={tag} />)}
                </div>
            </CardContent>
        </Card>
    );
};

/* ────────────────────────────────────────────────────────────────────────
   Limitações declaradas
   ──────────────────────────────────────────────────────────────────────── */

/**
 * `dataQualityNotes` — o que a própria varredura declara não alcançar.
 *
 * Aparece com lista cheia e com lista vazia. Com lista cheia é ainda mais
 * necessário: seis fornecedores listados sem esta ressalva leem como "estas são
 * todas as empresas que recebem dados do meu site", e coleta feita pelo
 * servidor não aparece em varredura nenhuma que rode no navegador.
 */
const LimitesDaVarredura = ({ notas }: { notas: NotaDeQualidade[] }) => {
    const [aberto, setAberto] = useState(false);

    if (notas.length === 0) return null;

    return (
        <div
            className="rounded-lg border"
            style={{ borderColor: 'var(--sup-borda)', background: 'var(--sup-2)' }}
        >
            <button
                type="button"
                onClick={() => setAberto(v => !v)}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
                <EyeOff className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                <span className="flex-1 text-[12.5px] font-medium" style={{ color: 'var(--laudo-texto-suave)' }}>
                    O que esta varredura não alcança ({notas.length})
                </span>
                {aberto
                    ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}
            </button>

            {aberto && (
                <ul className="space-y-2.5 border-t px-4 py-3" style={{ borderColor: 'var(--sup-borda)' }}>
                    {notas.map((nota, i) => (
                        <li key={i} className="border-l-2 pl-3" style={{ borderColor: 'var(--laudo-linha)' }}>
                            <p className="text-[12.5px] font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                {nota.limitation || 'Limitação sem título na resposta'}
                            </p>
                            {nota.reason && (
                                <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {nota.reason}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

/* ────────────────────────────────────────────────────────────────────────
   A seção
   ──────────────────────────────────────────────────────────────────────── */

const METODO_DE_VARREDURA: Record<string, string> = {
    browser: 'A página foi aberta em um navegador real e a rede foi observada até se acomodar. É a coleta que enxerga requisição, cookie e storage.',
    har: 'A leitura veio de um HAR gravado no DevTools. As requisições são reais; o que não foi percorrido durante a gravação não aparece.',
    static_fallback: 'O navegador não subiu e a leitura caiu para o HTML servido. Sem rede observada: só a presença no código pode ser provada aqui.',
    html_fallback: 'O navegador não subiu e a leitura caiu para o HTML servido. Sem rede observada: só a presença no código pode ser provada aqui.',
    html_source: 'A leitura foi do HTML servido, sem execução de JavaScript. Tag injetada por gerenciador de tags não aparece nesta forma de coleta.',
};

const InventarioDeColeta = ({
    tags,
    resumo,
    mostraDetalhe,
    avisoDePlano,
    notasDeQualidade = [],
    metodoDaVarredura,
}: Props) => {
    const lidas = (Array.isArray(tags) ? tags : []).map(lerTag);
    const notas = Array.isArray(notasDeQualidade) ? notasDeQualidade : [];

    /* O total do motor, quando veio. A lista é cortada pelo plano; este número
       não é. Sem ele a tela não consegue distinguir "não achamos nada" de
       "achamos e o plano escondeu" — e a primeira frase, dita no lugar da
       segunda, é um atestado de conformidade falso. */
    const totalDoMotor = typeof resumo?.totalTags === 'number' && resumo.totalTags >= 0
        ? resumo.totalTags
        : undefined;
    const ocultas = totalDoMotor !== undefined ? Math.max(0, totalDoMotor - lidas.length) : 0;

    /* ── Agrupamento por fornecedor ──────────────────────────────────────
       O cliente pensa em empresas, não em tags: "o Google leva X, a Meta leva
       Y". Uma lista plana de seis tags esconde que quatro delas são da mesma
       empresa — que é exatamente o fato que ele precisa levar ao contrato de
       operador. */
    const porFornecedor = new Map<string, TagLida[]>();
    for (const tag of lidas) {
        const chave = tag.fornecedor || SEM_FORNECEDOR;
        const lista = porFornecedor.get(chave) || [];
        lista.push(tag);
        porFornecedor.set(chave, lista);
    }

    const grupos: GrupoDeFornecedor[] = [...porFornecedor.entries()].map(([fornecedor, doFornecedor]) => {
        /* União dos campos, sem repetir. Duas tags do Google que ambas levam
           "Conversions" continuam sendo uma coleta de conversões. A comparação
           é sobre o rótulo traduzido para não listar "Remarketing" duas vezes
           quando o catálogo escreveu grafias diferentes. */
        const vistos = new Map<string, string>();
        for (const tag of doFornecedor) {
            for (const c of tag.campos) {
                const traduzido = traduzirCampo(c);
                if (!vistos.has(traduzido.toLowerCase())) vistos.set(traduzido.toLowerCase(), c);
            }
        }

        const ordenadas = [...doFornecedor].sort((a, b) => {
            const risco = (ORDEM_DE_RISCO[a.risco || ''] ?? 5) - (ORDEM_DE_RISCO[b.risco || ''] ?? 5);
            if (risco !== 0) return risco;
            /* Empate no risco: quem tem prova de contato sem aceite vem
               primeiro. É o que o leitor precisa corrigir hoje. */
            const contato = Number(b.antesDoConsentimento === true && temProvaDeRede(b))
                - Number(a.antesDoConsentimento === true && temProvaDeRede(a));
            if (contato !== 0) return contato;
            const apontada = Number(b.antesDoConsentimento === true) - Number(a.antesDoConsentimento === true);
            if (apontada !== 0) return apontada;
            return (b.ocorrencias || 0) - (a.ocorrencias || 0);
        });

        return {
            fornecedor,
            tags: ordenadas,
            piorRisco: ordenadas.find(t => t.risco)?.risco,
            camposDoFornecedor: [...vistos.values()],
            quantasContataram: doFornecedor.filter(t => t.antesDoConsentimento === true && temProvaDeRede(t)).length,
            quantasApontadas: doFornecedor.filter(t => t.antesDoConsentimento === true && !temProvaDeRede(t)).length,
            temProvaDeRede: doFornecedor.some(temProvaDeRede),
        };
    });

    grupos.sort((a, b) => {
        /* O balde sem fornecedor vai para o fim: é lacuna de dado, não achado,
           e não deve encabeçar a leitura. */
        if ((a.fornecedor === SEM_FORNECEDOR) !== (b.fornecedor === SEM_FORNECEDOR)) {
            return a.fornecedor === SEM_FORNECEDOR ? 1 : -1;
        }
        const risco = (ORDEM_DE_RISCO[a.piorRisco || ''] ?? 5) - (ORDEM_DE_RISCO[b.piorRisco || ''] ?? 5);
        if (risco !== 0) return risco;
        if (b.quantasContataram !== a.quantasContataram) {
            return b.quantasContataram - a.quantasContataram;
        }
        return b.tags.length - a.tags.length;
    });

    /* ── Os números do resumo ────────────────────────────────────────────
       Contagem só sobre tag que trouxe o campo. Quando NENHUMA trouxe, o
       número vira "não informado": exibir "0 contataram sem consentimento"
       sobre um campo que não veio é o escudo verde sobre dado ausente — a tela
       afirmaria conformidade que ninguém mediu. */
    const comMetodo = lidas.filter(t => t.metodo !== undefined).length;
    const comContato = lidas.filter(temProvaDeRede).length;
    const comCampoDeConsentimento = lidas.filter(t => t.antesDoConsentimento !== undefined).length;
    const contataramSemAceite = lidas.filter(t => t.antesDoConsentimento === true && temProvaDeRede(t)).length;
    const apontadasSemAceite = lidas.filter(t => t.antesDoConsentimento === true && !temProvaDeRede(t)).length;

    /* Fornecedor não informado não é um fornecedor: contá-lo inflaria o número
       que o cliente leva ao contrato de operador. */
    const fornecedoresIdentificados = grupos.filter(g => g.fornecedor !== SEM_FORNECEDOR).length;
    const temBaldeAnonimo = grupos.some(g => g.fornecedor === SEM_FORNECEDOR);

    const explicacaoDoMetodo = metodoDaVarredura ? METODO_DE_VARREDURA[metodoDaVarredura] : undefined;

    return (
        <section className="space-y-5">

            {/* ── Cabeçalho ──────────────────────────────────────────────── */}
            <div>
                <h3 className="t-titulo flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                    <Database className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                    O que estão coletando do seu visitante
                </h3>
                <p className="t-apoio mt-1.5 max-w-3xl">
                    Cada empresa abaixo foi encontrada no seu site por esta varredura — no
                    código entregue, no script carregado ou numa requisição capturada durante
                    a visita. Para cada tag: como ela foi detectada, a evidência registrada, e
                    o que o catálogo do motor diz que aquele produto de rastreamento coleta. O
                    que a varredura não mediu está escrito como não medido.
                </p>
            </div>

            {/* ── Resumo do que foi observado ────────────────────────────── */}
            {lidas.length > 0 && (
                <div
                    className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-3"
                    style={{ borderColor: 'var(--sup-borda)', background: 'var(--sup-2)' }}
                >
                    <Numero
                        valor={fornecedoresIdentificados}
                        rotulo={fornecedoresIdentificados === 1 ? 'fornecedor identificado' : 'fornecedores identificados'}
                    />
                    <Numero
                        valor={ocultas > 0 ? `${lidas.length} de ${totalDoMotor}` : lidas.length}
                        rotulo={ocultas > 0 ? 'tags nesta lista' : (lidas.length === 1 ? 'tag' : 'tags')}
                    />
                    <Numero
                        valor={comMetodo > 0 ? comContato : 'n/d'}
                        rotulo={comMetodo > 0
                            ? 'com requisição capturada'
                            : 'método de detecção não informado'}
                        cor={comMetodo > 0 ? 'var(--laudo-carimbo)' : undefined}
                    />
                    <Numero
                        valor={comCampoDeConsentimento > 0 ? contataramSemAceite : 'n/d'}
                        rotulo={comCampoDeConsentimento === 0
                            ? 'consentimento não avaliado nesta resposta'
                            : contataramSemAceite === 1
                                ? 'contatou o fornecedor sem consentimento'
                                : 'contataram o fornecedor sem consentimento'}
                        cor={contataramSemAceite > 0 ? 'var(--laudo-critico)' : undefined}
                    />
                    {apontadasSemAceite > 0 && (
                        <Numero
                            valor={apontadasSemAceite}
                            rotulo={apontadasSemAceite === 1
                                ? 'apontada sem prova de disparo'
                                : 'apontadas sem prova de disparo'}
                            cor="var(--laudo-alto)"
                        />
                    )}
                </div>
            )}

            {/* Lista cortada pelo plano: dizer, e dizer o tamanho do corte. */}
            {lidas.length > 0 && ocultas > 0 && (
                <NaoMedido>
                    O motor identificou {totalDoMotor} tags e esta resposta traz {lidas.length}.
                    {' '}{ocultas === 1 ? '1 tag ficou' : `${ocultas} tags ficaram`} fora da lista
                    por limite de plano — as contagens acima valem só para o que está listado.
                    {avisoDePlano ? ` ${avisoDePlano}` : ''}
                </NaoMedido>
            )}

            {/* ── Como a página foi lida ─────────────────────────────────── */}
            {metodoDaVarredura ? (
                <p className="t-apoio flex items-start gap-2 text-[12px]">
                    <Info className="mt-[3px] h-3.5 w-3.5 shrink-0" />
                    <span>
                        <span className="voz-evidencia">{metodoDaVarredura}</span>
                        {explicacaoDoMetodo
                            ? <> — {explicacaoDoMetodo}</>
                            : <> — esta tela não conhece este método de coleta; o código acima é o
                                que o motor registrou.</>}
                    </span>
                </p>
            ) : (
                <NaoMedido>
                    A resposta não trouxe o método da varredura. Sem ele não dá para dizer o que
                    esta coleta conseguiu enxergar — com navegador há requisição de rede, sem
                    navegador só existe o HTML entregue.
                </NaoMedido>
            )}

            {/* ── Os fornecedores, ou a ausência deles ───────────────────── */}
            {grupos.length > 0 ? (
                <div className="space-y-4">
                    {grupos.map(grupo => (
                        <BlocoDoFornecedor key={grupo.fornecedor} grupo={grupo} />
                    ))}
                    {temBaldeAnonimo && (
                        <NaoMedido>
                            O bloco sem fornecedor não entra na contagem de empresas acima: sem o
                            nome, não dá para dizer quantas empresas distintas ele representa.
                        </NaoMedido>
                    )}
                </div>
            ) : (
                <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardContent className="space-y-3 p-5">
                        {/* Três situações diferentes, e a distinção entre elas é a
                            diferença entre um laudo e um atestado falso:
                            (a) o motor achou tags e o plano escondeu a lista;
                            (b) o motor não achou nenhuma;
                            (c) a resposta não disse quantas achou. */}
                        {totalDoMotor !== undefined && totalDoMotor > 0 ? (
                            <>
                                <p className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                    {totalDoMotor === 1
                                        ? 'A varredura identificou 1 tag de terceiro — a lista não está neste plano'
                                        : `A varredura identificou ${totalDoMotor} tags de terceiro — a lista não está neste plano`}
                                </p>
                                <p className="t-corpo text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {avisoDePlano
                                        || 'O detalhe de cada tag — fornecedor, evidência registrada e método de detecção — fica disponível no plano que abre os achados.'}
                                </p>
                            </>
                        ) : totalDoMotor === 0 ? (
                            <>
                                <p className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                    Nenhuma tag de terceiro foi identificada nesta varredura
                                </p>
                                {/* Ausência de achado NÃO é atestado de conformidade. Sem as
                                    razões abaixo, o leitor lê "nada encontrado" como "nada
                                    existe" — e leva isso ao DPO. */}
                                <p className="t-corpo text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    Isso não é o mesmo que dizer que o site não coleta nada. Vale para o
                                    endereço varrido, no momento da varredura, e dentro do que esta forma
                                    de coleta alcança.
                                </p>
                            </>
                        ) : (
                            <>
                                <p className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                    Esta resposta não trouxe nenhuma tag
                                </p>
                                <p className="t-corpo text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    Sem o total do motor (<span className="voz-evidencia">summary.totalTags</span>)
                                    não dá para saber se a varredura não encontrou nada ou se a lista foi
                                    cortada antes de chegar aqui — e as duas coisas se leem igual numa lista
                                    vazia. Esta tela não escolhe uma delas.
                                    {mostraDetalhe === false && ' Esta resposta declara não trazer o detalhe dos achados.'}
                                </p>
                            </>
                        )}

                        {notas.length > 0 ? (
                            <ul className="space-y-2.5 pt-1">
                                {notas.map((nota, i) => (
                                    <li key={i} className="border-l-2 pl-3" style={{ borderColor: 'var(--laudo-linha)' }}>
                                        <p className="text-[12.5px] font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                            {nota.limitation || 'Limitação sem título na resposta'}
                                        </p>
                                        {nota.reason && (
                                            <p className="mt-0.5 text-[12px] leading-relaxed" style={{ color: 'var(--laudo-texto-suave)' }}>
                                                {nota.reason}
                                            </p>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <NaoMedido>
                                A resposta também não trouxe as limitações declaradas da varredura,
                                então esta tela não tem como listar as razões possíveis.
                            </NaoMedido>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Com a lista cheia a ressalva continua valendo — e é onde ela
                mais importa, porque uma lista de fornecedores lê como completa. */}
            {grupos.length > 0 && <LimitesDaVarredura notas={notas} />}
            {grupos.length > 0 && notas.length === 0 && (
                <NaoMedido>
                    A resposta não declarou as limitações desta varredura. A lista acima cobre o
                    que esta coleta alcançou no endereço varrido — não é um inventário completo
                    do site.
                </NaoMedido>
            )}
        </section>
    );
};

const Numero = ({ valor, rotulo, cor }: { valor: number | string; rotulo: string; cor?: string }) => (
    <span className="flex items-baseline gap-1.5">
        <span
            className="text-lg font-semibold tabular-nums"
            style={{ color: cor || 'var(--laudo-texto)' }}
        >
            {valor}
        </span>
        <span className="text-[12px]" style={{ color: 'var(--laudo-texto-suave)' }}>{rotulo}</span>
    </span>
);

export default InventarioDeColeta;
