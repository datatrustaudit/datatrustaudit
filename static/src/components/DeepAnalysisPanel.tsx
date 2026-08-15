import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Cookie,
    Database,
    Shield,
    Activity,
    Scan,
    Sparkles,
    Globe
} from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CookiesInspector from './CookiesInspector';
import DataLayerAnalyzer from './DataLayerAnalyzer';
import ConsentModeChecker, { type AuditoriaDeConsentimento } from './ConsentModeChecker';
import TagHealthMonitor from './TagHealthMonitor';
import SecurityScanner from './SecurityScanner';

interface DeepAnalysisPanelProps {
    url: string;
    detectedTags: any[];
    hasConsentTool: boolean;
    pages?: any[];
    ga4PropertyId?: string;
    /* Evidência observada pelo motor. As abas de Cookies e DataLayer
       fabricavam o conteúdo a partir das tags detectadas — cookie com validade
       inventada, evento de compra com SKU e preço que nunca existiram. Num
       laudo, evidência falsa contamina os achados verdadeiros junto. */
    storage?: any;
    eventos?: any[];
    datalayerFindings?: any[];
    /* Bloco `consent` do motor (`ConsentAuditResult`). A aba de Consent Mode
       recebia só `hasConsentTool` e fabricava o resto: versão "v2", padrão
       "denied" e uma tabela de sete sinais, tudo derivado de um booleano sobre
       banner. No laudo de exemplo isso afirmava o contrário da medição —
       `consentModeV2` era false e o motor tinha emitido `consent_mode_missing`
       como crítico. */
    consent?: AuditoriaDeConsentimento | null;
}

const DeepAnalysisPanel = ({
    url, detectedTags, hasConsentTool, pages, ga4PropertyId,
    storage, eventos, datalayerFindings, consent,
}: DeepAnalysisPanelProps) => {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b dark:border-gray-700">
                <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                    <Sparkles className="h-6 w-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        {pages ? 'Deep Scan: Análise Multi-Página' : 'Análise Detalhada Avançada'}
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        {pages ? `Consolidação de ${pages.length} páginas analisadas` : 'Inspeção profunda separada por categoria'}
                    </p>
                </div>
            </div>

            {/* Tabs por categoria */}
            <Tabs defaultValue={pages ? "pages" : "security"} className="w-full">
                <TabsList className={`grid w-full ${pages ? 'grid-cols-6' : 'grid-cols-5'} h-12`}>
                    {pages && (
                        <TabsTrigger value="pages" className="flex items-center gap-2 text-xs md:text-sm">
                            <Globe className="h-4 w-4" />
                            <span className="hidden md:inline">Páginas</span>
                        </TabsTrigger>
                    )}
                    <TabsTrigger value="security" className="flex items-center gap-2 text-xs md:text-sm">
                        <Scan className="h-4 w-4" />
                        <span className="hidden md:inline">Segurança</span>
                    </TabsTrigger>
                    <TabsTrigger value="consent" className="flex items-center gap-2 text-xs md:text-sm">
                        <Shield className="h-4 w-4" />
                        <span className="hidden md:inline">Consent Mode</span>
                    </TabsTrigger>
                    <TabsTrigger value="cookies" className="flex items-center gap-2 text-xs md:text-sm">
                        <Cookie className="h-4 w-4" />
                        <span className="hidden md:inline">Cookies</span>
                    </TabsTrigger>
                    <TabsTrigger value="datalayer" className="flex items-center gap-2 text-xs md:text-sm">
                        <Database className="h-4 w-4" />
                        <span className="hidden md:inline">DataLayer</span>
                    </TabsTrigger>
                    <TabsTrigger value="health" className="flex items-center gap-2 text-xs md:text-sm">
                        <Activity className="h-4 w-4" />
                        <span className="hidden md:inline">Tag Health</span>
                    </TabsTrigger>
                </TabsList>

                {pages && (
                    <TabsContent value="pages" className="mt-6">
                        <div className="grid grid-cols-1 gap-4">
                            {pages.map((page, idx) => (
                                <Card key={idx} className="hover:shadow-md transition-shadow">
                                    <div className="p-4 flex items-center justify-between">
                                        <div>
                                            <p className="font-semibold text-blue-600 truncate max-w-md">{page.url}</p>
                                            <div className="flex gap-2 mt-1">
                                                <Badge variant="outline">{page.type}</Badge>
                                                <Badge className={page.violationsFound > 0 ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}>
                                                    {page.violationsFound} violações
                                                </Badge>
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-medium">{page.tagsFound} tags</p>
                                            <p className="text-xs text-gray-400">{page.totalEvents} eventos</p>
                                        </div>
                                    </div>
                                </Card>
                            ))}
                        </div>
                    </TabsContent>
                )}

                <TabsContent value="security" className="mt-6">
                    <SecurityScanner
                        url={url}
                        detectedTags={detectedTags}
                        hasConsentTool={hasConsentTool}
                    />
                </TabsContent>

                <TabsContent value="consent" className="mt-6">
                    <ConsentModeChecker
                        url={url}
                        detectedTags={detectedTags}
                        hasConsentTool={hasConsentTool}
                        consent={consent}
                    />
                </TabsContent>

                <TabsContent value="cookies" className="mt-6">
                    <CookiesInspector
                        url={url}
                        storage={storage}
                    />
                </TabsContent>

                <TabsContent value="datalayer" className="mt-6">
                    <DataLayerAnalyzer
                        url={url}
                        eventos={eventos}
                        achados={datalayerFindings}
                    />
                </TabsContent>

                <TabsContent value="health" className="mt-6">
                    {/* A linha do tempo de rede é a única medição de tempo que
                        existe: sem ela a aba exibia por tag um valor de
                        `Math.random()` com ícone de relógio, que mudava a cada
                        re-render. Quando `storage` não vem, a aba declara a
                        ausência em vez de estimar. */}
                    <TagHealthMonitor
                        detectedTags={detectedTags}
                        hasConsentTool={hasConsentTool}
                        linhaDoTempo={storage?.firingTimeline}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default DeepAnalysisPanel;
