/**
 * O inventário de eventos: o que foi disparado, com quais parâmetros, e o que
 * falta em cada um.
 *
 * O `EventAuditPanel` mostrava só o nome do evento e um par de badges. O motor
 * traz muito mais e nada disso chegava à tela: cada parâmetro observado com
 * valor, tipo esperado e tipo real, a lista do que falta (obrigatório e
 * recomendado) e o push como veio. É essa parte que responde às duas perguntas
 * do cliente — "o que a empresa está pegando" e "o que poderia estar melhor".
 *
 * Três decisões que valem mais que o desenho:
 *
 * 1. **Agrupa por nome, mas conta pelo `summary`.** A lista `events` traz uma
 *    entrada por disparo (seis `gtm.scrollDepth` são seis entradas) e chega
 *    cortada pelo plano. Contar a partir dela dá número errado no free. Os
 *    quatro agregados do topo vêm de `summary`, que sobrevive ao corte.
 *
 * 2. **Repetir não é duplicar.** `isDuplicate` do motor marca todo nome com
 *    mais de um disparo — inclusive `gtm.scrollDepth`, `gtm.click` e
 *    `gtm.dom`, que repetem por design. Quem já filtrou esses é o backend, em
 *    `duplicate_detector.EVENTOS_REPETIDOS_POR_DESIGN`, e o resultado dessa
 *    filtragem é a lista `duplicates`. Então o veredito de duplicata sai
 *    daqui: `duplicates`, nunca `isDuplicate`. A lista espelhada abaixo só
 *    serve para *explicar* por que um nome repetido não foi apontado — ela não
 *    decide nada, e por isso não quebra o laudo se ficar defasada.
 *
 * 3. **Valor de parâmetro pode ser dado pessoal.** `page_view` de rede carrega
 *    o beacon inteiro, com `cid` e o que mais o site tenha empilhado. Passa
 *    por `mascararTexto` (mesmas regras do `audit_engine/mascarador.py`) e é
 *    truncado antes de ir para a tela.
 *
 * Campo que não veio é dito, nunca preenchido: "não informado" no lugar de um
 * zero que o cliente leria como medição.
 */
import { useId, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
    Activity,
    AlertTriangle,
    ChevronDown,
    ChevronRight,
    CircleSlash,
    Copy,
    Info,
    ShieldAlert,
    ShoppingCart,
} from 'lucide-react';
import { mascararTexto } from '@/services/mascaraDePII';

// ── Formato do que a API entrega ────────────────────────────────────────────
// Tudo opcional de propósito: a resposta é cortada por plano e o componente
// precisa dizer "não veio" em vez de estourar.

export interface ParametroDeEvento {
    name?: string;
    value?: string | null;
    expectedType?: string | null;
    actualType?: string | null;
    isValid?: boolean;
    issue?: string | null;
}

export interface EventoDoLaudo {
    name?: string;
    source?: string;
    validity?: string;
    confidence?: string;
    detectionMethod?: string;
    parametersFound?: ParametroDeEvento[];
    parameterCount?: number;
    missingRequiredParams?: string[];
    missingRecommendedParams?: string[];
    occurrenceCount?: number;
    lineNumber?: number | null;
    sourceSnippet?: string | null;
    isDuplicate?: boolean;
}

export interface DuplicataDoLaudo {
    entityType?: string;
    name?: string;
    occurrenceCount?: number;
    severity?: string;
    recommendation?: string;
    confidence?: string;
    note?: string | null;
}

/** Os agregados de `summary`. Só eles sobrevivem ao corte por plano. */
export interface ResumoDeEventos {
    totalEvents?: number;
    eventsDetected?: number;
    uniqueEventNames?: number;
    duplicatedEventNames?: number;
    eventsWithIssues?: number;
    ecommerceEventsDetected?: string[];
}

interface Props {
    eventos?: EventoDoLaudo[];
    duplicatas?: DuplicataDoLaudo[];
    resumo?: ResumoDeEventos;
}

// ── Tabelas de tradução ─────────────────────────────────────────────────────

/**
 * Espelho de `EVENTOS_REPETIDOS_POR_DESIGN` (`audit_engine/duplicate_detector.py`).
 *
 * Só explica: o veredito de duplicata vem de `duplicates`, produzido pelo
 * backend já com este filtro aplicado. Se a lista de lá crescer e esta ficar
 * para trás, o pior que acontece é um nome repetido aparecer como "repetição
 * não classificada" em vez de trazer o motivo — nunca o contrário, e nunca um
 * alarme falso.
 */
const REPETEM_POR_DESIGN = new Set([
    'gtm.scrollDepth', 'gtm.click', 'gtm.linkClick', 'gtm.timer',
    'gtm.formSubmit', 'gtm.elementVisibility', 'gtm.video', 'gtm.historyChange',
    'scroll', 'click', 'video_progress', 'timer', 'user_engagement',
    'form_start', 'view_item_list', 'view_promotion', 'select_promotion',
    'gtm.dom', 'gtm.load', 'gtm.js', 'gtm.init', 'gtm.init_consent',
]);

interface Validade {
    rotulo: string;
    cor: string;
    /** O que aquele estado significa para quem vai corrigir. */
    explica: string;
    /** Ordem de gravidade: menor é pior, usada para escolher o rótulo do grupo. */
    peso: number;
}

const VALIDADES: Record<string, Validade> = {
    malformed: {
        rotulo: 'Malformado',
        cor: 'var(--laudo-critico)',
        explica: 'Parâmetro com tipo ou formato incompatível com o esperado pelo GA4.',
        peso: 0,
    },
    partial: {
        rotulo: 'Parcial',
        cor: 'var(--laudo-medio)',
        explica: 'O evento dispara, mas falta parâmetro obrigatório — o relatório do GA4 fica incompleto.',
        peso: 1,
    },
    no_parameters: {
        rotulo: 'Sem parâmetros',
        cor: 'var(--laudo-baixo)',
        explica: 'Disparo observado sem nenhum parâmetro anexado.',
        peso: 2,
    },
    /* O motor devolve `valid` em dois casos que não são a mesma coisa: o evento
       está no catálogo GA4 e trouxe os obrigatórios, ou o evento NÃO está no
       catálogo e não havia o que exigir (`event_auditor._validate_event`
       devolve `valid` quando não acha esquema). Rotular os dois como "Válido",
       em verde, carimba conformidade sobre um evento que ninguém conferiu —
       `gtm.scrollDepth` e `page_view` de rede caem todos aí. "Sem apontamento"
       é o que a varredura de fato mediu nos dois casos. */
    valid: {
        rotulo: 'Sem apontamento',
        cor: 'var(--laudo-conforme)',
        explica: 'Nenhum parâmetro obrigatório ausente e nada apontado como inválido. Evento que o GA4 não cataloga não tem obrigatórios definidos — aqui isto significa "nada a apontar", não "conferido contra um padrão".',
        peso: 3,
    },
};

/**
 * Validade desconhecida não vira "Válido" nem some: aparece com o valor cru.
 * Um estado novo no motor precisa ficar visível na tela, não ser absorvido
 * pelo caso mais otimista.
 */
const leValidade = (bruto?: string): Validade => {
    const chave = (bruto ?? '').trim();
    if (chave && VALIDADES[chave]) return VALIDADES[chave];
    return {
        rotulo: chave ? `Não classificado (${chave})` : 'Validade não informada',
        cor: 'var(--laudo-baixo)',
        explica: 'A varredura não classificou a validade deste disparo.',
        peso: 2,
    };
};

/** O identificador cru do motor não é texto de laudo. */
const METODOS: Record<string, string> = {
    browser_datalayer: 'dataLayer lido no navegador durante a visita',
    network_request: 'requisição de rede interceptada',
    source: 'código-fonte da página',
    script_pattern: 'padrão de código em script embutido',
    dom: 'árvore do documento (DOM)',
    script_url: 'endereço do script externo',
    inferred: 'inferência — não confirmado pela varredura',
};

const CONFIANCAS: Record<string, string> = {
    high: 'confiança alta',
    medium: 'confiança média',
    low: 'confiança baixa',
};

/**
 * O tipo observado chega com o nome que a linguagem do motor usa (`str`,
 * `int`, `NoneType`). Traduzir é leitura, não invenção — o que não estiver na
 * tabela aparece cru, para um tipo novo do motor ficar visível em vez de
 * sumir.
 */
const TIPOS: Record<string, string> = {
    str: 'texto',
    string: 'texto',
    int: 'número inteiro',
    float: 'número',
    number: 'número',
    bool: 'booleano',
    boolean: 'booleano',
    list: 'lista',
    array: 'lista',
    dict: 'objeto',
    object: 'objeto',
    null: 'nulo',
    NoneType: 'nulo',
};

const CORES_DE_GRAVIDADE: Record<string, string> = {
    critical: 'var(--laudo-critico)',
    high: 'var(--laudo-alto)',
    warning: 'var(--laudo-medio)',
    medium: 'var(--laudo-medio)',
    low: 'var(--laudo-baixo)',
};

const ROTULOS_DE_GRAVIDADE: Record<string, string> = {
    critical: 'Crítica',
    high: 'Alta',
    warning: 'Atenção',
    medium: 'Média',
    low: 'Baixa',
};

// ── Utilidades ──────────────────────────────────────────────────────────────

/**
 * Mascara e trunca. Devolve também o que foi encontrado de dado pessoal, para
 * a tela poder dizer que mascarou — esconder sem avisar seria o mesmo tipo de
 * silêncio que este laudo existe para evitar.
 */
const paraExibir = (bruto: unknown, limite: number) => {
    /* Número e booleano viram texto ANTES da máscara. O motor serializa todo
       valor como string, mas o histórico já devolveu `0` e `false` crus — e
       `mascararTexto` devolve não-string intacto, o que fazia a célula exibir
       "vazio" sobre um valor que existe. Vazio de mentira é pior que vazio. */
    const normalizado = typeof bruto === 'number' || typeof bruto === 'boolean' ? String(bruto) : bruto;
    const { texto, achados } = mascararTexto(normalizado);
    const inteiro = typeof texto === 'string' ? texto : '';
    const cortado = inteiro.length > limite;
    return {
        texto: cortado ? `${inteiro.slice(0, limite)}…` : inteiro,
        cortado,
        tamanho: inteiro.length,
        mascarou: achados.length > 0,
    };
};

/**
 * Número que o motor mediu, ou `null` quando o campo não veio.
 *
 * Zero é resposta legítima e passa — "0 eventos com problema" é uma medição.
 * Aceita string numérica porque a mesma resposta já chegou de duas fontes
 * (`/api/audit` e o histórico) com o campo serializado de jeitos diferentes, e
 * "13" virar "não informado" apagaria uma contagem que existe.
 */
const numero = (bruto: unknown): number | null => {
    if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
    if (typeof bruto === 'string' && bruto.trim() !== '') {
        const n = Number(bruto);
        return Number.isFinite(n) ? n : null;
    }
    return null;
};

const lista = <T,>(bruto: T[] | undefined | null): T[] => (Array.isArray(bruto) ? bruto : []);

type ClasseDeRepeticao = 'unico' | 'duplicata' | 'por_design' | 'sem_classificacao';

interface GrupoDeEvento {
    nome: string;
    /** Uma entrada por disparo trazido na resposta. Pode ser menos que `disparos`. */
    entradas: EventoDoLaudo[];
    /** `occurrenceCount` do motor: quantas vezes o nome disparou. */
    disparos: number | null;
    validade: Validade;
    /** Disparos do mesmo nome com validades diferentes — o rótulo do grupo mostra a pior. */
    validadeVaria: boolean;
    obrigatoriosAusentes: string[];
    recomendadosAusentes: string[];
    classe: ClasseDeRepeticao;
    duplicata?: DuplicataDoLaudo;
}

const unicos = (valores: string[]): string[] => [...new Set(valores.filter(Boolean))];

/**
 * Junta os disparos do mesmo nome em um bloco só.
 *
 * Sem isso a aba mostra seis linhas idênticas de `gtm.scrollDepth` e o que
 * realmente muda entre elas — o percentual de rolagem — fica escondido no meio
 * da repetição.
 */
const agrupar = (
    eventos: EventoDoLaudo[],
    duplicatasDeEvento: Map<string, DuplicataDoLaudo>,
): GrupoDeEvento[] => {
    const mapa = new Map<string, EventoDoLaudo[]>();
    for (const ev of eventos) {
        if (!ev || typeof ev !== 'object') continue;
        const nome = (ev.name ?? '').trim() || 'evento sem nome declarado';
        const atual = mapa.get(nome) ?? [];
        atual.push(ev);
        mapa.set(nome, atual);
    }

    const grupos: GrupoDeEvento[] = [];
    for (const [nome, entradas] of mapa) {
        const contagens = entradas.map(e => numero(e.occurrenceCount)).filter((n): n is number => n !== null);
        // O motor grava a mesma contagem em todas as entradas do nome; pegar o
        // maior protege contra uma entrada avulsa vinda sem o campo.
        const disparos = contagens.length ? Math.max(...contagens) : null;
        const repete = (disparos ?? entradas.length) > 1;
        const duplicata = duplicatasDeEvento.get(nome);

        const classe: ClasseDeRepeticao =
            !repete ? 'unico'
                : duplicata ? 'duplicata'
                    : REPETEM_POR_DESIGN.has(nome) ? 'por_design'
                        : 'sem_classificacao';

        // A pior validade entre os disparos manda no rótulo do grupo: um
        // `page_view` correto não apaga o `page_view` que veio sem parâmetro.
        // Quando elas divergem o cabeçalho avisa, senão "Sem parâmetros" no
        // topo faria parecer que nenhum disparo trouxe parâmetro algum.
        const validades = entradas.map(e => leValidade(e.validity));
        const validade = validades.reduce(
            (pior, atual) => (atual.peso < pior.peso ? atual : pior),
            leValidade('valid'),
        );

        grupos.push({
            nome,
            entradas,
            disparos,
            validade,
            validadeVaria: new Set(validades.map(v => v.rotulo)).size > 1,
            obrigatoriosAusentes: unicos(entradas.flatMap(e => lista(e.missingRequiredParams))),
            recomendadosAusentes: unicos(entradas.flatMap(e => lista(e.missingRecommendedParams))),
            classe,
            duplicata,
        });
    }

    /* Ordem de leitura: o que precisa de correção primeiro. Parâmetro
       obrigatório ausente e evento malformado abrem a lista; evento saudável
       fecha. Dentro da mesma faixa, ordem alfabética para a página ficar
       estável entre varreduras. */
    const faixa = (g: GrupoDeEvento) =>
        g.obrigatoriosAusentes.length || g.validade.peso === 0 ? 0
            : g.classe === 'duplicata' ? 1
                : g.validade.peso === 1 ? 2
                    : g.recomendadosAusentes.length ? 3
                        : 4;

    return grupos.sort((a, b) => faixa(a) - faixa(b) || a.nome.localeCompare(b.nome, 'pt-BR'));
};

// ── Peças de tela ───────────────────────────────────────────────────────────

const Etiqueta = ({ children, cor }: { children: React.ReactNode; cor: string }) => (
    <span
        className="voz-evidencia text-[10px] uppercase tracking-wider rounded border px-2 py-0.5 whitespace-nowrap"
        style={{ color: cor, borderColor: cor, background: `color-mix(in srgb, ${cor} 12%, transparent)` }}
    >
        {children}
    </span>
);

const Contador = ({ rotulo, valor, nota }: { rotulo: string; valor: number | null; nota?: string }) => (
    <div
        className="rounded-lg border p-3"
        style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-fundo)' }}
    >
        <p className="t-etiqueta m-0">{rotulo}</p>
        <p
            className="voz-evidencia text-2xl font-semibold m-0 mt-1"
            style={{ color: valor === null ? 'var(--laudo-texto-fraco)' : 'var(--laudo-texto)' }}
        >
            {/* Agregado ausente não vira zero: zero significaria "medimos e não
                achamos", e ninguém mediu. */}
            {valor === null ? 'não informado' : valor}
        </p>
        {nota && (
            <p className="text-[11px] leading-snug m-0 mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                {nota}
            </p>
        )}
    </div>
);

interface Situacao {
    texto: string;
    /** Só o que a varredura apontou como problema recebe destaque. */
    alerta: boolean;
}

/**
 * O que a varredura concluiu sobre o parâmetro — e nada além.
 *
 * A coluna dizia "ok" sempre que `isValid` não era `false`. Acontece que o
 * motor cria `EventParameter` com `is_valid=True` por padrão e **nunca**
 * compara tipo: `expected_type` não é preenchido em lugar nenhum de
 * `event_auditor.py`. Ou seja, "ok" era o valor-padrão de um campo que
 * ninguém avaliou, exibido como aprovação — o mesmo escudo verde sobre dado
 * ausente que este laudo existe para não repetir.
 *
 * Sem tipo esperado não há comparação possível, e é isso que a célula passa a
 * dizer. Se um dia o motor catalogar tipos, "tipo compatível" volta a
 * aparecer — mas aí com medição atrás.
 */
const leSituacao = (p: ParametroDeEvento): Situacao => {
    if (p.isValid === false) {
        return { texto: p.issue || 'apontado como inválido, sem detalhe do motivo', alerta: true };
    }
    if (p.issue) return { texto: p.issue, alerta: true };
    if (!p.expectedType) return { texto: 'sem referência para comparar', alerta: false };
    if (p.isValid === true) return { texto: 'tipo compatível com o esperado', alerta: false };
    return { texto: 'não avaliado', alerta: false };
};

/** A tabela de parâmetros de um disparo: o que o site enviou, campo a campo. */
const TabelaDeParametros = ({ parametros, deRede }: { parametros: ParametroDeEvento[]; deRede: boolean }) => {
    const celula = 'px-2 py-1.5 align-top text-left';
    return (
        <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full border-collapse text-xs min-w-[34rem]">
                <thead>
                    <tr style={{ borderBottom: '1px solid var(--laudo-linha)' }}>
                        {['Parâmetro', 'Valor observado', 'Tipo esperado', 'Tipo observado', 'Situação'].map(h => (
                            <th key={h} className={`t-etiqueta ${celula} font-normal`}>{h}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {parametros.map((p, i) => {
                        const situacao = leSituacao(p);
                        const invalido = situacao.alerta;
                        const valor = paraExibir(p.value, 120);
                        return (
                            <tr
                                key={`${p.name ?? 'sem-nome'}-${i}`}
                                style={{
                                    borderBottom: '1px solid var(--laudo-linha)',
                                    background: invalido
                                        ? 'color-mix(in srgb, var(--laudo-critico) 10%, transparent)'
                                        : 'transparent',
                                }}
                            >
                                <td className={`${celula} voz-evidencia`} style={{ color: 'var(--laudo-texto)' }}>
                                    {p.name || '—'}
                                </td>
                                <td className={`${celula} voz-evidencia break-all`} style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {valor.tamanho === 0
                                        ? <span style={{ color: 'var(--laudo-texto-fraco)' }}>vazio</span>
                                        : valor.texto}
                                    {valor.cortado && (
                                        <span className="ml-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                            {/* "recebidos": o motor já corta o valor antes de
                                                enviar, então este número é o tamanho do que
                                                chegou — não necessariamente o do valor original. */}
                                            ({valor.tamanho} caracteres recebidos)
                                        </span>
                                    )}
                                    {valor.mascarou && (
                                        <span className="ml-1" style={{ color: 'var(--laudo-alto)' }}>
                                            dado pessoal mascarado
                                        </span>
                                    )}
                                </td>
                                <td className={`${celula} voz-evidencia`} style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    {p.expectedType ? (TIPOS[p.expectedType] ?? p.expectedType) : 'não catalogado'}
                                </td>
                                <td className={`${celula} voz-evidencia`} style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {p.actualType ? (TIPOS[p.actualType] ?? p.actualType) : 'não informado'}
                                </td>
                                <td className={celula} style={{ color: invalido ? 'var(--laudo-critico)' : 'var(--laudo-texto-fraco)' }}>
                                    {situacao.texto}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            {deRede && (
                /* Sem esta ressalva a coluna "Tipo observado" mentiria por
                   omissão: numa requisição tudo trafega como texto, então
                   "texto" ali não distingue número de string — é a forma do
                   transporte, não a do valor no dataLayer. */
                <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '66ch' }}>
                    Disparo lido na requisição de rede: todo parâmetro trafega como texto, então o
                    tipo observado descreve o transporte, não o valor original no dataLayer.
                </p>
            )}
        </div>
    );
};

/** Um disparo: método, linha, parâmetros e o push como veio. */
const Disparo = ({ evento, indice, total }: { evento: EventoDoLaudo; indice: number; total: number }) => {
    const [trechoInteiro, setTrechoInteiro] = useState(false);
    const validade = leValidade(evento.validity);
    const parametros = lista(evento.parametersFound);
    const contados = numero(evento.parameterCount);
    const trecho = paraExibir(evento.sourceSnippet, trechoInteiro ? 4000 : 220);
    const linha = numero(evento.lineNumber);
    const deRede = evento.detectionMethod === 'network_request';

    return (
        <div className="pl-3 border-l" style={{ borderColor: 'var(--laudo-linha)' }}>
            <p className="t-etiqueta m-0 mb-2">
                {total > 1 ? `Disparo ${indice + 1} de ${total}` : 'Disparo registrado'}
                {' · '}
                {METODOS[evento.detectionMethod ?? ''] || `método não traduzido (${evento.detectionMethod || 'não informado'})`}
                {evento.confidence && ` · ${CONFIANCAS[evento.confidence] || `confiança ${evento.confidence}`}`}
                {linha !== null && ` · linha ${linha} do HTML`}
                {' · '}
                {validade.rotulo}
            </p>

            {parametros.length > 0 ? (
                <TabelaDeParametros parametros={parametros} deRede={deRede} />
            ) : (
                <p className="text-xs m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {/* Contagem sem lista é o corte por plano agindo. Dizer isso é
                        melhor do que exibir "0 parâmetros", que seria falso. */}
                    {contados !== null && contados > 0
                        ? `O motor contou ${contados} parâmetro(s) neste disparo, mas os detalhes não vieram nesta resposta.`
                        : 'Nenhum parâmetro foi anexado a este disparo.'}
                </p>
            )}

            {trecho.tamanho > 0 && (
                <div className="mt-2">
                    {/* Chamar a URL do beacon de "como veio" faria parecer código
                        da página. São coisas diferentes: uma é o que o site
                        escreveu, a outra é o que saiu pela rede. */}
                    <p className="t-etiqueta m-0 mb-1">
                        {deRede ? 'Requisição observada' : 'Como veio'}
                    </p>
                    <pre
                        className="voz-evidencia text-[11px] leading-relaxed m-0 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all"
                        style={{
                            background: 'var(--sup-2)',
                            border: '1px solid var(--laudo-linha)',
                            color: 'var(--laudo-texto-suave)',
                        }}
                    >
                        {trecho.texto}
                    </pre>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                        {trecho.cortado && (
                            <button
                                type="button"
                                onClick={() => setTrechoInteiro(v => !v)}
                                className="voz-ferramenta text-[11px] underline"
                                style={{ color: 'var(--laudo-carimbo)' }}
                            >
                                {trechoInteiro ? 'recolher' : `mostrar os ${trecho.tamanho} caracteres`}
                            </button>
                        )}
                        {trecho.mascarou && (
                            <span className="text-[11px]" style={{ color: 'var(--laudo-alto)' }}>
                                dado pessoal identificado e mascarado nesta exibição
                            </span>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

const ListaDeAusentes = ({
    titulo, itens, cor, explicacao,
}: { titulo: string; itens: string[]; cor: string; explicacao: string }) => (
    <div>
        <p className="text-xs font-semibold m-0 mb-1" style={{ color: cor }}>{titulo}</p>
        <div className="flex flex-wrap gap-1 mb-1">
            {itens.map(p => (
                <span
                    key={p}
                    className="voz-evidencia text-[11px] rounded border px-1.5 py-0.5"
                    style={{ color: cor, borderColor: cor, background: `color-mix(in srgb, ${cor} 12%, transparent)` }}
                >
                    {p}
                </span>
            ))}
        </div>
        <p className="text-[11px] m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '62ch' }}>
            {explicacao}
        </p>
    </div>
);

const Grupo = ({ grupo }: { grupo: GrupoDeEvento }) => {
    const [aberto, setAberto] = useState(false);
    // `useId` e não o nome do evento: dois laudos na mesma página (comparador)
    // gerariam ids repetidos, e aí o leitor de tela aponta para o painel errado.
    const idDoPainel = `inventario-evento-${useId()}`;
    const Seta = aberto ? ChevronDown : ChevronRight;
    const disparosDeclarados = grupo.disparos ?? grupo.entradas.length;
    const faltaDetalhe = grupo.disparos !== null && grupo.entradas.length < grupo.disparos;

    return (
        <div
            className="rounded-lg border overflow-hidden"
            style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
        >
            <button
                type="button"
                onClick={() => setAberto(v => !v)}
                aria-expanded={aberto}
                aria-controls={idDoPainel}
                className="w-full text-left px-3 py-3 flex items-start gap-2"
            >
                <Seta className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }} />
                <span className="flex-1 min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                        <code className="voz-evidencia text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                            {grupo.nome}
                        </code>
                        <Etiqueta cor={grupo.validade.cor}>{grupo.validade.rotulo}</Etiqueta>
                        {grupo.validadeVaria && (
                            <Etiqueta cor="var(--laudo-baixo)">pior de {grupo.entradas.length} disparos</Etiqueta>
                        )}
                        {grupo.classe === 'duplicata' && (
                            <Etiqueta cor={CORES_DE_GRAVIDADE[grupo.duplicata?.severity ?? 'warning'] ?? 'var(--laudo-medio)'}>
                                duplicata · {disparosDeclarados}×
                            </Etiqueta>
                        )}
                        {grupo.classe === 'por_design' && (
                            <Etiqueta cor="var(--laudo-baixo)">repete por design · {disparosDeclarados}×</Etiqueta>
                        )}
                        {grupo.classe === 'sem_classificacao' && (
                            <Etiqueta cor="var(--laudo-baixo)">{disparosDeclarados}× · repetição não classificada</Etiqueta>
                        )}
                        {grupo.obrigatoriosAusentes.length > 0 && (
                            <Etiqueta cor="var(--laudo-critico)">
                                {grupo.obrigatoriosAusentes.length} obrigatório(s) ausente(s)
                            </Etiqueta>
                        )}
                        {grupo.obrigatoriosAusentes.length === 0 && grupo.recomendadosAusentes.length > 0 && (
                            <Etiqueta cor="var(--laudo-medio)">
                                {grupo.recomendadosAusentes.length} recomendado(s) ausente(s)
                            </Etiqueta>
                        )}
                    </span>
                    <span className="block text-[11px] mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                        origem: {unicos(grupo.entradas.map(e => e.source ?? '')).join(' · ') || 'não informada'}
                    </span>
                </span>
            </button>

            {aberto && (
                <div id={idDoPainel} className="px-3 pb-4 pt-1 space-y-4" style={{ borderTop: '1px solid var(--laudo-linha)' }}>
                    <p className="text-xs m-0 pt-3" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}>
                        {grupo.validade.explica}
                        {grupo.validadeVaria && ' Os disparos deste evento não vieram todos iguais — o cabeçalho mostra o pior deles.'}
                    </p>

                    {grupo.classe === 'duplicata' && grupo.duplicata && (
                        <div
                            className="rounded border p-3"
                            style={{
                                borderColor: CORES_DE_GRAVIDADE[grupo.duplicata.severity ?? 'warning'] ?? 'var(--laudo-medio)',
                                background: 'color-mix(in srgb, var(--laudo-medio) 8%, transparent)',
                            }}
                        >
                            <p className="text-xs m-0" style={{ color: 'var(--laudo-texto)', maxWidth: '66ch' }}>
                                <strong>Duplicata apontada pelo motor. </strong>
                                {grupo.duplicata.recommendation || 'Sem recomendação registrada para este achado.'}
                            </p>
                            {grupo.duplicata.note && (
                                <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    {grupo.duplicata.note}
                                </p>
                            )}
                        </div>
                    )}

                    {grupo.classe === 'por_design' && (
                        <p className="text-xs m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '66ch' }}>
                            Este nome dispara várias vezes por natureza — rolagem, clique ou ciclo de vida
                            do container. A repetição está registrada, mas não é apontada como erro:
                            tratá-la como duplicata encheria o laudo de alarme falso.
                        </p>
                    )}

                    {grupo.classe === 'sem_classificacao' && (
                        <p className="text-xs m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '66ch' }}>
                            O nome repete, e a varredura não classificou a repetição como duplicata. O fato
                            está registrado; a causa precisa de verificação manual.
                        </p>
                    )}

                    {grupo.obrigatoriosAusentes.length > 0 && (
                        <ListaDeAusentes
                            titulo="Parâmetros obrigatórios ausentes"
                            itens={grupo.obrigatoriosAusentes}
                            cor="var(--laudo-critico)"
                            explicacao="O GA4 espera estes parâmetros neste evento. Sem eles o relatório fica incompleto e a atribuição de conversão não fecha."
                        />
                    )}

                    {grupo.recomendadosAusentes.length > 0 && (
                        <ListaDeAusentes
                            titulo="Parâmetros recomendados ausentes"
                            itens={grupo.recomendadosAusentes}
                            cor="var(--laudo-medio)"
                            explicacao="Não impedem o evento de funcionar, mas são o que o GA4 usa para os relatórios padrão. Acrescentá-los é o ganho mais barato desta lista."
                        />
                    )}

                    {faltaDetalhe && (
                        <p className="text-[11px] m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            O motor contou {grupo.disparos} disparo(s) deste evento; esta resposta trouxe o
                            detalhe de {grupo.entradas.length}.
                        </p>
                    )}

                    <div className="space-y-4">
                        {grupo.entradas.map((ev, i) => (
                            <Disparo key={i} evento={ev} indice={i} total={grupo.entradas.length} />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// ── Componente ──────────────────────────────────────────────────────────────

const InventarioDeEventos = ({ eventos, duplicatas, resumo }: Props) => {
    const listaDeEventos = lista(eventos);

    /* Só duplicata de evento. As de tag e de container pertencem à seção de
       tags — repeti-las aqui contaria o mesmo achado duas vezes. */
    const duplicatasDeEvento = new Map<string, DuplicataDoLaudo>();
    for (const d of lista(duplicatas)) {
        if (d?.entityType === 'event' && d.name) duplicatasDeEvento.set(d.name, d);
    }

    const grupos = agrupar(listaDeEventos, duplicatasDeEvento);

    const total = numero(resumo?.totalEvents) ?? numero(resumo?.eventsDetected);
    const unicosDoResumo = numero(resumo?.uniqueEventNames);
    const repetidosDoResumo = numero(resumo?.duplicatedEventNames);
    const comProblema = numero(resumo?.eventsWithIssues);
    const ecommerce = lista(resumo?.ecommerceEventsDetected);

    const porDesign = grupos.filter(g => g.classe === 'por_design');
    const semClassificacao = grupos.filter(g => g.classe === 'sem_classificacao');

    /* Prova de envio e prova de coleta não são a mesma coisa, e o laudo não
       pode juntar as duas num número só. Requisição interceptada é dado que
       SAIU da máquina do visitante; push no dataLayer é dado montado na página,
       que pode nunca ter sido transmitido. Afirmar "o site enviou 13" sobre
       nove pushes locais é exatamente o tipo de exagero que o DPO derruba. */
    const disparosDeRede = listaDeEventos.filter(e => e.detectionMethod === 'network_request').length;
    const disparosDeDatalayer = listaDeEventos.filter(e => e.detectionMethod === 'browser_datalayer').length;
    const disparosDeCodigo = listaDeEventos.length - disparosDeRede - disparosDeDatalayer;

    /* A seção de duplicados sai da lista `duplicates`, não dos grupos: no plano
       free a lista de eventos chega cortada, e um achado de duplicata cujo
       evento não veio detalhado sumiria da tela se dependesse do grupo. */
    const apontadas = [...duplicatasDeEvento.values()];

    if (listaDeEventos.length === 0 && apontadas.length === 0) {
        return (
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p className="t-etiqueta m-0 mb-2">Eventos e parâmetros</p>
                    <p className="voz-argumento m-0" style={{ color: 'var(--laudo-texto)', maxWidth: '66ch' }}>
                        <CircleSlash className="h-4 w-4 inline mr-2" style={{ color: 'var(--laudo-texto-fraco)' }} />
                        {/* Três estados diferentes, e só um deles é "não tem".
                            Contador ausente significa que ninguém mediu — dizer
                            "nenhum evento" aí seria afirmar ausência a partir de
                            silêncio. */}
                        {total === null
                            ? 'Esta resposta não trouxe a lista de eventos nem o contador — a varredura não registrou medição de eventos.'
                            : total > 0
                                ? `O resumo desta varredura registra ${total} evento(s), mas a lista detalhada não veio nesta resposta.`
                                : 'Nenhum evento foi observado durante a visita.'}
                    </p>
                    <p className="text-xs mt-3 m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '68ch' }}>
                        A varredura observa o que dispara em uma visita, sem login e sem aceitar o aviso de
                        cookies. Evento disparado após interação, dentro de área autenticada, por
                        aplicação de página única ou pelo servidor não aparece aqui — ausência nesta lista
                        não prova ausência no site.
                    </p>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-5">

            {/* Resumo. Os quatro números vêm de `summary` — contar a partir da
                lista daria número menor no plano free, onde ela chega cortada. */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p className="t-etiqueta m-0 mb-1">Eventos e parâmetros</p>
                    <h3
                        className="t-secao voz-argumento m-0 mb-4 flex items-center gap-2"
                        style={{ color: 'var(--laudo-texto)' }}
                    >
                        <Activity className="h-5 w-5 shrink-0" style={{ color: 'var(--laudo-carimbo)' }} />
                        O que a página dispara e o que sai pela rede
                    </h3>

                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        <Contador rotulo="Disparos observados" valor={total} />
                        <Contador rotulo="Nomes distintos" valor={unicosDoResumo} />
                        <Contador
                            rotulo="Nomes repetidos"
                            valor={repetidosDoResumo}
                            /* Sem a lista de duplicidade não dá para dizer "0
                               apontados": seria transformar ausência de dado em
                               ausência de achado. */
                            nota={duplicatas === undefined
                                ? 'a lista de duplicidade não veio nesta resposta'
                                : `${apontadas.length} apontado(s) como duplicata`}
                        />
                        <Contador
                            rotulo="Com problema"
                            valor={comProblema}
                            nota="parâmetro obrigatório ausente, segundo o catálogo GA4"
                        />
                    </div>

                    {/* Quanto do que está aqui é prova de envio. Derivado de
                        `detectionMethod`, disparo a disparo — nada é suposto. */}
                    {listaDeEventos.length > 0 && (
                        <p
                            className="text-xs mt-3 m-0"
                            style={{ color: 'var(--laudo-texto-suave)', maxWidth: '70ch' }}
                        >
                            Dos {listaDeEventos.length} disparo(s) detalhados nesta resposta,{' '}
                            <strong style={{ color: 'var(--laudo-texto)' }}>{disparosDeRede}</strong>{' '}
                            {disparosDeRede === 1 ? 'saiu' : 'saíram'} da máquina do visitante por requisição
                            de rede — esses são prova de envio.{' '}
                            {disparosDeDatalayer > 0 && (
                                <>
                                    Outros {disparosDeDatalayer} foram lidos no dataLayer da página: provam
                                    que o dado foi montado, não necessariamente que foi transmitido.{' '}
                                </>
                            )}
                            {disparosDeCodigo > 0 && (
                                <>E {disparosDeCodigo} vieram do código servido, sem confirmação de disparo.</>
                            )}
                        </p>
                    )}

                    {/* A distinção que evita o alarme falso. O motor marca
                        `isDuplicate` em todo nome repetido; o veredito de
                        duplicata é o da lista `duplicates`, que já exclui o que
                        repete por design. */}
                    {(porDesign.length > 0 || semClassificacao.length > 0) && (
                        <p
                            className="text-xs mt-4 pt-3 m-0 border-t"
                            style={{ color: 'var(--laudo-texto-suave)', borderColor: 'var(--laudo-linha)', maxWidth: '70ch' }}
                        >
                            <Info className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" style={{ color: 'var(--laudo-carimbo)' }} />
                            Repetir não é duplicar.{' '}
                            {porDesign.length > 0 && (
                                <>
                                    {porDesign.map(g => g.nome).join(', ')}{' '}
                                    {porDesign.length === 1 ? 'repete' : 'repetem'} por design — rolagem,
                                    clique e ciclo de vida do container disparam várias vezes por natureza, e
                                    apontá-los como erro tiraria a credibilidade dos achados verdadeiros.{' '}
                                </>
                            )}
                            {semClassificacao.length > 0 && (
                                <>
                                    {semClassificacao.map(g => g.nome).join(', ')}{' '}
                                    {semClassificacao.length === 1 ? 'repete' : 'repetem'} sem classificação do
                                    motor — o fato está registrado, a causa precisa de verificação manual.
                                </>
                            )}
                        </p>
                    )}

                    {ecommerce.length > 0 && (
                        <div className="mt-4 pt-3 border-t" style={{ borderColor: 'var(--laudo-linha)' }}>
                            <p className="t-etiqueta m-0 mb-2 flex items-center gap-1.5">
                                <ShoppingCart className="h-3.5 w-3.5" /> Eventos de e-commerce
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {ecommerce.map(nome => (
                                    <span
                                        key={nome}
                                        className="voz-evidencia text-[11px] rounded border px-1.5 py-0.5"
                                        style={{
                                            color: 'var(--laudo-carimbo)',
                                            borderColor: 'var(--laudo-carimbo)',
                                            background: 'var(--laudo-carimbo-wash)',
                                        }}
                                    >
                                        {nome}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Duplicatas: o achado inteiro, fora do acordeão, porque é o que
                infla conversão e vira decisão de negócio errada. */}
            {apontadas.length > 0 && (
                <Card
                    className="border-l-4"
                    style={{
                        borderColor: 'var(--laudo-linha)',
                        borderLeftColor: 'var(--laudo-alto)',
                        background: 'var(--laudo-superficie)',
                    }}
                >
                    <CardContent className="pt-6">
                        <p className="t-etiqueta m-0 mb-3 flex items-center gap-1.5">
                            <Copy className="h-3.5 w-3.5" /> Eventos duplicados
                        </p>
                        <ul className="list-none p-0 m-0 space-y-3">
                            {apontadas.map((d, i) => {
                                const gravidade = d.severity ?? 'warning';
                                const cor = CORES_DE_GRAVIDADE[gravidade] ?? 'var(--laudo-medio)';
                                const disparos = numero(d.occurrenceCount);
                                return (
                                    <li key={d.name ?? i} className="pl-3 border-l" style={{ borderColor: cor }}>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <code className="voz-evidencia text-sm" style={{ color: 'var(--laudo-texto)' }}>
                                                {d.name || 'evento sem nome declarado'}
                                            </code>
                                            <Etiqueta cor={cor}>
                                                {ROTULOS_DE_GRAVIDADE[gravidade] ?? gravidade}
                                                {disparos !== null && ` · ${disparos}×`}
                                            </Etiqueta>
                                        </div>
                                        <p className="text-xs m-0 mt-1" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '68ch' }}>
                                            {d.recommendation || 'Sem recomendação registrada para este achado.'}
                                        </p>
                                        {d.note && (
                                            <p className="text-[11px] m-0 mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                {d.note}
                                            </p>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </CardContent>
                </Card>
            )}

            {/* O inventário. Fechado por padrão: o cliente escolhe onde entrar. */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p className="t-etiqueta m-0 mb-1">Inventário por evento</p>
                    <p className="text-xs m-0 mb-4" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '70ch' }}>
                        Abra um evento para ver cada disparo com os parâmetros que o acompanharam, o tipo
                        de cada valor e o que falta. "Tipo esperado" só aparece nos parâmetros que o GA4
                        cataloga; onde está vazio, a varredura não tem referência para comparar.
                    </p>

                    {/* Chegar aqui sem grupo é a lista cortada pelo plano — os
                        achados de duplicata acima vieram, o detalhe não. */}
                    {grupos.length === 0 ? (
                        <p className="text-xs m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '70ch' }}>
                            Esta resposta trouxe os achados de duplicidade, mas não a lista detalhada dos
                            eventos.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {grupos.map(g => <Grupo key={g.nome} grupo={g} />)}
                        </div>
                    )}

                    {grupos.some(g => g.obrigatoriosAusentes.length > 0) && (
                        <p
                            className="text-xs mt-4 pt-3 border-t m-0 flex gap-2"
                            style={{ color: 'var(--laudo-texto-suave)', borderColor: 'var(--laudo-linha)', maxWidth: '70ch' }}
                        >
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--laudo-critico)' }} />
                            <span>
                                Evento com parâmetro obrigatório ausente chega ao GA4 e é contado, mas sem o
                                dado que o relatório usa. O número aparece; a análise que dependeria dele, não.
                            </span>
                        </p>
                    )}
                </CardContent>
            </Card>

            <p className="text-xs leading-relaxed" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '72ch' }}>
                <ShieldAlert className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />
                <strong>Alcance e tratamento.</strong> A lista cobre o que disparou durante uma visita à
                página indicada, sem login e sem aceitar o aviso de cookies — nada aqui aconteceu depois
                de uma manifestação do titular, porque nenhuma foi dada. O que foi observado em
                requisição de rede saiu da máquina do visitante nessas condições; o que foi lido no
                dataLayer é registro na própria página, e prova a coleta, não o envio. Evento de área
                autenticada, de aplicação de página única ou disparado pelo servidor não é observável
                por esta varredura. Valores que casam com padrão de dado pessoal são mascarados antes de
                aparecer nesta tela.
            </p>
        </div>
    );
};

export default InventarioDeEventos;
