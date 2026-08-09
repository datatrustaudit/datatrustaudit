/**
 * O resultado gratuito: uma frase, e o que ela custa ignorar.
 *
 * O plano free mostrava metade da lista de achados. Meia lista dá a impressão
 * de laudo completo e some com o resto sem avisar — quem lê não tem como saber
 * que faltava. Aqui o corte é honesto: dizemos o que encontramos e qual artigo
 * isso contraria, sem dizer onde. O "onde" é o que se compra.
 *
 * Também abre o laudo pago. A mesma frase nos dois impede que a versão
 * gratuita afirme uma coisa e a paga outra sobre o mesmo site.
 */
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertTriangle, Lock, ArrowRight } from 'lucide-react';

export interface VereditoDoLaudo {
    conforme: boolean;
    titulo: string;
    frase: string;
    artigo: string | null;
    motivo: string;
}

interface Props {
    veredito: VereditoDoLaudo;
    url?: string;
    totalDeAchados?: number;
    porGravidade?: Record<string, number>;
    /** Quando falso, o laudo detalhado está bloqueado e a chamada aparece. */
    mostraDetalhe: boolean;
    onUpgrade?: () => void;
}

const Veredito = ({
    veredito, url, totalDeAchados = 0, porGravidade, mostraDetalhe, onUpgrade,
}: Props) => {
    const cor = veredito.conforme ? 'var(--laudo-conforme)' : 'var(--laudo-critico)';
    const criticas = porGravidade?.critical ?? 0;

    return (
        <div className="space-y-4">
            <Card
                className="border-l-4 shadow-sm"
                style={{
                    borderColor: 'var(--laudo-linha)',
                    borderLeftColor: cor,
                    background: 'var(--laudo-superficie)',
                }}
            >
                <CardContent className="pt-6">
                    {url && (
                        <p
                            className="voz-evidencia text-[11px] uppercase tracking-widest mb-3"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            {url}
                        </p>
                    )}

                    <h2
                        className="voz-argumento text-2xl md:text-3xl font-semibold leading-tight m-0 flex items-start gap-3"
                        style={{ color: cor, maxWidth: '26ch' }}
                    >
                        {veredito.conforme
                            ? <CheckCircle2 className="h-7 w-7 shrink-0 mt-1" />
                            : <AlertTriangle className="h-7 w-7 shrink-0 mt-1" />}
                        {veredito.titulo}
                    </h2>

                    <p
                        className="voz-argumento mt-4 text-base leading-relaxed"
                        style={{ color: 'var(--laudo-texto)', maxWidth: '68ch' }}
                    >
                        {veredito.frase}
                    </p>

                    {veredito.artigo && (
                        <p
                            className="voz-evidencia mt-3 text-xs"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            {veredito.artigo} · Lei 13.709/2018
                        </p>
                    )}

                    {/* Os números sobrevivem ao corte: dizer "8 achados" sem
                        listá-los é o que motiva o upgrade. Esconder a contagem
                        junto faria a tela parecer defeituosa, não limitada. */}
                    {!veredito.conforme && totalDeAchados > 0 && (
                        <div
                            className="mt-5 flex flex-wrap gap-6 border-t pt-4"
                            style={{ borderColor: 'var(--laudo-linha)' }}
                        >
                            <span>
                                <span className="voz-evidencia text-2xl font-bold" style={{ color: 'var(--laudo-texto)' }}>
                                    {totalDeAchados}
                                </span>
                                <span className="text-xs ml-2" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    não conformidade(s)
                                </span>
                            </span>
                            {criticas > 0 && (
                                <span>
                                    <span className="voz-evidencia text-2xl font-bold" style={{ color: 'var(--laudo-critico)' }}>
                                        {criticas}
                                    </span>
                                    <span className="text-xs ml-2" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                        de gravidade crítica
                                    </span>
                                </span>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {!mostraDetalhe && (
                <Card
                    style={{
                        borderColor: 'color-mix(in srgb, var(--laudo-carimbo) 40%, transparent)',
                        background: 'color-mix(in srgb, var(--laudo-carimbo) 7%, transparent)',
                    }}
                >
                    <CardContent className="pt-6">
                        <p
                            className="flex items-center gap-2 text-sm font-semibold m-0 mb-3"
                            style={{ color: 'var(--laudo-texto)' }}
                        >
                            <Lock className="h-4 w-4" style={{ color: 'var(--laudo-carimbo)' }} />
                            {veredito.conforme
                                ? 'Quer o laudo completo mesmo assim?'
                                : 'O laudo completo mostra onde corrigir'}
                        </p>

                        <ul
                            className="text-sm space-y-1.5 list-none p-0 m-0 mb-4"
                            style={{ color: 'var(--laudo-texto-suave)', maxWidth: '62ch' }}
                        >
                            {[
                                'Cada achado com a tag responsável e a linha no código-fonte',
                                'Os cookies gravados antes do aceite, um a um',
                                'O passo a passo da correção, com o código pronto',
                                'Versão para o jurídico, com base legal e cadeia de evidência',
                                'Exportação em PDF e Excel, e comparação entre varreduras',
                            ].map(item => (
                                <li key={item} className="flex gap-2">
                                    <ArrowRight className="h-3.5 w-3.5 shrink-0 mt-1" style={{ color: 'var(--laudo-carimbo)' }} />
                                    {item}
                                </li>
                            ))}
                        </ul>

                        <Button onClick={onUpgrade} size="lg">
                            Ver o laudo completo
                        </Button>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default Veredito;
