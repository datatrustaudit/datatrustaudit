/**
 * Leitura de datas vindas da API.
 *
 * O backend usa `utcnow()`, que devolve um `datetime` **naive já em UTC** — de
 * propósito, porque as colunas não guardam fuso e misturar aware com naive
 * quebra as comparações. O efeito colateral aparece no outro lado: o JSON sai
 * como `"2026-08-13T02:40:00"`, sem sufixo, e o navegador lê string assim como
 * **hora local**.
 *
 * No Brasil isso desloca três horas — e não é só o relógio que erra:
 *
 *     "2026-08-13T02:40:00"  →  exibido: 13/08/2026 02:40
 *                               correto: 12/08/2026 23:40
 *
 * O **dia** muda. Num laudo que se propõe a provar o que um site fez e quando,
 * e numa conferência de caixa que casa pagamento com extrato bancário, isso não
 * é arredondamento: é a informação errada, escrita com confiança.
 *
 * O 'Z' só é acrescentado quando a string tem hora e realmente não traz fuso:
 * assim não se estraga uma resposta que um dia passe a mandar o offset, nem uma
 * data sem hora, que a especificação já manda ler como UTC.
 */

const TEM_FUSO = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/* Só há o que corrigir quando a string traz hora: "2026-08-13" sem hora já é
   lida como UTC pela especificação, e "2026-08-13Z" não é formato válido de
   Date — motor estrito (Safari) devolve Invalid Date e uma data legítima
   sumiria da tela. */
const TEM_HORA = /\d{2}:\d{2}/;

/** O instante, ou `null` se a entrada não for uma data utilizável. */
export function comoInstanteUtc(iso: string | null | undefined): Date | null {
    if (!iso || typeof iso !== 'string') return null;

    const precisaDoZ = TEM_HORA.test(iso) && !TEM_FUSO.test(iso);
    const data = new Date(precisaDoZ ? `${iso}Z` : iso);

    /* `new Date('lixo')` não estoura: devolve um Date inválido, cujo
       `toLocaleString()` produz a string "Invalid Date" — que vai para a tela
       como se fosse conteúdo. Devolver null obriga quem chama a decidir o que
       exibir na ausência. */
    return Number.isNaN(data.getTime()) ? null : data;
}

/**
 * Data e hora para leitura humana, em pt-BR.
 *
 * `null` quando não há data — e não uma data de mentira. Campo ausente é dito,
 * nunca preenchido: o cabeçalho do laudo já carimbou o relógio de quem abria a
 * página porque um fallback plausível escondia que a chave certa não existia.
 */
export function dataHoraLegivel(iso: string | null | undefined): string | null {
    const d = comoInstanteUtc(iso);
    return d ? d.toLocaleString('pt-BR') : null;
}

/** Só o dia, sem hora — para listas onde o horário é ruído. */
export function dataLegivel(iso: string | null | undefined): string | null {
    const d = comoInstanteUtc(iso);
    return d ? d.toLocaleDateString('pt-BR') : null;
}

/** Só o horário — para linhas do tempo, onde o dia já está no cabeçalho. */
export function horaLegivel(iso: string | null | undefined): string | null {
    const d = comoInstanteUtc(iso);
    return d ? d.toLocaleTimeString('pt-BR') : null;
}
