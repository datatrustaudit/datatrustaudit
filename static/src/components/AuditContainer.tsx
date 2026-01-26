import { useState } from 'react';
import { toast } from '@/hooks/use-toast';
import { AuditResult } from '@/types/audit';
// import { simulateAudit } from '@/utils/auditUtils';
import { FileAnalysisService } from '@/services/fileAnalysisService';
import AuditForm from '@/components/AuditForm';
import CurrentAuditDisplay from '@/components/CurrentAuditDisplay';
import AuditResultsDisplay from '@/components/AuditResultsDisplay';
import FileAnalysisResults from '@/components/FileAnalysisResults';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3 } from 'lucide-react';

const AuditContainer = () => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [fileAnalysisResult, setFileAnalysisResult] = useState<any>(null);
  const [useViewSource, setUseViewSource] = useState(false);
  const [currentAuditUrl, setCurrentAuditUrl] = useState('');
  const [analysisType, setAnalysisType] = useState<'url' | 'file' | 'navigation'>('url');
  const [navigationResult, setNavigationResult] = useState<any>(null);

  const clearAuditData = () => {
    setAuditResult(null);
    setFileAnalysisResult(null);
    setNavigationResult(null);
    setCurrentAuditUrl('');
    console.log('🧹 Dados da auditoria anterior limpos');
  };

  const handleAudit = async () => {
  if (!url) {
    toast({
      title: "Erro",
      description: "Por favor, insira uma URL válida",
      variant: "destructive"
    });
    return;
  }

  let validUrl = url;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    validUrl = 'https://' + url;
  }

  try {
    new URL(validUrl);
  } catch {
    toast({
      title: "URL Inválida",
      description: "Por favor, insira uma URL válida (ex: exemplo.com)",
      variant: "destructive"
    });
    return;
  }

  if (currentAuditUrl !== validUrl) {
    clearAuditData();
  }

  setLoading(true);
  setCurrentAuditUrl(validUrl);
  setAnalysisType('url');

  console.log(`🔄 Iniciando auditoria por URL para: ${validUrl}`);

  try {
    const response = await fetch("/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: validUrl }),
    });
    const data = await response.json();

    if (data.status === "ok" && data.result) {
      setAuditResult(data.result);

      toast({
        title: "Auditoria Concluída!",
        description: `Score: ${data.result.score} – ${data.result.problems?.join(", ") || "Sem problemas críticos."}`
      });

      console.log(`✅ Auditoria por URL concluída para: ${validUrl}`);
    } else {
      throw new Error(data.msg || "Erro desconhecido na API");
    }
  } catch (error) {
    console.error('❌ Erro na auditoria:', error);
    clearAuditData();
    toast({
      title: "Erro na Auditoria",
      description: "Ocorreu um erro durante a análise. Tente novamente ou use upload de arquivos.",
      variant: "destructive"
    });
  } finally {
    setLoading(false);
  }
};


  const handleFileAnalysis = async (files: any[]) => {
    if (!files || files.length === 0) {
      toast({
        title: "Erro",
        description: "Nenhum arquivo foi carregado",
        variant: "destructive"
      });
      return;
    }

    clearAuditData();
    setLoading(true);
    setAnalysisType('file');
    
    console.log(`🔄 Iniciando análise por upload de ${files.length} arquivos`);
    
    try {
      const fileAnalysisService = FileAnalysisService.getInstance();
      const result = await fileAnalysisService.analyzeFiles(files);
      
      setFileAnalysisResult(result);
      setCurrentAuditUrl(`Análise de ${files.length} arquivo(s)`);
      
      toast({
        title: "Análise de Arquivos Concluída!",
        description: `${result.summary.totalScripts} scripts e ${result.summary.totalEvents} eventos analisados com ${result.summary.duplicateCount} duplicatas encontradas.`
      });
      
      console.log(`✅ Análise de arquivos concluída:`);
      console.log(`   - Scripts: ${result.summary.totalScripts}`);
      console.log(`   - Eventos: ${result.summary.totalEvents}`);
      console.log(`   - Duplicatas: ${result.summary.duplicateCount}`);
      console.log(`   - Score: ${result.summary.complianceScore}%`);
      
    } catch (error) {
      console.error('❌ Erro na análise de arquivos:', error);
      clearAuditData();
      toast({
        title: "Erro na Análise",
        description: "Ocorreu um erro durante a análise dos arquivos. Verifique os arquivos e tente novamente.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNavigationComplete = async (results: any) => {
    clearAuditData();
    setLoading(true);
    setAnalysisType('navigation');
    
    console.log(`🔄 Processando resultados da navegação completa`);
    
    try {
      setNavigationResult(results);
      setCurrentAuditUrl(`Navegação completa - ${results.pages.length} páginas`);
      
      toast({
        title: "Navegação Completa Finalizada!",
        description: `${results.pages.length} páginas analisadas, ${results.totalEvents} eventos capturados, ${results.violationsFound} violações encontradas.`
      });
      
      console.log(`✅ Navegação completa processada:`);
      console.log(`   - Páginas: ${results.pages.length}`);
      console.log(`   - Eventos: ${results.totalEvents}`);
      console.log(`   - Violações: ${results.violationsFound}`);
      console.log(`   - GA4 ID: ${results.ga4PropertyId}`);
      
    } catch (error) {
      console.error('❌ Erro no processamento da navegação:', error);
      clearAuditData();
      toast({
        title: "Erro no Processamento",
        description: "Ocorreu um erro ao processar os resultados da navegação.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (newUrl: string) => {
    if (newUrl !== url && (auditResult || fileAnalysisResult || navigationResult) && currentAuditUrl) {
      console.log('🔄 URL alterada, preparando para nova auditoria');
    }
    setUrl(newUrl);
  };

  return (
    <>
      <AuditForm
        url={url}
        setUrl={handleUrlChange}
        useViewSource={useViewSource}
        setUseViewSource={setUseViewSource}
        loading={loading}
        onAudit={handleAudit}
        onFileAnalysis={handleFileAnalysis}
        onNavigationComplete={handleNavigationComplete}
      />

      {currentAuditUrl && (
        analysisType === 'url' ? auditResult : 
        analysisType === 'file' ? fileAnalysisResult : 
        navigationResult
      ) && (
        <>
          {analysisType === 'url' && auditResult && (
            <>
              <CurrentAuditDisplay 
                currentAuditUrl={currentAuditUrl}
                useViewSource={useViewSource}
                auditResult={auditResult}
              />
              
              <AuditResultsDisplay 
                auditResult={auditResult}
                currentAuditUrl={currentAuditUrl}
                url={url}
              />
            </>
          )}

          {analysisType === 'file' && fileAnalysisResult && (
            <>
              <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-green-800">
                  <span className="font-medium">Análise de arquivos:</span>
                  <span className="font-mono bg-white px-2 py-1 rounded border">
                    {currentAuditUrl}
                  </span>
                </div>
              </div>

              <FileAnalysisResults analysisResult={fileAnalysisResult} />
            </>
          )}

          {analysisType === 'navigation' && navigationResult && (
            <>
              <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-purple-800">
                  <span className="font-medium">Navegação completa:</span>
                  <span className="font-mono bg-white px-2 py-1 rounded border">
                    {currentAuditUrl}
                  </span>
                </div>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Resultados da Navegação Completa</CardTitle>
                    <CardDescription>
                      Análise detalhada de todas as páginas visitadas com eventos e scripts capturados
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="text-center p-3 bg-blue-50 rounded-lg">
                        <div className="text-2xl font-bold text-blue-600">{navigationResult.pages?.length || 0}</div>
                        <div className="text-sm text-blue-800">Páginas Analisadas</div>
                      </div>
                      <div className="text-center p-3 bg-green-50 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{navigationResult.totalEvents || 0}</div>
                        <div className="text-sm text-green-800">Eventos Capturados</div>
                      </div>
                      <div className="text-center p-3 bg-orange-50 rounded-lg">
                        <div className="text-2xl font-bold text-orange-600">{navigationResult.violationsFound || 0}</div>
                        <div className="text-sm text-orange-800">Violações LGPD</div>
                      </div>
                      <div className="text-center p-3 bg-purple-50 rounded-lg">
                        <div className="text-2xl font-bold text-purple-600">{navigationResult.summary?.complianceScore || 0}%</div>
                        <div className="text-sm text-purple-800">Score Compliance</div>
                      </div>
                    </div>

                    {navigationResult.ga4PropertyId && (
                      <Alert className="mb-4">
                        <BarChart3 className="h-4 w-4" />
                        <AlertDescription>
                          <strong>GA4 Property ID detectado:</strong> <code className="bg-gray-100 px-2 py-1 rounded">{navigationResult.ga4PropertyId}</code>
                        </AlertDescription>
                      </Alert>
                    )}

                    <div className="space-y-4">
                      <h4 className="font-semibold">Páginas Visitadas:</h4>
                      {navigationResult.pages?.map((page: any, index: number) => (
                        <div key={index} className="border rounded-lg p-4">
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-medium">{page.name}</span>
                            <Badge variant="outline">{page.type}</Badge>
                          </div>
                          <div className="text-sm text-gray-600 mb-2">{page.url}</div>
                          <div className="flex gap-4 text-sm">
                            <span>{page.events?.length || 0} eventos</span>
                            <span>{page.scripts?.length || 0} scripts</span>
                            <span className="text-orange-600">
                              {(page.events?.filter((e: any) => e.beforeConsent).length || 0) + 
                               (page.scripts?.filter((s: any) => s.beforeConsent).length || 0)} violações
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
};

export default AuditContainer;
