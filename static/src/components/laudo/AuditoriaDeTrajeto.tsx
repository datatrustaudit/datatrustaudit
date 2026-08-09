/**
 * Auditoria de percurso: o funil inteiro, a partir de um HAR do DevTools.
 *
 * Toda varredura deste produto — e do mercado — abre a home deslogada. Mas
 * dado pessoal não vaza na home: vaza no checkout, na área do cliente, na
 * confirmação do pedido. É lá que o e-mail entra no dataLayer e o CPF aparece
 * na query string, e é justamente onde nenhum scanner chega, porque nenhum faz
 * login.
 *
 * O HAR resolve sem extensão e sem pedir credencial ao cliente: quem audita
 * grava o próprio DevTools percorrendo o funil já autenticado.
 *
 * O arquivo é limpo aqui, no navegador, antes de subir. O servidor limpa de
 * novo — é lá que está a garantia —, mas assim o dado do checkout não chega
 * sequer a trafegar.
 */
import { useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
    Upload, RefreshCw, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, MapPin,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { mascararHAR } from '@/services/mascaraDePII';

interface PassoDoTrajeto {
    ordem: number;
    nome: string;
    url: string;
    requisicoes: number;
    dadosPessoais: Array<{ tipo: string; onde: string }>;
    laudo: {
        score?: number;
        tags?: Array<{ name: string; isBeforeConsent?: boolean }>;
        summary?: { violationsCount?: number; violationsBySeverity?: Record<string, number> };
        privacy?: { violations?: Array<{ severity?: string; violation?: string; description?: string }> };
    };
}

interface Resultado {
    arquivo: string;
    resumo: {
        passos: number;
        requisicoes: number;
        duracaoSegundos: number | null;
        passosIgnorados: number;
        violationsCount: number;
        dadosPessoaisEncontrados: Record<string, number>;
    };
    passos: PassoDoTrajeto[];
}

const ROTULO_PII: Record<string, string> = {
    email: 'e-mail',
    cpf: 'CPF',
    cnpj: 'CNPJ',
    cartao: 'cartão',
    telefone: 'telefone',
};

const corDaGravidade = (n?: string) =>
    n === 'critical' ? 'var(--laudo-critico)'
        : n === 'high' ? 'var(--laudo-alto)'
            : n === 'medium' ? 'var(--laudo-medio)' : 'var(--laudo-baixo)';

const Passo = ({ passo }: { passo: PassoDoTrajeto }) => {
    const [aberto, setAberto] = useState(false);
    const achados = passo.laudo.summary?.violationsCount ?? 0;
    const pii = passo.dadosPessoais?.length ?? 0;
    const tagsAntes = (passo.laudo.tags || []).filter(t => t.isBeforeConsent).length;

    // A cor do passo conta a história do funil: onde ele fica vermelho é onde
    // a correção precisa começar.
    const cor = pii > 0 ? 'var(--laudo-critico)'
        : achados > 0 ? 'var(--laudo-alto)'
            : 'var(--laudo-conforme)';

    return (
        <div className="border-l-2 pl-4 pb-5 relative" style={{ borderColor: 'var(--laudo-linha)' }}>
            <span
                className="absolute -left-[7px] top-1 h-3 w-3 rounded-full"
                style={{ background: cor }}
            />
            <button
                onClick={() => setAberto(v => !v)}
                className="flex w-full items-start justify-between gap-4 text-left"
            >
                <span className="min-w-0">
                    <span className="flex items-center gap-2">
                        {aberto
                            ? <ChevronDown className="h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />
                            : <ChevronRight className="h-4 w-4 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }} />}
                        <span className="font-medium text-sm" style={{ color: 'var(--laudo-texto)' }}>
                            {passo.nome}
                        </span>
                    </span>
                    <span
                        className="voz-evidencia mt-1 block text-[11px] pl-6"
                        style={{ color: 'var(--laudo-texto-fraco)' }}
                    >
                        {passo.requisicoes} requisição(ões)
                        {tagsAntes > 0 && ` · ${tagsAntes} tag(s) antes do consentimento`}
                    </span>
                </span>

                <span className="flex shrink-0 items-center gap-3">
                    {pii > 0 && (
                        <span
                            className="voz-evidencia rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider"
                            style={{ color: 'var(--laudo-critico)', borderColor: 'var(--laudo-critico)' }}
                        >
                            dado pessoal
                        </span>
                    )}
                    <span className="voz-evidencia text-sm font-bold" style={{ color: cor }}>
                        {achados}
                    </span>
                </span>
            </button>

            {aberto && (
                <div className="mt-3 pl-6 space-y-3">
                    {pii > 0 && (
                        <div
                            className="rounded-md border p-3"
                            style={{
                                borderColor: 'color-mix(in srgb, var(--laudo-critico) 35%, transparent)',
                                background: 'color-mix(in srgb, var(--laudo-critico) 8%, transparent)',
                            }}
                        >
                            <p className="text-xs font-semibold mb-1" style={{ color: 'var(--laudo-critico)' }}>
                                Dado pessoal em texto claro
                            </p>
                            <ul className="space-y-1 list-none p-0 m-0">
                                {passo.dadosPessoais.map((d, i) => (
                                    <li key={i} className="text-xs" style={{ color: 'var(--laudo-texto)' }}>
                                        <strong>{ROTULO_PII[d.tipo] || d.tipo}</strong> em {d.onde}
                                    </li>
                                ))}
                            </ul>
                            <p className="text-[11px] mt-2" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                O valor foi descartado antes do envio — o laudo registra onde estava.
                            </p>
                        </div>
                    )}

                    {(passo.laudo.tags || []).length > 0 && (
                        <p className="text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                            <span style={{ color: 'var(--laudo-texto-fraco)' }}>Disparou aqui: </span>
                            {(passo.laudo.tags || []).map(t => t.name).join(', ')}
                        </p>
                    )}

                    {(passo.laudo.privacy?.violations || []).slice(0, 4).map((v, i) => (
                        <p
                            key={i}
                            className="text-xs pl-2 border-l"
                            style={{ color: 'var(--laudo-texto)', borderColor: corDaGravidade(v.severity) }}
                        >
                            {v.violation || v.description}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
};

const AuditoriaDeTrajeto = () => {
    const { token } = useAuth();
    const entrada = useRef<HTMLInputElement>(null);
    const [enviando, setEnviando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [resultado, setResultado] = useState<Resultado | null>(null);
    const [limpezaLocal, setLimpezaLocal] = useState<Record<string, number> | null>(null);

    const enviar = async (arquivo: File) => {
        setEnviando(true);
        setErro(null);
        setResultado(null);
        setLimpezaLocal(null);

        try {
            const texto = await arquivo.text();
            let bruto: any;
            try {
                bruto = JSON.parse(texto);
            } catch {
                throw new Error(
                    'Esse arquivo não é um HAR válido. Na aba Network do DevTools, use o botão de exportar (seta para baixo) e escolha "Export HAR".',
                );
            }

            // Limpeza antes do envio: o dado do checkout não trafega.
            const { har, encontrados } = mascararHAR(bruto);
            setLimpezaLocal(encontrados);

            const corpo = new FormData();
            corpo.append(
                'arquivo',
                new Blob([JSON.stringify(har)], { type: 'application/json' }),
                arquivo.name,
            );

            const r = await fetch('/api/trajeto/har', {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: corpo,
            });
            const dados = await r.json().catch(() => null);
            if (!r.ok) throw new Error(dados?.detail || `O servidor respondeu ${r.status}.`);
            setResultado(dados);
        } catch (e) {
            setErro((e as Error).message);
        } finally {
            setEnviando(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                <CardContent className="pt-6">
                    <h3
                        className="voz-argumento text-lg font-semibold m-0 mb-2 flex items-center gap-2"
                        style={{ color: 'var(--laudo-texto)' }}
                    >
                        <MapPin className="h-5 w-5" style={{ color: 'var(--laudo-carimbo)' }} />
                        Auditar o funil, não só a home
                    </h3>
                    <p className="text-sm mb-4" style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}>
                        Dado pessoal raramente vaza na página inicial — vaza no carrinho, no
                        checkout e na confirmação do pedido, onde nenhuma varredura automática
                        chega porque nenhuma faz login. Grave você mesmo o percurso e suba aqui.
                    </p>

                    <ol
                        className="text-sm space-y-1.5 mb-5 pl-5"
                        style={{ color: 'var(--laudo-texto-suave)', maxWidth: '66ch' }}
                    >
                        <li>Abra o site e pressione <strong>F12</strong> para abrir o DevTools.</li>
                        <li>Vá na aba <strong>Network</strong> e marque <strong>Preserve log</strong>.</li>
                        <li>Percorra o funil como um cliente: login, produto, carrinho, checkout.</li>
                        <li>Clique na seta de download (<strong>Export HAR</strong>) e salve o arquivo.</li>
                        <li>Suba o arquivo abaixo.</li>
                    </ol>

                    <div
                        className="flex items-start gap-2 rounded-md border p-3 mb-4"
                        style={{
                            borderColor: 'color-mix(in srgb, var(--laudo-conforme) 30%, transparent)',
                            background: 'color-mix(in srgb, var(--laudo-conforme) 7%, transparent)',
                        }}
                    >
                        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--laudo-conforme)' }} />
                        <p className="text-xs m-0" style={{ color: 'var(--laudo-texto)', maxWidth: '62ch' }}>
                            E-mail, CPF, telefone e cartão são removidos <strong>no seu navegador</strong>,
                            antes do envio. O laudo registra em que ponto do funil o dado estava —
                            nunca o valor.
                        </p>
                    </div>

                    <input
                        ref={entrada}
                        type="file"
                        accept=".har,application/json"
                        className="hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) enviar(f);
                            e.target.value = '';
                        }}
                    />
                    <Button onClick={() => entrada.current?.click()} disabled={enviando} size="lg">
                        {enviando ? (
                            <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Auditando o percurso…</>
                        ) : (
                            <><Upload className="h-4 w-4 mr-2" /> Escolher arquivo HAR</>
                        )}
                    </Button>

                    {erro && (
                        <div
                            className="mt-4 flex items-start gap-2 rounded-md border p-3"
                            style={{
                                borderColor: 'color-mix(in srgb, var(--laudo-critico) 35%, transparent)',
                                background: 'color-mix(in srgb, var(--laudo-critico) 8%, transparent)',
                            }}
                        >
                            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: 'var(--laudo-critico)' }} />
                            <p className="text-sm m-0" style={{ color: 'var(--laudo-texto)' }}>{erro}</p>
                        </div>
                    )}
                </CardContent>
            </Card>

            {limpezaLocal && Object.keys(limpezaLocal).length > 0 && (
                <p className="voz-evidencia text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    Removido antes do envio:{' '}
                    {Object.entries(limpezaLocal)
                        .map(([tipo, n]) => `${n} ${ROTULO_PII[tipo] || tipo}`)
                        .join(' · ')}
                </p>
            )}

            {resultado && (
                <>
                    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                        <CardContent className="pt-6">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                {[
                                    ['Telas auditadas', resultado.resumo.passos, undefined],
                                    ['Requisições', resultado.resumo.requisicoes, undefined],
                                    ['Não conformidades', resultado.resumo.violationsCount,
                                        resultado.resumo.violationsCount > 0 ? 'var(--laudo-critico)' : 'var(--laudo-conforme)'],
                                    ['Dado pessoal exposto',
                                        Object.values(resultado.resumo.dadosPessoaisEncontrados || {}).reduce((a, b) => a + b, 0),
                                        Object.keys(resultado.resumo.dadosPessoaisEncontrados || {}).length > 0
                                            ? 'var(--laudo-critico)' : 'var(--laudo-conforme)'],
                                ].map(([rotulo, valor, cor]) => (
                                    <div key={String(rotulo)}>
                                        <p className="text-xs" style={{ color: 'var(--laudo-texto-fraco)' }}>{rotulo}</p>
                                        <p
                                            className="voz-evidencia text-2xl font-bold mt-1"
                                            style={{ color: (cor as string) || 'var(--laudo-texto)' }}
                                        >
                                            {valor as number}
                                        </p>
                                    </div>
                                ))}
                            </div>
                            {resultado.resumo.passosIgnorados > 0 && (
                                <p className="text-xs mt-4" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                    O percurso tinha mais telas: {resultado.resumo.passosIgnorados} ficaram de
                                    fora deste laudo. Grave um trecho menor para auditar as demais.
                                </p>
                            )}
                        </CardContent>
                    </Card>

                    <Card style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
                        <CardContent className="pt-6">
                            <p
                                className="voz-evidencia text-[11px] uppercase tracking-widest mb-4"
                                style={{ color: 'var(--laudo-texto-fraco)' }}
                            >
                                O percurso, passo a passo
                            </p>
                            {resultado.passos.map(p => <Passo key={p.ordem} passo={p} />)}
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    );
};

export default AuditoriaDeTrajeto;
