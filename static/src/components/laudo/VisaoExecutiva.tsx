/**
 * O laudo para quem decide — dono do site, cliente da agência, diretor.
 *
 * O mesmo dado das abas técnicas, respondendo três perguntas em ordem:
 * estamos irregulares, o que exatamente foi visto, e o que fazer primeiro.
 *
 * Existe porque o laudo tinha uma saída só, técnica, para três leitores muito
 * diferentes: quem paga (quer decidir), quem responde juridicamente (quer base
 * legal) e quem corrige (quer o código). Servir os três na mesma tela deixava
 * ela técnica demais para uns e rasa demais para outros.
 *
 * Nada aqui é calculado de novo: se um número divergir das abas técnicas, é
 * bug de leitura, não de opinião.
 */
import { Card, CardContent } from '@/components/ui/card';
import { AlertTriangle, CheckCircle, ArrowRight, Clock } from 'lucide-react';
import { corDoScore } from './tema-dos-graficos';

interface Props {
    url: string;
    score: number;
    totalDeAchados: number;
    porGravidade: Record<string, number>;
    temCmp: boolean;
    tagsAntesDoConsentimento: number;
    cookiesSemConsentimento: number;
    piiExposto: number;
    exposicaoLegal?: string;
    /** Recomendações do motor, já ordenadas por gravidade. */
    proximosPassos: Array<{
        titulo: string;
        porque?: string;
        gravidade?: string;
        esforco?: string;
        /** O que digitar para resolver. O motor escreve; a tela descartava. */
        comoCorrigir?: string;
    }>;
}

const GRAVIDADE_ROTULO: Record<string, string> = {
    critical: 'crítica',
    high: 'alta',
    medium: 'média',
    low: 'baixa',
};

const VisaoExecutiva = ({
    url,
    score,
    totalDeAchados,
    porGravidade,
    temCmp,
    tagsAntesDoConsentimento,
    cookiesSemConsentimento,
    piiExposto,
    exposicaoLegal,
    proximosPassos,
}: Props) => {
    const criticas = porGravidade.critical || 0;
    const altas = porGravidade.high || 0;
    const conforme = totalDeAchados === 0;

    /* O veredito em uma frase. É a primeira coisa que o leitor precisa, e a
       que o laudo nunca dizia: ele abria com um número (11%) que sozinho não
       significa nada para quem não conhece a escala. */
    const veredito = conforme
        ? 'Nada fora de conformidade no que foi observado'
        : criticas > 0
            ? `Não conforme — ${criticas} ${criticas > 1 ? 'não conformidades críticas' : 'não conformidade crítica'}`
            : altas > 0
                ? `Ajustes necessários — ${altas} ${altas > 1 ? 'pontos de risco alto' : 'ponto de risco alto'}`
                : 'Ajustes menores pendentes';

    const corDoVeredito = conforme
        ? 'var(--laudo-conforme)'
        : criticas > 0
            ? 'var(--laudo-critico)'
            : altas > 0
                ? 'var(--laudo-alto)'
                : 'var(--laudo-medio)';

    /* Evidência: só entra na lista o que foi de fato observado. Item com zero
       some em vez de aparecer como "0 cookies" — linha zerada num laudo lê
       como ruído, não como boa notícia. */
    const evidencias = [
        cookiesSemConsentimento > 0 && {
            numero: cookiesSemConsentimento,
            texto: `cookie(s) gravado(s) no navegador antes de qualquer aceite`,
        },
        tagsAntesDoConsentimento > 0 && {
            numero: tagsAntesDoConsentimento,
            texto: `tag(s) de rastreio disparada(s) sem consentimento`,
        },
        piiExposto > 0 && {
            numero: piiExposto,
            texto: `dado(s) pessoal(is) trafegando em texto claro`,
        },
        !temCmp && {
            numero: null,
            texto: 'Nenhum controle de consentimento encontrado na página',
        },
    ].filter(Boolean) as Array<{ numero: number | null; texto: string }>;

    return (
        <div className="space-y-5">

            {/* Veredito */}
            <Card
                className="border-l-4 shadow-sm"
                style={{
                    borderColor: 'var(--laudo-linha)',
                    borderLeftColor: corDoVeredito,
                    background: 'var(--laudo-superficie)',
                }}
            >
                <CardContent className="pt-6">
                    <p
                        className="voz-evidencia text-[11px] uppercase tracking-widest mb-2"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        {url}
                    </p>
                    <div className="flex flex-wrap items-baseline justify-between gap-4">
                        <h2
                            className="voz-argumento text-2xl md:text-3xl font-semibold leading-tight"
                            style={{ color: corDoVeredito, maxWidth: '24ch' }}
                        >
                            {veredito}
                        </h2>
                        {/* O score vira apoio, não manchete: sozinho ele não
                            diz a quem lê se é perto ou longe de resolver. */}
                        <div className="text-right">
                            <div
                                className="voz-evidencia text-3xl font-bold leading-none"
                                style={{ color: corDoScore(score) }}
                            >
                                {score}
                                <span className="text-lg" style={{ color: 'var(--laudo-texto-fraco)' }}>/100</span>
                            </div>
                            <p className="text-[11px] mt-1" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                conformidade técnica
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* O que foi observado */}
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <p
                        className="voz-evidencia text-[11px] uppercase tracking-widest mb-4"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        O que foi observado
                    </p>

                    {evidencias.length === 0 ? (
                        <div className="flex items-start gap-3">
                            <CheckCircle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-conforme)' }} />
                            <p className="voz-argumento" style={{ color: 'var(--laudo-texto)' }}>
                                Nesta visita, nenhum rastreador coletou dados antes de o visitante
                                decidir.
                            </p>
                        </div>
                    ) : (
                        <ul className="space-y-3 list-none p-0 m-0">
                            {evidencias.map((e, i) => (
                                <li key={i} className="flex items-baseline gap-3">
                                    {e.numero !== null ? (
                                        <span
                                            className="voz-evidencia text-xl font-bold shrink-0"
                                            style={{ color: 'var(--laudo-critico)', minWidth: '2ch' }}
                                        >
                                            {e.numero}
                                        </span>
                                    ) : (
                                        <AlertTriangle
                                            className="h-4 w-4 shrink-0 self-center"
                                            style={{ color: 'var(--laudo-critico)' }}
                                        />
                                    )}
                                    <span className="voz-argumento" style={{ color: 'var(--laudo-texto)' }}>
                                        {e.texto}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {/* A frase que dá peso a tudo acima. Sem ela, o leitor
                        supõe que o scanner aceitou os cookies como um visitante
                        comum — e o achado perde a força. */}
                    <p
                        className="mt-5 pt-4 text-sm border-t"
                        style={{ color: 'var(--laudo-texto-suave)', borderColor: 'var(--laudo-linha)' }}
                    >
                        A varredura nunca clica em “aceitar”. Tudo listado acima aconteceu
                        <strong style={{ color: 'var(--laudo-texto)' }}> sem consentimento do visitante</strong>.
                    </p>
                </CardContent>
            </Card>

            {/* Exposição legal */}
            {exposicaoLegal && !conforme && (
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
                            Exposição legal
                        </p>
                        <p className="voz-argumento" style={{ color: 'var(--laudo-texto)', maxWidth: '68ch' }}>
                            {exposicaoLegal}
                        </p>
                    </CardContent>
                </Card>
            )}

            {/* Por onde começar */}
            {proximosPassos.length > 0 && (
                <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardContent className="pt-6">
                        <p
                            className="voz-evidencia text-[11px] uppercase tracking-widest mb-4"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            Por onde começar
                        </p>
                        <ol className="space-y-4 list-none p-0 m-0">
                            {proximosPassos.slice(0, 5).map((passo, i) => (
                                <li key={i} className="flex gap-3">
                                    <ArrowRight
                                        className="h-4 w-4 shrink-0 mt-1"
                                        style={{ color: 'var(--laudo-carimbo)' }}
                                    />
                                    <div className="min-w-0">
                                        <p className="font-medium text-sm" style={{ color: 'var(--laudo-texto)' }}>
                                            {passo.titulo}
                                        </p>
                                        {passo.porque && (
                                            <p
                                                className="voz-argumento text-sm mt-1"
                                                style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}
                                            >
                                                {passo.porque}
                                            </p>
                                        )}

                                        {/* A providência. Sem ela o laudo aponta o
                                            problema e devolve o trabalho para quem
                                            contratou — e o texto já vinha pronto do
                                            motor. */}
                                        {passo.comoCorrigir && (
                                            <p
                                                className="text-sm mt-2 pl-3 border-l"
                                                style={{
                                                    color: 'var(--laudo-texto)',
                                                    borderColor: 'var(--laudo-carimbo)',
                                                    maxWidth: '66ch',
                                                }}
                                            >
                                                <span
                                                    className="voz-evidencia text-[10px] uppercase tracking-widest block mb-0.5"
                                                    style={{ color: 'var(--laudo-carimbo)' }}
                                                >
                                                    Como corrigir
                                                </span>
                                                {passo.comoCorrigir}
                                            </p>
                                        )}
                                        <div className="flex flex-wrap gap-3 mt-1.5">
                                            {passo.gravidade && GRAVIDADE_ROTULO[passo.gravidade] && (
                                                <span
                                                    className="voz-evidencia text-[10px] uppercase tracking-wider"
                                                    style={{ color: `var(--laudo-${
                                                        passo.gravidade === 'critical' ? 'critico'
                                                            : passo.gravidade === 'high' ? 'alto'
                                                                : passo.gravidade === 'medium' ? 'medio' : 'baixo'
                                                    })` }}
                                                >
                                                    gravidade {GRAVIDADE_ROTULO[passo.gravidade]}
                                                </span>
                                            )}
                                            {passo.esforco && (
                                                <span
                                                    className="voz-evidencia text-[10px] uppercase tracking-wider inline-flex items-center gap-1"
                                                    style={{ color: 'var(--laudo-texto-fraco)' }}
                                                >
                                                    <Clock className="h-3 w-3" />
                                                    esforço {passo.esforco}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        {proximosPassos.length > 5 && (
                            <p className="text-xs mt-4" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                Mais {proximosPassos.length - 5} recomendação(ões) na aba Técnica.
                            </p>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Alcance — o que o laudo NÃO cobre.
                Declarar o limite é o que separa laudo de propaganda: sem isso,
                "nada encontrado" é lido como "o site inteiro está limpo". */}
            <p className="text-xs leading-relaxed" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '72ch' }}>
                Esta varredura cobre a página analisada, em uma visita, sem aceitar o aviso de
                cookies e sem login. Páginas internas, área autenticada e o fluxo de checkout
                podem carregar outras tags — e são justamente onde dado pessoal costuma
                trafegar.
            </p>
        </div>
    );
};

export default VisaoExecutiva;
