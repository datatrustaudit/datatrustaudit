/**
 * O laudo para quem responde juridicamente — DPO, jurídico, compliance.
 *
 * Este leitor não lê JavaScript e não quer. Precisa de três coisas: qual
 * dispositivo da LGPD sustenta cada achado, que evidência existe para
 * sustentá-lo, e o que dizer se a ANPD perguntar.
 *
 * A ordem aqui é por artigo, não por tag — é assim que a conversa jurídica
 * acontece. As abas técnicas continuam ordenando por tag, para quem corrige.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Scale, FileText } from 'lucide-react';

interface Violacao {
    severity?: string;
    article?: string;
    violation?: string;
    description?: string;
    tag?: string;
    evidence?: string;
    recommendation?: string;
}

interface Props {
    url: string;
    timestamp?: string;
    scanMethod?: string;
    violacoes: Violacao[];
    totalDeAchados: number;
    temCmp: boolean;
    jurisdicao?: string;
    framework?: string;
    exposicaoLegal?: string;
}

const ORDEM_DE_GRAVIDADE: Record<string, number> = {
    critical: 0, high: 1, medium: 2, low: 3,
};

const corDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'var(--laudo-critico)'
        : nivel === 'high' ? 'var(--laudo-alto)'
            : nivel === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

const rotuloDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'Crítica'
        : nivel === 'high' ? 'Alta'
            : nivel === 'medium' ? 'Média' : 'Baixa';

const VisaoJuridica = ({
    url,
    timestamp,
    scanMethod,
    violacoes,
    totalDeAchados,
    temCmp,
    jurisdicao,
    framework,
    exposicaoLegal,
}: Props) => {

    /* Agrupa por dispositivo legal. Um mesmo artigo costuma ser violado por
       várias tags; para o jurídico isso é um caso só, com várias evidências. */
    const porArtigo = new Map<string, Violacao[]>();
    for (const v of violacoes) {
        const artigo = v.article || 'LGPD — dispositivo não classificado';
        const lista = porArtigo.get(artigo) || [];
        lista.push(v);
        porArtigo.set(artigo, lista);
    }

    const grupos = [...porArtigo.entries()].sort((a, b) => {
        const piorDe = (lista: Violacao[]) =>
            Math.min(...lista.map(v => ORDEM_DE_GRAVIDADE[v.severity || 'low'] ?? 3));
        return piorDe(a[1]) - piorDe(b[1]);
    });

    /* Data inválida vira "Invalid Date" na tela — num documento que se propõe
       a ser apresentável a uma autoridade, isso é pior que omitir o campo. */
    const dataDaVarredura = (() => {
        if (!timestamp) return null;
        const d = new Date(timestamp);
        if (Number.isNaN(d.getTime())) return null;
        return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    })();

    return (
        <div className="space-y-5">

            {/* Cabeçalho de peça técnica.
                O que torna um laudo apresentável a uma autoridade não é o
                design: é dizer o que foi examinado, quando e por qual método. */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p
                        className="voz-evidencia text-[11px] uppercase tracking-widest mb-4"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        Identificação da varredura
                    </p>
                    <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2 m-0">
                        {[
                            ['Endereço examinado', url],
                            ['Data e hora', dataDaVarredura || 'não registrada'],
                            /* O identificador cru do motor não é texto de
                               laudo: "static_fallback" e "html_fallback" não
                               dizem nada a um advogado, e escondem justamente
                               o que ele precisa saber — se houve navegador,
                               porque é isso que determina o que pôde ou não
                               ser observado. Método desconhecido é declarado
                               como tal, nunca omitido. */
                            ['Método', ({
                                browser: 'Navegador real, com interceptação de rede',
                                har: 'Registro de navegação (HAR) enviado pelo cliente',
                                static_fallback: 'Somente código-fonte — sem execução de scripts',
                                html_fallback: 'Somente código-fonte — sem execução de scripts',
                                html_source: 'Somente código-fonte — sem execução de scripts',
                            } as Record<string, string>)[scanMethod || ''] || 'não informado'],
                            ['Regime aplicável', [jurisdicao, framework].filter(Boolean).join(' · ') || 'LGPD (Lei 13.709/2018)'],
                            ['Consentimento', temCmp
                                ? 'Controle presente na página'
                                : 'Nenhum controle encontrado'],
                            ['Não conformidades', String(totalDeAchados)],
                        ].map(([rotulo, valor]) => (
                            <div key={rotulo}>
                                <dt className="text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    {rotulo}
                                </dt>
                                <dd className="voz-evidencia text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                                    {valor}
                                </dd>
                            </div>
                        ))}
                    </dl>

                    <p
                        className="voz-argumento text-sm mt-5 pt-4 border-t"
                        style={{ color: 'var(--laudo-texto-suave)', borderColor: 'var(--laudo-linha)', maxWidth: '70ch' }}
                    >
                        A varredura foi conduzida <strong style={{ color: 'var(--laudo-texto)' }}>sem
                        aceitar o aviso de cookies</strong>. Toda coleta registrada abaixo ocorreu
                        antes de qualquer manifestação do titular — o que caracteriza tratamento
                        sem consentimento, e não mera irregularidade de configuração.
                    </p>
                </CardContent>
            </Card>

            {/* Exposição */}
            {exposicaoLegal && (
                <Card
                    className="border-l-4"
                    style={{
                        borderColor: 'var(--laudo-linha)',
                        borderLeftColor: 'var(--laudo-carimbo)',
                        background: 'var(--laudo-superficie)',
                    }}
                >
                    <CardContent className="pt-6">
                        <p
                            className="voz-evidencia text-[11px] uppercase tracking-widest mb-2"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            Sanção prevista
                        </p>
                        <p className="voz-argumento" style={{ color: 'var(--laudo-texto)', maxWidth: '70ch' }}>
                            {exposicaoLegal}
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Achados por dispositivo legal */}
            {grupos.length === 0 ? (
                <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardContent className="pt-6">
                        <p className="voz-argumento" style={{ color: 'var(--laudo-texto)' }}>
                            Nenhum dispositivo da LGPD foi apontado como violado no escopo desta
                            varredura. Isso não atesta conformidade do site como um todo — veja o
                            alcance ao final.
                        </p>
                    </CardContent>
                </Card>
            ) : (
                grupos.map(([artigo, itens]) => {
                    const pior = itens.reduce((a, b) =>
                        (ORDEM_DE_GRAVIDADE[b.severity || 'low'] ?? 3) < (ORDEM_DE_GRAVIDADE[a.severity || 'low'] ?? 3) ? b : a
                    );
                    const cor = corDaGravidade(pior.severity);
                    return (
                        <Card
                            key={artigo}
                            className="border-l-4"
                            style={{
                                borderColor: 'var(--laudo-linha)',
                                borderLeftColor: cor,
                                background: 'var(--laudo-superficie)',
                            }}
                        >
                            <CardContent className="pt-6">
                                <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
                                    <h3
                                        className="voz-argumento text-lg font-semibold flex items-center gap-2 m-0"
                                        style={{ color: 'var(--laudo-texto)' }}
                                    >
                                        <Scale className="h-4 w-4 shrink-0" style={{ color: cor }} />
                                        {artigo}
                                    </h3>
                                    <span
                                        className="voz-evidencia text-[10px] uppercase tracking-wider rounded border px-2 py-0.5"
                                        style={{ color: cor, borderColor: cor }}
                                    >
                                        gravidade {rotuloDaGravidade(pior.severity)}
                                    </span>
                                </div>

                                <ul className="space-y-3 list-none p-0 m-0">
                                    {itens.map((v, i) => (
                                        <li
                                            key={i}
                                            className="pl-3 border-l"
                                            style={{ borderColor: 'var(--laudo-linha)' }}
                                        >
                                            <p
                                                className="voz-argumento text-sm m-0"
                                                style={{ color: 'var(--laudo-texto)', maxWidth: '68ch' }}
                                            >
                                                {v.violation || v.description}
                                            </p>
                                            {(v.tag || v.evidence) && (
                                                <p
                                                    className="voz-evidencia text-xs mt-1 m-0"
                                                    style={{ color: 'var(--laudo-texto-fraco)' }}
                                                >
                                                    evidência: {v.evidence || v.tag}
                                                </p>
                                            )}
                                        </li>
                                    ))}
                                </ul>

                                {pior.recommendation && (
                                    <div
                                        className="mt-4 pt-3 border-t flex gap-2"
                                        style={{ borderColor: 'var(--laudo-linha)' }}
                                    >
                                        <FileText
                                            className="h-4 w-4 shrink-0 mt-0.5"
                                            style={{ color: 'var(--laudo-carimbo)' }}
                                        />
                                        <p
                                            className="voz-argumento text-sm m-0"
                                            style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}
                                        >
                                            <strong style={{ color: 'var(--laudo-texto)' }}>Providência: </strong>
                                            {pior.recommendation}
                                        </p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    );
                })
            )}

            <p className="text-xs leading-relaxed" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '72ch' }}>
                <strong>Alcance.</strong> O exame cobre a página indicada, em uma visita, sem
                autenticação e sem aceitar o aviso de cookies. Retenção de dados, contratos de
                operador, transferência internacional e o fluxo autenticado não são observáveis
                por varredura automatizada e exigem verificação documental.
            </p>
        </div>
    );
};

export default VisaoJuridica;
