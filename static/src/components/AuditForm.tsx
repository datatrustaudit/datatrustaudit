import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Globe,
  Search,
  Eye,
  Upload,
  BarChart3,
  Zap,
  Shield,
  CheckCircle,
  AlertTriangle,
  Clock,
  TrendingUp,
  FileCode,
  Layers,
  Sparkles
} from 'lucide-react';
import FileUploadSection from './FileUploadSection';
import SiteNavigationAnalysis from './SiteNavigationAnalysis';
import OmnibugRealTimeDisplay from './OmnibugRealTimeDisplay';
import { useI18n } from '@/context/I18nContext';
import { usePlan } from '@/context/PlanContext';
import { Lock } from 'lucide-react';

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
  const { isFeatureAvailable, setShowUpgradeModal, setBlockedFeature } = usePlan();
  const [activeTab, setActiveTab] = useState('url');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);

  const handleFileUpload = (files: any[]) => {
    console.log('📁 Arquivos recebidos para análise:', files.length);
    if (onFileAnalysis) {
      onFileAnalysis(files);
    }
  };

  const handleAudit = () => {
    if (url && !recentUrls.includes(url)) {
      setRecentUrls(prev => [url, ...prev].slice(0, 5));
    }
    onAudit();
  };

  const features = [
    { icon: Shield, label: t('home.tag_count'), desc: t('home.tag_desc') },
    { icon: FileCode, label: t('home.lgpd_title'), desc: t('home.lgpd_desc') },
    { icon: TrendingUp, label: t('home.fines_title'), desc: t('home.fines_desc') },
    { icon: Sparkles, label: t('home.ai_title'), desc: t('home.ai_desc') },
  ];

  return (
    <Card className="mb-8 shadow-[0_20px_50px_rgba(0,0,0,0.1)] border border-slate-200 bg-white overflow-hidden rounded-[24px]">
      {/* Header Estilo Screenshot 1 */}
      <CardHeader className="relative pb-6 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
              <Zap className="h-6 w-6" />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                DataTrust Audit
                <Badge className="bg-slate-100 text-slate-500 text-[10px] font-normal border-slate-200">v2.0</Badge>
              </CardTitle>
            </div>
          </div>
        </div>
        
        <CardDescription className="text-slate-500 mt-3 text-sm">
          {t('home.audit_description')}
        </CardDescription>

        {/* Feature Pills (Screenshot 1 Style) */}
        <div className="flex flex-wrap gap-2 mt-5">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-xs text-slate-600 shadow-sm"
            >
              <f.icon className="h-3.5 w-3.5 text-blue-600" />
              <span className="font-medium">{f.label}</span>
              <span className="text-slate-300">•</span>
              <span className="text-slate-500">{f.desc}</span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-8 bg-slate-50/50">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 p-1.5 bg-slate-200/50 rounded-2xl h-auto border border-slate-200 mb-8">
            <TabsTrigger
              value="url"
              className="flex flex-col sm:flex-row items-center gap-2 py-4 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md rounded-xl transition-all text-slate-600"
            >
              <Globe className="h-4 w-4" />
              <div className="text-left">
                <div className="font-bold text-xs uppercase tracking-wider">{t('home.tab_url')}</div>
                <div className="text-[10px] opacity-60 hidden sm:block">Análise rápida</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="upload"
              className="flex flex-col sm:flex-row items-center gap-2 py-4 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md rounded-xl transition-all text-slate-600"
            >
              <Upload className="h-4 w-4" />
              <div className="text-left">
                <div className="font-bold text-xs uppercase tracking-wider">{t('home.tab_upload')}</div>
                <div className="text-[10px] opacity-60 hidden sm:block">Arquivos GTM</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="navigation"
              className="flex flex-col sm:flex-row items-center gap-2 py-4 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md rounded-xl transition-all text-slate-600"
            >
              <Layers className="h-4 w-4" />
              <div className="text-left">
                <div className="font-bold text-xs uppercase tracking-wider">Deep Scan</div>
                <div className="text-[10px] opacity-60 hidden sm:block">Site completo</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="omnibug"
              className="flex flex-col sm:flex-row items-center gap-2 py-4 data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-md rounded-xl transition-all relative text-slate-600"
            >
              <Eye className="h-4 w-4" />
              <div className="text-left">
                <div className="font-bold text-xs uppercase tracking-wider">Real-time</div>
                <div className="text-[10px] opacity-60 hidden sm:block">Omnibug Style</div>
              </div>
              <Badge className="absolute -top-1 -right-1 text-[8px] px-1 py-0 bg-blue-600 border-0">PRO</Badge>
            </TabsTrigger>
          </TabsList>

          {/* URL Analysis Tab */}
          <TabsContent value="url" className="space-y-6">
            <div className="relative group">
              <div className="flex gap-4">
                <div className="relative flex-1">
                  <Globe className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                  <Input
                    type="text"
                    placeholder="Digite a URL do site (ex: uol.com.br)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="pl-14 h-16 text-lg bg-white border-slate-200 focus:border-blue-500 focus:ring-blue-500/20 rounded-2xl transition-all placeholder:text-slate-400 text-slate-900 shadow-sm"
                    onKeyDown={(e) => e.key === 'Enter' && handleAudit()}
                  />
                </div>
                <Button
                  onClick={handleAudit}
                  disabled={loading || !url}
                  size="lg"
                  className="h-16 px-10 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white shadow-xl shadow-blue-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  {loading ? (
                    <div className="flex items-center gap-3">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      <span>{t('home.analyzing')}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 font-bold">
                      <Search className="h-5 w-5" />
                      <span>Auditar</span>
                    </div>
                  )}
                </Button>
              </div>

              {/* Recent URLs */}
              {recentUrls.length > 0 && (
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <span className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                    <Clock className="h-3 w-3" /> Recentes:
                  </span>
                  {recentUrls.map((u, i) => (
                    <button
                      key={i}
                      onClick={() => setUrl(u)}
                      className="text-[11px] px-3 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition-all"
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* View Source Option (Premium Box) */}
            <div 
              className={`flex items-center gap-5 p-5 rounded-2xl border transition-all ${
                isFeatureAvailable('showScripts') 
                  ? 'bg-white border-slate-200 shadow-sm' 
                  : 'bg-slate-50 border-slate-100 opacity-60'
              }`}
            >
              <Checkbox
                id="view-source"
                checked={isFeatureAvailable('showScripts') ? useViewSource : false}
                onCheckedChange={(checked) => {
                  if (!isFeatureAvailable('showScripts')) {
                    setBlockedFeature('showScripts');
                    setShowUpgradeModal(true);
                    return;
                  }
                  setUseViewSource(checked as boolean)
                }}
                className="w-5 h-5 rounded-md border-slate-300 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
              />
              <div 
                className="flex-1 cursor-pointer"
                onClick={() => {
                  if (!isFeatureAvailable('showScripts')) {
                    setBlockedFeature('showScripts');
                    setShowUpgradeModal(true);
                  }
                }}
              >
                <label
                  htmlFor="view-source"
                  className="font-bold text-slate-900 flex items-center gap-2 cursor-pointer text-sm"
                >
                  <Eye className="h-4 w-4 text-blue-600" />
                  Análise view-source avançada
                  {!isFeatureAvailable('showScripts') && <Lock className="h-3.5 w-3.5 text-slate-400 ml-1" />}
                </label>
                <p className="text-xs text-slate-500 mt-1">
                  Localiza posição exata das tags no HTML para debugging preciso
                </p>
              </div>
              <Badge className="bg-slate-100 text-slate-500 border-0 text-[10px] font-bold">
                + Precisão
              </Badge>
            </div>

            {/* Info Cards (Bottom Row Screenshot 1) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
              <div className="p-5 rounded-2xl bg-blue-50 border border-blue-100 group hover:bg-blue-100/50 transition-all cursor-default">
                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Zap className="h-5 w-5" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm mb-1">Rápido</h4>
                <p className="text-[11px] text-slate-500">~ 5 segundos</p>
              </div>
              <div className="p-5 rounded-2xl bg-green-50 border border-green-100 group hover:bg-green-100/50 transition-all cursor-default">
                <div className="w-8 h-8 rounded-lg bg-green-100 text-green-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Shield className="h-5 w-5" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm mb-1">Seguro</h4>
                <p className="text-[11px] text-slate-500">Sem dados salvos</p>
              </div>
              <div className="p-5 rounded-2xl bg-purple-50 border border-purple-100 group hover:bg-purple-100/50 transition-all cursor-default">
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                  <Sparkles className="h-5 w-5" />
                </div>
                <h4 className="font-bold text-slate-900 text-sm mb-1">IA</h4>
                <p className="text-[11px] text-slate-500">Auditoria com IA</p>
              </div>
            </div>
          </TabsContent>

          {/* Other Tabs remain same but inside dark theme */}
          <TabsContent value="upload" className="mt-6">
            <FileUploadSection onFilesProcessed={handleFileUpload} disabled={loading} />
          </TabsContent>
          <TabsContent value="navigation" className="mt-6">
            <SiteNavigationAnalysis url={url} onComplete={onNavigationComplete} />
          </TabsContent>
          <TabsContent value="omnibug" className="mt-6">
            <OmnibugRealTimeDisplay url={url} onComplete={(results) => {
              if (onFileAnalysis) {
                onFileAnalysis([{
                  content: JSON.stringify(results, null, 2),
                  file: { name: `omnibug-analysis-${url || 'unknown'}.json` },
                  type: 'omnibug',
                  omnibugResults: results
                }]);
              }
            }} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AuditForm;
