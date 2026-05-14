import { useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import AppHeader from '@/components/AppHeader';
import AuditContainer from '@/components/AuditContainer';
import { Shield, Zap, Search, Lock, Activity, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const Index = () => {
  const { t } = useI18n();
  const [isAuditActive, setIsAuditActive] = useState(false);
  
  return (
    <div className="min-h-screen bg-gray-950 transition-colors duration-300 font-sans text-slate-200">
      <AppHeader />
      
      {!isAuditActive && (
        <section className="pt-24 pb-12 px-4 text-center max-w-5xl mx-auto relative overflow-hidden">
          {/* Background Glows */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden">
            <div className="absolute -top-24 left-1/4 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full" />
            <div className="absolute top-24 right-1/4 w-96 h-96 bg-indigo-600/10 blur-[120px] rounded-full" />
          </div>

          <Badge className="bg-white/5 hover:bg-white/10 text-blue-400 cursor-pointer mb-8 py-2 px-5 text-sm rounded-full mx-auto inline-flex items-center gap-2 border border-blue-500/20 backdrop-blur-md shadow-xl transition-all hover:scale-105 active:scale-95">
            <Shield className="w-4 h-4" />
            DataTrust Audit 2.0 está no ar!
          </Badge>
          
          <h1 className="text-5xl md:text-8xl font-black tracking-tight text-white mb-8 leading-[1.1]">
            Pare de perder dados por <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-600 to-indigo-600 drop-shadow-sm">
              tags quebradas
            </span>.
          </h1>
          
          <p className="text-xl md:text-2xl text-slate-400 mb-12 max-w-3xl mx-auto font-light leading-relaxed">
            Auditoria automatizada de Google Tag Manager, compliance LGPD/GDPR e saúde de dados. Descubra erros silenciosos antes que eles custem o seu ROI.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-6 justify-center items-center mb-4">
            <span className="flex items-center gap-2 text-sm text-slate-300 font-medium bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <CheckCircle2 className="w-4 h-4 text-green-400" /> Sem cartão de crédito
            </span>
            <span className="flex items-center gap-2 text-sm text-slate-300 font-medium bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <CheckCircle2 className="w-4 h-4 text-green-400" /> Relatório em 10 segundos
            </span>
            <span className="flex items-center gap-2 text-sm text-slate-300 font-medium bg-white/5 px-4 py-2 rounded-full border border-white/5">
              <CheckCircle2 className="w-4 h-4 text-green-400" /> +50 verificações ativas
            </span>
          </div>
        </section>
      )}

      <main className="container mx-auto px-4 pb-16 relative z-10">
        <AuditContainer onStateChange={setIsAuditActive} />
      </main>

      {!isAuditActive && (
        <section className="bg-gray-950 py-24 border-t border-white/5">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
                Tudo que você precisa para Data Layer e Tags
              </h2>
              <p className="text-lg text-slate-400 max-w-2xl mx-auto">
                Desenvolvido por especialistas em Web Analytics para martechs e equipes de growth de alta performance.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-8">
              {/* Feature 1 */}
              <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-blue-500/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-all group">
                <div className="w-14 h-14 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Activity className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Auditoria de Eventos</h3>
                <p className="text-slate-400 leading-relaxed">Verifica disparo de pageviews, conversões e ecommerce. Detectamos tags duplicadas, parâmetros faltando e consent mode.</p>
              </div>

              {/* Feature 2 */}
              <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-indigo-500/50 hover:shadow-[0_0_30px_rgba(99,102,241,0.15)] transition-all group">
                <div className="w-14 h-14 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Shield className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Riscos LGPD & GDPR</h3>
                <p className="text-slate-400 leading-relaxed">Varredura automática por tecnologias de rastreamento antes do consentimento. Descubra pixels ocultos carregando dados PII.</p>
              </div>

              {/* Feature 3 */}
              <div className="bg-white/5 backdrop-blur-sm p-8 rounded-2xl border border-white/10 hover:border-emerald-500/50 hover:shadow-[0_0_30px_rgba(16,185,129,0.15)] transition-all group">
                <div className="w-14 h-14 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                  <Search className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-bold text-white mb-3">Exportação PDF/Excel</h3>
                <p className="text-slate-400 leading-relaxed">Gere white-labels profissionais para seus clientes com 1 clique. Ideal para consultorias e agências fecharem contratos de web analytics.</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 bg-gray-950">
        <div className="container mx-auto px-4 py-12">
          <div className="flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <p className="text-sm font-semibold text-white">
                DataTrust Audit
              </p>
            </div>
            <div className="flex items-center gap-8 text-sm font-medium text-slate-500">
              <a href="/pricing" className="hover:text-blue-400 transition-colors">Preços</a>
              <a href="/docs" className="hover:text-blue-400 transition-colors">Documentação</a>
              <a href="/terms" className="hover:text-blue-400 transition-colors">Termos & Privacidade</a>
            </div>
            <p className="text-xs text-slate-600">
              © 2024 TRACKNOLOGY Ecosystem. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
