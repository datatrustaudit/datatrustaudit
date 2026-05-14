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
    { icon: Shield, label: '14+ Tags', desc: 'Detecção automática' },
    { icon: FileCode, label: 'LGPD', desc: 'Análise de conformidade' },
    { icon: TrendingUp, label: 'Multas', desc: 'Cálculo estimado' },
    { icon: Sparkles, label: 'IA', desc: 'Correções com Gemini' },
  ];

  return (
    <Card className="mb-8 shadow-xl border-0 bg-gradient-to-br from-white via-white to-blue-50/30 backdrop-blur-sm overflow-hidden">
      {/* Header Animado */}
      <CardHeader className="relative pb-2">
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-blue-500/10 to-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none" />

        <CardTitle className="flex items-center gap-3 text-2xl relative">
          <div className="p-2 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
            <Zap className="h-6 w-6" />
          </div>
          <div>
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent font-bold">
              GTM Audit Pro
            </span>
            <Badge variant="secondary" className="ml-2 text-xs">v2.0</Badge>
          </div>
        </CardTitle>
        <CardDescription className="text-base mt-2">
          Auditoria completa de tags, eventos e conformidade LGPD com IA
        </CardDescription>

        {/* Feature Pills */}
        <div className="flex flex-wrap gap-2 mt-4">
          {features.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200/50 text-sm"
            >
              <f.icon className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-gray-700">{f.label}</span>
              <span className="text-gray-400">•</span>
              <span className="text-gray-500 text-xs">{f.desc}</span>
            </div>
          ))}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 p-1 bg-gray-100/80 rounded-xl h-auto">
            <TabsTrigger
              value="url"
              className="flex items-center gap-2 py-3 data-[state=active]:bg-white data-[state=active]:shadow-md rounded-lg transition-all"
            >
              <Globe className="h-4 w-4" />
              <div className="hidden sm:block">
                <div className="font-medium">URL</div>
                <div className="text-[10px] text-gray-400">Análise rápida</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="upload"
              className="flex items-center gap-2 py-3 data-[state=active]:bg-white data-[state=active]:shadow-md rounded-lg transition-all"
            >
              <Upload className="h-4 w-4" />
              <div className="hidden sm:block">
                <div className="font-medium">Upload</div>
                <div className="text-[10px] text-gray-400">Arquivos GTM</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="navigation"
              className="flex items-center gap-2 py-3 data-[state=active]:bg-white data-[state=active]:shadow-md rounded-lg transition-all"
            >
              <Layers className="h-4 w-4" />
              <div className="hidden sm:block">
                <div className="font-medium">Deep Scan</div>
                <div className="text-[10px] text-gray-400">Site completo</div>
              </div>
            </TabsTrigger>
            <TabsTrigger
              value="omnibug"
              className="flex items-center gap-2 py-3 data-[state=active]:bg-white data-[state=active]:shadow-md rounded-lg transition-all relative"
            >
              <Eye className="h-4 w-4" />
              <div className="hidden sm:block">
                <div className="font-medium">Real-time</div>
                <div className="text-[10px] text-gray-400">Omnibug Style</div>
              </div>
              <Badge className="absolute -top-1 -right-1 text-[8px] px-1 py-0 bg-green-500">PRO</Badge>
            </TabsTrigger>
          </TabsList>

          {/* URL Analysis Tab */}
          <TabsContent value="url" className="space-y-4 mt-6">
            <div className="relative">
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <Globe className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Digite a URL do site (ex: uol.com.br)"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="pl-12 h-14 text-lg border-2 border-gray-200 focus:border-blue-500 rounded-xl transition-all"
                    onKeyDown={(e) => e.key === 'Enter' && handleAudit()}
                  />
                </div>
                <Button
                  onClick={handleAudit}
                  disabled={loading || !url}
                  size="lg"
                  className="h-14 px-8 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/25 transition-all hover:shadow-xl hover:shadow-blue-500/30 hover:scale-[1.02]"
                >
                  {loading ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                      <span>Analisando...</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Search className="h-5 w-5" />
                      <span>Auditar</span>
                    </div>
                  )}
                </Button>
              </div>

              {/* Recent URLs */}
              {recentUrls.length > 0 && (
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Recentes:
                  </span>
                  {recentUrls.map((u, i) => (
                    <button
                      key={i}
                      onClick={() => setUrl(u)}
                      className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* View Source Option */}
            <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/50">
              <Checkbox
                id="view-source"
                checked={useViewSource}
                onCheckedChange={(checked) => setUseViewSource(checked as boolean)}
                className="border-amber-400 data-[state=checked]:bg-amber-500"
              />
              <div className="flex-1">
                <label
                  htmlFor="view-source"
                  className="font-medium text-amber-900 cursor-pointer flex items-center gap-2"
                >
                  <Eye className="h-4 w-4" />
                  Análise view-source avançada
                </label>
                <p className="text-xs text-amber-700 mt-0.5">
                  Localiza posição exata das tags no HTML para debugging preciso
                </p>
              </div>
              <Badge className="bg-amber-100 text-amber-700 border-amber-300">
                +Precisão
              </Badge>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
                <CheckCircle className="h-5 w-5 text-blue-600 mb-2" />
                <h4 className="font-medium text-blue-900 text-sm">Rápido</h4>
                <p className="text-xs text-blue-700">~5 segundos</p>
              </div>
              <div className="p-4 rounded-xl bg-green-50 border border-green-100">
                <Shield className="h-5 w-5 text-green-600 mb-2" />
                <h4 className="font-medium text-green-900 text-sm">Seguro</h4>
                <p className="text-xs text-green-700">Sem dados salvos</p>
              </div>
              <div className="p-4 rounded-xl bg-purple-50 border border-purple-100">
                <Sparkles className="h-5 w-5 text-purple-600 mb-2" />
                <h4 className="font-medium text-purple-900 text-sm">IA</h4>
                <p className="text-xs text-purple-700">Correções automáticas</p>
              </div>
            </div>
          </TabsContent>

          {/* File Upload Tab */}
          <TabsContent value="upload" className="mt-6">
            <Alert className="mb-4 border-blue-200 bg-blue-50">
              <FileCode className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800">
                <strong>Upload de arquivos GTM:</strong> Faça upload do container JSON exportado do GTM
                ou arquivos HTML/JS para análise precisa de tags e triggers.
              </AlertDescription>
            </Alert>
            <FileUploadSection
              onFilesProcessed={handleFileUpload}
              disabled={loading}
            />
          </TabsContent>

          {/* Navigation Tab */}
          <TabsContent value="navigation" className="mt-6">
            <Alert className="mb-4 border-indigo-200 bg-indigo-50">
              <Layers className="h-4 w-4 text-indigo-600" />
              <AlertDescription className="text-indigo-800">
                <strong>Deep Scan:</strong> Navega automaticamente por múltiplas páginas do site,
                capturando todos os eventos de e-commerce, pageviews e interações.
              </AlertDescription>
            </Alert>
            <SiteNavigationAnalysis
              url={url}
              onComplete={onNavigationComplete}
            />
          </TabsContent>

          {/* Omnibug Tab */}
          <TabsContent value="omnibug" className="mt-6">
            <Alert className="mb-4 border-green-200 bg-green-50">
              <Eye className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">
                <strong>Captura Real-time:</strong> Análise estilo Omnibug que intercepta
                requisições de rede e mostra exatamente quais dados estão sendo enviados
                para GA4, Meta Pixel, GTM e outras plataformas.
              </AlertDescription>
            </Alert>
            <OmnibugRealTimeDisplay
              url={url}
              onComplete={(results) => {
                console.log('🔍 Dados Omnibug capturados:', results);
                if (onFileAnalysis) {
                  const convertedData = {
                    content: JSON.stringify(results, null, 2),
                    file: { name: `omnibug-analysis-${url || 'unknown'}.json` },
                    type: 'omnibug',
                    omnibugResults: results
                  };
                  onFileAnalysis([convertedData]);
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

export default AuditForm;
