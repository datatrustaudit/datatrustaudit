import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { AuthRequestError, useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2, Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react';
import MinimalTopMenu from '@/components/MinimalTopMenu';
import MarcaDataTrust from '@/components/MarcaDataTrust';

type AuthMode = 'login' | 'signup' | 'forgot';

/** A qual campo o erro pertence. `null` = erro geral (veio do servidor). */
type CampoDeErro = 'name' | 'email' | 'password' | null;

/**
 * Textos desta tela que ainda não existem em `translations/*.json`.
 *
 * Chave ausente no dicionário não estoura: o `t()` cai no "humanizador" e
 * imprime o nome da chave na tela ("Contexto Signup"). Como este passe só pode
 * tocar `Auth.tsx`, o texto mora aqui até virar chave de tradução — com o
 * inglês junto, para que os outros nove idiomas não regridam para português.
 */
const TEXTOS = {
    'pt-BR': {
        etiqueta_login: 'Acesso à conta',
        etiqueta_signup: 'Nova conta',
        etiqueta_forgot: 'Recuperar acesso',
        contexto_login: 'Suas varreduras e os laudos já emitidos continuam no histórico da conta.',
        contexto_signup: 'A conta guarda cada varredura no histórico: o laudo fica registrado, com data, para consultar depois.',
        dica_senha: 'Mínimo de 6 caracteres.',
        mostrar_senha: 'Mostrar senha',
        ocultar_senha: 'Ocultar senha',
        ir_para_inicio: 'DataTrust Audit — página inicial',
    },
    en: {
        etiqueta_login: 'Account access',
        etiqueta_signup: 'New account',
        etiqueta_forgot: 'Recover access',
        contexto_login: 'Your scans and the reports already issued stay in your account history.',
        contexto_signup: 'Your account keeps every scan in one history: each report stays on file, dated, for later.',
        dica_senha: 'At least 6 characters.',
        mostrar_senha: 'Show password',
        ocultar_senha: 'Hide password',
        ir_para_inicio: 'DataTrust Audit — home',
    },
};

/**
 * Campo embutido na superfície 2, alto o bastante para o toque no celular.
 * O `md:text-[15px]` não é redundante: o `Input` do shadcn traz `md:text-sm`,
 * e sem repetir o tamanho na mesma media query o campo encolhe para 14px no
 * desktop enquanto o rótulo fica no tamanho de cima.
 *
 * Nenhum campo usa placeholder: o rótulo fica visível o tempo todo (placeholder
 * some ao digitar) e `--laudo-texto-fraco` sobre `--sup-2` mede 4,41:1, abaixo
 * do mínimo de texto.
 */
const CLASSE_CAMPO =
    'h-12 rounded-lg border text-[15px] md:text-[15px] ' +
    'focus-visible:ring-2 focus-visible:ring-offset-0 focus-visible:ring-[color:var(--laudo-carimbo)]';

const estiloCampo = (temErro: boolean) => ({
    background: 'var(--sup-2)',
    // A borda vermelha é o único lugar onde cor quente aparece nesta tela — e
    // só quando existe um erro de verdade.
    borderColor: temErro ? 'var(--laudo-critico)' : 'var(--sup-borda)',
    color: 'var(--laudo-texto)',
});

/**
 * Aviso colado no campo, com o mesmo texto que a tela já mostrava.
 *
 * Fica no escopo do módulo de propósito: componente declarado dentro do render
 * é um tipo novo a cada rerender, e o React desmonta e remonta a árvore em vez
 * de atualizá-la.
 */
const MensagemDeErro = ({ id, texto }: { id: string; texto: string }) => (
    <p
        id={id}
        role="alert"
        className="mt-2 flex items-start gap-1.5 text-[13px] leading-snug"
        style={{ color: 'var(--laudo-critico)' }}
    >
        <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{texto}</span>
    </p>
);

/** Faixa de aviso do cartão: cor só na barra lateral, nunca no fundo inteiro. */
const estiloFaixa = (cor: string) => ({
    background: 'var(--sup-2)',
    borderStyle: 'solid' as const,
    borderColor: 'var(--sup-borda)',
    borderWidth: '1px',
    borderLeftWidth: '3px',
    borderLeftColor: cor,
});

const AuthPage = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const { login, signup, loginWithGoogle } = useAuth();
    const { t, language } = useI18n();
    const [mode, setMode] = useState<AuthMode>(() => searchParams.get('mode') === 'signup' ? 'signup' : 'login');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [campoDoErro, setCampoDoErro] = useState<CampoDeErro>(null);
    const [success, setSuccess] = useState('');
    const [form, setForm] = useState({ name: '', email: '', password: '' });

    const tx = (key: string, vars: Record<string, string> = {}) =>
        Object.entries(vars).reduce((text, [name, value]) => text.replace(`{${name}}`, value), t(key));

    const tl = (chave: keyof (typeof TEXTOS)['pt-BR']) =>
        (language === 'pt-BR' ? TEXTOS['pt-BR'] : TEXTOS.en)[chave];

    const getAuthErrorMessage = (err: unknown) => {
        if (err instanceof AuthRequestError) {
            switch (err.code) {
                case 'EMAIL_ALREADY_REGISTERED':
                    return t('auth.email_may_exist');
                case 'NAME_REQUIRED':
                case 'PASSWORD_TOO_SHORT':
                case 'VALIDATION_FAILED':
                    return t('auth.check_information');
                default:
                    return mode === 'signup' ? t('auth.signup_failed') : t('auth.authentication_error');
            }
        }
        return mode === 'signup' ? t('auth.signup_failed') : t('auth.authentication_error');
    };

    const getRedirectTarget = () => {
        const saved = localStorage.getItem('gtm-redirect-after-auth');
        if (saved) {
            localStorage.removeItem('gtm-redirect-after-auth');
            return saved;
        }
        return null;
    };

    const handleGoogleLogin = async () => {
        setError('');
        setCampoDoErro(null);
        try {
            await loginWithGoogle();
        } catch (err: unknown) {
            setError(getAuthErrorMessage(err));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setCampoDoErro(null);
        setIsLoading(true);

        try {
            if (mode === 'login') {
                await login(form.email, form.password);
                navigate(getRedirectTarget() ?? '/');
            } else if (mode === 'signup') {
                if (!form.name.trim()) {
                    setError(t('auth.name_required'));
                    setCampoDoErro('name');
                    setIsLoading(false);
                    return;
                }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
                    setError(t('auth.check_information'));
                    setCampoDoErro('email');
                    setIsLoading(false);
                    return;
                }
                if (form.password.length < 6) {
                    setError(t('auth.check_information'));
                    setCampoDoErro('password');
                    setIsLoading(false);
                    return;
                }
                await signup(form.email, form.password, form.name);
                navigate(getRedirectTarget() ?? '/pricing');
            } else {
                await new Promise(r => setTimeout(r, 800));
                setSuccess(t('auth.reset_sent'));
            }
        } catch (err: unknown) {
            setError(getAuthErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const titles: Record<AuthMode, { heading: string; sub: string; cta: string }> = {
        login: {
            heading: t('auth.login_heading'),
            sub: t('auth.login_sub'),
            cta: t('auth.login_cta'),
        },
        signup: {
            heading: t('auth.signup_heading'),
            sub: t('auth.signup_sub'),
            cta: t('auth.signup_cta'),
        },
        forgot: {
            heading: t('auth.forgot_heading'),
            sub: t('auth.forgot_sub'),
            cta: t('auth.forgot_cta'),
        },
    };

    const { heading, cta } = titles[mode];

    const etiqueta = { login: 'etiqueta_login', signup: 'etiqueta_signup', forgot: 'etiqueta_forgot' } as const;
    // No "esqueci a senha" a frase de contexto é a própria explicação já
    // traduzida; nos outros dois modos ela diz o que a pessoa leva daqui.
    const contexto =
        mode === 'forgot' ? titles.forgot.sub
            : mode === 'signup' ? tl('contexto_signup')
                : tl('contexto_login');

    /**
     * Um erro só pode ser exibido junto do campo se o campo estiver na tela.
     * Sem esta checagem, trocar de modo com erro pendente (ex.: erro no nome e
     * depois voltar para o login) faria a mensagem sumir por completo.
     */
    const campoEstaNaTela = (campo: Exclude<CampoDeErro, null>) =>
        campo === 'name' ? mode === 'signup'
            : campo === 'password' ? mode !== 'forgot'
                : true;

    const erroDoCampo = (campo: Exclude<CampoDeErro, null>) =>
        campoDoErro === campo && campoEstaNaTela(campo) ? error : '';

    const erroGeral = error && (!campoDoErro || !campoEstaNaTela(campoDoErro)) ? error : '';

    const erroNome = erroDoCampo('name');
    const erroEmail = erroDoCampo('email');
    const erroSenha = erroDoCampo('password');

    // A dica de senha só existe no cadastro; apontar `aria-describedby` para um
    // id que não está na página não descreve nada.
    const descricaoDaSenha = [erroSenha ? 'erro-senha' : '', mode === 'signup' ? 'dica-senha' : '']
        .filter(Boolean).join(' ');

    return (
        <div className="min-h-screen px-5 pb-16 pt-28" style={{ background: 'var(--sup-0)' }}>
            <MinimalTopMenu />

            <div className="mx-auto w-full max-w-[26rem]">
                <div className="flex justify-center">
                    <Link
                        to="/"
                        aria-label={tl('ir_para_inicio')}
                        className="inline-flex rounded-md"
                        style={{ color: 'var(--laudo-texto)' }}
                    >
                        <MarcaDataTrust tamanho={32} />
                    </Link>
                </div>

                <header className="mt-12 text-center">
                    <p className="t-etiqueta">{tl(etiqueta[mode])}</p>
                    <h1 className="t-titulo mt-3" style={{ color: 'var(--laudo-texto)' }}>{heading}</h1>
                    <p className="t-corpo mx-auto mt-4" style={{ color: 'var(--laudo-texto-suave)' }}>{contexto}</p>
                </header>

                <div className="cartao mt-9 p-6 sm:p-7">
                    {erroGeral && (
                        <div
                            role="alert"
                            className="mb-6 flex items-start gap-3 rounded-lg px-4 py-3"
                            style={estiloFaixa('var(--laudo-critico)')}
                        >
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: 'var(--laudo-critico)' }} />
                            <p className="text-sm leading-snug" style={{ color: 'var(--laudo-texto)' }}>{erroGeral}</p>
                        </div>
                    )}

                    {/* Confirmação de envio usa o azul da marca, não o verde de
                        `--laudo-conforme`: aquele verde é o selo de "site em
                        conformidade" e não pode significar "e-mail enviado". */}
                    {success && (
                        <div
                            role="status"
                            className="mb-6 flex items-start gap-3 rounded-lg px-4 py-3"
                            style={estiloFaixa('var(--laudo-carimbo)')}
                        >
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" style={{ color: 'var(--laudo-carimbo)' }} />
                            <p className="text-sm leading-snug" style={{ color: 'var(--laudo-texto)' }}>{success}</p>
                        </div>
                    )}

                    {mode !== 'forgot' && (
                        <>
                            {/* Caminho secundário: contorno, sem preenchimento. O botão
                                cheio da tela é um só, e é o de continuar. */}
                            <Button
                                type="button"
                                variant="outline"
                                onClick={handleGoogleLogin}
                                className="h-12 w-full gap-3 rounded-lg border text-sm font-medium transition hover:brightness-125"
                                style={{
                                    background: 'var(--sup-2)',
                                    borderColor: 'var(--sup-borda)',
                                    color: 'var(--laudo-texto)',
                                }}
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ width: 18, height: 18, flexShrink: 0 }}>
                                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.07-3.71 1.07-2.85 0-5.27-1.92-6.13-4.51H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path fill="currentColor" d="M5.87 14.13c-.22-.67-.35-1.39-.35-2.13s.13-1.46.35-2.13V7.03H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.97l3.69-2.84z" />
                                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.03l3.69 2.84c.86-2.59 3.28-4.51 6.13-4.51z" />
                                </svg>
                                <span>Entrar com Google</span>
                            </Button>

                            {/* Divisor por duas linhas em vez de rótulo sobreposto: o
                                antigo pintava fundo `bg-slate-950` atrás do texto, cor
                                que não é a do cartão — a listra aparecia. */}
                            <div className="my-6 flex items-center gap-3">
                                <span className="h-px flex-1" style={{ background: 'var(--sup-borda)' }} />
                                <span className="t-etiqueta shrink-0">{t('auth.or_continue_email')}</span>
                                <span className="h-px flex-1" style={{ background: 'var(--sup-borda)' }} />
                            </div>
                        </>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        {mode === 'signup' && (
                            <div>
                                <Label htmlFor="campo-nome" className="text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                    {t('auth.full_name')}
                                </Label>
                                <Input
                                    id="campo-nome"
                                    type="text"
                                    autoComplete="name"
                                    value={form.name}
                                    onChange={e => setForm({ ...form, name: e.target.value })}
                                    required
                                    aria-invalid={!!erroNome}
                                    aria-describedby={erroNome ? 'erro-nome' : undefined}
                                    className={`mt-2 ${CLASSE_CAMPO}`}
                                    style={estiloCampo(!!erroNome)}
                                />
                                {erroNome && <MensagemDeErro id="erro-nome" texto={erroNome} />}
                            </div>
                        )}

                        <div>
                            <Label htmlFor="campo-email" className="text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                E-mail
                            </Label>
                            <Input
                                id="campo-email"
                                type="email"
                                autoComplete="email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                required
                                aria-invalid={!!erroEmail}
                                aria-describedby={erroEmail ? 'erro-email' : undefined}
                                className={`mt-2 ${CLASSE_CAMPO}`}
                                style={estiloCampo(!!erroEmail)}
                            />
                            {erroEmail && <MensagemDeErro id="erro-email" texto={erroEmail} />}
                        </div>

                        {mode !== 'forgot' && (
                            <div>
                                <div className="flex items-baseline justify-between gap-3">
                                    <Label htmlFor="campo-senha" className="text-[13px]" style={{ color: 'var(--laudo-texto-suave)' }}>
                                        {t('auth.password')}
                                    </Label>
                                    {mode === 'login' && (
                                        <button
                                            type="button"
                                            onClick={() => setMode('forgot')}
                                            className="rounded text-[13px] transition hover:underline"
                                            style={{ color: 'var(--laudo-carimbo)' }}
                                        >
                                            {t('auth.forgot_password')}
                                        </button>
                                    )}
                                </div>
                                <div className="relative mt-2">
                                    <Input
                                        id="campo-senha"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                                        value={form.password}
                                        onChange={e => setForm({ ...form, password: e.target.value })}
                                        required
                                        minLength={6}
                                        aria-invalid={!!erroSenha}
                                        aria-describedby={descricaoDaSenha || undefined}
                                        className={`pr-12 ${CLASSE_CAMPO}`}
                                        style={estiloCampo(!!erroSenha)}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        aria-label={showPassword ? tl('ocultar_senha') : tl('mostrar_senha')}
                                        aria-pressed={showPassword}
                                        className="absolute right-1.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md transition"
                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                    >
                                        {showPassword
                                            ? <EyeOff className="h-4 w-4" aria-hidden="true" />
                                            : <Eye className="h-4 w-4" aria-hidden="true" />}
                                    </button>
                                </div>
                                {erroSenha && <MensagemDeErro id="erro-senha" texto={erroSenha} />}
                                {mode === 'signup' && (
                                    <p id="dica-senha" className="mt-2 text-[13px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                        {tl('dica_senha')}
                                    </p>
                                )}
                            </div>
                        )}

                        {/* Único botão cheio da tela: a ação que a pessoa veio fazer. */}
                        <Button
                            type="submit"
                            disabled={isLoading}
                            aria-busy={isLoading}
                            className="h-12 w-full rounded-lg text-[15px] font-semibold transition hover:brightness-110"
                            style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                        >
                            {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                            {cta}
                        </Button>
                    </form>

                    <div
                        className="mt-6 border-t pt-5 text-center text-sm"
                        style={{ borderColor: 'var(--sup-borda)', color: 'var(--laudo-texto-suave)' }}
                    >
                        {mode === 'login' ? (
                            <span>
                                {t('auth.no_account')}{' '}
                                <button
                                    onClick={() => setMode('signup')}
                                    className="rounded font-medium transition hover:underline"
                                    style={{ color: 'var(--laudo-carimbo)' }}
                                >
                                    {t('auth.sign_up')}
                                </button>
                            </span>
                        ) : (
                            <span>
                                {t('auth.have_account')}{' '}
                                <button
                                    onClick={() => setMode('login')}
                                    className="rounded font-medium transition hover:underline"
                                    style={{ color: 'var(--laudo-carimbo)' }}
                                >
                                    {t('auth.sign_in')}
                                </button>
                            </span>
                        )}
                    </div>
                </div>

                <p className="mx-auto mt-6 max-w-[22rem] text-center text-xs leading-relaxed" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {t('auth.terms_notice')}
                </p>
            </div>
        </div>
    );
};

export default AuthPage;
