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
  const { t } = useI18n();
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
  };

  const handleAudit = async () => {
    if (!url) {
      toast({
        title: t('common.error'),
        description: t('audit.url_required'),
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
        title: t('audit.invalid_url'),
        description: t('audit.invalid_url_desc'),
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
        throw new Error(errData?.detail || `API Error: ${response.status}`);
      }
      
      const data = await response.json();
      const scanId = data.scan_id;
      setCurrentScanId(scanId);

      const pollScan = async () => {
        try {
            const pollRes = await fetch(`/api/scans/${scanId}`, {
                headers
            });
            if (!pollRes.ok) throw new Error(t('audit.poll_failed'));
            const pollData = await pollRes.json();
            
            if (pollData.status === "completed") {
                setAuditResult(pollData.result);
                
                const violationCount = pollData.result?.privacy?.total_violations || 0;
                const score = pollData.result?.scores?.overall || pollData.result?.score || pollData.score || 0;
                
                toast({
                  title: t('audit.completed'),
                  description: `${t('dashboard.compliance_score')}: ${score}% – ${violationCount} ${t('dashboard.privacy_risks')}`
                });
                setLoading(false);
            } else if (pollData.status === "failed") {
                throw new Error(t('audit.failed_server'));
            } else {
                pollTimerRef.current = setTimeout(pollScan, 3000);
            }
        } catch (e) {
            console.error('❌ Polling error:', e);
            clearAuditData();
            setLoading(false);
            toast({
              title: t('audit.error_title'),
              description: e instanceof Error ? e.message : t('audit.error_generic'),
              variant: "destructive"
            });
        }
      };

      pollScan();

    } catch (error) {
      console.error('❌ Audit error:', error);
      clearAuditData();
      setLoading(false);
      toast({
        title: t('audit.error_title'),
        description: error instanceof Error ? error.message : t('audit.error_init'),
        variant: "destructive"
      });
    }
  };

  const handleFileAnalysis = async (files: any[]) => {
    if (!files || files.length === 0) {
      toast({
        title: t('common.error'),
        description: t('audit.no_files'),
        variant: "destructive"
      });
      return;
    }

    clearAuditData();
    setLoading(true);
    setAnalysisType('file');
    onStateChange?.(true);

    try {
      const fileAnalysisService = FileAnalysisService.getInstance();
      const result = await fileAnalysisService.analyzeFiles(files);

      setFileAnalysisResult(result);
      setCurrentAuditUrl(`${t('home.tab_upload')}: ${files.length} ${t('common.files')}`);

      toast({
        title: t('audit.file_completed'),
        description: `${result.summary.totalScripts} ${t('common.scripts')}, ${result.summary.totalEvents} ${t('common.events')}`
      });

    } catch (error) {
      console.error('❌ File analysis error:', error);
      clearAuditData();
      toast({
        title: t('audit.error_title'),
        description: t('audit.file_error'),
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

    try {
      setNavigationResult(results);
      setCurrentAuditUrl(`${t('home.tab_deep')}: ${results.pages.length} ${t('common.pages')}`);

      toast({
        title: t('audit.navigation_completed'),
        description: `${results.pages.length} ${t('common.pages')}, ${results.totalEvents} ${t('common.events')}`
      });

    } catch (error) {
      console.error('❌ Navigation error:', error);
      clearAuditData();
      toast({
        title: t('audit.error_title'),
        description: t('audit.navigation_error'),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUrlChange = (newUrl: string) => {
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

      {/* Audit Result by URL */}
      {analysisType === 'url' && auditResult && (
        <NewAuditResults result={auditResult} scanId={currentScanId || undefined} />
      )}

      {/* File analysis result */}
      {analysisType === 'file' && fileAnalysisResult && (
        <>
          <div className="mb-4 p-3 bg-white/5 border border-white/10 rounded-xl backdrop-blur-md">
            <div className="flex items-center gap-3 text-sm text-white/60">
              <span className="font-bold uppercase tracking-widest text-[10px] text-blue-400">{t('common.analysis')}:</span>
              <span className="font-mono bg-white/5 px-2 py-1 rounded border border-white/5 text-white/80">
                {currentAuditUrl}
              </span>
            </div>
          </div>
          <FileAnalysisResults analysisResult={fileAnalysisResult} />
        </>
      )}

      {/* Navigation Result (Deep Scan) */}
      {analysisType === 'navigation' && navigationResult && (
        <NewAuditResults 
          result={{
            url: url,
            timestamp: new Date().toISOString(),
            tags: navigationResult.allTags || [],
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
              violationsCount: navigationResult.violationsFound?.length || 0,
            } as any,
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
            pageReports: navigationResult.pages,
          }} 
        />
      )}
    </>
  );
};

export default AuditContainer;
