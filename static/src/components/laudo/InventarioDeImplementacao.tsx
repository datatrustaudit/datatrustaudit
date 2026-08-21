/**
 * Como o rastreamento foi montado, e como o consentimento foi (ou não) pedido.
 *
 * O motor já responde tudo isto — `gtmQuality`, `consent` e o teste de recusa
 * dentro de `storage` — e a tela lia quase nada. O que existia era um punhado
 * de booleanos crus: "hasNoscript: false" não diz nada a quem não implementa
 * GTM, e um laudo que exige do leitor o conhecimento que ele foi comprar não
 * cumpre a função. Cada pergunta aqui vem com a consequência prática da
 * resposta observada.
 *
 * A regra que manda em tudo: **o que não foi medido é dito, nunca preenchido.**
 * Três armadilhas concretas neste arquivo, todas com histórico no produto:
 *
 * 1. `consentSignals` vazio significa que nenhum sinal foi lido — não que os
 *    quatro sinais estejam negados. Montar a tabela dos quatro com valores
 *    seria inventar a declaração de Consent Mode que o site não tem.
 * 2. `hasRejectAll` tem TRÊS estados: `true`, `false` e `null`. O `null` é
 *    "não dá para afirmar pelo HTML" — colapsá-lo em "não" acusa o site de um
 *    dark pattern que a varredura não observou.
 * 3. As listas de "depois da recusa" só têm sentido quando a recusa aconteceu.
 *    Com `rejected: false`, elas vêm vazias porque não houve o que medir — e
 *    exibir isso como "nada foi gravado após a recusa" seria declarar
 *    conformidade a partir da ausência de teste. É o erro mais caro possível
 *    aqui: erro para mais o cliente confere e reclama; "conforme" por engano
 *    ele publica.
 * 4. O veredito do teste de recusa — respeitada ou ignorada — vem de
 *    `rejectionFindings`, nunca de contar `cookiesAfterRejection` aqui. Essa
 *    lista traz TODO cookie novo, inclusive o que a própria CMP grava para
 *    lembrar a recusa: classificar por ela acusava o site de ignorar o titular
 *    tendo como prova o registro da decisão do titular. Quem sabe separar
 *    rastreador de cookie comum é o catálogo do `storage_auditor`.
 *
 * O texto dos achados (`findings[]`) sai como o motor escreveu — parte em
 * inglês, parte em português. Traduzir aqui criaria uma segunda versão da
 * evidência, que diverge da que vai para o PDF e para o XLSX.
 */
import { Card, CardContent } from '@/components/ui/card';
import {
    Boxes,
    ShieldCheck,
    MousePointerClick,
    Info,
    Check,
    X,
    HelpCircle,
    AlertTriangle,
    Wrench,
} from 'lucide-react';

// ── Formas de dado que o motor entrega ───────────────────────────────────────

/** Achado de `gtmQuality.findings[]` e de `consent.findings[]`. */
interface Achado {
    check?: string;
    label?: string;
    status?: string;
    description?: string;
    /** String nestes dois blocos. Em `rejectionFindings` é objeto — ver `AchadoDaRecusa`. */
    evidence?: string | null;
    recommendation?: string | null;
    confidence?: string;
}

/** Passo a passo de correção. Só vem nos planos pago — ver `guidesLocked`. */
interface GuiaDeCorrecao {
    whatIsWrong?: string;
    whyItMatters?: string;
    howToFix?: string[];
    codeExample?: string | null;
    howToVerify?: string;
    legalBasis?: string;
    effort?: string;
    ownedBy?: string;
}

/**
 * Achado do teste de recusa. Diferente dos outros dois: `evidence` é um
 * OBJETO (`{cookies, requests, storageKeys}` ou `{buttonLabels}` ou `{}`),
 * e não uma string. Tratar os dois como string imprimiria "[object Object]".
 */
interface AchadoDaRecusa {
    check?: string;
    label?: string;
    status?: string;
    description?: string;
    recommendation?: string | null;
    /* Objeto hoje. A string está no tipo porque um achado novo que a escreva
       como string precisa aparecer na tela, não sumir por não casar o formato. */
    evidence?: Record<string, unknown> | string | null;
    guide?: GuiaDeCorrecao | null;
}

export interface QualidadeDoGtm {
    containers?: string[];
    containerCount?: number;
    hasNoscript?: boolean;
    datalayerInitBeforeGtm?: boolean;
    datalayerOverwritten?: boolean;
    gtmInHead?: boolean;
    gtmLoadedMultipleTimes?: boolean;
    findings?: Achado[];
    score?: number;
}

export interface AuditoriaDeConsentimento {
    cmpDetected?: boolean;
    cmpName?: string | null;
    consentModeV2?: boolean;
    consentModeVersion?: string | null;
    hasDefaultDenied?: boolean;
    /** Só os sinais realmente lidos na chamada `default`. Vazio = nenhum lido. */
    consentSignals?: Record<string, string>;
    /** `null` = não verificável pelo HTML. Diferente de `false`. */
    hasRejectAll?: boolean | null;
    /** `null`/ausente = não verificado. Ver o comentário no bloco de políticas. */
    hasPrivacyPolicy?: boolean | null;
    hasCookiePolicy?: boolean | null;
    tagsBeforeConsent?: string[];
    findings?: Achado[];
}

/** Cookie observado depois da recusa. Forma do Playwright (`context.cookies()`). */
interface CookieDaRecusa {
    name?: string;
    domain?: string;
}

/** Requisição observada depois da recusa, como o `browser_fetcher` a monta. */
interface RequisicaoDaRecusa {
    url?: string;
    domain?: string;
    path?: string;
    method?: string;
}

export interface TesteDeRecusa {
    attempted?: boolean;
    rejected?: boolean;
    cmp?: string | null;
    selector?: string | null;
    method?: string | null;
    hasAcceptOption?: boolean;
    hasRejectOption?: boolean;
    buttonLabels?: string[];
    cookiesAfterRejection?: CookieDaRecusa[];
    requestsAfterRejection?: RequisicaoDaRecusa[];
    /** Chave → valor do localStorage. Só as chaves vão para a tela. */
    storageAfterRejection?: Record<string, string>;
    failureReason?: string | null;
}

export interface StorageDoLaudo {
    rejectionTest?: TesteDeRecusa | null;
    rejectionFindings?: AchadoDaRecusa[];
    /** `true` quando o plano do usuário cortou o passo a passo dos achados. */
    guidesLocked?: boolean;
}

interface Props {
    gtm?: QualidadeDoGtm | null;
    consentimento?: AuditoriaDeConsentimento | null;
    storage?: StorageDoLaudo | null;
}

// ── Vocabulário visual ───────────────────────────────────────────────────────

/**
 * Status do motor → cor. Os cinco valores que o backend produz hoje
 * (`critical`, `high`, `warning`, `ok`, `not_detected`) mais o caminho do
 * desconhecido: status novo cai em cinza e continua legível, em vez de herdar
 * a cor de "conforme" por acidente de `else`.
 */
const corDoStatus = (status?: string) =>
    status === 'critical' ? 'var(--laudo-critico)'
        : status === 'high' ? 'var(--laudo-alto)'
            : status === 'warning' ? 'var(--laudo-medio)'
                : status === 'ok' ? 'var(--laudo-conforme)'
                    : 'var(--laudo-baixo)';

const rotuloDoStatus = (status?: string) =>
    status === 'critical' ? 'Crítico'
        : status === 'high' ? 'Alto'
            : status === 'warning' ? 'Atenção'
                : status === 'ok' ? 'Conforme'
                    : status === 'not_detected' ? 'Não se aplica'
                        : 'Registrado';

/** Fundo translúcido sobre a superfície do laudo — nunca cor crua do Tailwind. */
const banho = (token: string, pct = 10) =>
    `color-mix(in srgb, ${token} ${pct}%, transparent)`;

/** Etiqueta pequena em caixa alta, o rótulo padrão dos blocos do laudo. */
const Etiqueta = ({ children }: { children: React.ReactNode }) => (
    <p className="t-etiqueta m-0">{children}</p>
);

/**
 * O que a varredura não trouxe, dito com todas as letras.
 *
 * Existe porque a alternativa — sumir com o bloco — deixa o leitor concluir
 * que não havia nada a relatar. Buraco visível é melhor que campo em branco.
 */
const NaoMedido = ({ titulo, detalhe }: { titulo: string; detalhe?: string }) => (
    <div
        className="flex items-start gap-3 rounded-lg border px-4 py-3"
        style={{ borderColor: 'var(--laudo-linha)', background: banho('var(--laudo-baixo)', 7) }}
    >
        <Info className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
        <div>
            <p className="m-0 text-sm" style={{ color: 'var(--laudo-texto)' }}>{titulo}</p>
            {detalhe && (
                <p className="m-0 mt-1 text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {detalhe}
                </p>
            )}
        </div>
    </div>
);

/** Cabeçalho de bloco: ícone, título e a frase que diz de onde vem o dado. */
const Bloco = ({
    Icone,
    titulo,
    procedencia,
    children,
}: {
    Icone: typeof Boxes;
    titulo: string;
    procedencia: string;
    children: React.ReactNode;
}) => (
    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
        <CardContent className="pt-6">
            <div className="mb-5 flex items-start gap-3">
                <Icone className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--laudo-carimbo)' }} />
                <div>
                    <h3 className="t-secao m-0" style={{ color: 'var(--laudo-texto)' }}>{titulo}</h3>
                    <p className="t-apoio m-0 mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        {procedencia}
                    </p>
                </div>
            </div>
            {children}
        </CardContent>
    </Card>
);

/** Valor bruto conferível — ID de container, nome de cookie, seletor CSS. */
const Bruto = ({ children }: { children: React.ReactNode }) => (
    <code
        className="voz-evidencia rounded px-1.5 py-0.5 text-[12px]"
        style={{ background: 'var(--sup-2)', color: 'var(--laudo-texto)' }}
    >
        {children}
    </code>
);

// ── Perguntas de sim/não sobre o GTM ─────────────────────────────────────────

interface Pergunta {
    pergunta: string;
    /** O valor observado. `undefined` quando o campo não veio na resposta. */
    observado?: boolean;
    /**
     * Qual resposta é a saudável. `datalayerOverwritten` e
     * `gtmLoadedMultipleTimes` são perguntas cuja resposta boa é "não" —
     * pintar tudo pela mesma polaridade deixaria o pior achado em verde.
     */
    bomQuando: boolean;
    /** A consequência prática de cada resposta. Sempre as duas. */
    seSim: string;
    seNao: string;
}

const perguntasDoGtm = (gtm: QualidadeDoGtm): Pergunta[] => [
    {
        pergunta: 'O container está dentro do <head>?',
        observado: gtm.gtmInHead,
        bomQuando: true,
        seSim: 'O container sobe antes do corpo da página, que é a posição recomendada pelo Google: as tags já estão de pé quando a página começa a renderizar.',
        seNao: 'O container carrega depois que parte da página já apareceu. Tudo que acontece nesse intervalo — o page_view, um clique rápido, um redirecionamento — ocorre antes de existir tag para escutar, e não é contabilizado.',
    },
    {
        pergunta: 'O dataLayer foi inicializado antes do container?',
        observado: gtm.datalayerInitBeforeGtm,
        bomQuando: true,
        seSim: 'O array existe antes de o container carregar, então os push() feitos nesse intervalo ficam na fila e são processados quando o GTM sobe.',
        seNao: 'Não foi encontrada a declaração window.dataLayer = window.dataLayer || [] antes do snippet. Os push() executados antes do container carregar caem em um array que ainda não existe: o GTM cria o seu depois, vazio, e esses eventos se perdem sem erro nenhum no console.',
    },
    {
        /* O motor conta quantas vezes o padrão `window.dataLayer = []` aparece
           no código e marca este campo quando passa de uma. Ele NÃO compara a
           posição dessas declarações com a do container — dizer "redeclarado
           depois do GTM" seria afirmar uma ordem que ninguém mediu. A pergunta
           é sobre a contagem, que é o que a varredura observou. */
        pergunta: 'A declaração do dataLayer aparece mais de uma vez?',
        observado: gtm.datalayerOverwritten,
        bomQuando: false,
        seSim: 'O padrão window.dataLayer = [] foi encontrado mais de uma vez no código (o achado abaixo traz a contagem). Atribuição direta não acrescenta ao array: substitui o objeto inteiro. Se a segunda declaração rodar depois de já haver eventos na fila, tudo o que estava lá é descartado junto com a referência que o GTM guardava. Esta varredura não determina em que ordem elas executam — o que ela afirma é que existe mais de uma.',
        seNao: 'A declaração aparece no máximo uma vez no código, então não há atribuição concorrente capaz de descartar a fila.',
    },
    {
        /* Bandeira acesa por DOIS motivos diferentes no motor: snippet
           `gtm.js` repetido no HTML, ou mais de um container distinto na
           página. Escrever "o mesmo container é carregado repetidamente" faria
           o laudo acusar duplicação onde o que há são dois containers legítimos
           e distintos — falso positivo, e falso positivo faz o cliente duvidar
           dos achados verdadeiros. */
        pergunta: 'Há mais de uma carga de container do GTM na página?',
        observado: gtm.gtmLoadedMultipleTimes,
        bomQuando: false,
        seSim: 'O motor acende esta bandeira em dois casos: o snippet gtm.js repetido no código, ou mais de um container distinto na mesma página. Os achados abaixo dizem qual dos dois — e, no caso do snippet repetido, quantas vezes. Snippet duplicado multiplica cada disparo: pageview, conversão e receita saem inflados na origem, e nenhum ajuste no relatório conserta isso depois.',
        seNao: 'Um único container, carregado uma vez só — que é o esperado.',
    },
    {
        pergunta: 'Existe o fallback <noscript>?',
        observado: gtm.hasNoscript,
        bomQuando: true,
        seSim: 'O iframe de <noscript> está presente, então o visitante com JavaScript desativado ainda é contabilizado.',
        seNao: 'Falta o iframe de <noscript> logo após a abertura do <body>. É o item menos grave desta lista: não afeta conformidade, afeta a completude da medição — visitante com JavaScript bloqueado não entra na conta.',
    },
];

/** Uma linha da lista de perguntas: resposta, e o que ela implica. */
const LinhaDePergunta = ({ item }: { item: Pergunta }) => {
    /* Campo ausente não vira "não": a resposta seria uma afirmação que ninguém
       mediu. Aqui ele aparece como não informado, em cinza. */
    if (typeof item.observado !== 'boolean') {
        return (
            <li className="py-3">
                <div className="flex items-start gap-3">
                    <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    <div>
                        <p className="m-0 text-sm" style={{ color: 'var(--laudo-texto)' }}>{item.pergunta}</p>
                        <p className="m-0 mt-1 text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Esta varredura não trouxe a resposta para esta verificação.
                        </p>
                    </div>
                </div>
            </li>
        );
    }

    const saudavel = item.observado === item.bomQuando;
    const cor = saudavel ? 'var(--laudo-conforme)' : 'var(--laudo-alto)';
    const Icone = saudavel ? Check : X;

    return (
        <li className="py-3">
            <div className="flex items-start gap-3">
                <span
                    className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                    style={{ background: banho(cor, 18) }}
                >
                    <Icone className="h-3 w-3" style={{ color: cor }} />
                </span>
                <div>
                    <p className="m-0 text-sm" style={{ color: 'var(--laudo-texto)' }}>
                        {item.pergunta}{' '}
                        <strong className="voz-evidencia text-[12px]" style={{ color: cor }}>
                            {item.observado ? 'SIM' : 'NÃO'}
                        </strong>
                    </p>
                    <p
                        className="m-0 mt-1 text-xs"
                        style={{ color: 'var(--laudo-texto-suave)', maxWidth: '72ch' }}
                    >
                        {item.observado ? item.seSim : item.seNao}
                    </p>
                </div>
            </div>
        </li>
    );
};

// ── Achados do motor ─────────────────────────────────────────────────────────

/**
 * Lista de achados de `gtmQuality` e de `consent`.
 *
 * O texto vai como o motor escreveu, inclusive quando está em inglês: é a
 * mesma string que o PDF e o XLSX imprimem, e reescrevê-la aqui criaria duas
 * versões da mesma evidência.
 */
const ListaDeAchados = ({ achados }: { achados: Achado[] }) => (
    <ul className="m-0 list-none space-y-2 p-0">
        {achados.map((a, i) => {
            const cor = corDoStatus(a.status);
            return (
                <li
                    key={`${a.check || 'achado'}-${i}`}
                    className="rounded-lg border-l-[3px] px-4 py-3"
                    style={{ borderLeftColor: cor, background: banho(cor, 8) }}
                >
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                            {a.label || a.check || 'Achado sem rótulo'}
                        </span>
                        <span className="voz-evidencia text-[10px] uppercase tracking-widest" style={{ color: cor }}>
                            {rotuloDoStatus(a.status)}
                        </span>
                        {/* Confiança faz parte do achado: "medium" numa peça de
                            evidência muda o peso do que se pode afirmar. */}
                        {a.confidence && (
                            <span className="voz-evidencia text-[10px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                confiança {a.confidence}
                            </span>
                        )}
                    </div>
                    {a.description && (
                        <p className="m-0 mt-1.5 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '78ch' }}>
                            {a.description}
                        </p>
                    )}
                    {a.evidence && (
                        <p className="m-0 mt-1.5 text-xs">
                            <span style={{ color: 'var(--laudo-texto-fraco)' }}>Evidência: </span>
                            <Bruto>{a.evidence}</Bruto>
                        </p>
                    )}
                    {a.recommendation && (
                        <p
                            className="m-0 mt-2 border-t pt-2 text-xs"
                            style={{ borderColor: 'var(--laudo-linha)', color: 'var(--laudo-texto-suave)', maxWidth: '78ch' }}
                        >
                            <strong style={{ color: 'var(--laudo-texto)' }}>Como corrigir: </strong>
                            {a.recommendation}
                        </p>
                    )}
                </li>
            );
        })}
    </ul>
);

// ── GTM ──────────────────────────────────────────────────────────────────────

const BlocoDoGtm = ({ gtm }: { gtm?: QualidadeDoGtm | null }) => {
    const containers = Array.isArray(gtm?.containers) ? gtm!.containers : [];
    const achados = Array.isArray(gtm?.findings) ? gtm!.findings : [];
    /* O contador do motor manda; a lista pode chegar cortada. Só se ele não
       vier é que se conta pela lista — e `??` porque zero é resposta legítima. */
    const quantos = gtm?.containerCount ?? containers.length;

    const procedencia =
        'Lido do código-fonte da página durante a varredura: quais containers do Google Tag Manager carregam, onde e em que ordem.';

    if (!gtm) {
        return (
            <Bloco Icone={Boxes} titulo="Implementação do Google Tag Manager" procedencia={procedencia}>
                <NaoMedido
                    titulo="Esta varredura não trouxe a análise do GTM."
                    detalhe="Rode a auditoria novamente para obter a verificação de container, dataLayer e snippet."
                />
            </Bloco>
        );
    }

    /* Sem container não há implementação de GTM a avaliar — e responder "o
       container está no <head>? NÃO" sobre um container que não existe seria
       fabricar um achado. Nesse caso a lista de perguntas sai da tela e o que
       fica é a constatação. */
    const temContainer = quantos > 0 || containers.length > 0;

    return (
        <Bloco Icone={Boxes} titulo="Implementação do Google Tag Manager" procedencia={procedencia}>
            <div className="space-y-5">

                <div>
                    <Etiqueta>Containers encontrados</Etiqueta>
                    {temContainer ? (
                        <>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                                {containers.map((id) => <Bruto key={id}>{id}</Bruto>)}
                                {/* `gtmQuality` não passa por corte de plano, então
                                    hoje contador e lista sempre batem. A frase existe
                                    para o dia em que não baterem: contador sem lista
                                    tem de ser dito, não deixado para o leitor contar
                                    as etiquetas e concluir errado. */}
                                {containers.length === 0 && (
                                    <span className="text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                        identificadores não incluídos nesta resposta
                                    </span>
                                )}
                            </div>
                            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '72ch' }}>
                                {quantos === 1
                                    ? 'Um container. É a configuração esperada: um ponto de controle, uma publicação, uma versão para auditar.'
                                    : `${quantos} containers na mesma página. Cada um carrega e executa seu próprio conjunto de tags, sem enxergar o do outro: a mesma tag pode estar publicada nos dois e disparar duas vezes, e não há uma tela única onde alguém veja tudo o que está sendo coletado.`}
                            </p>
                        </>
                    ) : (
                        <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '72ch' }}>
                            Nenhum container do Google Tag Manager foi identificado nesta página. As tags
                            encontradas, se houver, estão no código diretamente — sem intermediário para
                            controlar disparo ou consentimento.
                        </p>
                    )}
                </div>

                {temContainer && (
                    <div>
                        <Etiqueta>Verificações de implementação</Etiqueta>
                        <ul
                            className="m-0 mt-1 list-none divide-y p-0"
                            style={{ borderColor: 'var(--laudo-linha)' }}
                        >
                            {perguntasDoGtm(gtm).map((p) => (
                                <LinhaDePergunta key={p.pergunta} item={p} />
                            ))}
                        </ul>
                    </div>
                )}

                {/* Score do eixo, com a escala dita. Número solto num laudo é
                    exatamente o tipo de coisa que o leitor interpreta errado. */}
                {typeof gtm.score === 'number' && temContainer && (
                    <p className="m-0 text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        Qualidade da implementação do GTM:{' '}
                        <strong className="voz-evidencia" style={{ color: 'var(--laudo-texto)' }}>
                            {gtm.score}/100
                        </strong>{' '}
                        — quanto maior, melhor. A régua são os achados desta varredura: partindo de
                        100, cada achado crítico desconta 25 pontos e cada alerta desconta 10.
                    </p>
                )}

                {/* Mesmas verificações de cima, na redação do motor e com a
                    evidência bruta ("gtm.js encontrado 4×"). Dizer isso no
                    rótulo evita que o leitor conte duas vezes o mesmo
                    problema — a lista não acrescenta achados, acrescenta
                    a medida e a palavra que vai para o PDF e para o XLSX. */}
                {achados.length > 0 && (
                    <div>
                        <Etiqueta>As mesmas verificações, na redação do motor</Etiqueta>
                        <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Não são problemas adicionais: é o texto e a evidência que também vão para o
                            PDF e para a planilha, sem tradução, para conferir palavra por palavra.
                        </p>
                        <div className="mt-2">
                            <ListaDeAchados achados={achados} />
                        </div>
                    </div>
                )}
            </div>
        </Bloco>
    );
};

// ── Consentimento ────────────────────────────────────────────────────────────

/** Os quatro sinais do Consent Mode v2, na ordem em que o Google os documenta. */
const SINAIS_CANONICOS = ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization'];

const BlocoDeConsentimento = ({
    consentimento,
    recusa,
    checksDaRecusa,
}: {
    consentimento?: AuditoriaDeConsentimento | null;
    recusa?: TesteDeRecusa | null;
    /** Achados que o bloco do teste de recusa já publica, por `check`. */
    checksDaRecusa: Set<string>;
}) => {
    const procedencia =
        'Lido do código-fonte da página: assinatura da plataforma de consentimento, declaração de Consent Mode e links de política.';

    if (!consentimento) {
        return (
            <Bloco Icone={ShieldCheck} titulo="Consentimento" procedencia={procedencia}>
                <NaoMedido titulo="Esta varredura não trouxe a auditoria de consentimento." />
            </Bloco>
        );
    }

    const sinais = consentimento.consentSignals;
    /* "Não veio o campo" e "veio vazio" levam à mesma frase, e é de propósito:
       nos dois casos nenhum sinal foi lido, e é isso que a tela pode afirmar. */
    const sinaisLidos = sinais && typeof sinais === 'object' ? Object.entries(sinais) : [];
    /* `cmp_present_no_ui` chega nas duas listas — o motor o publica em
       `consent.findings` e em `storage.rejectionFindings`. Impresso duas vezes
       na mesma tela, o mesmo achado parece dois problemas distintos, e ninguém
       conta certo. Fica com o bloco do teste de recusa, que traz também a
       evidência e o passo a passo; aqui ele sai da lista. */
    const achados = (Array.isArray(consentimento.findings) ? consentimento.findings : [])
        .filter((a) => !(a.check && checksDaRecusa.has(a.check)));
    const tagsAntes = Array.isArray(consentimento.tagsBeforeConsent) ? consentimento.tagsBeforeConsent : [];

    /* A CMP é detectada por assinatura no HTML — isso prova que o script está
       lá, não que o aviso apareceu. O teste de recusa abre o navegador e olha
       a tela; quando ele não acha controle nenhum, as duas leituras se
       contradizem, e essa contradição é o achado. */
    const cmpNoCodigoSemControleNaTela =
        consentimento.cmpDetected === true &&
        recusa?.attempted === true &&
        recusa?.hasAcceptOption === false &&
        recusa?.hasRejectOption === false;

    return (
        <Bloco Icone={ShieldCheck} titulo="Consentimento" procedencia={procedencia}>
            <div className="space-y-5">

                <div>
                    <Etiqueta>Plataforma de consentimento (CMP)</Etiqueta>
                    <p className="m-0 mt-2 text-sm" style={{ color: 'var(--laudo-texto)' }}>
                        {consentimento.cmpDetected
                            ? <>Assinatura encontrada no código: <Bruto>{consentimento.cmpName || 'ferramenta não identificada'}</Bruto></>
                            : 'Nenhuma plataforma de consentimento foi encontrada no código desta página.'}
                    </p>
                    {cmpNoCodigoSemControleNaTela && (
                        <p
                            className="m-0 mt-2 rounded-lg border-l-[3px] px-3 py-2 text-xs"
                            style={{
                                borderLeftColor: 'var(--laudo-critico)',
                                background: banho('var(--laudo-critico)', 9),
                                color: 'var(--laudo-texto-suave)',
                                maxWidth: '78ch',
                            }}
                        >
                            <strong style={{ color: 'var(--laudo-texto)' }}>O script está na página, o aviso não apareceu. </strong>
                            Durante a visita, o navegador não encontrou nenhum botão de aceitar ou recusar.
                            Script carregado não é aviso exibido — e é comum a CMP vir configurada para
                            mostrar o banner apenas na União Europeia.
                        </p>
                    )}
                </div>

                <div>
                    <Etiqueta>Google Consent Mode</Etiqueta>
                    {sinaisLidos.length === 0 ? (
                        <div className="mt-2">
                            <NaoMedido
                                titulo="Nenhum sinal de Consent Mode foi lido nesta página."
                                detalhe="A varredura procurou a chamada gtag('consent','default', …) no código e não leu nenhum dos quatro sinais nela. Sem essa declaração, o Google recebe as tags sem qualquer estado de consentimento anexado: não há o que exibir aqui, e é isso que o laudo afirma — não que os sinais estejam negados."
                            />
                        </div>
                    ) : (
                        <>
                            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '72ch' }}>
                                Estado declarado na chamada <Bruto>gtag('consent','default', …)</Bruto>
                                {consentimento.consentModeVersion && <> — versão <Bruto>{consentimento.consentModeVersion}</Bruto></>}.
                                <strong style={{ color: 'var(--laudo-texto)' }}> denied</strong> é o padrão correto:
                                significa que a tag espera a manifestação do titular antes de coletar.
                            </p>
                            <ul className="m-0 mt-2 list-none space-y-1 p-0">
                                {SINAIS_CANONICOS.map((sinal) => {
                                    const valor = sinais?.[sinal];
                                    /* Sinal fora do mapa não foi encontrado na
                                       declaração lida. É uma afirmação sobre a
                                       chamada observada, não um palpite sobre o
                                       estado dele. */
                                    const cor = valor === 'denied' ? 'var(--laudo-conforme)'
                                        : valor === 'granted' ? 'var(--laudo-critico)'
                                            : 'var(--laudo-baixo)';
                                    return (
                                        <li key={sinal} className="flex flex-wrap items-center gap-2 text-xs">
                                            <Bruto>{sinal}</Bruto>
                                            <span className="voz-evidencia" style={{ color: cor }}>
                                                {valor ?? 'não encontrado na declaração'}
                                            </span>
                                        </li>
                                    );
                                })}
                                {/* Sinal fora dos quatro canônicos existe (o motor lê
                                    o que estiver lá) e não pode sumir da tela. */}
                                {sinaisLidos
                                    .filter(([nome]) => !SINAIS_CANONICOS.includes(nome))
                                    .map(([nome, valor]) => (
                                        <li key={nome} className="flex flex-wrap items-center gap-2 text-xs">
                                            <Bruto>{nome}</Bruto>
                                            <span className="voz-evidencia" style={{ color: 'var(--laudo-texto-suave)' }}>
                                                {String(valor)}
                                            </span>
                                        </li>
                                    ))}
                            </ul>
                            {consentimento.hasDefaultDenied === false && (
                                <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-alto)', maxWidth: '72ch' }}>
                                    Nenhum sinal veio como <Bruto>denied</Bruto> por padrão: na prática a
                                    declaração existe, mas não retém nada antes do consentimento.
                                </p>
                            )}
                        </>
                    )}
                </div>

                <div>
                    <Etiqueta>Controles e políticas na página</Etiqueta>
                    <ul className="m-0 mt-2 list-none space-y-2 p-0">
                        {/* Três estados, não dois. `null` é a resposta do motor
                            para "a CMP está lá, mas o botão de recusar não dá
                            para confirmar pelo HTML" — banner em modal só
                                aparece depois que o JavaScript roda. Ler isso como
                            "não tem" acusaria o site de um dark pattern que
                            ninguém observou. */}
                        <li className="text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '76ch' }}>
                            <span style={{ color: 'var(--laudo-texto)' }}>Opção de recusar tudo: </span>
                            {consentimento.hasRejectAll === true && (
                                <span style={{ color: 'var(--laudo-conforme)' }}>
                                    encontrada no código da página. Recusar precisa ser tão fácil quanto aceitar.
                                </span>
                            )}
                            {consentimento.hasRejectAll === false && (
                                <span style={{ color: 'var(--laudo-critico)' }}>
                                    não encontrada, e também não há CMP na página — não existe caminho de recusa.
                                </span>
                            )}
                            {/* O motor devolve `null` quando achou CMP mas não
                                conseguiu confirmar o botão pelo HTML. Se o campo
                                simplesmente não veio e não há CMP, a mesma frase
                                afirmaria uma CMP que a varredura não encontrou —
                                por isso a justificativa depende de `cmpDetected`,
                                e não do `null` sozinho. */}
                            {(consentimento.hasRejectAll === null || consentimento.hasRejectAll === undefined) && (
                                <span style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    {consentimento.cmpDetected ? (
                                        <>
                                            não verificável pelo código-fonte. Há CMP na página, mas banners montados
                                            em modal só existem depois que o JavaScript roda — o laudo não afirma nem
                                            a presença nem a ausência do botão. O teste de recusa, abaixo, é a
                                            verificação que vale.
                                        </>
                                    ) : (
                                        <>
                                            esta varredura não trouxe a verificação. O teste de recusa, abaixo, é o
                                            que observa os controles na tela.
                                        </>
                                    )}
                                </span>
                            )}
                        </li>
                        {/* Três estados também aqui. O booleano cru colapsa
                            `undefined` em "não encontrada", e aí a tela acusa a
                            ausência de um documento que a varredura nunca chegou
                            a procurar — a mesma classe de erro que o `null` do
                            reject-all. */}
                        <li className="text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                            <span style={{ color: 'var(--laudo-texto)' }}>Política de privacidade: </span>
                            {consentimento.hasPrivacyPolicy === true
                                ? 'link ou menção encontrada na página.'
                                : consentimento.hasPrivacyPolicy === false
                                    ? 'nenhum link ou menção encontrada nesta página.'
                                    : <span style={{ color: 'var(--laudo-texto-fraco)' }}>esta varredura não trouxe a verificação.</span>}
                        </li>
                        <li className="text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                            <span style={{ color: 'var(--laudo-texto)' }}>Política de cookies: </span>
                            {consentimento.hasCookiePolicy === true
                                ? 'link ou menção encontrada na página.'
                                : consentimento.hasCookiePolicy === false
                                    ? 'nenhum link ou menção encontrada nesta página — é o documento que descreve cada cookie e sua finalidade.'
                                    : <span style={{ color: 'var(--laudo-texto-fraco)' }}>esta varredura não trouxe a verificação.</span>}
                        </li>
                    </ul>
                </div>

                {tagsAntes.length > 0 && (
                    <div>
                        <Etiqueta>Tags sem consentimento válido</Etiqueta>
                        <div className="mt-2 flex flex-wrap gap-2">
                            {tagsAntes.map((nome) => <Bruto key={nome}>{nome}</Bruto>)}
                        </div>
                        {/* O motor monta esta lista por dois critérios distintos, e a
                            força da prova não é a mesma nos dois: disparo de rede
                            durante a visita é evidência direta; posição no HTML antes
                            do script da CMP é indício — um CMP declarado antes das
                            tags não garante que ele bloqueia nada. O campo não diz
                            qual critério pegou cada tag, então a tela não pode
                            escolher um: descreve os dois. O motor faz a mesma
                            ressalva na própria redação ("appear to load"). */}
                        <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '76ch' }}>
                            A varredura nunca clicou em aceitar. Estas {tagsAntes.length} tag(s) entram
                            aqui por um de dois motivos: ou dispararam de fato durante a visita, sem
                            ninguém aceitar, ou estão declaradas no código antes do script de
                            consentimento. O primeiro é prova de coleta; o segundo é indício de que o
                            bloqueio não existe. Em página sem plataforma de consentimento, todo
                            rastreador entra na lista — não há consentimento a respeitar.
                        </p>
                    </div>
                )}

                {achados.length > 0 && (
                    <div>
                        <Etiqueta>As mesmas verificações, na redação do motor</Etiqueta>
                        <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Não são problemas adicionais: é o texto que também vai para o PDF e para a
                            planilha, sem tradução, para conferir palavra por palavra.
                        </p>
                        <div className="mt-2">
                            <ListaDeAchados achados={achados} />
                        </div>
                    </div>
                )}
            </div>
        </Bloco>
    );
};

// ── Teste de recusa ──────────────────────────────────────────────────────────

/** Uma observação do teste, em par rótulo/valor. */
const Par = ({ rotulo, children }: { rotulo: string; children: React.ReactNode }) => (
    <div>
        <dt className="text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>{rotulo}</dt>
        <dd className="voz-evidencia m-0 text-xs" style={{ color: 'var(--laudo-texto)' }}>{children}</dd>
    </div>
);

/**
 * Evidência dos achados da recusa: aqui é objeto, não string.
 *
 * As chaves variam com o achado (`cookies`/`requests`/`storageKeys` no
 * rastreamento pós-recusa, `buttonLabels` nos dark patterns), então o
 * componente percorre o que veio em vez de assumir um formato — chave nova no
 * motor aparece na tela em vez de sumir.
 */
const EvidenciaDoAchado = ({ evidencia }: { evidencia: Record<string, unknown> | string }) => {
    /* Evidência em string não tem chave para rotular: sai como veio, em vez de
       ser descartada por não casar com a forma esperada. */
    if (typeof evidencia === 'string') {
        return (
            <p className="m-0 mt-2 text-xs">
                <span style={{ color: 'var(--laudo-texto-fraco)' }}>Evidência: </span>
                <Bruto>{evidencia}</Bruto>
            </p>
        );
    }

    const rotulos: Record<string, string> = {
        cookies: 'Cookies gravados',
        requests: 'Requisições disparadas',
        storageKeys: 'Chaves de armazenamento',
        buttonLabels: 'Rótulos de botão lidos na tela',
    };

    const entradas = Object.entries(evidencia).filter(
        ([, valor]) => !(Array.isArray(valor) && valor.length === 0) && valor != null,
    );
    if (entradas.length === 0) return null;

    return (
        <div className="mt-2 space-y-1.5">
            {entradas.map(([chave, valor]) => (
                <div key={chave} className="text-xs">
                    <span style={{ color: 'var(--laudo-texto-fraco)' }}>{rotulos[chave] || chave}: </span>
                    <span className="inline-flex flex-wrap gap-1 align-top">
                        {Array.isArray(valor)
                            ? valor.map((item, i) => <Bruto key={`${chave}-${i}`}>{String(item)}</Bruto>)
                            : <Bruto>{String(valor)}</Bruto>}
                    </span>
                </div>
            ))}
        </div>
    );
};

/** O passo a passo de correção que o motor escreveu para o achado. */
const Guia = ({ guia }: { guia: GuiaDeCorrecao }) => (
    <div
        className="mt-3 rounded-lg border px-3 py-3"
        style={{ borderColor: 'var(--laudo-linha)', background: 'var(--sup-2)' }}
    >
        <div className="mb-2 flex items-center gap-2">
            <Wrench className="h-3.5 w-3.5" style={{ color: 'var(--laudo-carimbo)' }} />
            <span className="t-etiqueta">Como corrigir</span>
        </div>

        {guia.whatIsWrong && (
            <p className="m-0 text-xs" style={{ color: 'var(--laudo-texto)', maxWidth: '76ch' }}>
                {guia.whatIsWrong}
            </p>
        )}
        {guia.whyItMatters && (
            <p className="m-0 mt-1.5 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '76ch' }}>
                {guia.whyItMatters}
            </p>
        )}

        {Array.isArray(guia.howToFix) && guia.howToFix.length > 0 && (
            <ol className="m-0 mt-2 list-decimal space-y-1 pl-5 text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                {guia.howToFix.map((passo, i) => <li key={i}>{passo}</li>)}
            </ol>
        )}

        {guia.codeExample && (
            <pre
                className="voz-evidencia m-0 mt-2 overflow-x-auto rounded p-2 text-[11px]"
                style={{ background: 'var(--laudo-fundo)', color: 'var(--laudo-texto)' }}
            >
                {guia.codeExample}
            </pre>
        )}

        {guia.howToVerify && (
            <p className="m-0 mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '76ch' }}>
                <strong style={{ color: 'var(--laudo-texto)' }}>Como conferir: </strong>{guia.howToVerify}
            </p>
        )}

        {/* Base legal, esforço e responsável: é o que transforma o achado em
            tarefa atribuível. Cada um só aparece se veio. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
            {guia.legalBasis && <span>Base legal: {guia.legalBasis}</span>}
            {guia.effort && <span>Esforço: {guia.effort}</span>}
            {guia.ownedBy && <span>Responsável: {guia.ownedBy}</span>}
        </div>
    </div>
);

/**
 * O que foi observado depois do clique em recusar.
 *
 * Só lista o que a varredura registrou. A classificação — "a recusa foi
 * respeitada" ou "a coleta continuou" — não é decidida aqui: ver o veredito em
 * `BlocoDaRecusa`.
 */
const ObservadoDepoisDaRecusa = ({
    cookies,
    requisicoes,
    chavesDeStorage,
    rotuloDosCookies,
}: {
    cookies: CookieDaRecusa[];
    requisicoes: RequisicaoDaRecusa[];
    chavesDeStorage: string[];
    /** Muda com o veredito: cookie novo não é sinônimo de rastreador. */
    rotuloDosCookies: string;
}) => (
    <>
        {cookies.length > 0 && (
            <div>
                <p className="m-0 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {rotuloDosCookies} ({cookies.length})
                </p>
                <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {cookies.map((c, i) => (
                        <li key={`${c.name}-${i}`} className="flex flex-wrap items-center gap-2 text-xs">
                            <Bruto>{c.name || 'sem nome'}</Bruto>
                            <span style={{ color: 'var(--laudo-texto-fraco)' }}>
                                {c.domain || 'domínio não informado'}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        {requisicoes.length > 0 && (
            <div>
                <p className="m-0 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Requisições a endpoint de rastreamento, disparadas depois ({requisicoes.length})
                </p>
                <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {requisicoes.map((r, i) => (
                        <li key={`${r.url}-${i}`} className="text-xs">
                            <span className="voz-evidencia" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                {r.method || 'método não informado'}{' '}
                            </span>
                            {/* A URL inteira é a prova; na tela ela quebra o
                                layout, então fica truncada por CSS — o texto
                                continua completo para copiar. */}
                            <span
                                className="voz-evidencia inline-block max-w-full truncate align-bottom"
                                style={{ color: 'var(--laudo-texto)' }}
                                title={r.url}
                            >
                                {r.url || r.domain || 'endereço não informado'}
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
        )}

        {chavesDeStorage.length > 0 && (
            <div>
                <p className="m-0 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Chaves gravadas em armazenamento local depois ({chavesDeStorage.length})
                </p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                    {chavesDeStorage.map((k) => <Bruto key={k}>{k}</Bruto>)}
                </div>
                {/* O conteúdo pode conter identificador do visitante; a chave
                    já prova a gravação. */}
                <p className="m-0 mt-1 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Os valores não são reproduzidos aqui — podem conter identificadores do visitante.
                </p>
            </div>
        )}
    </>
);

const BlocoDaRecusa = ({ storage }: { storage?: StorageDoLaudo | null }) => {
    const procedencia =
        'Segunda fase da varredura: o scanner procura o controle de recusa na página renderizada, clica nele e mede o que o site faz depois.';

    const recusa = storage?.rejectionTest;
    const achados = Array.isArray(storage?.rejectionFindings) ? storage!.rejectionFindings : [];
    const guiasBloqueados = storage?.guidesLocked === true;

    if (!storage || !recusa || typeof recusa !== 'object') {
        return (
            <Bloco Icone={MousePointerClick} titulo="Teste de recusa de consentimento" procedencia={procedencia}>
                <NaoMedido
                    titulo="Esta varredura não trouxe o teste de recusa."
                    detalhe="O teste exige o navegador real — varredura feita por código-fonte ou por arquivo HAR não o executa."
                />
            </Bloco>
        );
    }

    if (recusa.attempted !== true) {
        return (
            <Bloco Icone={MousePointerClick} titulo="Teste de recusa de consentimento" procedencia={procedencia}>
                <NaoMedido
                    titulo="O teste de recusa não foi executado nesta varredura."
                    detalhe="Nada do que está neste laudo afirma o que o site faz depois de o visitante recusar."
                />
            </Bloco>
        );
    }

    const conseguiu = recusa.rejected === true;
    const rotulos = Array.isArray(recusa.buttonLabels) ? recusa.buttonLabels : [];
    const cookiesDepois = Array.isArray(recusa.cookiesAfterRejection) ? recusa.cookiesAfterRejection : [];
    const requisicoesDepois = Array.isArray(recusa.requestsAfterRejection) ? recusa.requestsAfterRejection : [];
    const storageDepois = recusa.storageAfterRejection && typeof recusa.storageAfterRejection === 'object'
        ? Object.keys(recusa.storageAfterRejection)
        : [];

    /* O veredito vem do motor — não de contar as três listas aqui.
     *
     * `cookiesAfterRejection` traz TODO cookie novo gravado depois do clique,
     * sem filtro: o `browser_fetcher` compara o inventário antes e depois e
     * devolve a diferença. O cookie que a própria ferramenta de consentimento
     * grava para lembrar a recusa está nessa diferença — é o comportamento
     * correto, e é o mais provável de aparecer. Classificar pela lista fazia a
     * tela publicar "a decisão do titular foi registrada e ignorada" tendo como
     * única prova o registro da decisão do titular.
     *
     * Quem separa rastreador de cookie comum é `_identifica_cookie`, no
     * `storage_auditor`, e o resultado dessa separação já chega pronto em
     * `rejectionFindings`: `tracking_after_rejection` ou `rejection_respected`.
     * A lista não é cortada por plano (só o `guide` de cada achado é), então o
     * veredito está disponível em todos os planos.
     */
    const houveRastreamentoDepois = achados.some((a) => a.check === 'tracking_after_rejection');
    const recusaRespeitada = achados.some((a) => a.check === 'rejection_respected');

    /* Recusa não concluída tem duas causas de peso oposto, e pintar as duas de
       vermelho acusa o site pelo que é limitação nossa: o botão de recusar
       existe (o motor o classificou), e o clique automatizado é que não passou
       — banner dentro de iframe de origem diferente, elemento coberto,
       animação. Falso positivo faz o cliente duvidar dos achados verdadeiros,
       e este seria fácil de conferir e derrubar. */
    const cliqueFalhouComBotaoPresente = !conseguiu && recusa.hasRejectOption === true;

    return (
        <Bloco Icone={MousePointerClick} titulo="Teste de recusa de consentimento" procedencia={procedencia}>
            <div className="space-y-5">

                <div>
                    <Etiqueta>O que foi tentado</Etiqueta>
                    <dl className="m-0 mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2">
                        <Par rotulo="Resultado">
                            <span
                                style={{
                                    color: conseguiu ? 'var(--laudo-conforme)'
                                        : cliqueFalhouComBotaoPresente ? 'var(--laudo-texto-fraco)'
                                            : 'var(--laudo-alto)',
                                }}
                            >
                                {conseguiu ? 'Recusa efetuada'
                                    : cliqueFalhouComBotaoPresente ? 'Recusa não concluída pela varredura'
                                        : 'Não foi possível recusar'}
                            </span>
                        </Par>
                        <Par rotulo="Ferramenta identificada no clique">
                            {recusa.cmp || 'não identificada'}
                        </Par>
                        <Par rotulo="Botão de aceitar visível">
                            {recusa.hasAcceptOption === true ? 'sim'
                                : recusa.hasAcceptOption === false ? 'não'
                                    : 'não informado'}
                        </Par>
                        <Par rotulo="Botão de recusar visível">
                            {recusa.hasRejectOption === true ? 'sim'
                                : recusa.hasRejectOption === false ? 'não'
                                    : 'não informado'}
                        </Par>
                        {conseguiu && (
                            <>
                                <Par rotulo="Como o botão foi achado">
                                    {recusa.method === 'seletor_conhecido' ? 'seletor conhecido da CMP'
                                        : recusa.method === 'texto_do_botao' ? 'pelo texto do botão'
                                            : recusa.method || 'não informado'}
                                </Par>
                                <Par rotulo="Seletor usado">{recusa.selector || 'não informado'}</Par>
                            </>
                        )}
                        {!conseguiu && recusa.failureReason && (
                            <div className="sm:col-span-2">
                                <Par rotulo="Motivo">{recusa.failureReason}</Par>
                            </div>
                        )}
                    </dl>

                    {cliqueFalhouComBotaoPresente && (
                        <p className="m-0 mt-3 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '78ch' }}>
                            <strong style={{ color: 'var(--laudo-texto)' }}>Isto não é um achado contra o site. </strong>
                            O controle de recusa foi encontrado na página; o que não se concluiu foi o clique
                            automatizado — banner dentro de iframe de outra origem, elemento coberto por outro
                            e animação em curso são as causas comuns. O efeito prático é que o comportamento
                            do site depois da recusa segue sem medição nesta varredura.
                        </p>
                    )}

                    {/* `buttonLabels` não é o inventário de tudo o que estava na
                        tela: o motor varre os botões visíveis e guarda só os que
                        classificou como aceitar ou recusar. Prometer "todos os
                        rótulos" faria a ausência de um botão parecer prova de que
                        ele não existe. */}
                    {rotulos.length > 0 && (
                        <div className="mt-3">
                            <p className="m-0 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                Rótulos classificados como aceitar ou recusar
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {rotulos.map((r, i) => <Bruto key={`${r}-${i}`}>{r}</Bruto>)}
                            </div>
                        </div>
                    )}
                </div>

                <div>
                    <Etiqueta>O que o site fez depois da recusa</Etiqueta>
                    {!conseguiu ? (
                        /* O ponto mais delicado da tela inteira. Sem recusa não
                           há "depois da recusa": as três listas vêm vazias
                           porque nada foi medido, e apresentar isso como "nada
                           foi gravado" declararia conformidade a partir de um
                           teste que não aconteceu. */
                        <div className="mt-2">
                            <NaoMedido
                                titulo="Não há observação a fazer: a recusa não chegou a acontecer."
                                detalhe="Sem o clique em recusar, o comportamento posterior do site não foi medido. A ausência de cookies e requisições listados aqui não significa que o site respeitaria a recusa — significa que não houve recusa para observar."
                            />
                        </div>
                    ) : recusaRespeitada ? (
                        <div className="mt-2 space-y-3">
                            <div
                                className="flex items-start gap-3 rounded-lg border-l-[3px] px-4 py-3"
                                style={{ borderLeftColor: 'var(--laudo-conforme)', background: banho('var(--laudo-conforme)', 9) }}
                            >
                                <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--laudo-conforme)' }} />
                                <p className="m-0 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '76ch' }}>
                                    <strong style={{ color: 'var(--laudo-texto)' }}>A recusa foi respeitada. </strong>
                                    Depois do clique, o motor não observou requisição a endpoint de coleta,
                                    chave nova de armazenamento local nem cookie de rastreador conhecido. É a
                                    observação mais forte que esta varredura pode produzir a favor do site.
                                </p>
                            </div>
                            {/* Cookie novo existe e o veredito continua verde: é o
                                caso da própria ferramenta de consentimento gravando a
                                recusa. Esconder a lista faria o laudo afirmar "nenhum
                                cookie novo" sobre cookies que a varredura viu. */}
                            {cookiesDepois.length > 0 && (
                                <p className="m-0 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '78ch' }}>
                                    Cookies novos foram gravados depois do clique, e estão listados abaixo:
                                    nenhum deles bate com o catálogo de rastreadores do motor. É o
                                    comportamento esperado — a ferramenta de consentimento grava um cookie
                                    justamente para lembrar da recusa. Cookie de fornecedor fora do catálogo
                                    também cairia aqui, então vale conferir os nomes.
                                </p>
                            )}
                            <ObservadoDepoisDaRecusa
                                cookies={cookiesDepois}
                                requisicoes={requisicoesDepois}
                                chavesDeStorage={storageDepois}
                                rotuloDosCookies="Cookies gravados depois, nenhum deles rastreador conhecido"
                            />
                        </div>
                    ) : houveRastreamentoDepois ? (
                        <div className="mt-2 space-y-3">
                            <p
                                className="m-0 rounded-lg border-l-[3px] px-4 py-3 text-xs"
                                style={{
                                    borderLeftColor: 'var(--laudo-critico)',
                                    background: banho('var(--laudo-critico)', 9),
                                    color: 'var(--laudo-texto-suave)',
                                    maxWidth: '78ch',
                                }}
                            >
                                <strong style={{ color: 'var(--laudo-texto)' }}>A coleta continuou depois da recusa. </strong>
                                Tudo abaixo foi gravado ou enviado <em>após</em> o clique em recusar. Não é
                                erro de configuração de tag: é a decisão do titular registrada e ignorada.
                            </p>

                            <ObservadoDepoisDaRecusa
                                cookies={cookiesDepois}
                                requisicoes={requisicoesDepois}
                                chavesDeStorage={storageDepois}
                                rotuloDosCookies="Cookies gravados depois"
                            />
                        </div>
                    ) : (
                        /* A recusa aconteceu, mas o motor não publicou nem
                           `tracking_after_rejection` nem `rejection_respected` —
                           não deveria acontecer com o motor atual, e acontecendo,
                           a saída é mostrar o observado sem carimbar veredito. O
                           verde dependeria de separar rastreador de cookie comum,
                           e essa separação mora no backend. */
                        <div className="mt-2 space-y-3">
                            <NaoMedido
                                titulo="A recusa foi executada, mas esta varredura não trouxe a conclusão do teste."
                                detalhe="O que segue é o observado depois do clique, sem classificação. Sem a conclusão do motor o laudo não afirma que a recusa foi respeitada: distinguir cookie de rastreamento do cookie que a própria ferramenta de consentimento grava depende do catálogo que roda no servidor."
                            />
                            <ObservadoDepoisDaRecusa
                                cookies={cookiesDepois}
                                requisicoes={requisicoesDepois}
                                chavesDeStorage={storageDepois}
                                rotuloDosCookies="Cookies gravados depois"
                            />
                        </div>
                    )}
                </div>

                {achados.length > 0 && (
                    <div>
                        <Etiqueta>Conclusões do teste</Etiqueta>
                        <ul className="m-0 mt-2 list-none space-y-2 p-0">
                            {achados.map((a, i) => {
                                const cor = corDoStatus(a.status);
                                const evidencia = a.evidence || null;
                                return (
                                    <li
                                        key={`${a.check || 'recusa'}-${i}`}
                                        className="rounded-lg border-l-[3px] px-4 py-3"
                                        style={{ borderLeftColor: cor, background: banho(cor, 8) }}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            {a.status === 'critical' && (
                                                <AlertTriangle className="h-4 w-4" style={{ color: cor }} />
                                            )}
                                            <span className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                                {a.label || a.check || 'Achado sem rótulo'}
                                            </span>
                                            <span className="voz-evidencia text-[10px] uppercase tracking-widest" style={{ color: cor }}>
                                                {rotuloDoStatus(a.status)}
                                            </span>
                                        </div>
                                        {a.description && (
                                            <p className="m-0 mt-1.5 text-xs" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '78ch' }}>
                                                {a.description}
                                            </p>
                                        )}
                                        {evidencia && <EvidenciaDoAchado evidencia={evidencia} />}
                                        {a.recommendation && (
                                            <p
                                                className="m-0 mt-2 border-t pt-2 text-xs"
                                                style={{ borderColor: 'var(--laudo-linha)', color: 'var(--laudo-texto-suave)', maxWidth: '78ch' }}
                                            >
                                                <strong style={{ color: 'var(--laudo-texto)' }}>Como corrigir: </strong>
                                                {a.recommendation}
                                            </p>
                                        )}
                                        {a.guide && <Guia guia={a.guide} />}
                                        {/* Guia cortado pelo plano é dito. Sumir com
                                            ele em silêncio faz o laudo pago parecer
                                            igual ao grátis. */}
                                        {!a.guide && guiasBloqueados && (
                                            <p className="m-0 mt-2 text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                O passo a passo de correção deste achado está disponível nos planos pagos.
                                            </p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                )}
            </div>
        </Bloco>
    );
};

// ── Seção ────────────────────────────────────────────────────────────────────

const InventarioDeImplementacao = ({ gtm, consentimento, storage }: Props) => {
    /* Quais achados o bloco do teste de recusa vai imprimir. O bloco de
       consentimento consulta esta lista para não repetir os mesmos. */
    const checksDaRecusa = new Set(
        (Array.isArray(storage?.rejectionFindings) ? storage!.rejectionFindings : [])
            .map((a) => a.check)
            .filter((c): c is string => typeof c === 'string' && c.length > 0),
    );

    return (
        <div className="space-y-5">
            <BlocoDoGtm gtm={gtm} />
            <BlocoDeConsentimento
                consentimento={consentimento}
                recusa={storage?.rejectionTest}
                checksDaRecusa={checksDaRecusa}
            />
            <BlocoDaRecusa storage={storage} />
        </div>
    );
};

export default InventarioDeImplementacao;
