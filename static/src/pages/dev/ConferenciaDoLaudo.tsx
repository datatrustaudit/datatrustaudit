import NewAuditResults from '@/components/NewAuditResults';
import { normalizeAuditResult } from '@/components/AuditContainer';
import amostra from '@/dev/laudo-de-exemplo.json';

/**
 * Conferência visual do laudo, sem gastar varredura.
 *
 * O laudo é a tela mais difícil de olhar durante o desenvolvimento: exige
 * sessão, consome cota e leva quase um minuto de Chromium por vez. O resultado
 * prático era que mudanças no laudo iam para o commit verificadas por
 * typecheck e build — que provam que compila, não que a tela está certa. Esta
 * rota abre o laudo completo em um segundo, quantas vezes for preciso.
 *
 * **A amostra é um laudo real**, capturado de `auditar_pagina('terra.com.br',
 * 'premium')` e congelado em `src/dev/laudo-de-exemplo.json`. Isso é
 * deliberado: dado inventado é o defeito mais caro que este produto já teve, e
 * uma amostra fabricada aqui acabaria virando referência de "como o laudo
 * deve parecer" sobre números que nunca existiram. Ela foi podada dos campos
 * que nenhuma tela lê (`gtm`, `ga4`, `debugging`) e dos trechos de HTML em
 * volta de cada tag, que só pesavam.
 *
 * A rota só é registrada quando `import.meta.env.DEV` é verdadeiro — em
 * produção ela não existe, e o `import` do JSON sai do bundle junto.
 */
const ConferenciaDoLaudo = () => (
    <div className="min-h-screen px-5 py-10" style={{ background: 'var(--sup-0)' }}>
        <div className="mx-auto w-full max-w-6xl">
            {/* O aviso é grande de propósito. Uma tela de laudo idêntica à real
                exibindo dados de outro site é exatamente o tipo de coisa que
                acaba num print de apresentação. */}
            <div
                className="mb-8 rounded-lg border-l-[3px] px-4 py-3"
                style={{
                    borderLeftColor: 'var(--laudo-critico)',
                    background: 'color-mix(in srgb, var(--laudo-critico) 9%, transparent)',
                    color: 'var(--laudo-texto)',
                }}
            >
                <p className="text-sm font-semibold">Amostra de conferência — não é um laudo emitido</p>
                <p className="mt-1 text-sm" style={{ color: 'var(--laudo-texto-suave)' }}>
                    Varredura real de <strong>terra.com.br</strong>, congelada em arquivo para
                    conferir a tela sem consumir cota. Rota disponível apenas em desenvolvimento.
                </p>
            </div>

            {/* Passa pela MESMA normalização do fluxo real. A amostra é a
                resposta crua de `/api/audit`; entregá-la direto ao componente
                testaria uma forma de dado que o produto nunca produz — o
                `tagCount` vinha vazio, por exemplo, porque quem o calcula é a
                normalização. */}
            <NewAuditResults result={normalizeAuditResult(amostra) as never} scanId="amostra" />
        </div>
    </div>
);

export default ConferenciaDoLaudo;
