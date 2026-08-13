/**
 * Home — a primeira tela de quem ainda não sabe o que o produto faz.
 *
 * Ela precisa responder de uma olhada: o que é, o que o cliente ganha e o que
 * fazer agora. O "fazer agora" é um só — digitar um endereço —, então tudo que
 * não leva até o campo de URL foi cortado.
 *
 * Saíram daqui os dois borrões azuis de fundo, o degradê colorido na manchete e
 * as três "pills" com selo verde ("Sem cartão de crédito", "Relatório em 10
 * segundos", "+50 verificações ativas"): cor saturada nesta tela é alarme sem
 * achado, e as pills prometiam número que a tela não tem como comprovar. No
 * lugar dos três cartões com brilho no hover ficou o que a varredura de fato
 * observa, em texto.
 */
import { useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import AppHeader from '@/components/AppHeader';
import AuditContainer from '@/components/AuditContainer';
import AuditErrorBoundary from '@/components/AuditErrorBoundary';
import MarcaDataTrust from '@/components/MarcaDataTrust';

/* Escrito a partir do que o motor realmente lê durante a visita — tag e
   contagem de disparo, CMP e o que carrega antes do aceite, cookie e chave de
   storage gravados. Nada aqui é número ou promessa: é o escopo da varredura. */
const O_QUE_A_VARREDURA_OBSERVA = [
    {
        titulo: 'Tags e disparos',
        texto:
            'Quais tags estão instaladas, quantas vezes cada uma dispara e quais eventos duplicam conversão.',
    },
    {
        titulo: 'Consentimento',
        texto:
            'Se existe uma CMP, se ela chega a aparecer para o visitante e o que já carregou antes de qualquer aceite.',
    },
    {
        titulo: 'Cookies e armazenamento',
        texto:
            'Cookies gravados e chaves de storage escritas durante a visita, sem que nada tenha sido aceito.',
    },
];

const Index = () => {
    const { t } = useI18n();
    const [isAuditActive, setIsAuditActive] = useState(false);

    return (
        <div
            className="sup-0 voz-ferramenta min-h-screen"
            style={{ color: 'var(--laudo-texto)' }}
        >
            <AppHeader />

            {!isAuditActive && (
                <section className="container mx-auto px-4 pb-14 pt-20 md:pb-20 md:pt-28">
                    <div className="max-w-[46rem]">
                        {/* Sobretítulo em <p>: o único <h1> da tela é a
                            manchete, e leitor de tela não deve encontrar um
                            nível de cabeçalho antes dele. */}
                        <p className="t-etiqueta">Auditoria de tags, cookies e consentimento</p>

                        <h1 className="t-titulo mt-5" style={{ color: 'var(--laudo-texto)' }}>
                            Descubra o que seu site coleta antes de o visitante aceitar.
                        </h1>

                        <p className="t-corpo mt-6" style={{ color: 'var(--laudo-texto-suave)' }}>
                            A varredura abre a página sem clicar em “aceitar” — o que dispara mesmo
                            assim vira evidência no laudo.
                        </p>
                    </div>
                </section>
            )}

            {/* O campo de URL. É a única ação desta tela, e nada acima dele
                disputa atenção. */}
            <main className="container relative z-10 mx-auto px-4 pb-24">
                <AuditErrorBoundary>
                    <AuditContainer onStateChange={setIsAuditActive} />
                </AuditErrorBoundary>
            </main>

            {!isAuditActive && (
                <section className="border-t" style={{ borderColor: 'var(--sup-borda)' }}>
                    <div className="container mx-auto px-4 py-20 md:py-28">
                        <h2 className="t-etiqueta">O que a varredura observa</h2>

                        <div className="mt-10 grid gap-12 md:grid-cols-3 md:gap-10">
                            {O_QUE_A_VARREDURA_OBSERVA.map((item, indice) => (
                                <div key={item.titulo}>
                                    <span
                                        className="voz-evidencia text-[11px]"
                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                        aria-hidden="true"
                                    >
                                        {String(indice + 1).padStart(2, '0')}
                                    </span>
                                    <h3
                                        className="t-secao mt-3"
                                        style={{ color: 'var(--laudo-texto)' }}
                                    >
                                        {item.titulo}
                                    </h3>
                                    <p className="t-apoio mt-3">{item.texto}</p>
                                </div>
                            ))}
                        </div>

                        {/* A linha que assina: serifada, porque é conclusão e não
                            dado observado. */}
                        <p
                            className="voz-argumento mt-16 max-w-[38rem] text-[1.0625rem] md:mt-20"
                            style={{ color: 'var(--laudo-texto-suave)' }}
                        >
                            Cada achado vem com o que foi observado, quando e em qual endereço —
                            para você conferir, não acreditar.
                        </p>
                    </div>
                </section>
            )}

            <footer className="border-t" style={{ borderColor: 'var(--sup-borda)' }}>
                <div className="container mx-auto px-4 py-12">
                    <div className="flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
                        <span style={{ color: 'var(--laudo-texto-suave)' }}>
                            <MarcaDataTrust tamanho={26} />
                        </span>

                        <nav className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
                            <a
                                href="/pricing"
                                className="text-[color:var(--laudo-texto-suave)] transition-colors hover:text-[color:var(--laudo-carimbo)]"
                            >
                                {t('nav.pricing')}
                            </a>
                            <a
                                href="/docs"
                                className="text-[color:var(--laudo-texto-suave)] transition-colors hover:text-[color:var(--laudo-carimbo)]"
                            >
                                {t('nav.docs')}
                            </a>
                            <a
                                href="/terms"
                                className="text-[color:var(--laudo-texto-suave)] transition-colors hover:text-[color:var(--laudo-carimbo)]"
                            >
                                {t('nav.terms')}
                            </a>
                        </nav>

                        {/* O ano sai do relógio, não do arquivo de tradução: preso no JSON
                            ele ficou marcando 2024 nos dez idiomas. */}
                        <p
                            className="voz-evidencia text-[11px]"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            © {new Date().getFullYear()} {t('footer.copyright')}
                        </p>
                    </div>
                </div>
            </footer>
        </div>
    );
};

export default Index;
