import { useState } from 'react';
import { useI18n } from '@/context/I18nContext';
import AppHeader from '@/components/AppHeader';
import AuditContainer from '@/components/AuditContainer';
import AuditErrorBoundary from '@/components/AuditErrorBoundary';
import { Shield, Zap, Search, Activity, CheckCircle2 } from 'lucide-react';

const Index = () => {
  const { t } = useI18n();
  const [isAuditActive, setIsAuditActive] = useState(false);
  
  return (
    <div className="min-h-screen bg-[#070b16] font-sans text-slate-200">
      <AppHeader />
      
      {!isAuditActive && (
        <section className="pt-8 pb-2 px-4 text-center max-w-5xl mx-auto relative overflow-hidden">
          {/* Background Glows */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full pointer-events-none overflow-hidden">
            <div className="absolute -top-24 left-1/4 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full" />
            <div className="absolute top-24 right-1/4 w-96 h-96 bg-indigo-600/10 blur-[120px] rounded-full" />
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-black tracking-tight text-white mb-4 leading-[1.1]">
            {t('home.hero_title_line1')} <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-blue-600 to-indigo-600 drop-shadow-sm">
              {t('home.hero_title_accent')}
            </span>.
          </h1>
          
          <p className="text-lg md:text-xl text-slate-400 mb-6 max-w-3xl mx-auto font-light leading-relaxed">
            {t('home.hero_subtitle')}
          </p>
          
          <div className="flex flex-wrap gap-3 justify-center items-center mb-2">
            <span className="flex items-center gap-2 text-xs sm:text-sm text-slate-300 font-medium bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> {t('home.perk_no_card')}
            </span>
            <span className="flex items-center gap-2 text-xs sm:text-sm text-slate-300 font-medium bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> {t('home.perk_fast_report')}
            </span>
            <span className="flex items-center gap-2 text-xs sm:text-sm text-slate-300 font-medium bg-white/5 px-3 py-1.5 rounded-full border border-white/5">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" /> {t('home.perk_active_checks')}
            </span>
          </div>
        </section>
      )}

      {/* SCAN SECTION — immediately visible after hero */}
      <main className="container mx-auto px-4 pb-8 relative z-10">
        <AuditErrorBoundary>
          <AuditContainer onStateChange={setIsAuditActive} />
        </AuditErrorBoundary>
      </main>

      {!isAuditActive && (
        <section className="bg-[#070b16] py-16 border-t border-white/5">
          <div className="container mx-auto px-4 max-w-6xl">
            <div className="text-center mb-12">
              <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">
                {t('home.features_title')}
              </h2>
              <p className="text-base text-slate-400 max-w-2xl mx-auto">
                {t('home.features_subtitle')}
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              {/* Feature 1 */}
              <div className="bg-white/5 backdrop-blur-sm p-6 rounded-2xl border border-white/10 hover:border-blue-500/50 hover:shadow-[0_0_30px_rgba(59,130,246,0.15)] transition-all group">
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Activity className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{t('home.feature1_title')}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{t('home.feature1_desc')}</p>
              </div>

              {/* Feature 2 */}
              <div className="bg-white/5 backdrop-blur-sm p-6 rounded-2xl border border-white/10 hover:border-indigo-500/50 hover:shadow-[0_0_30px_rgba(99,102,241,0.15)] transition-all group">
                <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Shield className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{t('home.feature2_title')}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{t('home.feature2_desc')}</p>
              </div>

              {/* Feature 3 */}
              <div className="bg-white/5 backdrop-blur-sm p-6 rounded-2xl border border-white/10 hover:border-emerald-500/50 hover:shadow-[0_0_30px_rgba(16,185,129,0.15)] transition-all group">
                <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                  <Search className="w-6 h-6" />
                </div>
                <h3 className="text-lg font-bold text-white mb-2">{t('home.feature3_title')}</h3>
                <p className="text-sm text-slate-400 leading-relaxed">{t('home.feature3_desc')}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Footer */}
      <footer className="border-t border-white/5 bg-[#070b16]">
        <div className="container mx-auto px-4 py-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <p className="text-sm font-semibold text-white">
                DataTrust Audit
              </p>
            </div>
            <div className="flex items-center gap-8 text-sm font-medium text-slate-500">
              <a href="/pricing" className="hover:text-blue-400 transition-colors">{t('nav.pricing')}</a>
              <a href="/docs" className="hover:text-blue-400 transition-colors">{t('nav.docs')}</a>
              <a href="/terms" className="hover:text-blue-400 transition-colors">{t('nav.terms')}</a>
            </div>
            <p className="text-xs text-slate-600">
              {t('footer.copyright')}
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
