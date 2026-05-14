import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/context/I18nContext';
import { Button } from '@/components/ui/button';
import AppHeader from '@/components/AppHeader';
import {
    CheckCircle2, AlertCircle, Loader2, Send, Building2,
    Globe, BarChart3, Zap, FileText, Users, Crown, Star
} from 'lucide-react';

const TOOLS_LIST = [
    'Google Tag Manager', 'Google Analytics 4', 'Meta Pixel', 'Google Ads',
    'TikTok Pixel', 'Hotjar', 'Amplitude', 'Segment', 'Mixpanel',
    'Cookiebot', 'OneTrust', 'Custom in-house tool',
];

const TRAFFIC_OPTIONS = [
    'Under 100K/mo', '100K–500K/mo', '500K–1M/mo', '1M–5M/mo', 'Over 5M/mo',
];

const GOAL_OPTIONS = [
    'LGPD / GDPR compliance review',
    'GA4 implementation audit',
    'Tag migration from UA to GA4',
    'Full site tag inventory',
    'CMP / Consent Mode implementation review',
    'Data Layer quality audit',
    'PII leakage detection',
    'Other',
];

const QuoteRequestPage = () => {
    const { language } = useI18n();
    const isEn = language === 'en';

    const [form, setForm] = useState({
        name: '', email: '', company: '', website: '',
        domains: '', country: '', role: '',
        monthly_traffic: '', tools: [] as string[],
        goal: '', message: '',
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
        if (!form.name || !form.email) return;
        setStatus('loading');

        try {
            const res = await fetch('/api/quote-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(form),
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
                        {/* Success icon */}
                        <div className="w-20 h-20 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-purple-500/10">
                            <CheckCircle2 className="w-10 h-10 text-purple-400" />
                        </div>

                        <h1 className="text-2xl font-bold text-white mb-3">
                            {isEn ? 'Quote request received!' : 'Solicitação recebida!'}
                        </h1>
                        <p className="text-white/55 mb-2 leading-relaxed">
                            {isEn
                                ? "We'll send you a tailored proposal within 2 business days."
                                : 'Enviaremos uma proposta personalizada em até 2 dias úteis.'}
                        </p>
                        <p className="text-white/30 text-sm mb-8">
                            {isEn
                                ? 'Check your inbox — we may ask a few follow-up questions.'
                                : 'Verifique seu e-mail — podemos fazer algumas perguntas adicionais.'}
                        </p>

                        {/* 3 clearly visible action buttons */}
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
                                    className="w-full sm:w-auto bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-semibold shadow-lg transition-all"
                                >
                                    {isEn ? 'View Pricing' : 'Ver Planos'}
                                </Button>
                            </Link>
                            <Link to="/support">
                                <Button
                                    className="w-full sm:w-auto bg-white/5 hover:bg-white/10 text-white/60 hover:text-white border border-white/10 hover:border-white/20 font-medium transition-all"
                                >
                                    {isEn ? 'Contact Support' : 'Suporte'}
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
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/15 border border-purple-500/25 text-purple-300 text-sm font-medium mb-5">
                        <Building2 className="w-3.5 h-3.5" />
                        {isEn ? 'Enterprise & Agencies' : 'Enterprise & Agências'}
                    </div>
                    <h1 className="text-4xl md:text-5xl font-extrabold text-white mb-4">
                        {isEn ? 'Request a Custom Audit' : 'Solicitar Auditoria Personalizada'}
                    </h1>
                    <p className="text-xl text-white/45 max-w-lg mx-auto">
                        {isEn
                            ? "Tell us about your business and we'll build a tailored proposal — pricing by scope."
                            : 'Nos conte sobre seu negócio e criaremos uma proposta personalizada — preço por escopo.'}
                    </p>
                </div>

                <div className="grid md:grid-cols-5 gap-8">
                    {/* Sidebar */}
                    <div className="md:col-span-2 space-y-4">
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <h3 className="text-white font-semibold mb-4 text-sm">
                                {isEn ? "What's included in a Custom Audit" : 'O que está incluído na Auditoria Personalizada'}
                            </h3>
                            <div className="space-y-3">
                                {[
                                    { icon: <Globe className="w-4 h-4 text-purple-400" />, text: isEn ? 'Multi-domain scanning (up to 50 pages)' : 'Varredura multi-domínio (até 50 páginas)' },
                                    { icon: <FileText className="w-4 h-4 text-blue-400" />, text: isEn ? 'White-label bilingual reports (EN+PT)' : 'Relatórios white-label bilíngues (EN+PT)' },
                                    { icon: <BarChart3 className="w-4 h-4 text-green-400" />, text: isEn ? 'Line-level HTML & DataLayer analysis' : 'Análise linha a linha HTML & DataLayer' },
                                    { icon: <Users className="w-4 h-4 text-orange-400" />, text: isEn ? 'Team access & roles' : 'Acesso para equipe e papéis' },
                                    { icon: <Zap className="w-4 h-4 text-yellow-400" />, text: isEn ? 'Custom GTM fix scripts (AI-assisted)' : 'Scripts de correção GTM personalizados (IA)' },
                                ].map((item, i) => (
                                    <div key={i} className="flex items-start gap-2.5">
                                        <div className="w-7 h-7 rounded-lg bg-white/8 flex items-center justify-center flex-shrink-0">
                                            {item.icon}
                                        </div>
                                        <span className="text-white/55 text-xs leading-relaxed">{item.text}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="bg-gradient-to-br from-purple-500/15 to-indigo-500/15 border border-purple-500/25 rounded-2xl p-5">
                            <div className="flex items-center gap-2 mb-3">
                                <Crown className="w-4 h-4 text-purple-400" />
                                <span className="text-white font-semibold text-sm">
                                    {isEn ? 'Who is this for?' : 'Para quem é isso?'}
                                </span>
                            </div>
                            <div className="space-y-1.5 text-xs text-white/45 leading-relaxed">
                                <div>✦ {isEn ? 'Digital agencies managing multiple clients' : 'Agências digitais com múltiplos clientes'}</div>
                                <div>✦ {isEn ? 'E-commerce with 500K+ monthly visitors' : 'E-commerce com 500K+ visitas/mês'}</div>
                                <div>✦ {isEn ? 'Enterprise compliance teams' : 'Equipes de compliance enterprise'}</div>
                                <div>✦ {isEn ? 'Analytics consultants needing white-label' : 'Consultores de analytics precisando white-label'}</div>
                            </div>
                        </div>

                        <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
                            <p className="text-white/50 text-xs leading-relaxed">
                                {isEn
                                    ? 'Prefer a standard plan? No customization needed?'
                                    : 'Prefere um plano padrão? Sem necessidade de customização?'}
                            </p>
                            <Link to="/pricing" className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 text-xs mt-2 transition-colors">
                                <Star className="w-3 h-3" />
                                {isEn ? 'See Pro / Premium plans →' : 'Ver planos Pro / Premium →'}
                            </Link>
                        </div>
                    </div>

                    {/* Form */}
                    <div className="md:col-span-3">
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-7">
                            <h2 className="text-white font-bold text-lg mb-6">
                                {isEn ? 'Tell us about your project' : 'Nos conte sobre seu projeto'}
                            </h2>

                            {status === 'error' && (
                                <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl p-3 mb-5 text-sm">
                                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                                    {isEn ? 'Failed to send. Try again or email us.' : 'Falha ao enviar. Tente novamente.'}
                                </div>
                            )}

                            <form onSubmit={handleSubmit} className="space-y-4">
                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">
                                            {isEn ? 'Full Name' : 'Nome Completo'} <span className="text-red-400">*</span>
                                        </label>
                                        <input type="text" required value={form.name} onChange={e => update('name', e.target.value)}
                                            placeholder="Alex Johnson"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">
                                            {isEn ? 'Work Email' : 'Email de Trabalho'} <span className="text-red-400">*</span>
                                        </label>
                                        <input type="email" required value={form.email} onChange={e => update('email', e.target.value)}
                                            placeholder="alex@company.com"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all" />
                                    </div>
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Company' : 'Empresa'}</label>
                                        <input type="text" value={form.company} onChange={e => update('company', e.target.value)}
                                            placeholder="Acme Corp"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all" />
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Website' : 'Website'}</label>
                                        <input type="text" value={form.website} onChange={e => update('website', e.target.value)}
                                            placeholder="www.example.com"
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all" />
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Domain(s) to audit' : 'Domínio(s) para auditar'}</label>
                                    <input type="text" value={form.domains} onChange={e => update('domains', e.target.value)}
                                        placeholder="shop.example.com, blog.example.com"
                                        className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all" />
                                </div>

                                <div className="grid sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Monthly Traffic' : 'Tráfego Mensal'}</label>
                                        <select value={form.monthly_traffic} onChange={e => update('monthly_traffic', e.target.value)}
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all appearance-none">
                                            <option value="" className="bg-slate-900">{isEn ? 'Select...' : 'Selecione...'}</option>
                                            {TRAFFIC_OPTIONS.map(t => <option key={t} value={t} className="bg-slate-900">{t}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Main Audit Goal' : 'Objetivo Principal'}</label>
                                        <select value={form.goal} onChange={e => update('goal', e.target.value)}
                                            className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all appearance-none">
                                            <option value="" className="bg-slate-900">{isEn ? 'Select...' : 'Selecione...'}</option>
                                            {GOAL_OPTIONS.map(g => <option key={g} value={g} className="bg-slate-900">{g}</option>)}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-white/50 text-xs mb-2 font-medium">{isEn ? 'Tools currently in use' : 'Ferramentas em uso'}</label>
                                    <div className="flex flex-wrap gap-2">
                                        {TOOLS_LIST.map(tool => (
                                            <button key={tool} type="button" onClick={() => toggleTool(tool)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                                                    form.tools.includes(tool)
                                                        ? 'bg-purple-500/25 border-purple-500/50 text-purple-300'
                                                        : 'bg-white/5 border-white/10 text-white/50 hover:border-white/20 hover:text-white/70'
                                                }`}>
                                                {form.tools.includes(tool) && <span className="mr-1">✓</span>}
                                                {tool}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-white/50 text-xs mb-1.5 font-medium">{isEn ? 'Additional context or requirements' : 'Contexto adicional ou requisitos'}</label>
                                    <textarea rows={4} value={form.message} onChange={e => update('message', e.target.value)}
                                        placeholder={isEn ? 'e.g. We need a full compliance report for our LGPD audit by Q2...' : 'ex: Precisamos de um relatório completo de compliance para nossa auditoria LGPD...'}
                                        className="w-full bg-slate-800 border border-white/15 rounded-xl px-4 py-3 text-white text-sm placeholder:text-white/25 focus:outline-none focus:border-purple-500/60 focus:bg-white/10 transition-all resize-none" />
                                </div>

                                <Button type="submit" disabled={status === 'loading' || !form.name || !form.email}
                                    className="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 text-white font-bold py-3 rounded-xl transition-all">
                                    {status === 'loading' ? (
                                        <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{isEn ? 'Sending...' : 'Enviando...'}</>
                                    ) : (
                                        <><Send className="w-4 h-4 mr-2" />{isEn ? 'Request Custom Quote' : 'Solicitar Orçamento Personalizado'}</>
                                    )}
                                </Button>

                                <p className="text-center text-white/25 text-xs">
                                    {isEn ? 'No commitment. We\'ll respond with a detailed proposal within 2 business days.' : 'Sem compromisso. Responderemos com proposta detalhada em até 2 dias úteis.'}
                                </p>
                            </form>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuoteRequestPage;
