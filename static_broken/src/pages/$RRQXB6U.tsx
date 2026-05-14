import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import AppHeader from '@/components/AppHeader';
import {
    Tag, MessageSquare, Mail, Globe, Building2, User, Briefcase,
    CheckCircle2, AlertCircle, Send, ArrowRight, Headphones, Loader2
} from 'lucide-react';

const TOOLS_LIST = [
    'Google Tag Manager', 'Google Analytics 4', 'Meta Pixel', 'Google Ads',
    'TikTok Pixel', 'Hotjar', 'Amplitude', 'Segment', 'Mixpanel',
    'Cookiebot', 'OneTrust', 'Other CMP',
];

const ROLES = [
    'Analytics Engineer', 'Data Engineer', 'Marketing Analyst',
    'Digital Marketing Manager', 'CTO / Tech Lead', 'Agency Owner',
    'Freelancer / Consultant', 'Other',
];

const TRAFFIC_OPTIONS = [
    'Under 10K/mo', '10K–100K/mo', '100K–500K/mo',
    '500K–1M/mo', 'Over 1M/mo',
];

const PLANS_OPTIONS = [
    'Free (explore)', 'Pro (R$97/mo)', 'Premium (R$247/mo)', 'Custom Audit', 'Not sure yet',
];

const SupportPage = () => {
    const { t, language } = useI18n();
    const { toast } = useToast();
    const isEn = language === 'en';

    const [form, setForm] = useState({
        name: '', email: '', company: '', website: '',
        country: '', role: '', plan_interest: '', monthly_traffic: '',
        tools: [] as string[], message: '',
    });
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

    const update = (field: string, value: string) => setForm(prev => ({ ...prev, [field]: value }));

    const toggleTool = (tool: string) => {
        setForm(prev => ({
            ...prev,
            tools: prev.tools.includes(tool)
                ? prev.tools.filter(t => t !== tool)
                : [...prev.tools, tool],
        }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.name || !form.email || !form.message) return;
        setStatus('loading');

        try {
            const res = await fetch('/api/contact', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...form, type: 'contact' }),
            });
            if (!res.ok) throw new Error('Failed');
            setStatus('success');
        } catch {
            setStatus('error');
        }
    };

    if (status === 'success') {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <AppHeader />
                <div className="flex items-center justify-center min-h-[80vh] px-4">
                    <div className="text-center max-w-md w-full">
                        <div className="w-20 h-20 rounded-full bg-green-500/20 border border-green-500/30 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-green-500/10">
                            <CheckCircle2 className="w-10 h-10 text-green-400" />
                        </div>
                        <h1 className="text-2xl font-bold text-white mb-3">
                            {isEn ? 'Message sent!' : 'Mensagem enviada!'}
                        </h1>
                        <p className="text-white/55 mb-2 leading-relaxed">
                            {isEn
                                ? "We'll get back to you within 24 hours. Check your inbox."
                                : 'Retornaremos em até 24 horas. Verifique sua caixa de entrada.'}
                        </p>
                        <p className="text-white/30 text-sm mb-8">
                            {isEn
                                ? 'Premium users get priority response within 4 hours.'
                                : 'Usuários Premium recebem resposta prioritária em até 4 horas.'}
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <Link to="/">
                                <Button
                                    className="w-full sm:w-auto bg-white/10 hover:bg-white/15 text-white border border-white/20 hover:border-white/30 font-semibold transition-all"
                                >
                                    {isEn ? '← Back to Home' : '← Início'}
                                </Button>
                            </Link>
                            <Link to="/pricing">
                                <Button
                                    className="w-full sm:w-auto bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 text-white font-semibold shadow-lg transition-all"
                                >
                                    {isEn ? 'View Pricing' : 'Ver Planos'}
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            <AppHeader />

            <div className="max-w-5xl mx-auto px-4 pt-28 pb-20">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-300 text-sm font-medium mb-5">
                        <Headphones className="w-3.5 h-3.5" />
                        {isEn ? 'We typically respond within 24 hours' : 'Respondemos em até 24 horas'}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
                        {isEn ? 'Contact Support' : 'Falar com Suporte'}
                    </h1>
                    <p className="text-xl text-white/45 max-w-lg mx-auto">
                        {isEn
                            ? "Have a question, need help, or want to discuss a custom plan? We're here."
                            : 'Tem dúvida, precisa de ajuda ou quer discutir um plano personalizado? Estamos aqui.'}
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-8">
                    {/* Sidebar */}
                    <div className="md:col-span-2 space-y-4">
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <h3 className="text-white font-semibold mb-4">
                                {isEn ? 'Other ways to reach us' : 'Outras formas de contato'}
                            </h3>
                            <div className="space-y-3">
                                <a
                                    href="mailto:digitalfistpower@gmail.com"
                                    className="flex items-center gap-3 text-white/60 hover:text-white transition-colors text-sm"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                                        <Mail className="w-4 h-4 text-blue-400" />
                                    </div>
                                    digitalfistpower@gmail.com
                                </a>
                            </div>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <h3 className="text-white font-semibold mb-3 text-sm">
                                {isEn ? 'Looking for a custom audit?' : 'Procurando auditoria personalizada?'}
                            </h3>
                            <p className="text-white/45 text-xs mb-4 leading-relaxed">
                                {isEn
                                    ? 'Enterprise teams and agencies can request a full-service custom audit with white-label reports.'
                                    : 'Equipes enterprise e agências podem solicitar auditoria completa com relatórios white-label.'}
                            </p>
                            <Link to="/quote">
                                <Button variant="outline" size="sm" className="w-full border-white/20 text-white/70 hover:bg-white/10 text-xs">
                                    {isEn ? 'Request Custom Quote →' : 'Solicitar Orçamento →'}
                                </Button>
                            </Link>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <h3 className="text-white font-semibold mb-2 text-sm">
                                {isEn ? 'Response times' : 'Tempo de resposta'}
                            </h3>
                            <div className="space-y-1.5 text-xs text-white/40">
                                <div className="flex justify-between">
                                    <span>{isEn ? 'General support' : 'Suporte geral'}</span>
                                    <span className="text-green-400">&lt; 24h</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Pro {isEn ? 'users' : 'usuários'}</span>
                                    <span className="text-green-400">&lt; 12h</span>
                                </div>
                                <div className="flex justify-between">
                                    <span>Premium {isEn ? 'users' : 'usuários'}</span>
                                    <span className="text-green-400">&lt; 4h</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Form */}
                    <div className="md:col-span-3">
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-7">
                            <h2 className="text-white font-bold text-lg mb-6">
                                {isEn ? 'Send us a message' : 'Envie uma mensagem'}
                            </h2>

                            {status === 'error' && (
                                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-3 mb-5 text-sm">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {isEn ? 'Failed to send. Try again or email us directly.' : 'Falha ao enviar. Tente novamente ou nos envie um email.'}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                {/* Name + Email */}
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">
                                            {isEn ? 'Full Name' : 'Nome Completo'} <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="text"
                                            required
                                            value={form.name}
                                            onChange={e => update('name', e.target.value)}
                                            placeholder="Alex Johnson"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">
                                            {isEn ? 'Work Email' : 'Email de Trabalho'} <span className="text-red-400">*</span>
                                        </label>
                                        <input
                                            type="email"
                                            required
                                            value={form.email}
                                            onChange={e => update('email', e.target.value)}
                                            placeholder="alex@company.com"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Company + Website */}
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Company' : 'Empresa'}</label>
                                        <input
                                            type="text"
                                            value={form.company}
                                            onChange={e => update('company', e.target.value)}
                                            placeholder="Acme Corp"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Website' : 'Website'}</label>
                                        <input
                                            type="url"
                                            value={form.website}
                                            onChange={e => update('website', e.target.value)}
                                            placeholder="https://example.com"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Role + Plan */}
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Your Role' : 'Seu Cargo'}</label>
                                        <select
                                            value={form.role}
                                            onChange={e => update('role', e.target.value)}
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all appearance-none"
                                        >
                                            <option value="" className="bg-slate-900">{isEn ? 'Select role...' : 'Selecione...'}</option>
                                            {ROLES.map(r => <option key={r} value={r} className="bg-slate-900">{r}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Plan of Interest' : 'Plano de Interesse'}</label>
                                        <select
                                            value={form.plan_interest}
                                            onChange={e => update('plan_interest', e.target.value)}
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all appearance-none"
                                        >
                                            <option value="" className="bg-slate-900">{isEn ? 'Select...' : 'Selecione...'}</option>
                                            {PLANS_OPTIONS.map(p => <option key={p} value={p} className="bg-slate-900">{p}</option>)}
                                        </select>
                                    </div>
                                </div>

                                {/* Tools */}
                                <div>
                                    <label className="block text-white/50 text-xs mb-2 font-medium">{isEn ? 'Tools you use' : 'Ferramentas que você usa'}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {TOOLS_LIST.map(tool => (
                                            <button
                                                key={tool}
                                                type="button"
                                                onClick={() => toggleTool(tool)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                                    form.tools.includes(tool)
                                                        ? 'bg-blue-500/25 border-blue-500/50 text-blue-300'
                                                        : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                                                }`}
                                            >
                                                {form.tools.includes(tool) && <span className="mr-1">✓</span>}
                                                {tool}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Message */}
                                <div>
                                    <label className="block text-white/50 text-xs mb-1.5 font-medium">
                                        {isEn ? 'Message' : 'Mensagem'} <span className="text-red-400">*</span>
                                    </label>
                                    <textarea
                                        required
                                        rows={5}
                                        value={form.message}
                                        onChange={e => update('message', e.target.value)}
                                        placeholder={isEn
                                            ? 'Describe your situation, questions, or what you need help with...'
                                            : 'Descreva sua situação, dúvidas ou o que precisa de ajuda...'
                                        }
                                        className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-blue-500/60 focus:bg-white/10 transition-all resize-none"
                                    />
                                </div>

                                <Button
                                    type="submit"
                                    disabled={status === 'loading' || !form.name || !form.email || !form.message}
                                    className="w-full bg-gradient-to-r from-blue-500 to-indigo-600 hover:opacity-90 text-white font-bold py-3 rounded-xl transition-all"
                                >
                                    {status === 'loading' ? (
                                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isEn ? 'Sending...' : 'Enviando...'}</>
                                    ) : (
                                        <><Send className="w-4 h-4 mr-2" />{isEn ? 'Send Message' : 'Enviar Mensagem'}</>
                                    )}
                                </Button>

                                <p className="text-center text-white/25 text-xs">
                                    {isEn
                                        ? 'By submitting, you agree to our Privacy Policy. No spam, ever.'
                                        : 'Ao enviar, você concorda com nossa Política de Privacidade. Sem spam.'}
                                </p>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SupportPage;
