/**
 * Inventário do que foi gravado no navegador do visitante — um item por vez.
 *
 * Esta seção é a evidência mais forte do laudo, e a razão é uma só: **o
 * scanner nunca clica em "aceitar"**. Cada cookie e cada chave listada aqui
 * foi escrita no dispositivo de alguém que não manifestou nada. Não é
 * inferência por ordem no HTML, não é suposição a partir das tags detectadas —
 * é leitura direta de `context.cookies()` feita pelo `browser_fetcher` e
 * classificada pelo `audit_engine/storage_auditor.py`.
 *
 * Por isso o compromisso desta tela: ela mostra o que o motor observou e
 * **declara o que não foi observado**. O produto já exibiu cookies inventados
 * a partir das tags — um `_ga` com "2 anos" de validade que ninguém mediu — e
 * esse é o defeito mais caro que existe num laudo: quando o cliente leva ao
 * DPO uma lista que não se confirma, todo o resto do documento vira suspeito,
 * inclusive a parte correta.
 *
 * Quatro limites que esta tela precisa dizer em voz alta, porque quem lê
 * "cookies gravados sem consentimento" entende "todos":
 *
 *  1. `_identifica_cookie()` só devolve achado para cookie que casa com o
 *     catálogo de rastreadores conhecidos — os demais são ignorados com
 *     `continue`. A lista é de rastreadores reconhecidos, não do total gravado.
 *  2. O mesmo vale para localStorage/sessionStorage, que passam por
 *     `STORAGE_DE_RASTREIO` (lista fixa, débito registrado no CLAUDE.md).
 *  3. Nem toda varredura lê armazenamento. `auditar_armazenamento` roda também
 *     sobre a coleta que nunca abriu navegador, e nesse caso devolve listas
 *     vazias com exatamente a mesma forma da coleta que leu tudo. Quem separa
 *     as duas é o `scanMethod`, que por isso chega aqui como prop.
 *  4. O plano gratuito zera as duas listas no backend. O corte nos cookies é
 *     visível pelo total que sobrevive a ele; o das chaves, não — para esse só
 *     existe `showsDetail`.
 *
 * Omitir qualquer um deles transformaria "não reconheci", "não li" ou "seu
 * plano não mostra" em "não existe", que é a forma silenciosa de declarar
 * conformidade que ninguém mediu.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Cookie, Database, Info, EyeOff, Eye, Clock, Globe } from 'lucide-react';

/** Um achado de `storage_auditor.AchadoDeArmazenamento`, já em camelCase. */
export interface AchadoDeArmazenamento {
    /** `cookie` | `localStorage` | `sessionStorage` */
    type?: string;
    name?: string;
    owner?: string;
    purpose?: string;
    severity?: string;
    detail?: string;
    /**
     * Dias até expirar. `null`/ausente significa **cookie de sessão**: é assim
     * que `_duracao_em_dias()` trata `expires` vazio, -1 ou 0. Não é campo
     * faltando — é uma leitura com significado próprio.
     */
    durationDays?: number | null;
    httpOnly?: boolean;
    domain?: string | null;
}

/** O bloco `storage` da resposta de `/api/audit`. */
export interface ArmazenamentoDoLaudo {
    cookiesWithoutConsent?: AchadoDeArmazenamento[];
    /** Contagem real, anterior ao corte por plano. Sobrevive ao gating. */
    totalCookiesWithoutConsent?: number;
    storageWithoutConsent?: AchadoDeArmazenamento[];
}

interface Props {
    /** URL auditada — usada só para separar cookie próprio de terceiro. */
    url?: string;
    /** `storage` da resposta. Ausente quando a varredura não trouxe a leitura. */
    storage?: ArmazenamentoDoLaudo | null;
    /**
     * `scanMethod` da resposta — `browser`, `har`, `static_fallback`,
     * `html_fallback` ou `html_source`.
     *
     * Sem ele esta tela não pode dizer o que a lista vazia significa. O motor
     * monta o bloco `storage` em toda varredura, inclusive na que nunca abriu
     * navegador: `auditar_armazenamento` recebe um scan sem `cookies` e sem
     * `local_storage` e devolve listas vazias — indistinguíveis, na resposta,
     * de "abrimos o navegador e não achamos nada". Dizer "nenhum cookie
     * encontrado" sobre uma coleta que não lê cookie é declarar conformidade
     * que ninguém mediu.
     */
    metodoDaVarredura?: string | null;
    /**
     * `showsDetail` da resposta: o plano recebe as listas item a item, ou só o
     * veredito e as contagens.
     *
     * É o mesmo booleano que decide o corte no backend
     * (`plano_ve_detalhe` → `quantidade_visivel` → `_storage_para_o_plano`),
     * e é o único sinal confiável para a lista de chaves — que é cortada sem
     * que a resposta publique nenhum total para denunciar a diferença.
     */
    mostraDetalhe?: boolean;
}

/** O que cada forma de coleta consegue provar sobre o que ficou gravado. */
type Leitura =
    /** A coleta lê esse armazenamento por inteiro. */
    | 'completa'
    /** Lê parte dele — o que não aparece não pode ser negado. */
    | 'parcial'
    /** A coleta não toca nesse armazenamento: lista vazia não afirma nada. */
    | 'nenhuma'
    /** Método ausente ou desconhecido: não dá para saber o que foi lido. */
    | 'nao-declarado';

/**
 * O que o método da varredura permitiu ler de cookies e de storage local.
 *
 * `browser` roda `context.cookies()` e lê o `localStorage` da página. `har`
 * reconstrói cookies a partir do `Set-Cookie` das respostas gravadas
 * (`_cookies_da_entrada`, em `har_parser.py`) — cookie escrito por JavaScript
 * não passa por ali, e o `localStorage` do HAR fica sempre vazio, porque um
 * HAR registra rede, não armazenamento. As coletas de código-fonte não
 * executam script nenhum.
 *
 * Método desconhecido cai em `nao-declarado`, nunca no caso otimista: um valor
 * novo no motor não pode virar afirmação de conformidade aqui.
 */
const leituraPossivel = (metodo?: string | null): { cookies: Leitura; chaves: Leitura } => {
    switch ((metodo || '').trim()) {
        case 'browser':
            return { cookies: 'completa', chaves: 'completa' };
        case 'har':
            return { cookies: 'parcial', chaves: 'nenhuma' };
        case 'static_fallback':
        case 'html_fallback':
        case 'html_source':
            return { cookies: 'nenhuma', chaves: 'nenhuma' };
        default:
            return { cookies: 'nao-declarado', chaves: 'nao-declarado' };
    }
};

/**
 * Acima disso o motor já classifica o prazo como longo (`DURACAO_LONGA_DIAS`,
 * em `storage_auditor.py`). O número é repetido aqui porque a tela precisa
 * rotular o cookie como persistente; se ele mudar lá, muda aqui — deixar os
 * dois valores divergindo faria a etiqueta contradizer o texto do próprio
 * motor, que aparece logo abaixo dela.
 */
const DIAS_DE_CONSERVACAO_LONGA = 180;

const corDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'var(--laudo-critico)'
        : nivel === 'high' ? 'var(--laudo-alto)'
            : nivel === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

/* "Registrado" é o rótulo do que chegou sem gravidade declarada: o item foi
   observado, e a classificação é que não veio. Inventar "Baixo" para ele diria
   que o motor avaliou e achou pouco grave — coisa diferente. */
const rotuloDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'Crítico'
        : nivel === 'high' ? 'Alto'
            : nivel === 'medium' ? 'Médio'
                : nivel === 'low' ? 'Baixo' : 'Registrado';

/** "1 cookie observado" / "8 cookies observados". */
const plural = (n: number, singular: string, plurais: string) =>
    `${n} ${n === 1 ? singular : plurais}`;

/**
 * Traduz o prazo de conservação para linguagem humana.
 *
 * "400 dias" não comunica nada a quem lê o laudo; "1 ano e 1 mês" comunica que
 * o visitante segue identificável na próxima eleição. O número cru continua ao
 * lado na tela — é ele que o cliente confere no DevTools, e arredondar a
 * evidência para ficar bonito seria trocar prova por prosa.
 *
 * O ano vale 365 dias e o mês 30; por isso o resultado vem marcado como
 * aproximado. Devolve `null` quando não há prazo a traduzir.
 */
const prazoLegivel = (dias: number): string | null => {
    const total = Math.round(dias);
    if (total <= 0) return null;

    const anos = Math.floor(total / 365);
    const restoDoAno = total - anos * 365;
    const meses = Math.floor(restoDoAno / 30);
    const diasSoltos = restoDoAno - meses * 30;

    const partes = [
        anos > 0 ? plural(anos, 'ano', 'anos') : null,
        meses > 0 ? plural(meses, 'mês', 'meses') : null,
        diasSoltos > 0 ? plural(diasSoltos, 'dia', 'dias') : null,
    ].filter((p): p is string => p !== null);

    /* Duas unidades bastam para dar a escala. Três viram ruído — ninguém
       precisa de "1 ano, 1 mês e 5 dias" para entender que é muito tempo. */
    return partes.slice(0, 2).join(' e ');
};

/** Host da URL auditada, ou `null` quando não dá para determinar. */
const hostDaUrl = (url?: string): string | null => {
    if (!url) return null;
    /* URL sem esquema é comum no histórico e em laudo antigo; `new URL` levanta
       nesse caso. A segunda tentativa cobre isso, e a falha é devolvida como
       `null` — que a tela mostra como "origem não classificada", em vez de
       chutar que o cookie é de terceiro. */
    for (const candidata of [url, `https://${url}`]) {
        try {
            return new URL(candidata).hostname.toLowerCase();
        } catch {
            // Formato inválido nesta tentativa; a próxima decide.
        }
    }
    return null;
};

type OrigemDoCookie = 'proprio' | 'terceiro' | 'indeterminada';

/**
 * Cookie próprio ou de terceiro, pela mesma regra que o navegador usa para
 * decidir a quem entregar o cookie: o domínio precisa cobrir o host visitado.
 *
 * `.terra.com.br` num acesso a `www.terra.com.br` é próprio; `.doubleclick.net`
 * é terceiro. A distinção importa no laudo porque cookie de terceiro sai do
 * controle do titular do site — ele alimenta o perfil que o fornecedor mantém
 * em todos os outros sites onde está instalado.
 *
 * A comparação vale nos dois sentidos de propósito. O contexto do navegador
 * devolve também os cookies dos subdomínios tocados durante a visita, então um
 * `www.terra.com.br` lido a partir de `terra.com.br` não cobre o host e cairia
 * como "Terceiro" — acusação falsa contra o próprio site, do tipo que faz o
 * cliente desconfiar dos achados verdadeiros.
 */
const origemDoCookie = (dominio?: string | null, host?: string | null): OrigemDoCookie => {
    if (!dominio || !host) return 'indeterminada';
    const d = dominio.replace(/^\./, '').toLowerCase();
    if (!d) return 'indeterminada';
    if (host === d || host.endsWith(`.${d}`) || d.endsWith(`.${host}`)) return 'proprio';
    return 'terceiro';
};

/** Superfície embutida: mais escura que o cartão nos dois temas. */
const FUNDO_EMBUTIDO = 'color-mix(in srgb, var(--laudo-fundo) 70%, transparent)';

const Etiqueta = ({ children }: { children: React.ReactNode }) => (
    <span className="t-etiqueta block mb-0.5">{children}</span>
);

/** Uma célula do quadro de evidência: rótulo fixo em cima, leitura embaixo. */
const Campo = ({
    rotulo,
    children,
    icone,
}: {
    rotulo: string;
    children: React.ReactNode;
    icone?: React.ReactNode;
}) => (
    <div>
        <Etiqueta>{rotulo}</Etiqueta>
        <div
            className="text-[13px] flex items-center gap-1.5 flex-wrap"
            style={{ color: 'var(--laudo-texto)' }}
        >
            {icone}
            {children}
        </div>
    </div>
);

/** Etiqueta pequena com contorno na cor recebida. */
const Selo = ({ cor, children }: { cor: string; children: React.ReactNode }) => (
    <span
        className="voz-evidencia text-[10px] uppercase tracking-wider rounded border px-1.5 py-px whitespace-nowrap"
        style={{ color: cor, borderColor: cor, background: `color-mix(in srgb, ${cor} 10%, transparent)` }}
    >
        {children}
    </span>
);

/** Aviso de contexto — nunca verde: aqui não se comemora nada. */
const Nota = ({ children, cor = 'var(--laudo-texto-fraco)' }: { children: React.ReactNode; cor?: string }) => (
    <div
        className="flex items-start gap-2 rounded-lg px-3 py-2"
        style={{ background: `color-mix(in srgb, ${cor} 12%, transparent)` }}
    >
        <Info className="h-4 w-4 shrink-0 mt-0.5" style={{ color: cor }} />
        <p className="text-xs m-0 t-corpo" style={{ color: 'var(--laudo-texto-suave)' }}>
            {children}
        </p>
    </div>
);

/** Ficha de um cookie: nome, dono, finalidade e as leituras conferíveis. */
const FichaDeCookie = ({ item, host }: { item: AchadoDeArmazenamento; host: string | null }) => {
    const cor = corDaGravidade(item.severity);
    const origem = origemDoCookie(item.domain, host);

    /* `durationDays` ausente é cookie de sessão — leitura com significado, não
       campo vazio (ver `_duracao_em_dias`). Já um prazo negativo significa data
       de expiração no passado: o cookie estava lá mesmo assim, e dizer isso é
       mais honesto do que esconder o caso raro. */
    const temPrazo = typeof item.durationDays === 'number' && Number.isFinite(item.durationDays);
    const dias = temPrazo ? (item.durationDays as number) : null;
    const legivel = dias !== null ? prazoLegivel(dias) : null;
    const persistente = dias !== null && dias > DIAS_DE_CONSERVACAO_LONGA;

    return (
        <li className="border-l-2 pl-4 py-1" style={{ borderColor: cor }}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span
                    className="voz-evidencia text-sm font-semibold"
                    style={{ color: 'var(--laudo-texto)' }}
                >
                    {item.name || '(cookie sem nome na leitura)'}
                </span>
                <Selo cor={cor}>{rotuloDaGravidade(item.severity)}</Selo>
                {persistente && <Selo cor="var(--laudo-alto)">Persistente</Selo>}
            </div>

            <p className="text-[13px] mt-1 mb-0" style={{ color: 'var(--laudo-texto-suave)' }}>
                <span style={{ color: 'var(--laudo-texto)' }}>{item.owner || 'Dono não identificado'}</span>
                {item.purpose ? ` · ${item.purpose}` : ' · finalidade não classificada pelo catálogo'}
            </p>

            <div
                className="mt-2 grid gap-x-6 gap-y-3 rounded-lg px-3 py-2.5"
                style={{
                    background: FUNDO_EMBUTIDO,
                    gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
                }}
            >
                <Campo rotulo="Permanência" icone={<Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}>
                    {textoDaPermanencia(dias, legivel)}
                </Campo>

                <Campo rotulo="Domínio" icone={<Globe className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}>
                    {item.domain ? (
                        <>
                            <span className="voz-evidencia">{item.domain}</span>
                            {origem === 'proprio' && <Selo cor="var(--laudo-baixo)">Próprio</Selo>}
                            {origem === 'terceiro' && <Selo cor="var(--laudo-critico)">Terceiro</Selo>}
                            {origem === 'indeterminada' && (
                                <span className="text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    origem não classificada
                                </span>
                            )}
                        </>
                    ) : (
                        <span style={{ color: 'var(--laudo-texto-fraco)' }}>não informado na leitura</span>
                    )}
                </Campo>

                <Campo
                    rotulo="Leitura por JavaScript"
                    icone={
                        item.httpOnly
                            ? <EyeOff className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                            : <Eye className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--laudo-alto)' }} />
                    }
                >
                    {item.httpOnly ? (
                        <span>
                            Bloqueada <span style={{ color: 'var(--laudo-texto-fraco)' }}>(HttpOnly — gravado pelo servidor)</span>
                        </span>
                    ) : (
                        <span>
                            Liberada <span style={{ color: 'var(--laudo-texto-fraco)' }}>(qualquer script da página lê o valor)</span>
                        </span>
                    )}
                </Campo>
            </div>

            {item.detail && (
                <p className="t-apoio text-xs mt-2 mb-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {item.detail}
                </p>
            )}
        </li>
    );
};

/**
 * O texto da permanência. Fica separado porque são três casos que afirmam
 * coisas diferentes — expira ao fechar o navegador, fica N dias, ou já estava
 * vencido — e um ternário aninhado na JSX esconderia essa diferença. Note que
 * nenhum deles é "não sei": prazo desconhecido não existe nesta leitura, já
 * que `_duracao_em_dias` só devolve `None` para cookie de sessão.
 */
function textoDaPermanencia(dias: number | null, legivel: string | null) {
    if (dias === null) {
        return (
            <span>
                Sessão <span style={{ color: 'var(--laudo-texto-fraco)' }}>(expira ao fechar o navegador)</span>
            </span>
        );
    }
    if (dias <= 0) {
        return (
            <span style={{ color: 'var(--laudo-texto-suave)' }}>
                Prazo já vencido no momento da leitura
            </span>
        );
    }
    /* Prazo curto demais para virar dia inteiro. `_gat`, do Google Analytics,
       expira em um minuto: arredondar mostraria "0 dias", que soa como erro de
       leitura quando na verdade é o comportamento correto do cookie. */
    if (Math.round(dias) < 1) {
        return (
            <span>
                Menos de um dia{' '}
                <span style={{ color: 'var(--laudo-texto-fraco)' }}>(cookie de curta duração)</span>
            </span>
        );
    }
    /* O número é o que falta até expirar, contado no instante da leitura
       (`_duracao_em_dias` faz `(expires - now) / 86400`) — não a validade
       configurada na origem. Num cookie já em uso os dois divergem, e o laudo
       precisa dizer qual dos dois está mostrando: é esse valor que o cliente
       vai conferir no DevTools, e ele muda a cada dia que passa. */
    return (
        <span>
            {legivel ? <>≈ {legivel} </> : null}
            <span className="voz-evidencia" style={{ color: 'var(--laudo-texto-fraco)' }}>
                ({plural(Math.round(dias), 'dia', 'dias')} a contar da leitura)
            </span>
        </span>
    );
}

/** Ficha de uma chave de localStorage/sessionStorage. */
const FichaDeChave = ({ item }: { item: AchadoDeArmazenamento }) => {
    const cor = corDaGravidade(item.severity);
    return (
        <li className="border-l-2 pl-4 py-1" style={{ borderColor: cor }}>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="voz-evidencia text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                    {item.name || '(chave sem nome na leitura)'}
                </span>
                <Selo cor={cor}>{rotuloDaGravidade(item.severity)}</Selo>
                {item.type && <Selo cor="var(--laudo-carimbo)">{item.type}</Selo>}
            </div>
            <p className="text-[13px] mt-1 mb-0" style={{ color: 'var(--laudo-texto-suave)' }}>
                <span style={{ color: 'var(--laudo-texto)' }}>{item.owner || 'Dono não identificado'}</span>
                {item.purpose ? ` · ${item.purpose}` : ''}
            </p>
            {item.detail && (
                <p className="t-apoio text-xs mt-1.5 mb-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {item.detail}
                </p>
            )}
        </li>
    );
};

/**
 * Como os cookies desta varredura foram obtidos — texto de cabeçalho.
 *
 * A frase anterior dizia que o scanner "não clicou em nada — nem em aceitar,
 * nem em recusar", e isso é falso desde que existe a segunda fase do
 * `browser_fetcher`: com controle na página, `tentar_recusar` clica em
 * "Recusar" e o laudo publica o resultado em `rejectionTest`. Duas seções do
 * mesmo documento afirmando coisas opostas sobre o mesmo scanner derrubam a
 * peça inteira. O que vale para esta lista é outra coisa, e continua verdade:
 * `result.cookies` é capturado **antes** daquela fase e nunca é reescrito
 * depois dela.
 */
const DescricaoDaColetaDeCookies = ({ alcance, url }: { alcance: Leitura; url?: string }) => {
    const endereco = url ? <span className="voz-evidencia">{url}</span> : 'a página';

    if (alcance === 'completa') {
        return (
            <>
                O scanner abriu {endereco} e leu o navegador antes de tocar em qualquer
                controle da página. Tudo listado abaixo já estava gravado sem que o visitante
                manifestasse nada. É leitura direta, por
                <span className="voz-evidencia"> context.cookies()</span>, que enxerga inclusive
                o que o JavaScript da página não vê. O teste de recusa, quando há botão para
                clicar, acontece depois desta captura e não altera esta lista.
            </>
        );
    }
    if (alcance === 'parcial') {
        return (
            <>
                Esta varredura veio de um registro de navegação (HAR), não de uma visita do
                scanner. Os cookies abaixo foram reconstruídos do cabeçalho
                <span className="voz-evidencia"> Set-Cookie</span> das respostas gravadas —
                cookie escrito por JavaScript não aparece num HAR. A lista é um piso do que
                foi gravado, nunca o inventário completo. E o arquivo é gravado por quem
                audita, que pode ter aceitado o aviso antes de começar: por isso aqui não se
                afirma que foram gravados sem consentimento — só que foram gravados.
            </>
        );
    }
    if (alcance === 'nenhuma') {
        return (
            <>
                Esta varredura não abriu navegador: leu apenas o código-fonte de {endereco}.
                Cookie só existe em navegador aberto, então nada foi lido aqui — e nada pode
                ser afirmado, nem a favor nem contra o site.
            </>
        );
    }
    return (
        <>
            A resposta não declarou como {endereco} foi coletada, e é o método que determina
            se houve leitura de cookies. O que aparecer abaixo foi observado; o que não
            aparecer não pode ser tratado como ausente.
        </>
    );
};

const InventarioDeArmazenamento = ({ url, storage, metodoDaVarredura, mostraDetalhe }: Props) => {
    /* "Veio vazio" e "não veio" são afirmações diferentes, e confundir as duas
       já fez este produto declarar conformidade sobre uma varredura que tinha
       gravado oito cookies: a chave chegava com outro nome, o `??` virava lista
       vazia e a tela mostrava escudo verde. Por isso a checagem é pelo tipo do
       campo, não pelo tamanho da lista. */
    const trouxeLeituraDeCookies = Array.isArray(storage?.cookiesWithoutConsent);
    const trouxeLeituraDeChaves = Array.isArray(storage?.storageWithoutConsent);

    /* Lista presente não é medição feita: o motor monta o bloco `storage` para
       toda varredura, e a coleta sem navegador entrega listas vazias com a
       mesma forma da coleta que leu tudo. É o método que separa as duas. */
    const alcance = leituraPossivel(metodoDaVarredura);

    if (!storage || (!trouxeLeituraDeCookies && !trouxeLeituraDeChaves)) {
        return (
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6 flex items-start gap-3">
                    <Info className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    <div>
                        <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                            Esta varredura não trouxe a leitura de armazenamento.
                        </p>
                        <p className="t-apoio text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Ausência de leitura não é ausência de cookies: a captura exige o
                            navegador real, e sem ela não há como afirmar nada — nem a favor,
                            nem contra o site. Rode a auditoria de novo para obter o inventário.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    const cookies = storage.cookiesWithoutConsent ?? [];
    const chaves = storage.storageWithoutConsent ?? [];
    const host = hostDaUrl(url);

    /* `??` e não `||`: zero é resposta legítima do motor, e `||` a trocaria
       silenciosamente pelo tamanho da lista. */
    const totalDeCookies = storage.totalCookiesWithoutConsent ?? cookies.length;

    /* O corte por plano acontece no backend (`_storage_para_o_plano`), e o
       contador sobrevive a ele justamente para que a tela possa denunciar a
       diferença. Lista menor que o total não é "acabaram os cookies". */
    const cookiesOcultos = Math.max(0, totalDeCookies - cookies.length);

    /* A lista de chaves é cortada pelo mesmo `quantidade_visivel`, mas a
       resposta não publica total nenhum para ela — então não há como flagrar o
       corte pelos próprios dados. Inferir pelo número de cookies ocultos, como
       esta tela fazia, falha justamente no caso em que o erro é pior: plano
       gratuito, nenhum cookie de rastreador conhecido (nada a ocultar, sinal
       fica em `false`) e chaves zeradas pelo corte — a tela declarava "nenhuma
       chave gravada" sobre uma lista que o plano esvaziou. `showsDetail` é o
       mesmo booleano que decide o corte no backend, e vale mesmo quando a
       contagem de cookies é zero. */
    const listasPodemEstarCortadas = cookiesOcultos > 0 || mostraDetalhe === false;

    const deTerceiros = cookies.filter(c => origemDoCookie(c.domain, host) === 'terceiro').length;

    return (
        <div className="space-y-4">
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                        <Cookie className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                        {/* "Sem consentimento" é afirmação sobre o estado do visitante, e só
                            se sustenta quando foi o scanner quem visitou: ele não clica em
                            nada antes desta captura. Num HAR, quem gravou foi o auditor, que
                            pode ter aceitado o aviso antes de ligar o DevTools — o título
                            então diz o que é verificável, que é o registro do cookie. */}
                        {alcance.cookies === 'parcial'
                            ? 'Cookies gravados durante a navegação registrada'
                            : 'Cookies gravados sem consentimento'}
                    </CardTitle>
                    <CardDescription className="t-apoio" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        <DescricaoDaColetaDeCookies alcance={alcance.cookies} url={url} />
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-4">
                    {!trouxeLeituraDeCookies ? (
                        /* Chegamos aqui com a leitura de storage presente e a de cookies
                           ausente. Cair no ramo de baixo diria "nenhum cookie encontrado"
                           sobre uma lista que nunca existiu — a forma silenciosa de
                           declarar conformidade que ninguém mediu. */
                        <Nota>
                            Esta varredura trouxe o armazenamento local, mas não trouxe a leitura de
                            cookies. Nada pode ser afirmado sobre cookies aqui — nem a favor, nem
                            contra o site.
                        </Nota>
                    ) : totalDeCookies === 0 && alcance.cookies === 'nenhuma' ? (
                        /* Lista vazia porque ninguém leu. Cair no texto de baixo aqui
                           seria o escudo verde sobre dado ausente: "nenhum cookie
                           encontrado" sugere que se procurou. */
                        <Nota cor="var(--laudo-medio)">
                            <strong>Não houve leitura de cookies nesta varredura.</strong> A coleta foi
                            feita sobre o código-fonte da página, sem abrir navegador — nenhum cookie
                            chega a ser gravado nesse modo, e por isso a ausência de lista aqui não diz
                            nada sobre o site. Rode a auditoria com navegador para obter o inventário.
                        </Nota>
                    ) : totalDeCookies === 0 ? (
                        /* Sem escudo verde: o catálogo de rastreadores é finito, então
                           "nenhum reconhecido" não é "nenhum gravado". A afirmação é
                           limitada ao que a varredura sabe checar — e, quando o método
                           não foi declarado, nem isso se pode garantir. */
                        <Nota>
                            Nenhum cookie de rastreamento conhecido foi encontrado antes de qualquer
                            manifestação do visitante. A verificação cobre o catálogo de rastreadores
                            do motor — cookie de fornecedor fora dele não seria reconhecido, e por
                            isso este resultado não equivale a declarar a página livre de cookies.
                            {alcance.cookies === 'parcial' && (
                                <> Some a isso o limite do HAR: cookie gravado por JavaScript não é
                                    registrado nele, e portanto não seria visto por esta varredura.</>
                            )}
                            {alcance.cookies === 'nao-declarado' && (
                                <> E o método de coleta não veio na resposta: sem saber se houve
                                    navegador, não dá para afirmar sequer que a leitura aconteceu.</>
                            )}
                        </Nota>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span
                                    className="voz-evidencia text-sm"
                                    style={{ color: 'var(--laudo-texto)' }}
                                >
                                    {plural(totalDeCookies, 'cookie observado', 'cookies observados')}
                                </span>
                                {deTerceiros > 0 && (
                                    <span className="text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        {plural(deTerceiros, 'de terceiro', 'de terceiros')}
                                        {/* A origem só pode ser classificada nos cookies que a
                                            tela recebeu. Com a lista cortada, o número é um piso —
                                            dizer isso evita que ele seja lido como total. */}
                                        {cookiesOcultos > 0 ? ' entre os listados' : ''} — fora do
                                        controle de quem responde pelo site
                                    </span>
                                )}
                            </div>

                            {alcance.cookies === 'nenhuma' && (
                                /* Contradição entre o que a resposta contou e o que o método
                                   declarado consegue ler. Esconder qualquer um dos dois seria
                                   escolher por conta própria em qual acreditar. */
                                <Nota cor="var(--laudo-medio)">
                                    A resposta declara um método de coleta que não lê cookies (somente
                                    código-fonte) e, ainda assim, trouxe esta lista. Os itens abaixo
                                    vêm do motor, mas a origem da leitura ficou inconsistente —
                                    confirme antes de usar como evidência.
                                </Nota>
                            )}

                            {cookiesOcultos > 0 && (
                                <Nota cor="var(--laudo-medio)">
                                    {cookies.length === 0 ? (
                                        <>
                                            A contagem acima é real, mas <strong>o plano atual não exibe a
                                            lista</strong>. Os {totalDeCookies} cookies foram observados e
                                            estão no laudo completo — o que falta aqui é o detalhamento,
                                            não a evidência.
                                        </>
                                    ) : (
                                        <>
                                            Listados {cookies.length} de {totalDeCookies}:{' '}
                                            <strong>{plural(cookiesOcultos, 'cookie está oculto', 'cookies estão ocultos')} pelo
                                            plano atual</strong>. A lista abaixo está incompleta de propósito e
                                            não deve ser usada como inventário final.
                                        </>
                                    )}
                                </Nota>
                            )}

                            {cookies.length > 0 && (
                                <ul className="space-y-4 list-none p-0 m-0">
                                    {cookies.map((c, i) => (
                                        <FichaDeCookie
                                            key={`${c.name ?? 'sem-nome'}-${c.domain ?? 'sem-dominio'}-${i}`}
                                            item={c}
                                            host={host}
                                        />
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </CardContent>
            </Card>

            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base" style={{ color: 'var(--laudo-texto)' }}>
                        <Database className="h-4 w-4" style={{ color: 'var(--laudo-carimbo)' }} />
                        localStorage e sessionStorage
                    </CardTitle>
                    <CardDescription className="t-apoio" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        Não são cookies e não aparecem no aviso de cookies do site — mas identificam
                        o visitante do mesmo jeito. O localStorage ainda é pior num ponto: não expira
                        sozinho, fica até alguém limpar.
                    </CardDescription>
                </CardHeader>

                <CardContent className="space-y-3">
                    {!trouxeLeituraDeChaves ? (
                        <Nota>
                            Esta varredura trouxe os cookies, mas não trouxe a leitura de
                            localStorage e sessionStorage. Nada pode ser afirmado sobre eles aqui.
                        </Nota>
                    ) : chaves.length === 0 && alcance.chaves === 'nenhuma' ? (
                        /* O motor devolve lista vazia mesmo quando `scan.local_storage`
                           nunca foi preenchido — no HAR ele é sempre `{}`, porque um HAR
                           registra rede e não armazenamento. Dizer "nenhuma chave gravada"
                           aí é declarar conformidade sobre coisa nenhuma. */
                        <Nota cor="var(--laudo-medio)">
                            <strong>Não houve leitura de localStorage nem de sessionStorage nesta
                            varredura.</strong>{' '}
                            {metodoDaVarredura === 'har'
                                ? 'Um registro de navegação (HAR) grava as requisições de rede, não o armazenamento do navegador — essas chaves ficam fora do arquivo.'
                                : 'A coleta foi feita sobre o código-fonte, sem executar script: nada chega a ser gravado nem lido nesse modo.'}{' '}
                            A ausência de lista aqui não afirma nada sobre o site.
                        </Nota>
                    ) : chaves.length === 0 ? (
                        <Nota cor={listasPodemEstarCortadas ? 'var(--laudo-medio)' : 'var(--laudo-texto-fraco)'}>
                            {listasPodemEstarCortadas ? (
                                <>
                                    A lista veio vazia, mas <strong>o plano atual corta as listas desta
                                    seção</strong> — e o motor não publica um total de chaves para
                                    comparar. Não é possível distinguir “nada foi gravado” de “o plano
                                    escondeu”. O laudo completo responde isso.
                                </>
                            ) : (
                                <>
                                    Nenhuma chave de armazenamento local conhecida foi gravada antes do
                                    aceite. Isso vale só para o armazenamento: <strong>não altera nada do
                                    que os cookies acima registram</strong>, e a verificação cobre o
                                    catálogo de rastreadores do motor — chave de fornecedor fora dele
                                    passaria despercebida.
                                    {alcance.chaves === 'nao-declarado' && (
                                        <> A resposta também não declarou o método de coleta: sem
                                            navegador não há leitura de armazenamento, e sem o método não
                                            dá para confirmar que ela aconteceu.</>
                                    )}
                                </>
                            )}
                        </Nota>
                    ) : (
                        <>
                            {/* `p` e não `span`: o `space-y-3` do cartão espaça irmãos por
                                margem, e margem vertical não pega em elemento inline. */}
                            <p className="voz-evidencia text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                                {plural(chaves.length, 'chave gravada', 'chaves gravadas')}
                            </p>
                            {listasPodemEstarCortadas && (
                                <Nota cor="var(--laudo-medio)">
                                    O plano atual corta as listas desta seção e o motor não publica um
                                    total de chaves — pode haver mais do que o exibido aqui.
                                </Nota>
                            )}
                            <ul className="space-y-4 list-none p-0 m-0">
                                {chaves.map((s, i) => (
                                    <FichaDeChave key={`${s.type ?? 'storage'}-${s.name ?? 'sem-nome'}-${i}`} item={s} />
                                ))}
                            </ul>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};

export default InventarioDeArmazenamento;
