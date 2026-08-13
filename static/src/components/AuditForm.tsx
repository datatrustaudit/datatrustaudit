import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Search, Eye, Upload, Layers, MapPin, Lock, type LucideIcon } from 'lucide-react';
import AuditoriaDeTrajeto from './laudo/AuditoriaDeTrajeto';
import FileUploadSection from './FileUploadSection';
import SiteNavigationAnalysis from './SiteNavigationAnalysis';
import OmnibugRealTimeDisplay from './OmnibugRealTimeDisplay';
import { useI18n } from '@/context/I18nContext';
import { usePlan } from '@/context/PlanContext';
import { useAuth } from '@/context/AuthContext';

interface AuditFormProps {
  url: string;
  setUrl: (url: string) => void;
  useViewSource: boolean;
  setUseViewSource: (value: boolean) => void;
  loading: boolean;
  onAudit: () => void;
  onFileAnalysis?: (files: any[]) => void;
  onNavigationComplete?: (results: any) => void;
}

const AuditForm = ({
  url,
  setUrl,
  useViewSource,
  setUseViewSource,
  loading,
  onAudit,
  onFileAnalysis,
  onNavigationComplete
}: AuditFormProps) => {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const { isFeatureAvailable, setShowUpgradeModal, setBlockedFeature } = usePlan();
  const [activeTab, setActiveTab] = useState('url');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);

  const handleFileUpload = (files: any[]) => {
    if (onFileAnalysis) {
      onFileAnalysis(files);
    }
  };

  /* Gatilho para os modos que rodam dentro de um filho (Deep e Tempo Real).
     Cada incremento manda o componente começar — é o que permite um botão só,
     acima das abas, disparar qualquer um dos modos. */
  const [gatilhoDeep, setGatilhoDeep] = useState(0);
  const [gatilhoTempoReal, setGatilhoTempoReal] = useState(0);

  const registrarNoHistorico = () => {
    if (url && !recentUrls.includes(url)) {
      setRecentUrls(prev => [url, ...prev].slice(0, 5));
    }
  };

  /* Upload e Trajeto trabalham sobre arquivo — o endereço vem de dentro dele.
     Mostrar a barra nesses modos convidaria a digitar uma URL que seria
     ignorada. */
  const modoUsaUrl = activeTab !== 'upload' && activeTab !== 'trajeto';

  const rotuloDoBotao = () => {
    if (!isAuthenticated) return t('home.create_account_to_scan');
    if (activeTab === 'navigation') return t('home.tab_deep');
    if (activeTab === 'omnibug') return t('home.tab_realtime');
    return t('home.scan_website');
  };

  const dispararModoAtivo = () => {
    if (!url) return;
    registrarNoHistorico();
    if (activeTab === 'navigation') {
      setGatilhoDeep(n => n + 1);
    } else if (activeTab === 'omnibug') {
      setGatilhoTempoReal(n => n + 1);
    } else {
      onAudit();
    }
  };

  /* A leitura do plano é a mesma de antes, só guardada numa constante: a
     mesma pergunta aparecia quatro vezes dentro do JSX do view-source. */
  const podeVerFonte = isFeatureAvailable('showScripts');

  /* As abas escolhem um modo, não são o modo — por isso na tira só aparece o
     título. Título e descrição empilhados nas cinco abas viravam papa em tela
     estreita (dois blocos de 9px por aba, cinco vezes). A descrição desceu
     para uma linha só, a do modo que está ativo. */
  const modos: { valor: string; titulo: string; descricao: string; Icone: LucideIcon; pro?: boolean }[] = [
    { valor: 'url', titulo: t('home.tab_url'), descricao: t('home.tab_url_desc'), Icone: Globe },
    { valor: 'upload', titulo: t('home.tab_upload'), descricao: t('home.tab_upload_desc'), Icone: Upload },
    { valor: 'navigation', titulo: t('home.tab_deep'), descricao: t('home.tab_deep_desc'), Icone: Layers },
    { valor: 'omnibug', titulo: t('home.tab_realtime'), descricao: t('home.tab_realtime_desc'), Icone: Eye, pro: true },
    /* Trajeto: o único modo que alcança a área logada, porque quem
       navega é o auditor, não o scanner. */
    { valor: 'trajeto', titulo: 'Trajeto', descricao: 'Checkout e área logada', Icone: MapPin },
  ];
  const modoAtivo = modos.find(m => m.valor === activeTab);

  return (
    <section className="cartao mb-8 overflow-hidden">
      <div className="p-5 sm:p-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* Barra de endereço acima das abas.
              Ela morava dentro da aba "Análise Rápida": quem entrava direto no
              Deep Scan ou no Tempo Real não tinha onde digitar a URL — os dois
              recebem `url` por prop e ficavam presos numa string vazia. Aqui em
              cima ela vale para os três modos que usam URL. */}
          {modoUsaUrl && (
            <div className="mb-8 sm:mb-10">
              <label htmlFor="endereco-auditado" className="t-etiqueta mb-3 block">
                Endereço a auditar
              </label>

              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1 rounded-xl border bg-[var(--sup-2)] border-[var(--sup-borda)] transition-colors focus-within:border-[var(--laudo-carimbo)] focus-within:shadow-[0_0_0_3px_var(--laudo-carimbo-wash)]">
                  <Globe
                    aria-hidden="true"
                    className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--laudo-texto-fraco)] sm:left-5 sm:h-[1.15rem] sm:w-[1.15rem]"
                  />
                  <Input
                    id="endereco-auditado"
                    type="text"
                    inputMode="url"
                    placeholder={t('home.url_placeholder')}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="voz-evidencia h-14 w-full border-0 bg-transparent pl-11 pr-4 text-base text-[var(--laudo-texto)] placeholder:text-[var(--laudo-texto-fraco)] focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 sm:h-16 sm:pl-14 sm:text-[1.0625rem] md:text-[1.0625rem]"
                    onKeyDown={(e) => e.key === 'Enter' && dispararModoAtivo()}
                  />
                </div>
                <Button
                  onClick={dispararModoAtivo}
                  disabled={loading || !url}
                  className="h-14 w-full shrink-0 rounded-xl px-7 text-[0.9375rem] font-semibold tracking-tight transition hover:brightness-110 sm:h-16 sm:w-auto sm:px-9"
                  style={{ background: 'var(--laudo-carimbo)', color: 'var(--sup-0)' }}
                >
                  {loading ? (
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 animate-spin rounded-full border-2"
                        style={{
                          borderColor: 'color-mix(in srgb, currentColor 25%, transparent)',
                          borderTopColor: 'currentColor',
                        }}
                      />
                      {t('home.analyzing')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-2.5">
                      <Search className="h-4 w-4" aria-hidden="true" />
                      {rotuloDoBotao()}
                    </span>
                  )}
                </Button>
              </div>

              {/* Endereços já digitados nesta sessão. */}
              {recentUrls.length > 0 && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <span className="t-etiqueta">{t('nav.history')}</span>
                  {recentUrls.map((u, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setUrl(u)}
                      className="voz-evidencia max-w-full truncate rounded-md border px-2.5 py-1 text-[11px] transition-colors"
                      style={{
                        borderColor: 'var(--sup-borda)',
                        background: 'var(--sup-2)',
                        color: 'var(--laudo-texto-suave)',
                      }}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <TabsList
            aria-label="Modo de auditoria"
            className="flex h-auto w-full flex-wrap justify-start gap-1 rounded-none bg-transparent p-0"
          >
            {modos.map(({ valor, titulo, Icone, pro }) => {
              const ativa = activeTab === valor;
              return (
                <TabsTrigger
                  key={valor}
                  value={valor}
                  className="rounded-md px-2.5 py-2 text-[0.8125rem] font-medium tracking-tight transition-colors sm:px-3"
                  style={{
                    background: ativa ? 'var(--laudo-carimbo-wash)' : 'transparent',
                    color: ativa ? 'var(--laudo-texto)' : 'var(--laudo-texto-fraco)',
                    boxShadow: ativa
                      ? 'inset 0 0 0 1px color-mix(in srgb, var(--laudo-carimbo) 55%, transparent)'
                      : 'none',
                  }}
                >
                  <Icone className="mr-2 hidden h-3.5 w-3.5 opacity-70 sm:block" aria-hidden="true" />
                  {titulo}
                  {/* O selo PRO era um badge azul cheio, flutuando fora da aba.
                      A informação continua; o tratamento virou uma marca de
                      arquivo, que não disputa atenção com achado. */}
                  {pro && (
                    <span
                      className="voz-evidencia ml-2 rounded-sm border px-1 py-px text-[9px] leading-none tracking-[0.14em]"
                      style={{ borderColor: 'var(--sup-borda-forte)', color: 'var(--laudo-texto-fraco)' }}
                    >
                      PRO
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* A descrição do modo escolhido, uma linha, embaixo da tira. */}
          {modoAtivo && (
            <p className="mt-3 text-[0.8125rem]" style={{ color: 'var(--laudo-texto-fraco)' }}>
              {modoAtivo.descricao}
            </p>
          )}

          {/* URL Analysis Tab — a barra de endereço subiu para cima das abas */}
          <TabsContent value="url" className="mt-7 space-y-5 focus-visible:outline-none">
            {/* View Source Option (Premium Box) */}
            <div
              className="flex items-start gap-3 rounded-xl border p-4 sm:gap-4 sm:p-5"
              style={{
                borderColor: 'var(--sup-borda)',
                background: 'var(--sup-2)',
                opacity: podeVerFonte ? 1 : 0.65,
              }}
            >
              <Checkbox
                id="view-source"
                checked={podeVerFonte ? useViewSource : false}
                onCheckedChange={(checked) => {
                  if (!podeVerFonte) {
                    setBlockedFeature('showScripts');
                    setShowUpgradeModal(true);
                    return;
                  }
                  setUseViewSource(checked as boolean)
                }}
                className="mt-0.5 h-5 w-5 rounded-[5px] shrink-0"
                style={{
                  borderColor: 'var(--sup-borda-forte)',
                  background: podeVerFonte && useViewSource ? 'var(--laudo-carimbo)' : 'var(--sup-1)',
                  color: 'var(--sup-0)',
                }}
              />
              <div
                className="min-w-0 flex-1 cursor-pointer"
                onClick={() => {
                  if (!podeVerFonte) {
                    setBlockedFeature('showScripts');
                    setShowUpgradeModal(true);
                  }
                }}
              >
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <label
                    htmlFor="view-source"
                    className="cursor-pointer text-sm font-semibold tracking-tight"
                    style={{ color: 'var(--laudo-texto)' }}
                  >
                    {t('home.view_source')}
                  </label>
                  {!podeVerFonte && (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" style={{ color: 'var(--laudo-texto-fraco)' }} />
                  )}
                  <span className="t-etiqueta">Premium</span>
                </div>
                <p className="t-apoio mt-1 text-[0.8125rem]">
                  {t('home.view_source_desc')}
                </p>
              </div>
            </div>

            {/* Os três cartões com ícone colorido saíram. A cor ali não marcava
                gravidade nenhuma — era decoração, e cor decorativa ao lado do
                botão de varredura compete com a cor que significa achado. O
                cartão de "IA" saiu inteiro: dizia "IA — Auditoria com IA", que
                não informa nada. O que restou são os dois fatos que valem no
                momento de clicar: quanto tempo leva e o que é guardado. */}
            <p className="text-[0.8125rem]" style={{ color: 'var(--laudo-texto-fraco)' }}>
              <span className="voz-evidencia">{t('home.fast_desc')}</span>
              <span className="mx-2" aria-hidden="true">·</span>
              {t('home.secure_desc')}
            </p>
          </TabsContent>

          <TabsContent value="upload" className="mt-7 focus-visible:outline-none">
            <FileUploadSection onFilesProcessed={handleFileUpload} disabled={loading} />
          </TabsContent>
          <TabsContent value="navigation" className="mt-7 focus-visible:outline-none">
            <SiteNavigationAnalysis url={url} gatilho={gatilhoDeep} onComplete={onNavigationComplete} />
          </TabsContent>
          <TabsContent value="trajeto" className="mt-7 focus-visible:outline-none">
            <AuditoriaDeTrajeto />
          </TabsContent>
          <TabsContent value="omnibug" className="mt-7 focus-visible:outline-none">
            <OmnibugRealTimeDisplay url={url} gatilho={gatilhoTempoReal} onComplete={(results) => {
              if (onFileAnalysis) {
                onFileAnalysis([{
                  content: JSON.stringify(results, null, 2),
                  file: { name: `captura-${url || 'site'}.json` },
                  type: 'omnibug',
                  omnibugResults: results
                }]);
              }
            }} />
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
};

export default AuditForm;
