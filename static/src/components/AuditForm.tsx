
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Globe, Search, Eye, Upload, BarChart3 } from 'lucide-react';
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
  const handleFileUpload = (files: any[]) => {
    console.log('📁 Arquivos recebidos para análise:', files.length);
    if (onFileAnalysis) {
      onFileAnalysis(files);
    }
  };

  return (
    <Card className="mb-8 shadow-lg border-0 bg-white/80 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Análise Completa de Site
        </CardTitle>
        <CardDescription>
          Escolha o método de análise: inserir URL para análise automática ou fazer upload de arquivos para análise precisa
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="url" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="url" className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Análise por URL
            </TabsTrigger>
            <TabsTrigger value="upload" className="flex items-center gap-2">
              <Upload className="h-4 w-4" />
              Upload de Arquivos
            </TabsTrigger>
            <TabsTrigger value="navigation" className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4" />
              Navegação Completa
            </TabsTrigger>
            <TabsTrigger value="omnibug" className="flex items-center gap-2">
              <Eye className="h-4 w-4" />
              Captura Real (Omnibug)
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="url" className="space-y-4 mt-6">
            <div className="flex gap-4">
              <Input
                type="text"
                placeholder="exemplo.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="flex-1 h-12 text-lg"
                onKeyDown={(e) => e.key === 'Enter' && onAudit()}
              />
              <Button 
                onClick={onAudit} 
                disabled={loading}
                size="lg"
                className="px-8 bg-blue-600 hover:bg-blue-700"
              >
                {loading ? (
                  <div className="flex items-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Analisando...
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4" />
                    Iniciar Auditoria
                  </div>
                )}
              </Button>
            </div>
            
            <div className="flex items-center space-x-3 p-4 bg-orange-50 rounded-lg border border-orange-200">
              <Checkbox 
                id="view-source"
                checked={useViewSource}
                onCheckedChange={(checked) => setUseViewSource(checked as boolean)}
              />
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-orange-600" />
                <label 
                  htmlFor="view-source" 
                  className="text-sm font-medium text-orange-800 cursor-pointer"
                >
                  Usar análise view-source: para localizar posição exata do GTM
                </label>
              </div>
              <Badge variant="outline" className="bg-orange-100 text-orange-700 border-orange-300">
                Mais preciso
              </Badge>
            </div>

            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <h4 className="font-medium text-blue-900 mb-2">ℹ️ Análise por URL:</h4>
              <ul className="text-sm text-blue-800 space-y-1">
                <li>• <strong>Automática:</strong> Tenta buscar automaticamente o código do site</li>
                <li>• <strong>Limitações:</strong> Pode não capturar scripts carregados dinamicamente</li>
                <li>• <strong>Recomendação:</strong> Para análise completa, use upload de arquivos</li>
              </ul>
            </div>
          </TabsContent>
          
          <TabsContent value="upload" className="mt-6">
            <FileUploadSection 
              onFilesProcessed={handleFileUpload}
              disabled={loading}
            />
          </TabsContent>

          <TabsContent value="navigation" className="mt-6">
            <SiteNavigationAnalysis 
              url={url}
              onComplete={onNavigationComplete}
            />
          </TabsContent>

          <TabsContent value="omnibug" className="mt-6">
            <OmnibugRealTimeDisplay 
              url={url}
              onComplete={(results) => {
                console.log('🔍 Dados Omnibug capturados:', results);
                if (onFileAnalysis) {
                  // Converter dados Omnibug para formato compatível com FileAnalysisService
                  const convertedData = {
                    content: JSON.stringify(results, null, 2),
                    file: { name: `omnibug-analysis-${url || 'unknown'}.json` },
                    type: 'omnibug',
                    omnibugResults: results // Adicionar dados originais
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
