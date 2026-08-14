import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Cliente do Supabase — a autenticação do produto.
 *
 * **Este módulo não pode lançar durante o import.** Ele lançava, e o efeito era
 * desproporcional: sem `VITE_SUPABASE_URL`, a aplicação inteira morria em tela
 * branca. Home, preços, o laudo de exemplo — nada aparecia, porque `main.tsx`
 * importa o `App`, que importa o `AuthContext`, que importa este arquivo. Uma
 * variável de configuração de LOGIN derrubava até as páginas que não têm login.
 *
 * Isso é fácil de acontecer em produção: `VITE_*` são embutidas em tempo de
 * build, então basta publicar sem as variáveis do ambiente e o site sobe em
 * branco, sem nada na tela que explique o que houve.
 *
 * O comportamento agora é degradar, não morrer: quem não depende de conta
 * continua funcionando, e quem depende recebe uma mensagem que diz o que
 * fazer. Isso não é abrandar o erro — é colocá-lo onde ele é acionável. O
 * diagnóstico continua no console, e `motivoDaFaltaDeAuth` leva o texto à tela
 * de login em vez de escondê-lo.
 */

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

/** Valores de exemplo que alguém esqueceu de substituir. */
const MARCAS_DE_PLACEHOLDER = ['COLE_', 'YOUR_', 'CHANGE_', 'REPLACE_', 'AQUI', 'TODO'];

function ehPlaceholder(valor: string): boolean {
    const maiusculo = valor.toUpperCase();
    return MARCAS_DE_PLACEHOLDER.some((marca) => maiusculo.includes(marca));
}

function diagnosticar(): string | null {
    if (!supabaseUrl) {
        return (
            'VITE_SUPABASE_URL não foi definida no build. ' +
            'Em desenvolvimento ela vem do .env da raiz (o Vite usa envDir: ".."); ' +
            'na Vercel, de Settings → Environment Variables — e é preciso republicar ' +
            'depois de adicionar, porque variáveis VITE_ entram no bundle durante o build.'
        );
    }
    if (!supabaseAnonKey || ehPlaceholder(supabaseAnonKey)) {
        return (
            'VITE_SUPABASE_ANON_KEY está ausente ou ainda é um valor de exemplo. ' +
            'Ela fica no painel do Supabase, em Settings → API, como "anon public".'
        );
    }
    // `/rest/v1` é o endereço da API de dados, não o do projeto. Com ele, toda
    // chamada de autenticação vira 404 — e o erro aponta para a rota, não para
    // a configuração, o que manda quem for investigar para o lado errado.
    if (supabaseUrl.endsWith('/rest/v1') || supabaseUrl.endsWith('/rest/v1/')) {
        return (
            'VITE_SUPABASE_URL termina em "/rest/v1" — esse é o endereço da API de ' +
            'dados, não o do projeto. Use a URL sem esse sufixo.'
        );
    }
    return null;
}

/** `null` quando a autenticação está configurada; a explicação, quando não. */
export const motivoDaFaltaDeAuth: string | null = diagnosticar();

export const authDisponivel: boolean = motivoDaFaltaDeAuth === null;

if (motivoDaFaltaDeAuth) {
    // Continua no console: quem abre o DevTools por causa de um login que não
    // funciona precisa achar a causa sem ter que ler o código.
    console.error(`[DataTrust] Autenticação indisponível. ${motivoDaFaltaDeAuth}`);
}

/**
 * O cliente. É `null` quando falta configuração — `createClient` com URL vazia
 * levanta "Invalid URL" no próprio import, que é justamente o que se quer
 * evitar aqui.
 *
 * O tipo mente um pouco de propósito: declarar `SupabaseClient | null` obrigaria
 * uma guarda em cada uma das dezenas de chamadas, e o `AuthContext` já barra
 * tudo por `authDisponivel`. Quem for chamar isto de um caminho novo precisa
 * checar essa flag antes.
 */
export const supabase: SupabaseClient = (
    authDisponivel ? createClient(supabaseUrl, supabaseAnonKey) : null
) as SupabaseClient;
