import { useState, useRef, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { FileAnalysisService } from '@/services/fileAnalysisService';
import AuditForm from '@/components/AuditForm';
import NewAuditResults from '@/components/NewAuditResults';
import FileAnalysisResults from '@/components/FileAnalysisResults';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BarChart3 } from 'lucide-react';
import { usePlan } from '@/context/PlanContext';
import { useAuth } from '@/context/AuthContext';

interface Tag {
    id: string;
    name: string;
    type: string;
    position: number;
    lineNumber: number;
    matchedPattern: string;
    tagId: string | null;
    dataCollected: string[];
    lgpdRisk: string;
    context: string;
    isBeforeConsent: boolean;
}

interface NewAuditResult {
    url: string;
    timestamp: string;
    tags: Tag[];
    tagCount: number;
    typeCounts: Record<string, number>;
    duplicates: any[];
    loadingOrder: any[];
    privacy: {
        jurisdiction: string;
        framework: string;
        confidenceLevel: string;
        consentRisks: string[];
        disclosureGaps: string[];
        violations: any[];
        total_violations: number;
        estimatedRiskExposure: string;
        has_consent_tool: boolean;
        has_universal_analytics: boolean;
        compliance_score: number;
    };
    score: number;
    scores?: {
        auditScore: number;
        trackingQualityScore: number;
        eventArchitectureScore: number;
        datalayerQualityScore: number;
        consentIntegrityScore: number;
        privacyRiskScore: number;
        tagDuplicationRisk?: number;
        estimatedBusinessImpact?: string;
    };
    gtmQuality?: any;
    events?: any;
    consentAudit?: any;
    recommendations?: any[];
    dataQualityNotes?: any[];
    summary: {
        totalTags: number;
        consentDetected: boolean;
        consentModeV2?: boolean;
        hasUniversalAnalytics: boolean;
        violationsCount: number;
        estimatedFine: string;
        piiExposureCount?: number;
        securityIssuesCount?: number;
        eventsDetected?: number;
        duplicatesDetected?: number;
    };
    pageReports?: any[];
}
interface AuditContainerProps {
  onStateChange?: (isActive: boolean) => void;
}

const AuditContainer = ({ onStateChange }: AuditContainerProps = {}) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [auditResult, setAuditResult] = useState<NewAuditResult | null>(null);
  const [fileAnalysisResult, setFileAnalysisResult] = useState<any>(null);
  const [useViewSource, setUseViewSource] = useState(false);
  const [currentAuditUrl, setCurrentAuditUrl] = useState('');
  const [analysisType, setAnalysisType] = useState<'url' | 'file' | 'navigation'>('url');
  const [navigationResult, setNavigationResult] = useState<any>(null);
  const [currentScanId, setCurrentScanId] = useState<string | null>(null);

  // Plan entitlement
  const { plan, limits, isFeatureAvailable } = usePlan();
  const { token, isAuthenticated } = useAuth();
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    }
  }, []);

  // Force-disable view-source for non-Premium users even if toggle somehow got set
  const effectiveViewSource = useViewSource && isFeatureAvailable('showScripts');

  const clearAuditData = () => {
    setAuditResult(null);
    setFileAnalysisResult(null);
    setNavigationResult(null);
    setCurrentScanId(null);
    setCurrentAuditUrl('');
    onStateChange?.(false);
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
    onStateChange?.(true);

    console.log(`🔄 Iniciando auditoria por URL para: ${validUrl}`);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`/api/scans/?url=${encodeURIComponent(validUrl)}`, {
        method: 'POST',
        headers
      });
      
      if (!response.ok) {
        let errData;
        try { errData = await response.json(); } catch { errData = null; }
        throw new Error(errData?.detail || `Erro na API: ${response.status}`);
      }
      
      const data = await response.json();
      const scanId = data.scan_id;
      setCurrentScanId(scanId);

      const pollScan = async () => {
        try {
            const pollRes = await fetch(`/api/scans/${scanId}`, {
                headers
            });
            if (!pollRes.ok) throw new Error("Falha ao obter status da auditoria");
            const pollData = await pollRes.json();
            
            if (pollData.status === "completed") {
                setAuditResult(pollData.result);
                
                const violationCount = pollData.result?.privacy?.total_violations || 0;
                const score = pollData.result?.scores?.overall || pollData.result?.score || pollData.score || 0;
                
                toast({
                  title: "Auditoria Concluída!",
                  description: `Score: ${score}% – ${violationCount} violações LGPD detectadas`
                });
                setLoading(false);
            } else if (pollData.status === "failed") {
                throw new Error("A auditoria falhou no servidor.");
            } else {
                pollTimerRef.current = setTimeout(pollScan, 3000);
            }
        } catch (e) {
            console.error('❌ Erro no polling:', e);
            clearAuditData();
            setLoading(false);
            toast({
              title: "Erro na Auditoria",
              description: e instanceof Error ? e.message : "Ocorreu um erro durante a análise. Tente novamente.",
              variant: "destructive"
            });
        }
      };

      pollScan();

    } catch (error) {
      console.error('❌ Erro na auditoria:', error);
      clearAuditData();
      setLoading(false);
      toast({
        title: "Erro na Auditoria",
        description: error instanceof Error ? error.message : "Ocorreu um erro ao iniciar a análise. Tente novamente.",
        variant: "destructive"
      });
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
    onStateChange?.(true);

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
    onStateChange?.(true);

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

      {/* Resultado da auditoria por URL - Novo formato */}
      {analysisType === 'url' && auditResult && (
        <NewAuditResults result={auditResult} scanId={currentScanId || undefined} />
      )}

      {/* Resultado da análise de arquivos */}
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

      {/* Resultado da navegação completa - Unificado com NewAuditResults */}
      {analysisType === 'navigation' && navigationResult && (
        <NewAuditResults 
          result={{
            url: url,
            timestamp: new Date().toISOString(),
            tags: navigationResult.allTags || [], // Garantir que temos tags consolidadas
            tagCount: navigationResult.allTags?.length || 0,
            typeCounts: {}, 
            duplicates: [],
            loadingOrder: [],
            privacy: {
              violations: navigationResult.violationsFound || [],
              total_violations: navigationResult.violationsFound?.length || 0,
              estimatedRiskExposure: navigationResult.summary?.estimatedFine || "R$ 0",
              has_consent_tool: navigationResult.summary?.consentDetected || false,
              has_universal_analytics: false,
              compliance_score: navigationResult.summary?.complianceScore || 0,
              jurisdiction: 'Unknown',
              framework: 'General Privacy',
              confidenceLevel: 'low',
              consentRisks: [],
              disclosureGaps: [],
            },
            score: navigationResult.summary?.complianceScore || 0,
            summary: {
              totalTags: navigationResult.allTags?.length || 0,
              consentDetected: navigationResult.summary?.consentDetected || false,
              hasUniversalAnalytics: false,
              violationsCount: navigationResult.violationsFound?.length || 0,
              estimatedFine: navigationResult.summary?.estimatedFine || "R$ 0",
              piiExposureCount: navigationResult.piiExposureCount || 0,
              securityIssuesCount: navigationResult.securityIssuesCount || 0
            },
            pageReports: navigationResult.pages, // Para o Deep Scan Panel
          }} 
        />
      )}
    </>
  );
};

export default AuditContainer;
