/**
 * A marca do DataTrust Audit.
 *
 * Substitui um JPG de 1024×1024 e 465 KB que era exibido em 36×36. Além do
 * peso, JPG não tem transparência: sobre o header escuro ele aparecia como um
 * quadrado com fundo próprio — daí a impressão de que o logo tinha sumido.
 * Em SVG a marca fica nítida em qualquer tamanho, pesa alguns bytes, e adota
 * a cor de quem a contém.
 *
 * O símbolo é um **selo de conferência**: um escudo cujo contorno se fecha
 * como um lacre, com uma marca de verificação dentro e um ponto de registro.
 * O ícone anterior era um raio, que comunica velocidade — o oposto do que o
 * produto vende. Um laudo não vale por ser rápido; vale por ser conferível.
 *
 * O traço é aberto de propósito (`stroke`, não preenchimento sólido): dá o
 * peso visual de instrumento de precisão, não de emblema.
 */

interface Props {
    /** Lado do símbolo em pixels. */
    tamanho?: number;
    className?: string;
    /** Cor do traço. Por padrão herda a cor do texto ao redor. */
    cor?: string;
}

export const SimboloDataTrust = ({ tamanho = 32, className = '', cor }: Props) => (
    <svg
        width={tamanho}
        height={tamanho}
        viewBox="0 0 32 32"
        fill="none"
        className={className}
        role="img"
        aria-label="DataTrust Audit"
        style={cor ? { color: cor } : undefined}
    >
        {/* Escudo: contorno fechado, sem preenchimento — a forma é o lacre. */}
        <path
            d="M16 2.5 L27 7v9.2c0 6.3-4.4 11.2-11 13.3-6.6-2.1-11-7-11-13.3V7L16 2.5Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinejoin="round"
        />
        {/* Marca de conferência. */}
        <path
            d="m10.8 16.3 3.5 3.5 7-7.4"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
        />
        {/* Ponto de registro: o carimbo que diz "conferido em". */}
        <circle cx="16" cy="6.6" r="1.15" fill="currentColor" />
    </svg>
);

/**
 * Marca completa: símbolo + nome.
 *
 * `compacta` esconde o nome e mantém só o símbolo — para telas estreitas, em
 * vez de encolher a tipografia até ficar ilegível.
 */
export const MarcaDataTrust = ({
    compacta = false,
    tamanho = 30,
    className = '',
}: { compacta?: boolean; tamanho?: number; className?: string }) => (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
        <SimboloDataTrust tamanho={tamanho} className="shrink-0" />
        {!compacta && (
            <span className="flex flex-col leading-none">
                {/* Peso diferente entre as duas metades: "Data" leve, "Trust"
                    firme. A palavra que carrega o valor é a que fica sólida. */}
                <span className="text-[17px] tracking-[-0.02em] whitespace-nowrap">
                    <span className="font-light">Data</span><span className="font-semibold">Trust</span>
                </span>
                <span className="text-[9px] uppercase tracking-[0.18em] opacity-45 mt-1">
                    Auditoria
                </span>
            </span>
        )}
    </span>
);

export default MarcaDataTrust;
