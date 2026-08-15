/**
 * Leitura de resposta da API.
 *
 * O motivo de existir: a tela de histórico exibiu ao usuário
 *
 *     Unexpected token '<', "<!DOCTYPE "... is not valid JSON
 *
 * Isso não é mensagem de erro, é o vazamento de uma exceção do `JSON.parse`.
 * Ela não diz o que houve nem o que fazer, e some com a única informação útil:
 * a resposta não veio da API — veio do servidor de arquivos, que devolveu a
 * página inicial.
 *
 * Esse caso é estrutural aqui, não acidente. O backend serve o SPA num
 * catch-all (`@app.get("/{full_path:path}")` em main.py), e a Vercel tem um
 * `rewrites` equivalente. Qualquer endereço que essas regras não excluam
 * responde `index.html` com status 200 — então o `fetch` acha que deu certo, e
 * o erro só aparece no `.json()`, longe da causa.
 *
 * O mesmo acontece quando o backend simplesmente não existe naquele ambiente,
 * que é a situação do deploy enquanto só o frontend está publicado.
 *
 * Aqui o diagnóstico é feito onde a informação ainda existe.
 */

export class ErroDaApi extends Error {
    /** Status HTTP, ou 0 quando a requisição nem chegou a completar. */
    readonly status: number;
    /** True quando a resposta veio do servidor de arquivos, não da API. */
    readonly respostaNaoEraDaApi: boolean;

    constructor(mensagem: string, status: number, respostaNaoEraDaApi = false) {
        super(mensagem);
        this.name = 'ErroDaApi';
        this.status = status;
        this.respostaNaoEraDaApi = respostaNaoEraDaApi;
    }
}

/** A resposta é HTML? Assinatura no content-type ou no início do corpo. */
function pareceHtml(tipo: string, corpo: string): boolean {
    if (tipo.includes('text/html')) return true;
    const inicio = corpo.trimStart().slice(0, 120).toLowerCase();
    return inicio.startsWith('<!doctype') || inicio.startsWith('<html');
}

/**
 * Lê o corpo como JSON, ou levanta `ErroDaApi` com uma explicação utilizável.
 *
 * Diferente de `response.json()`, considera o status: um 500 com corpo JSON
 * ainda é erro, e a mensagem do servidor (`detail`) é melhor do que qualquer
 * texto genérico — é ela que diz "cota esgotada" ou "plano inválido".
 */
export async function lerJson<T = unknown>(resposta: Response): Promise<T> {
    const tipo = (resposta.headers.get('content-type') || '').toLowerCase();
    const texto = await resposta.text();

    if (pareceHtml(tipo, texto)) {
        /* 200 com HTML é o caso mais traiçoeiro: para o `fetch` deu tudo certo.
           Acontece quando o endereço não está na lista de exceções do
           catch-all, ou quando o backend não existe e o servidor de arquivos
           responde a tudo. */
        throw new ErroDaApi(
            'Este endereço respondeu a página do site em vez de dados. ' +
            'O serviço de auditoria não está disponível neste ambiente.',
            resposta.status,
            true,
        );
    }

    if (!texto.trim()) {
        if (resposta.ok) return undefined as T;
        throw new ErroDaApi(`O servidor respondeu ${resposta.status}, sem conteúdo.`, resposta.status);
    }

    let dados: unknown;
    try {
        dados = JSON.parse(texto);
    } catch {
        // Nem JSON nem HTML: texto solto, o 404 da Vercel entre eles.
        const amostra = texto.trim().slice(0, 120);
        throw new ErroDaApi(
            resposta.ok
                ? `Resposta em formato inesperado: ${amostra}`
                : `O servidor respondeu ${resposta.status}: ${amostra}`,
            resposta.status,
        );
    }

    if (!resposta.ok) {
        const d = dados as { detail?: unknown; message?: unknown; error?: unknown };
        const doServidor = [d?.detail, d?.message, d?.error].find((v) => typeof v === 'string' && v);
        throw new ErroDaApi(
            (doServidor as string) || `O servidor respondeu ${resposta.status}.`,
            resposta.status,
        );
    }

    return dados as T;
}

/**
 * `fetch` + `lerJson`, com a falha de rede também virando `ErroDaApi`.
 *
 * Sem isto, quem chama precisa distinguir três tipos de exceção para escrever
 * uma mensagem — e é aí que se acaba mostrando `err.message` cru na tela.
 */
export async function buscarJson<T = unknown>(url: string, init?: RequestInit): Promise<T> {
    let resposta: Response;
    try {
        resposta = await fetch(url, init);
    } catch {
        // TypeError do fetch: servidor fora do ar, DNS, CORS, rede caída.
        throw new ErroDaApi(
            'Não foi possível falar com o servidor. Verifique sua conexão e tente de novo.',
            0,
        );
    }
    return lerJson<T>(resposta);
}
