/**
 * Remove dado pessoal do HAR antes de ele sair da máquina de quem audita.
 *
 * O servidor mascara de novo, e é lá que está a garantia — checagem só no
 * cliente é conveniência, não proteção. O que este arquivo entrega é outra
 * coisa: o dado do checkout do cliente **não trafega**. Numa conversa com um
 * DPO, "não guardamos" é bom; "não chega a sair da sua máquina" é melhor.
 *
 * As regras são as mesmas do `audit_engine/mascarador.py`, inclusive a
 * validação por dígito verificador. Identificador de tag é numérico e se
 * parece com PII — o ID do Meta Pixel tem 13 a 16 dígitos, como um cartão — e
 * estragá-lo quebraria a detecção da própria tag que se quer auditar.
 */

export const MARCADOR = {
    email: '[e-mail removido]',
    cpf: '[cpf removido]',
    cnpj: '[cnpj removido]',
    cartao: '[cartao removido]',
    telefone: '[telefone removido]',
} as const;

export type TipoDePII = keyof typeof MARCADOR;

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/gi;
const CPF = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const CARTAO = /\b(?:\d[ -]?){13,19}\b/g;
/* Só com formatação característica. Aceitar 10 ou 11 dígitos crus mascarava o
   `cid` do GA4 (847362819.1691582734), e sem ele o laudo perde a ligação entre
   requisições da mesma sessão. */
const TELEFONE = /(?:\+55[\s-]?)?(?:\(\d{2}\)[\s-]?\d{4,5}[-\s]?\d{4}|\b\d{2}[\s-]\d{4,5}[-\s]?\d{4}\b|\b9?\d{4}-\d{4}\b)/g;

const digitos = (t: string) => t.replace(/\D/g, '');

const cpfValido = (texto: string): boolean => {
    const n = digitos(texto);
    if (n.length !== 11 || n === n[0].repeat(11)) return false;
    for (const tamanho of [9, 10]) {
        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += Number(n[i]) * (tamanho + 1 - i);
        if (((soma * 10) % 11) % 10 !== Number(n[tamanho])) return false;
    }
    return true;
};

const cnpjValido = (texto: string): boolean => {
    const n = digitos(texto);
    if (n.length !== 14 || n === n[0].repeat(14)) return false;
    for (const tamanho of [12, 13]) {
        /* Pesos do CNPJ: decresce de (tamanho-7) até 2, depois de 9 até 2.
           Para 12 dígitos: [5,4,3,2, 9,8,7,6,5,4,3,2].

           A versão anterior calculava o comprimento como `tamanho - 7` e
           produzia um peso a mais — `range(5,1,-1)` tem quatro elementos, não
           cinco. O resultado era CNPJ sempre inválido, e nenhum era mascarado.
           Typecheck e build passavam; só rodar pegou. */
        const pesos: number[] = [];
        for (let p = tamanho - 7; p >= 2; p--) pesos.push(p);
        for (let p = 9; p >= 2; p--) pesos.push(p);

        let soma = 0;
        for (let i = 0; i < tamanho; i++) soma += Number(n[i]) * pesos[i];
        const resto = soma % 11;
        const digito = resto < 2 ? 0 : 11 - resto;
        if (digito !== Number(n[tamanho])) return false;
    }
    return true;
};

const luhn = (texto: string): boolean => {
    const n = digitos(texto);
    if (n.length < 13 || n.length > 19) return false;
    let soma = 0;
    let par = false;
    for (let i = n.length - 1; i >= 0; i--) {
        let d = Number(n[i]);
        if (par) { d *= 2; if (d > 9) d -= 9; }
        soma += d;
        par = !par;
    }
    return soma % 10 === 0;
};

export const mascararTexto = (texto: unknown): { texto: unknown; achados: TipoDePII[] } => {
    if (typeof texto !== 'string' || !texto) return { texto, achados: [] };

    const achados: TipoDePII[] = [];
    let saida = texto;

    const troca = (padrao: RegExp, tipo: TipoDePII, validador?: (v: string) => boolean) => {
        saida = saida.replace(padrao, (valor) => {
            if (validador && !validador(valor)) return valor;
            achados.push(tipo);
            return MARCADOR[tipo];
        });
    };

    // E-mail primeiro: o trecho numérico de um endereço seria analisado pelos
    // padrões seguintes.
    troca(EMAIL, 'email');
    troca(CNPJ, 'cnpj', cnpjValido);
    troca(CPF, 'cpf', cpfValido);
    troca(CARTAO, 'cartao', luhn);
    troca(TELEFONE, 'telefone');

    return { texto: saida, achados };
};

/**
 * Percorre o HAR inteiro. Trabalha sobre uma cópia — o arquivo do usuário
 * continua intacto no disco dele.
 */
export const mascararHAR = (dados: any): { har: any; encontrados: Record<string, number> } => {
    const encontrados: Record<string, number> = {};
    const registra = (tipos: TipoDePII[]) => {
        for (const t of tipos) encontrados[t] = (encontrados[t] || 0) + 1;
    };

    const limpar = (valor: any): any => {
        if (typeof valor === 'string') {
            const { texto, achados } = mascararTexto(valor);
            registra(achados);
            return texto;
        }
        if (Array.isArray(valor)) return valor.map(limpar);
        if (valor && typeof valor === 'object') {
            const saida: Record<string, any> = {};
            for (const [chave, v] of Object.entries(valor)) saida[chave] = limpar(v);
            return saida;
        }
        return valor;
    };

    return { har: limpar(dados), encontrados };
};
