import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    BarChart3,
    Shield,
    Clock,
    FileText,
    Download,
    AlertTriangle,
    CheckCircle,
    Copy,
    Globe,
    PieChart,
    Sparkles,
    FileSpreadsheet,
    Lock,
    Activity,
    Box,
} from 'lucide-react';
import ScriptTimeline from './ScriptTimeline';
import LGPDReport from './LGPDReport';
import AIChat from './AIChat';
import Dashboard from './Dashboard';
import PDFExport from './PDFExport';
import DeepAnalysisPanel from './DeepAnalysisPanel';
import FeatureGate from './FeatureGate';
import EventAuditPanel from './EventAuditPanel';
import GTMQualityPanel from './GTMQualityPanel';
import DataQualityNotes from './DataQualityNotes';
import VisaoExecutiva from './laudo/VisaoExecutiva';
import VisaoJuridica from './laudo/VisaoJuridica';
import Veredito from './laudo/Veredito';
import { useI18n } from '@/context/I18nContext';
import { usePlan } from '@/context/PlanContext';
import { useAuth } from '@/context/AuthContext';
import { toast } from '@/hooks/use-toast';

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

/** Locked export button — shows lock icon and opens upgrade modal on click */
const LockedExportButton = ({ label, icon: Icon, feature, onUpgrade }: {
    label: string;
    icon: React.ElementType;
    feature: string;
    onUpgrade: (f: string) => void;
}) => (
    <Button
        variant="ghost"
        size="sm"
        onClick={() => onUpgrade(feature)}
        className="flex items-center gap-2 opacity-50 cursor-not-allowed border border-dashed border-gray-300 dark:border-gray-600"
        title={`Bloqueado — faça upgrade para acessar ${label}`}
    >
        <Lock className="w-3 h-3" />
        <Icon className="w-4 h-4" />
        {label}
    </Button>
);

const NewAuditResults = ({ result, scanId }: { result: NewAuditResult, scanId?: string }) => {
    const { t } = useI18n();
    const { limits, isFeatureAvailable, setShowUpgradeModal, setBlockedFeature } = usePlan();
    const { token } = useAuth();

    /** Qual das três saídas do laudo está aberta. */
    const [leitor, setLeitor] = useState<'executiva' | 'juridica' | 'tecnica'>('executiva');

    /* O veredito e o nível de detalhe vêm do backend: o plano é decidido lá,
       nunca aqui. Aceitar essa decisão do cliente já entregou relatório
       completo para anônimo. */
    const veredito = (result as any).veredito;
    const mostraDetalhe = (result as any).showsDetail !== false;

    /* Números compartilhados pelas três visões. Cada uma apresenta de um jeito,
       mas todas leem daqui: se divergirem na tela, é bug de leitura, não
       diferença de critério — foi assim que o produto chegou a mostrar três
       respostas para o mesmo site. */
    const totalDeAchados = result.summary?.violationsCount
        ?? result.privacy?.total_violations
        ?? (result.privacy?.violations || []).length;

    const porGravidade: Record<string, number> =
        (result.summary as any)?.violationsBySeverity
        // Fallback para resposta antiga em cache: a lista pode vir cortada pelo
        // plano, então o total acima continua sendo a fonte da contagem.
        || (result.privacy?.violations || []).reduce((acc: Record<string, number>, v: any) => {
            const nivel = v?.severity || 'medium';
            acc[nivel] = (acc[nivel] || 0) + 1;
            return acc;
        }, {});

    const temCmp = Boolean(result.privacy?.has_consent_tool ?? result.summary?.consentDetected);
    const tagsAntesDoConsentimento = (result.tags || []).filter(t => t.isBeforeConsent).length;
    const cookiesSemConsentimento =
        ((result as any).storage?.cookiesWithoutConsent || []).length;

    /* Recomendações do motor, da mais grave para a menos. O executivo lê as
       cinco primeiras; a aba técnica mostra todas. */
    const proximosPassos = ((result.recommendations || []) as any[])
        .map(r => ({
            titulo: r?.title || r?.recommendation || r?.issue || '',
            porque: r?.why || r?.description || r?.impact,
            gravidade: r?.severity,
            esforco: r?.effort || r?.esforco,
            /* O motor escreve o que digitar para corrigir e a API entrega em
               `howToFix`. Este `map` descartava o campo: o laudo apontava o
               problema e calava sobre a solução — que já estava pronta, a um
               nome de propriedade de distância. */
            comoCorrigir: r?.howToFix || r?.fix || r?.como_corrigir,
        }))
        .filter(p => p.titulo)
        .sort((a, b) => {
            const ordem: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
            return (ordem[a.gravidade] ?? 4) - (ordem[b.gravidade] ?? 4);
        });

    const handleUpgradeLock = (feature: string) => {
        setBlockedFeature(feature);
        setShowUpgradeModal(true);
    };

    /* A cor do score sai da paleta do laudo — a mesma que pinta a gravidade de
       cada achado. Antes vinha de classes soltas do Tailwind (`bg-green-100`),
       que num tema escuro rendem um disco quase branco, e que não têm relação
       nenhuma com o vermelho usado ao lado para dizer "crítico". */
    const corDoScore = (score: number) => {
        if (score >= 80) return 'var(--laudo-conforme)';
        if (score >= 50) return 'var(--laudo-medio)';
        return 'var(--laudo-critico)';
    };

    /* Gravidade tem uma escala só no produto inteiro — a de `--laudo-*`. O
       motor devolve o nível em inglês; a tela mostrava esse valor cru
       ("critical", "high") numa coluna chamada "Risco LGPD", em português. */
    const GRAVIDADE: Record<string, { rotulo: string; cor: string }> = {
        critical: { rotulo: 'Crítico', cor: 'var(--laudo-critico)' },
        high: { rotulo: 'Alto', cor: 'var(--laudo-alto)' },
        medium: { rotulo: 'Médio', cor: 'var(--laudo-medio)' },
        low: { rotulo: 'Baixo', cor: 'var(--laudo-baixo)' },
    };
    const gravidade = (nivel?: string) =>
        GRAVIDADE[String(nivel || '').toLowerCase()] ?? { rotulo: 'Baixo', cor: 'var(--laudo-baixo)' };

    /* `new Date(undefined).toLocaleString()` devolve a string "Invalid Date", e
       era isso que o cabeçalho do laudo mostrava — a API não manda `timestamp`,
       manda `finished_at`. Data ruim vira ausência declarada: um campo vazio o
       leitor cobra, "Invalid Date" ele lê como defeito do produto inteiro. */
    const dataDoExame = (() => {
        const d = new Date(result.timestamp);
        return Number.isNaN(d.getTime()) ? null : d.toLocaleString('pt-BR');
    })();

    const handleCopyReport = () => {
        // Free users get a summary-only copy (no violation details)
        const violationsText = limits.showViolationDetails
            ? result.privacy.violations.map(v => `- ${v.tag}: ${v.violation} (${v.article})`).join('\n')
            : `${result.privacy.total_violations} violação(ões) — faça upgrade para detalhes completos`;

        const tagsText = limits.showLineNumbers
            ? result.tags.map(t => `- ${t.name} (${t.type}) — Linha ${t.lineNumber}`).join('\n')
            : result.tags.map(t => `- ${t.name} (${t.type})`).join('\n');

        const report = `
DataTrust Audit Report
================
URL: ${result.url}
Data: ${new Date(result.timestamp).toLocaleString('pt-BR')}

Score de Conformidade: ${result.score}%
Total de Tags: ${result.tagCount}
Violações Detectadas: ${result.privacy.total_violations}
Exposição Estimada: ${result.privacy.estimatedRiskExposure}
Jurisdição: ${result.privacy.jurisdiction} (${result.privacy.framework})

Tags Detectadas:
${tagsText}

Violações:
${violationsText}
        `.trim();

        navigator.clipboard.writeText(report);
        toast({ title: 'Relatório copiado!', description: 'Resumo copiado para a área de transferência.' });
    };

    const handleExportJSON = () => {
        // Strip sensitive data for lower plans
        const exportData = limits.showViolationDetails
            ? result
            : { ...result, privacy: { ...result.privacy, violations: [] } };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: 'Exportado!', description: 'Relatório exportado em formato JSON.' });
    };

    const handleExportPDF = async () => {
        if (!scanId) {
            toast({ title: 'Aviso', description: 'Exportação indisponível para esta análise não-salva.' });
            return;
        }

        try {
            toast({ title: 'Gerando PDF...', description: 'Aguarde, isso pode levar alguns segundos.' });
            const response = await fetch(`/api/exports/pdf/${scanId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 403) {
                     handleUpgradeLock('exportPDF');
                     return;
                }
                throw new Error('Erro ao gerar PDF');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: 'PDF Exportado!', description: 'Relatório profissional baixado.' });
        } catch {
            toast({ title: 'Erro', description: 'Não foi possível gerar o PDF.', variant: 'destructive' });
        }
    };

    const handleExportExcel = async () => {
        if (!scanId) {
            toast({ title: 'Aviso', description: 'Exportação indisponível para esta análise não-salva.' });
            return;
        }

        try {
            toast({ title: 'Gerando Excel...', description: 'Aguarde, isso pode levar alguns segundos.' });
            const response = await fetch(`/api/exports/excel/${scanId}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!response.ok) {
                if (response.status === 403) {
                     handleUpgradeLock('exportExcel');
                     return;
                }
                throw new Error('Erro ao gerar Excel');
            }
            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `datatrust-audit-${new Date().toISOString().split('T')[0]}.xlsx`;
            a.click();
            URL.revokeObjectURL(url);
            toast({ title: 'Excel Exportado!', description: 'Planilha detalhada baixada.' });
        } catch {
            toast({ title: 'Erro', description: 'Não foi possível gerar o Excel.', variant: 'destructive' });
        }
    };

    // Slice tags list by plan visibility percentage
    const visibleTagCount = Math.max(1, Math.ceil(result.tags.length * (limits.visibilityPercentage / 100)));
    const visibleTags = result.tags.slice(0, visibleTagCount);
    const hasMoreTags = visibleTagCount < result.tags.length;

    return (
        <div className="space-y-6">
            {/* ─── Cabeçalho do laudo ───
                Era um banner com gradiente azul e cinco caixas de número. Três
                motivos para sair:

                · Repetia. O veredito logo abaixo já diz quantas violações
                  existem e se há CMP, e a aba Dashboard mostra os mesmos
                  números com contexto. Repetir três vezes não reforça, dilui.
                · Uma das caixas exibia texto inventado. Sem plano pago, a
                  "Exposição" mostrava a frase "Risco Estimado: Moderado"
                  desfocada — um valor que ninguém mediu, sobre um site que
                  podia estar em qualquer situação. Cadeado pode esconder o
                  número; não pode fabricar um.
                · Gradiente saturado não é a voz de um laudo. O que carimba
                  autoridade aqui é a identidade `--laudo-*`.

                Fica o que um cabeçalho de laudo precisa ter: o que foi
                examinado, quando, o índice, e como levar embora. */}
            <header
                className="rounded-xl border overflow-hidden"
                style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
            >
                <div className="flex flex-wrap items-start justify-between gap-6 p-6">
                    <div className="min-w-0 flex-1">
                        <p
                            className="text-[10px] uppercase tracking-[0.18em] voz-ferramenta"
                            style={{ color: 'var(--laudo-texto-fraco)' }}
                        >
                            Laudo de auditoria
                        </p>
                        {/* A URL em voz de evidência: é o objeto examinado, não
                            um título. Quebra em qualquer ponto porque endereço
                            longo não pode empurrar o score para fora da tela. */}
                        <p
                            className="voz-evidencia mt-2 text-lg break-all"
                            style={{ color: 'var(--laudo-texto)' }}
                        >
                            {result.url}
                        </p>
                        <p className="mt-2 text-xs" style={{ color: 'var(--laudo-texto-suave)' }}>
                            {dataDoExame && <>Examinado em {dataDoExame}{' · '}</>}
                            {/* Sem clicar em "aceitar" — é essa a condição que
                                dá valor a tudo que vem depois, e ela precisa
                                estar escrita no cabeçalho, não numa nota de
                                rodapé. */}
                            sem aceitar cookies
                        </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                        <div
                            className="flex h-[68px] w-[68px] items-center justify-center rounded-full text-3xl font-semibold tabular-nums"
                            style={{
                                color: corDoScore(result.score),
                                background: `color-mix(in srgb, ${corDoScore(result.score)} 13%, transparent)`,
                                boxShadow: `inset 0 0 0 1.5px ${corDoScore(result.score)}`,
                            }}
                        >
                            {result.score}
                        </div>
                        <div className="max-w-[7rem]">
                            <p className="text-sm font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                {t('dashboard.score_title')}
                            </p>
                            <p className="text-[11px] leading-tight" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                de 0 a 100
                            </p>
                        </div>
                    </div>
                </div>

                {/* ─── Saídas do laudo, por plano ─── */}
                <div
                    className="flex flex-wrap gap-2 border-t px-6 py-3"
                    style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-fundo)' }}
                >
                    <Button variant="outline" size="sm" onClick={handleCopyReport} className="flex items-center gap-2">
                        <Copy className="w-4 h-4" />
                        {t('buttons.copy')}
                    </Button>

                    {isFeatureAvailable('jsonExport') ? (
                        <Button variant="outline" size="sm" onClick={handleExportJSON} className="flex items-center gap-2">
                            <Download className="w-4 h-4" />
                            {t('buttons.export_json')}
                        </Button>
                    ) : (
                        <LockedExportButton label={t('buttons.export_json')} icon={Download} feature="jsonExport" onUpgrade={handleUpgradeLock} />
                    )}

                    {isFeatureAvailable('pdfExport') ? (
                        <Button variant="outline" size="sm" onClick={handleExportPDF} className="flex items-center gap-2">
                            <FileText className="w-4 h-4" />
                            {t('buttons.export_pdf')}
                        </Button>
                    ) : (
                        <LockedExportButton label={t('buttons.export_pdf')} icon={FileText} feature="pdfExport" onUpgrade={handleUpgradeLock} />
                    )}

                    {isFeatureAvailable('excelExport') ? (
                        <Button variant="outline" size="sm" onClick={handleExportExcel} className="flex items-center gap-2">
                            <FileSpreadsheet className="w-4 h-4" />
                            {t('buttons.export_excel')}
                        </Button>
                    ) : (
                        <LockedExportButton label={t('buttons.export_excel')} icon={FileSpreadsheet} feature="excelExport" onUpgrade={handleUpgradeLock} />
                    )}
                </div>
            </header>

            {/* O veredito abre o laudo em qualquer plano. No gratuito ele é o
                laudo inteiro; no pago, a manchete que resume o que vem
                abaixo. A mesma frase nos dois impede que a versão gratuita
                afirme uma coisa e a paga outra sobre o mesmo site. */}
            {veredito && (
                <div className="mb-6">
                    <Veredito
                        veredito={veredito}
                        url={result.url}
                        totalDeAchados={totalDeAchados}
                        porGravidade={porGravidade}
                        mostraDetalhe={mostraDetalhe}
                        onUpgrade={() => handleUpgradeLock('fullReport')}
                    />
                </div>
            )}

            {/* ─── Seletor de leitor ───
                O mesmo laudo, três saídas. O conteúdo já existia todo no
                motor; o que faltava era admitir que quem paga, quem responde
                juridicamente e quem corrige não leem a mesma coisa. Servir os
                três na mesma tela deixava ela técnica demais para uns e rasa
                demais para outros. */}
            {/* No gratuito o veredito É o laudo. Mostrar as abas por cima de
                listas vazias entregaria um esqueleto — o cliente leria como
                defeito, não como limite de plano. */}
            <div
                className={`flex flex-wrap gap-1 rounded-md border p-1 mb-4 ${mostraDetalhe ? '' : 'hidden'}`}
                role="tablist"
                aria-label="Para quem é esta leitura"
                style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
            >
                {([
                    ['executiva', 'Resumo', 'Veredito, evidência e por onde começar'],
                    ['juridica', 'Jurídico', 'Base legal e cadeia de evidência'],
                    ['tecnica', 'Técnico', 'Tags, eventos, código e linha'],
                ] as const).map(([chave, rotulo, descricao]) => {
                    const ativa = leitor === chave;
                    return (
                        <button
                            key={chave}
                            role="tab"
                            aria-selected={ativa}
                            onClick={() => setLeitor(chave)}
                            title={descricao}
                            className="flex-1 min-w-[8rem] rounded px-3 py-2 text-left transition-colors"
                            style={{
                                background: ativa ? 'color-mix(in srgb, var(--laudo-carimbo) 14%, transparent)' : 'transparent',
                                color: ativa ? 'var(--laudo-texto)' : 'var(--laudo-texto-fraco)',
                                boxShadow: ativa ? 'inset 0 0 0 1px var(--laudo-carimbo)' : 'none',
                            }}
                        >
                            <span className="block text-sm font-semibold">{rotulo}</span>
                            <span className="block text-[11px] leading-tight mt-0.5">{descricao}</span>
                        </button>
                    );
                })}
            </div>

            {mostraDetalhe && leitor === 'executiva' && (
                <VisaoExecutiva
                    url={result.url}
                    score={result.score}
                    totalDeAchados={totalDeAchados}
                    porGravidade={porGravidade}
                    temCmp={temCmp}
                    tagsAntesDoConsentimento={tagsAntesDoConsentimento}
                    cookiesSemConsentimento={cookiesSemConsentimento}
                    piiExposto={result.summary?.piiExposureCount || 0}
                    exposicaoLegal={result.privacy?.estimatedRiskExposure}
                    proximosPassos={proximosPassos}
                />
            )}

            {mostraDetalhe && leitor === 'juridica' && (
                <VisaoJuridica
                    url={result.url}
                    timestamp={result.timestamp}
                    scanMethod={(result as any).scanMethod}
                    violacoes={result.privacy?.violations || []}
                    totalDeAchados={totalDeAchados}
                    temCmp={temCmp}
                    jurisdicao={result.privacy?.jurisdiction}
                    framework={result.privacy?.framework}
                    exposicaoLegal={result.privacy?.estimatedRiskExposure}
                />
            )}

            {/* ─── Main tabs ─── */}
            <Tabs defaultValue="dashboard" className={`w-full ${mostraDetalhe && leitor === 'tecnica' ? '' : 'hidden'}`}>
                <TabsList className="flex flex-wrap w-full h-auto gap-1 p-1">
                    <TabsTrigger value="dashboard" className="flex items-center gap-1.5 text-xs">
                        <PieChart className="w-3.5 h-3.5" />
                        {t('nav.dashboard')}
                    </TabsTrigger>

                    <TabsTrigger value="events" className="flex items-center gap-1.5 text-xs">
                        <Activity className="w-3.5 h-3.5" />
                        Eventos
                    </TabsTrigger>

                    <TabsTrigger value="gtm-quality" className="flex items-center gap-1.5 text-xs">
                        <Box className="w-3.5 h-3.5" />
                        GTM Quality
                    </TabsTrigger>

                    <TabsTrigger value="deep" className="flex items-center gap-1.5 text-xs">
                        <Sparkles className="w-3.5 h-3.5" />
                        IA PRO
                        {!isFeatureAvailable('deepAnalysis') && <Lock className="w-3 h-3 opacity-50" />}
                    </TabsTrigger>

                    <TabsTrigger value="timeline" className="flex items-center gap-1.5 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        Timeline
                        {!isFeatureAvailable('showLineNumbers') && <Lock className="w-3 h-3 opacity-50" />}
                    </TabsTrigger>

                    <TabsTrigger value="lgpd" className="flex items-center gap-1.5 text-xs">
                        <Shield className="w-3.5 h-3.5" />
                        Privacidade
                    </TabsTrigger>

                    {result.pageReports && (
                        <TabsTrigger value="deep-scan" className="flex items-center gap-1.5 text-xs">
                            <Globe className="w-3.5 h-3.5" />
                            {t('home.tab_deep')}
                        </TabsTrigger>
                    )}

                    <TabsTrigger value="details" className="flex items-center gap-1.5 text-xs">
                        <FileText className="w-3.5 h-3.5" />
                        {t('common.results')}
                    </TabsTrigger>
                </TabsList>

                {/* Dashboard */}
                <TabsContent value="dashboard" className="mt-6">
                    {/* ─── O que foi encontrado, por categoria ───
                        Cada categoria tinha sua própria cor viva. Num laudo
                        isso desinforma: o leitor lê cor como gravidade, e
                        "Publicidade" em laranja parece uma acusação quando é só
                        uma classificação. Aqui a cor ficou reservada para
                        risco; categoria é superfície neutra, e o emoji
                        distingue. */}
                    <div
                        className="rounded-xl border p-5"
                        style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
                    >
                        <div className="mb-4 flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" style={{ color: 'var(--laudo-texto-suave)' }} />
                            <h3 className="text-sm font-semibold" style={{ color: 'var(--laudo-texto)' }}>
                                Tags detectadas por categoria
                            </h3>
                            <span className="ml-auto text-[11px]" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                {result.tagCount} no total
                            </span>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {Object.entries(result.typeCounts || {}).map(([type, count]) => {
                                const rotulos: Record<string, string> = {
                                    consent: '🔐 Consentimento',
                                    tag_manager: '📦 Tag Manager',
                                    analytics: '📊 Analytics',
                                    advertising: '📢 Publicidade',
                                    heatmap: '🔥 Mapa de calor',
                                    support: '💬 Suporte',
                                };
                                return (
                                    <span
                                        key={type}
                                        className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm"
                                        style={{
                                            borderColor: 'var(--laudo-linha)',
                                            background: 'var(--laudo-fundo)',
                                            color: 'var(--laudo-texto-suave)',
                                        }}
                                    >
                                        {rotulos[type] || type}
                                        <strong className="tabular-nums" style={{ color: 'var(--laudo-texto)' }}>
                                            {count}
                                        </strong>
                                    </span>
                                );
                            })}
                        </div>

                        {/* ─── Disparo repetido ───
                            Este é um achado de verdade, então mantém cor — a do
                            nível "alto" da paleta do laudo, a mesma que pinta
                            um achado alto em qualquer outra tela. */}
                        {result.duplicates && result.duplicates.length > 0 && (
                            <FeatureGate feature="showViolationDetails" featureName="Tags duplicadas">
                                <div
                                    className="mt-5 overflow-hidden rounded-lg border-l-[3px] border-y border-r p-4"
                                    style={{
                                        borderLeftColor: 'var(--laudo-alto)',
                                        borderTopColor: 'var(--laudo-linha)',
                                        borderRightColor: 'var(--laudo-linha)',
                                        borderBottomColor: 'var(--laudo-linha)',
                                        background: 'color-mix(in srgb, var(--laudo-alto) 8%, transparent)',
                                    }}
                                >
                                    <h4
                                        className="mb-3 flex items-center gap-2 text-sm font-semibold"
                                        style={{ color: 'var(--laudo-texto)' }}
                                    >
                                        <AlertTriangle className="h-4 w-4" style={{ color: 'var(--laudo-alto)' }} />
                                        Tags disparando mais de uma vez
                                    </h4>
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        {result.duplicates.map((dup, i) => (
                                            <div
                                                key={i}
                                                className="flex flex-col gap-2 rounded-lg border p-3"
                                                style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <span
                                                        className="voz-evidencia break-all pr-2 text-sm"
                                                        style={{ color: 'var(--laudo-texto)' }}
                                                    >
                                                        {dup.tag}
                                                    </span>
                                                    <span
                                                        className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums"
                                                        style={{
                                                            color: 'var(--laudo-alto)',
                                                            background: 'color-mix(in srgb, var(--laudo-alto) 15%, transparent)',
                                                        }}
                                                    >
                                                        {dup.count}× disparos
                                                    </span>
                                                </div>
                                                <p
                                                    className="border-t pt-2 text-sm"
                                                    style={{ borderColor: 'var(--laudo-linha)', color: 'var(--laudo-texto-suave)' }}
                                                >
                                                    <strong style={{ color: 'var(--laudo-texto)' }}>Como corrigir: </strong>
                                                    {dup.recommendation}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </FeatureGate>
                        )}
                    </div>

                    <Dashboard result={result} />
                </TabsContent>

                {/* Events */}
                <TabsContent value="events" className="mt-6">
                    <EventAuditPanel data={result.events || null} />
                </TabsContent>

                {/* GTM Quality */}
                <TabsContent value="gtm-quality" className="mt-6">
                    <GTMQualityPanel data={result.gtmQuality || null} />
                </TabsContent>

                {/* AI Deep Analysis — Premium only */}
                <TabsContent value="deep" className="mt-6">
                    <FeatureGate feature="deepAnalysis" featureName="Análise PRO">
                        <DeepAnalysisPanel
                            url={result.url}
                            detectedTags={result.tags}
                            hasConsentTool={result.privacy.has_consent_tool}
                            storage={(result as any).storage}
                            eventos={(result.events as any)?.events ?? []}
                            datalayerFindings={(result as any).datalayerFindings ?? []}
                        />
                    </FeatureGate>
                </TabsContent>

                {/* Timeline — Premium only */}
                <TabsContent value="timeline" className="mt-6">
                    <FeatureGate feature="showLineNumbers" featureName="Script Timeline com linha de código">
                        <ScriptTimeline
                            tags={result.tags}
                            loadingOrder={result.loadingOrder}
                            hasConsentTool={result.privacy.has_consent_tool}
                            linhaDoTempo={(result as any).storage?.firingTimeline ?? []}
                            primeiroDisparoMs={(result as any).storage?.firstTrackerFiredMs}
                        />
                    </FeatureGate>
                </TabsContent>

                <TabsContent value="lgpd" className="mt-6">
                    <FeatureGate feature="showViolationDetails" featureName="Relatório de Privacidade completo">
                        <LGPDReport 
                            lgpdAnalysis={{
                                ...result.privacy,
                                totalViolations: result.privacy.total_violations,
                                hasConsentTool: result.privacy.has_consent_tool,
                                hasUniversalAnalytics: result.privacy.has_universal_analytics,
                                complianceScore: result.privacy.compliance_score
                            } as any} 
                            url={result.url} 
                        />
                    </FeatureGate>
                </TabsContent>

                {/* Deep Scan multi-page — Premium */}
                {result.pageReports && (
                    <TabsContent value="deep-scan" className="mt-6">
                        <FeatureGate feature="deepAnalysis" featureName="Deep Scan multi-página">
                            <DeepAnalysisPanel
                                url={result.url}
                                detectedTags={result.tags}
                                hasConsentTool={result.privacy.has_consent_tool}
                                pages={result.pageReports}
                                ga4PropertyId={result.tags.find(t => t.name.includes('GA4'))?.tagId || ''}
                                storage={(result as any).storage}
                                eventos={(result.events as any)?.events ?? []}
                                datalayerFindings={(result as any).datalayerFindings ?? []}
                            />
                        </FeatureGate>
                    </TabsContent>
                )}

                {/* Tag details table */}
                <TabsContent value="details" className="mt-6">
                    <Card className="shadow-lg border-0">
                        <CardHeader>
                            <CardTitle>Tags encontradas</CardTitle>
                            <CardDescription>
                                {hasMoreTags ? (
                                    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                                        <Lock className="h-3 w-3" />
                                        Mostrando {visibleTagCount} de {result.tags.length}.
                                        <button
                                            className="underline underline-offset-2 hover:no-underline"
                                            style={{ color: 'var(--laudo-carimbo)' }}
                                            onClick={() => handleUpgradeLock('showViolationDetails')}
                                        >
                                            Ver a lista completa
                                        </button>
                                    </span>
                                ) : (
                                    `${result.tags.length} tags observadas na visita`
                                )}
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {/* A tabela é a evidência bruta do laudo, e por isso
                                fala em voz de evidência (monoespaçada) nas
                                colunas que um dev vai conferir contra o código:
                                linha, ID e padrão. */}
                            <div className="overflow-x-auto">
                                <table className="w-full border-collapse text-sm">
                                    <thead>
                                        <tr style={{ borderBottom: '1.5px solid var(--laudo-linha)' }}>
                                            {[
                                                '#',
                                                'Tag',
                                                'Categoria',
                                                null, // Linha: tem cadeado, montada abaixo
                                                ...(isFeatureAvailable('showViolationDetails') ? ['ID / padrão'] : []),
                                                'Risco',
                                                'Disparou',
                                            ].map((titulo, i) => (
                                                <th
                                                    key={i}
                                                    className="p-3 text-left text-[11px] font-semibold uppercase tracking-wider"
                                                    style={{ color: 'var(--laudo-texto-fraco)' }}
                                                >
                                                    {titulo ?? (
                                                        <span className="inline-flex items-center gap-1.5">
                                                            Linha
                                                            {!isFeatureAvailable('showLineNumbers') && (
                                                                <Lock className="h-3 w-3" style={{ color: 'var(--laudo-medio)' }} />
                                                            )}
                                                        </span>
                                                    )}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {visibleTags.map((tag, index) => {
                                            const risco = gravidade(tag.lgpdRisk);
                                            return (
                                                <tr
                                                    key={index}
                                                    style={{
                                                        borderBottom: '1px solid var(--laudo-linha)',
                                                        /* Realce da linha inteira quando a tag
                                                           disparou antes do aceite: é a coluna
                                                           que sustenta a acusação. */
                                                        background: tag.isBeforeConsent
                                                            ? 'color-mix(in srgb, var(--laudo-critico) 7%, transparent)'
                                                            : 'transparent',
                                                    }}
                                                >
                                                    <td className="p-3 tabular-nums" style={{ color: 'var(--laudo-texto-fraco)' }}>
                                                        {index + 1}
                                                    </td>
                                                    <td className="p-3 font-medium" style={{ color: 'var(--laudo-texto)' }}>
                                                        {tag.name}
                                                    </td>
                                                    <td className="p-3" style={{ color: 'var(--laudo-texto-suave)' }}>
                                                        {tag.type}
                                                    </td>
                                                    <td className="p-3">
                                                        {isFeatureAvailable('showLineNumbers') ? (
                                                            <code
                                                                className="voz-evidencia rounded px-2 py-0.5 text-xs tabular-nums"
                                                                style={{ background: 'var(--laudo-fundo)', color: 'var(--laudo-texto)' }}
                                                            >
                                                                {tag.lineNumber}
                                                            </code>
                                                        ) : (
                                                            <button
                                                                onClick={() => handleUpgradeLock('showLineNumbers')}
                                                                className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide transition-opacity hover:opacity-100"
                                                                style={{
                                                                    color: 'var(--laudo-medio)',
                                                                    background: 'color-mix(in srgb, var(--laudo-medio) 12%, transparent)',
                                                                    opacity: 0.8,
                                                                }}
                                                            >
                                                                <Lock className="h-2.5 w-2.5" />
                                                                Premium
                                                            </button>
                                                        )}
                                                    </td>
                                                    {isFeatureAvailable('showViolationDetails') && (
                                                        <td className="p-3">
                                                            <code
                                                                className="voz-evidencia rounded px-2 py-0.5 text-xs"
                                                                style={{ background: 'var(--laudo-fundo)', color: 'var(--laudo-texto-suave)' }}
                                                            >
                                                                {tag.tagId || tag.matchedPattern.substring(0, 20)}
                                                            </code>
                                                        </td>
                                                    )}
                                                    <td className="p-3">
                                                        <span
                                                            className="inline-block rounded px-2 py-0.5 text-xs font-semibold"
                                                            style={{
                                                                color: risco.cor,
                                                                background: `color-mix(in srgb, ${risco.cor} 14%, transparent)`,
                                                            }}
                                                        >
                                                            {risco.rotulo}
                                                        </span>
                                                    </td>
                                                    {/* "✅ OK" dizia mais do que se mediu: a
                                                        varredura observa QUANDO a tag disparou,
                                                        não se ela está correta. O rótulo agora
                                                        descreve o fato observado. */}
                                                    <td className="p-3">
                                                        <span
                                                            className="inline-block rounded px-2 py-0.5 text-xs font-medium"
                                                            style={{
                                                                color: tag.isBeforeConsent ? 'var(--laudo-critico)' : 'var(--laudo-texto-suave)',
                                                                background: tag.isBeforeConsent
                                                                    ? 'color-mix(in srgb, var(--laudo-critico) 14%, transparent)'
                                                                    : 'var(--laudo-fundo)',
                                                            }}
                                                        >
                                                            {tag.isBeforeConsent ? 'Antes do aceite' : 'Não observado antes'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}

                                        {hasMoreTags && (
                                            <tr style={{ borderBottom: '1px dashed var(--laudo-linha)' }}>
                                                <td colSpan={7} className="p-3 text-center">
                                                    <button
                                                        className="mx-auto flex items-center gap-2 text-sm transition-colors"
                                                        style={{ color: 'var(--laudo-texto-fraco)' }}
                                                        onClick={() => handleUpgradeLock('showViolationDetails')}
                                                    >
                                                        <Lock className="h-3 w-3" />
                                                        Mais {result.tags.length - visibleTagCount} tags no laudo completo
                                                    </button>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Data Quality Notes */}
            {result.dataQualityNotes && result.dataQualityNotes.length > 0 && (
                <DataQualityNotes notes={result.dataQualityNotes} />
            )}

            {/* AI Chat */}
            <AIChat
                context={{
                    violations: result.privacy.total_violations,
                    score: result.score,
                    hasConsentTool: result.privacy.has_consent_tool,
                    tags: result.tags,
                    estimatedFine: result.privacy.estimatedRiskExposure,
                    url: result.url,
                    piiExposure: result.summary?.piiExposureCount || 0,
                    securityIssues: result.summary?.securityIssuesCount || 0,
                    isDeepScan: !!result.pageReports,
                }}
            />
        </div>
    );
};

export default NewAuditResults;
