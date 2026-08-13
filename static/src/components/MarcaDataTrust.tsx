import { useId } from 'react';

/**
 * A marca do DataTrust Audit, em SVG.
 *
 * Substitui um JPG de 1024×1024 e 465 KB que era exibido em 36×36. Além do
 * peso, JPG não tem transparência: sobre o header escuro ele aparecia como um
 * quadrado com fundo próprio — daí a impressão de que o logo tinha sumido.
 *
 * O símbolo tem quatro elementos, e cada um diz uma parte do que o produto faz:
 *
 * - **O escudo** é a proteção. Divide-se ao meio em duas cores porque a
 *   auditoria tem dois lados: o que já está seguro e o que ainda não está.
 * - **Os pixels que se desprendem** do canto superior esquerdo são o dado
 *   escapando — é exatamente o achado que o laudo persegue: rastreador
 *   disparando antes do consentimento.
 * - **A lupa com a marca de conferência** é o exame. Não é um raio: velocidade
 *   é o oposto do que se vende aqui. Um laudo vale por ser conferível.
 * - **A malha de nós** são as tags conversando entre si — o objeto auditado.
 *
 * As cores vêm de variáveis CSS (`--marca-*`, definidas em `index.css`), não
 * de literais: no tema escuro o azul-marinho do original desapareceria contra
 * o fundo, então lá as variáveis assumem versões clareadas. Um SVG com cor
 * fixa obrigaria a manter dois arquivos de logo.
 */

interface Props {
    /** Lado do símbolo em pixels. */
    tamanho?: number;
    className?: string;
}

export const SimboloDataTrust = ({ tamanho = 32, className = '' }: Props) => {
    /* IDs de gradiente precisam ser únicos no documento. Com um literal fixo,
       duas instâncias da marca na mesma página declaram o mesmo id: o navegador
       resolve `url(#…)` para a primeira definição, e desmontar essa primeira
       instância deixa a segunda sem pintura. `useId` resolve na raiz. */
    const uid = useId().replace(/:/g, '');

    return (
        <svg
            width={tamanho}
            height={tamanho}
            viewBox="0 0 64 64"
            fill="none"
            className={className}
            role="img"
            aria-label="DataTrust Audit"
        >
            <defs>
                {/* Parada dura no meio: o escudo troca de cor em vez de
                    degradar. É a divisão do original, não um esmaecimento. */}
                <linearGradient id={`escudo-${uid}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="50%" stopColor="var(--marca-escuro, #12285C)" />
                    <stop offset="50%" stopColor="var(--marca-vivo, #1A63E8)" />
                </linearGradient>
                <linearGradient id={`check-${uid}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--marca-check, #22B5D8)" />
                    <stop offset="100%" stopColor="var(--marca-check-2, #35D0EE)" />
                </linearGradient>
            </defs>

            {/* Escudo. O canto superior esquerdo não fecha: é de lá que os
                pixels se desprendem. */}
            <path
                d="M32 5.5 L54.5 13.5 V32.5 C54.5 45.5 45.2 54.8 32 58.5 C18.8 54.8 9.5 45.5 9.5 32.5 V19"
                stroke={`url(#escudo-${uid})`}
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            {/* O dado escapando: quadrados menores e mais apagados conforme se
                afastam do escudo. */}
            <g fill="var(--marca-pixel, #2C6FD6)">
                <rect x="9.5" y="13.5" width="6" height="6" rx="0.8" />
                <rect x="3.2" y="15.4" width="4.2" height="4.2" rx="0.6" opacity="0.78" />
                <rect x="6.6" y="8.4" width="4.6" height="4.6" rx="0.6" opacity="0.6" />
                <rect x="1.2" y="9.6" width="3.2" height="3.2" rx="0.5" opacity="0.42" />
                <rect x="12.8" y="6.2" width="3" height="3" rx="0.5" opacity="0.3" />
            </g>

            {/* Malha de tags: as linhas passam por trás da lupa. */}
            <g stroke="var(--marca-pixel, #2C6FD6)" strokeWidth="1.3" opacity="0.85">
                <path d="M18.5 24.5 L26 30" />
                <path d="M45.5 22.5 L37 29.5" />
                <path d="M19 43 L26 37.5" />
                <path d="M45 39 L38 35" />
            </g>
            <g fill="var(--marca-pixel, #2C6FD6)">
                <circle cx="18.5" cy="24.5" r="2.6" />
                <circle cx="45.5" cy="22.5" r="3.2" />
                <circle cx="19" cy="43" r="2.6" />
                <circle cx="45" cy="39" r="2.8" />
            </g>

            {/* Lupa. O disco opaco tapa as linhas da malha que passariam por
                dentro da lente — sem ele, a marca de conferência divide espaço
                com traços que não são dela. */}
            <circle cx="30.5" cy="32" r="11.4" fill="var(--marca-lente, #FFFFFF)" />
            <circle
                cx="30.5"
                cy="32"
                r="11.4"
                stroke="var(--marca-escuro, #12285C)"
                strokeWidth="3.4"
            />
            {/* Cabo, saindo da borda em 45°. */}
            <path
                d="M38.8 40 L46.5 47.6"
                stroke="var(--marca-escuro, #12285C)"
                strokeWidth="4.6"
                strokeLinecap="round"
            />

            {/* A conferência. */}
            <path
                d="M25 32.4 L29.2 36.6 L36.4 27.6"
                stroke={`url(#check-${uid})`}
                strokeWidth="3.6"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </svg>
    );
};

/**
 * Marca completa: símbolo + nome.
 *
 * `compacta` esconde o nome e mantém só o símbolo — para telas estreitas, em
 * vez de encolher a tipografia até ficar ilegível. `assinatura` acrescenta a
 * linha de disciplinas; ela cabe numa capa de laudo ou numa tela de entrada,
 * não num header de 56 px.
 */
export const MarcaDataTrust = ({
    compacta = false,
    assinatura = false,
    tamanho = 34,
    className = '',
}: {
    compacta?: boolean;
    assinatura?: boolean;
    tamanho?: number;
    className?: string;
}) => (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
        <SimboloDataTrust tamanho={tamanho} className="shrink-0" />
        {!compacta && (
            <span className="flex flex-col leading-none">
                <span className="text-[19px] font-semibold tracking-[-0.02em] whitespace-nowrap">
                    {/* "Audit" recebe o gradiente porque é a palavra que nomeia
                        o serviço; "DataTrust" é quem presta. */}
                    <span className="marca-nome">DataTrust</span>{' '}
                    <span className="marca-servico">Audit</span>
                </span>
                {assinatura && (
                    <span className="marca-assinatura mt-1.5 text-[8.5px] uppercase tracking-[0.16em] whitespace-nowrap">
                        Auditoria <span className="marca-ponto">•</span> Privacidade{' '}
                        <span className="marca-ponto">•</span> Conformidade{' '}
                        <span className="marca-ponto">•</span> Governança
                    </span>
                )}
            </span>
        )}
    </span>
);

export default MarcaDataTrust;
