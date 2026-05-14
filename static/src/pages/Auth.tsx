import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Eye, EyeOff, Tag, Shield, Zap, AlertCircle } from 'lucide-react';

type AuthMode = 'login' | 'signup' | 'forgot';

const AuthPage = () => {
    const navigate = useNavigate();
    const { login, signup } = useAuth();
    const { language } = useI18n();
    const [mode, setMode] = useState<AuthMode>('login');
    const [showPassword, setShowPassword] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [form, setForm] = useState({ name: '', email: '', password: '' });

    const isEn = language === 'en';

    const getRedirectTarget = () => {
        const saved = localStorage.getItem('gtm-redirect-after-auth');
        if (saved) {
            localStorage.removeItem('gtm-redirect-after-auth');
            return saved;
        }
        return null;
    };

    const handleSocialLogin = (provider: 'google' | 'linkedin') => {
        setError('');
        // To be implemented: backend OAuth flow
        // Example: window.location.href = `${process.env.API_URL}/auth/${provider}`;
        setError(isEn 
            ? `${provider.charAt(0).toUpperCase() + provider.slice(1)} login is currently in configuration. Please use email/password.` 
            : `O login via ${provider.charAt(0).toUpperCase() + provider.slice(1)} está em configuração. Por favor, use e-mail/senha.`);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setIsLoading(true);

        try {
            if (mode === 'login') {
                await login(form.email, form.password);
                navigate(getRedirectTarget() ?? '/');
            } else if (mode === 'signup') {
                if (!form.name.trim()) {
                    setError(isEn ? 'Name is required.' : 'Nome é obrigatório.');
                    setIsLoading(false);
                    return;
                }
                await signup(form.email, form.password, form.name);
                // After signup, go to checkout if pending or pricing
                navigate(getRedirectTarget() ?? '/pricing');
            } else {
                // Forgot password — mock
                await new Promise(r => setTimeout(r, 800));
                setSuccess(isEn
                    ? 'If this email exists, a reset link has been sent.'
                    : 'Se este e-mail existir, um link de redefinição foi enviado.'
                );
            }
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : (isEn ? 'Authentication error.' : 'Erro de autenticação.'));
        } finally {
            setIsLoading(false);
        }
    };

    const titles: Record<AuthMode, { heading: string; sub: string; cta: string }> = {
        login: {
            heading: isEn ? 'Welcome back' : 'Bem-vindo de volta',
            sub: isEn ? 'Sign in to your DataTrust Audit account.' : 'Entre na sua conta DataTrust Audit.',
            cta: isEn ? 'Sign In' : 'Entrar',
        },
        signup: {
            heading: isEn ? 'Create your account' : 'Crie sua conta',
            sub: isEn ? 'Start auditing for free.' : 'Comece a auditar gratuitamente.',
            cta: isEn ? 'Create Account' : 'Criar Conta',
        },
        forgot: {
            heading: isEn ? 'Forgot password?' : 'Esqueceu a senha?',
            sub: isEn ? "We'll send a reset link to your email." : 'Enviaremos um link de redefinição.',
            cta: isEn ? 'Send Reset Link' : 'Enviar Link',
        },
    };

    const { heading, sub, cta } = titles[mode];

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 flex items-center justify-center px-4">
            {/* Background glow */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-blue-600/20 blur-3xl" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-indigo-600/20 blur-3xl" />
            </div>

            <div className="relative w-full max-w-md">
                {/* Logo */}
                <Link to="/" className="flex items-center gap-3 justify-center mb-8 group">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                        <Tag className="w-5 h-5 text-white" />
                    </div>
                    <span className="text-xl font-bold text-white tracking-tight">DataTrust Audit</span>
                </Link>

                {/* Trust chips */}
                <div className="flex items-center justify-center gap-3 mb-6">
                    {[
                        { icon: <Shield className="w-3.5 h-3.5" />, label: isEn ? 'Secure' : 'Seguro' },
                        { icon: <Zap className="w-3.5 h-3.5" />, label: isEn ? 'Instant access' : 'Acesso imediato' },
                    ].map((chip, i) => (
                        <div key={i} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 text-white/70 text-xs font-medium border border-white/10">
                            {chip.icon} {chip.label}
                        </div>
                    ))}
                </div>

                <Card className="bg-white/5 border-white/10 backdrop-blur-xl shadow-2xl">
                    <CardHeader className="pb-0 pt-8 px-8">
                        <h1 className="text-2xl font-bold text-white">{heading}</h1>
                        <p className="text-white/50 text-sm mt-1">{sub}</p>
                    </CardHeader>
                    <CardContent className="p-8 pt-6">
                        {error && (
                            <Alert className="mb-5 border-red-500/30 bg-red-500/10">
                                <AlertCircle className="h-4 w-4 text-red-400" />
                                <AlertDescription className="text-red-300 text-sm">{error}</AlertDescription>
                            </Alert>
                        )}
                        {success && (
                            <Alert className="mb-5 border-green-500/30 bg-green-500/10">
                                <AlertDescription className="text-green-300 text-sm">{success}</AlertDescription>
                            </Alert>
                        )}

                        {mode !== 'forgot' && (
                            <>
                                <div className="grid grid-cols-2 gap-4 mb-6">
                                    <Button 
                                        type="button"
                                        variant="outline" 
                                        onClick={() => handleSocialLogin('google')}
                                        className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-12 rounded-xl transition-all flex items-center justify-center gap-2 px-4 shadow-sm active:scale-95"
                                    >
                                        <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                                            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-1 .67-2.28 1.07-3.71 1.07-2.85 0-5.27-1.92-6.13-4.51H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                            <path fill="currentColor" d="M5.87 14.13c-.22-.67-.35-1.39-.35-2.13s.13-1.46.35-2.13V7.03H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.97l3.69-2.84z" />
                                            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.03l3.69 2.84c.86-2.59 3.28-4.51 6.13-4.51z" />
                                        </svg>
                                        <span className="text-sm font-medium">Google</span>
                                    </Button>
                                    <Button 
                                        type="button"
                                        variant="outline" 
                                        onClick={() => handleSocialLogin('linkedin')}
                                        className="bg-white/5 border-white/10 text-white hover:bg-white/10 h-12 rounded-xl transition-all flex items-center justify-center gap-2 px-4 shadow-sm active:scale-95"
                                    >
                                        <svg className="w-5 h-5 flex-shrink-0 text-[#0077b5]" viewBox="0 0 24 24">
                                            <path fill="currentColor" d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.32 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.79M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
                                        </svg>
                                        <span className="text-sm font-medium">LinkedIn</span>
                                    </Button>
                                </div>

                                <div className="relative mb-6">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-white/10"></span>
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-slate-950 px-2 text-slate-500">{isEn ? 'Or continue with email' : 'Ou continue com e-mail'}</span>
                                    </div>
                                </div>
                            </>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            {mode === 'signup' && (
                                <div className="space-y-1.5">
                                    <Label className="text-white/70 text-sm">{isEn ? 'Full Name' : 'Nome Completo'}</Label>
                                    <Input
                                        type="text"
                                        value={form.name}
                                        onChange={e => setForm({ ...form, name: e.target.value })}
                                        placeholder={isEn ? 'Your name' : 'Seu nome'}
                                        required
                                        className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400"
                                    />
                                </div>
                            )}

                            <div className="space-y-1.5">
                                <Label className="text-white/70 text-sm">Email</Label>
                                <Input
                                    type="email"
                                    value={form.email}
                                    onChange={e => setForm({ ...form, email: e.target.value })}
                                    placeholder="you@company.com"
                                    required
                                    className="bg-white/10 border-white/20 text-white placeholder:text-white/30 focus:border-blue-400"
                                />
                            </div>

                            {mode !== 'forgot' && (
                                <div className="space-y-1.5">
                                    <Label className="text-white/70 text-sm">{isEn ? 'Password' : 'Senha'}</Label>
                                    <div className="relative">
                                        <Input
                                            type={showPassword ? 'text' : 'password'}
                                            value={form.password}
                                            onChange={e => setForm({ ...form, password: e.target.value })}
                                            placeholder="••••••••"
                                            required
                                            minLength={6}
                                            className="bg-white/10 border-white/20 text-white placeholder:text-white/30 pr-10 focus:border-blue-400"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowPassword(!showPassword)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                                        >
                                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {mode === 'login' && (
                                <div className="flex justify-end">
                                    <button type="button" onClick={() => setMode('forgot')} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">
                                        {isEn ? 'Forgot password?' : 'Esqueci minha senha'}
                                    </button>
                                </div>
                            )}

                            <Button
                                type="submit"
                                disabled={isLoading}
                                className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 text-white font-semibold py-5 shadow-lg shadow-blue-500/25 transition-all"
                            >
                                {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : cta}
                            </Button>
                        </form>

                        <div className="mt-6 text-center text-sm">
                            {mode === 'login' ? (
                                <span className="text-white/40">
                                    {isEn ? "Don't have an account?" : 'Não tem conta?'}{' '}
                                    <button onClick={() => setMode('signup')} className="text-blue-400 hover:text-blue-300 font-medium">
                                        {isEn ? 'Sign up' : 'Criar conta'}
                                    </button>
                                </span>
                            ) : (
                                <span className="text-white/40">
                                    {isEn ? 'Already have an account?' : 'Já tem conta?'}{' '}
                                    <button onClick={() => setMode('login')} className="text-blue-400 hover:text-blue-300 font-medium">
                                        {isEn ? 'Sign in' : 'Entrar'}
                                    </button>
                                </span>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <p className="text-center text-white/30 text-xs mt-6">
                    {isEn
                        ? 'By signing up, you agree to our Terms of Service and Privacy Policy.'
                        : 'Ao criar uma conta, você concorda com nossos Termos de Uso e Política de Privacidade.'}
                </p>
            </div>
        </div>
    );
};

export default AuthPage;
