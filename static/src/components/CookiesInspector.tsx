/**
 * Os cookies que o navegador realmente gravou durante a varredura.
 *
 * A versão anterior **inventava**: a partir das tags detectadas, montava um
 * `_ga` com "2 anos" de validade, um `_fbp`, um `_gid`, e apresentava tudo
 * como se tivesse sido observado. O comentário no código era honesto —
 * `// Simular cookies baseado nas tags detectadas` — mas a tela não.
 *
 * Num laudo de conformidade isso é o defeito mais caro que existe. O cliente
 * leva ao DPO uma lista de cookies que talvez nunca tenham sido gravados; se
 * alguém conferir e não achar, todo o resto do laudo — inclusive o que estava
 * certo — passa a ser suspeito.
 *
 * O motor já captura os cookies de verdade: `browser_fetcher` lê
 * `context.cookies()` (que enxerga HttpOnly, ao contrário de `document.cookie`)
 * e o `storage_auditor` classifica cada um por dono, finalidade e gravidade.
 * Isso chega à resposta em `storage.cookiesWithoutConsent`. Esta tela só
 * precisa mostrar.
 *
 * E o mais importante: o scanner nunca clica em "aceitar". Todo cookie listado
 * aqui foi gravado **sem consentimento** — é evidência datada, não inferência.
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Cookie, ShieldCheck, AlertTriangle, Info } from 'lucide-react';

interface CookieObservado {
    name?: string;
    owner?: string;
    purpose?: string;
    severity?: string;
    detail?: string;
    domain?: string;
    expires?: string | number | null;
    httpOnly?: boolean;
    secure?: boolean;
}

interface Props {
    url: string;
    /** `storage` da resposta da API. Ausente quando o plano não dá direito. */
    storage?: {
        cookiesWithoutConsent?: CookieObservado[];
        totalCookiesWithoutConsent?: number;
        storageWithoutConsent?: Array<{ name?: string; type?: string; owner?: string; purpose?: string }>;
    } | null;
}

const corDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'var(--laudo-critico)'
        : nivel === 'high' ? 'var(--laudo-alto)'
            : nivel === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

const rotuloDaGravidade = (nivel?: string) =>
    nivel === 'critical' ? 'Crítico'
        : nivel === 'high' ? 'Alto'
            : nivel === 'medium' ? 'Médio' : 'Registrado';

const CookiesInspector = ({ url, storage }: Props) => {
    const cookies = storage?.cookiesWithoutConsent ?? [];
    const outroArmazenamento = storage?.storageWithoutConsent ?? [];
    const total = storage?.totalCookiesWithoutConsent ?? cookies.length;

    /* "Veio vazio" e "não veio" são afirmações diferentes, e só a primeira
       autoriza o escudo verde lá embaixo.

       Enquanto `GET /api/scans/{id}` devolvia `scan.raw_data` cru, a chave
       chegava com outro nome (`cookies_sem_consentimento`), o `??` acima
       transformava a ausência em lista vazia, e esta tela DECLARAVA
       conformidade sobre uma varredura que tinha gravado oito cookies. A causa
       está corrigida no backend — a rota devolve a mesma forma de `/api/audit`
       —, e esta checagem é o que impede a próxima forma de dado de reeditar a
       afirmação sem ninguém perceber. */
    const trouxeALeitura = Array.isArray(storage?.cookiesWithoutConsent);

    /* Sem o bloco `storage` não há o que mostrar — e dizer isso é melhor do
       que preencher a tela com suposição. A varredura pode ter falhado, o
       plano pode não dar direito, ou o laudo pode ser antigo. */
    if (!storage || !trouxeALeitura) {
        return (
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6 flex items-start gap-3">
                    <Info className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }} />
                    <div>
                        <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                            Esta varredura não trouxe a leitura de cookies.
                        </p>
                        <p className="text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                            A captura exige o navegador real. Rode a auditoria de novo para obter
                            a lista do que foi gravado.
                        </p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-4">
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2" style={{ color: 'var(--laudo-texto)' }}>
                        <Cookie className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                        Cookies gravados sem consentimento
                    </CardTitle>
                    <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
                        O scanner visitou {url} e não clicou em “aceitar”. Tudo abaixo foi gravado
                        no navegador mesmo assim.
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    {cookies.length === 0 ? (
                        <div className="flex items-start gap-3">
                            <ShieldCheck className="h-5 w-5 shrink-0 mt-0.5" style={{ color: 'var(--laudo-conforme)' }} />
                            <div>
                                <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>
                                    Nenhum cookie foi gravado antes de qualquer aceite.
                                </p>
                                <p className="text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    É o comportamento esperado de um site que respeita a decisão do
                                    visitante.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <p className="voz-evidencia text-sm mb-4" style={{ color: 'var(--laudo-texto-suave)' }}>
                                {total} cookie(s) observado(s)
                                {total > cookies.length && ` — ${cookies.length} listado(s) neste plano`}
                            </p>

                            <ul className="space-y-3 list-none p-0 m-0">
                                {cookies.map((c, i) => {
                                    const cor = corDaGravidade(c.severity);
                                    return (
                                        <li
                                            key={`${c.name}-${i}`}
                                            className="border-l-2 pl-3"
                                            style={{ borderColor: cor }}
                                        >
                                            <div className="flex flex-wrap items-baseline gap-2">
                                                <span className="voz-evidencia text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                                    {c.name}
                                                </span>
                                                {c.owner && (
                                                    <span className="text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                                                        {c.owner}
                                                    </span>
                                                )}
                                                <span
                                                    className="voz-evidencia text-[10px] uppercase tracking-wider rounded border px-1.5"
                                                    style={{ color: cor, borderColor: cor }}
                                                >
                                                    {rotuloDaGravidade(c.severity)}
                                                </span>
                                                {c.httpOnly && (
                                                    <span className="text-[10px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                        HttpOnly — gravado pelo servidor
                                                    </span>
                                                )}
                                            </div>

                                            {c.purpose && (
                                                <p className="text-sm mt-1 m-0" style={{ color: 'var(--laudo-texto)' }}>
                                                    {c.purpose}
                                                </p>
                                            )}
                                            {c.detail && (
                                                <p className="text-xs mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)', maxWidth: '70ch' }}>
                                                    {c.detail}
                                                </p>
                                            )}
                                            {c.domain && (
                                                <p className="voz-evidencia text-[11px] mt-1 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                    domínio {c.domain}
                                                </p>
                                            )}
                                        </li>
                                    );
                                })}
                            </ul>
                        </>
                    )}
                </CardContent>
            </Card>

            {outroArmazenamento.length > 0 && (
                <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base" style={{ color: 'var(--laudo-texto)' }}>
                            <AlertTriangle className="h-4 w-4" style={{ color: 'var(--laudo-alto)' }} />
                            Também gravado sem consentimento
                        </CardTitle>
                        <CardDescription style={{ color: 'var(--laudo-texto-fraco)' }}>
                            Chaves de localStorage e sessionStorage — não são cookies, mas
                            identificam o visitante do mesmo jeito.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <ul className="space-y-2 list-none p-0 m-0">
                            {outroArmazenamento.map((s, i) => (
                                <li key={`${s.name}-${i}`} className="text-sm" style={{ color: 'var(--laudo-texto)' }}>
                                    <span className="voz-evidencia font-medium">{s.name}</span>
                                    {s.owner && <span style={{ color: 'var(--laudo-texto-suave)' }}> · {s.owner}</span>}
                                    {s.purpose && (
                                        <span className="block text-xs mt-0.5" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                            {s.purpose}
                                        </span>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default CookiesInspector;
