import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
    Cookie,
    Database,
    Shield,
    Activity,
    Scan,
    Sparkles
} from 'lucide-react';

import CookiesInspector from './CookiesInspector';
import DataLayerAnalyzer from './DataLayerAnalyzer';
import ConsentModeChecker from './ConsentModeChecker';
import TagHealthMonitor from './TagHealthMonitor';
import SecurityScanner from './SecurityScanner';

interface DeepAnalysisPanelProps {
    url: string;
    detectedTags: any[];
    hasConsentTool: boolean;
}

const DeepAnalysisPanel = ({ url, detectedTags, hasConsentTool }: DeepAnalysisPanelProps) => {
    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3 pb-4 border-b dark:border-gray-700">
                <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                    <Sparkles className="h-6 w-6" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Análise Detalhada Avançada
                    </h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                        Inspeção profunda separada por categoria
                    </p>
                </div>
            </div>

            {/* Tabs por categoria */}
            <Tabs defaultValue="security" className="w-full">
                <TabsList className="grid w-full grid-cols-5 h-12">
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
                    />
                </TabsContent>

                <TabsContent value="cookies" className="mt-6">
                    <CookiesInspector
                        url={url}
                        detectedTags={detectedTags}
                    />
                </TabsContent>

                <TabsContent value="datalayer" className="mt-6">
                    <DataLayerAnalyzer
                        url={url}
                        detectedTags={detectedTags}
                    />
                </TabsContent>

                <TabsContent value="health" className="mt-6">
                    <TagHealthMonitor
                        detectedTags={detectedTags}
                        hasConsentTool={hasConsentTool}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default DeepAnalysisPanel;
