import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, CheckCircle, Clock, ArrowDown, Shield, Zap, AlertCircle, Lock } from 'lucide-react';

interface Tag {
  name: string;
  type: string;
  lineNumber: number;
  position: number;
  isBeforeConsent: boolean;
  lgpdRisk: string;
  dataCollected: string[];
}

interface LoadingOrderItem {
  position: number;
  tag: string;
  type: string;
  lineNumber: number;
  issues: string[];
  recommendations: string[];
  severity: string;
}

interface EventoDeRede {
  order?: number;
  msSincePageStart?: number;
  url?: string;
  owner?: string;
}

interface ScriptTimelineProps {
  tags: Tag[];
  loadingOrder: LoadingOrderItem[];
  hasConsentTool: boolean;
  /**
   * Ordem REAL de disparo, medida pelo navegador (`storage.firingTimeline`).
   *
   * Sem isto a aba ordenava por `position` — a posição da tag no HTML, que é
   * ordem de DECLARAÇÃO, não de execução. Uma tag declarada no fim do body e
   * carregada com `async` dispara antes de outra declarada no head; a tela
   * dizia o contrário, e é exatamente essa ordem que sustenta a acusação de
   * "disparou antes do consentimento".
   */
  linhaDoTempo?: EventoDeRede[];
  /** Quanto tempo depois do início da página o primeiro rastreador disparou. */
  primeiroDisparoMs?: number | null;
}

const ScriptTimeline = ({
  tags, loadingOrder, hasConsentTool, linhaDoTempo = [], primeiroDisparoMs,
}: ScriptTimelineProps) => {
  const getTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      consent: 'bg-green-500',
      tag_manager: 'bg-blue-500',
      analytics: 'bg-purple-500',
      advertising: 'bg-orange-500',
      heatmap: 'bg-red-500',
      support: 'bg-cyan-500',
      custom: 'bg-gray-500'
    };
    return colors[type] || 'bg-gray-500';
  };

  const getTypeBadgeColor = (type: string) => {
    const colors: Record<string, string> = {
      consent: 'bg-green-100 text-green-800 border-green-300',
      tag_manager: 'bg-blue-100 text-blue-800 border-blue-300',
      analytics: 'bg-purple-100 text-purple-800 border-purple-300',
      advertising: 'bg-orange-100 text-orange-800 border-orange-300',
      heatmap: 'bg-red-100 text-red-800 border-red-300',
      support: 'bg-cyan-100 text-cyan-800 border-cyan-300',
      custom: 'bg-gray-100 text-gray-800 border-gray-300'
    };
    return colors[type] || 'bg-gray-100 text-gray-800 border-gray-300';
  };

  const getSeverityIcon = (severity: string, isBeforeConsent: boolean) => {
    if (isBeforeConsent) {
      return <AlertTriangle className="w-5 h-5 text-red-500" />;
    }
    switch (severity) {
      case 'critical':
        return <AlertTriangle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'ok':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      default:
        return <CheckCircle className="w-5 h-5 text-green-500" />;
    }
  };

  const getRiskLabel = (risk: string) => {
    const labels: Record<string, { text: string; class: string }> = {
      critical: { text: 'Crítico', class: 'bg-red-100 text-red-800 border-red-300' },
      high: { text: 'Alto', class: 'bg-orange-100 text-orange-800 border-orange-300' },
      medium: { text: 'Médio', class: 'bg-yellow-100 text-yellow-800 border-yellow-300' },
      low: { text: 'Baixo', class: 'bg-blue-100 text-blue-800 border-blue-300' },
      none: { text: 'Nenhum', class: 'bg-green-100 text-green-800 border-green-300' }
    };
    return labels[risk] || labels.medium;
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      consent: '🔐 Consentimento',
      tag_manager: '📦 Tag Manager',
      analytics: '📊 Analytics',
      advertising: '📢 Publicidade',
      heatmap: '🔥 Heatmap',
      support: '💬 Suporte',
      custom: '🔧 Customizado'
    };
    return labels[type] || type;
  };

  // Ordenar por posição
  const sortedTags = [...tags].sort((a, b) => a.position - b.position);

  // Encontrar índice do consent
  const consentIndex = sortedTags.findIndex(t => t.type === 'consent');

  return (
    <Card className="shadow-lg border-0 bg-white/90 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Ordem de carregamento
        </CardTitle>
        <CardDescription>
          {linhaDoTempo.length > 0
            ? 'Ordem real de disparo, medida no navegador durante a visita.'
            : 'Ordem de declaração no HTML — esta varredura não trouxe a medição de rede.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* A ordem REAL, quando existe. É outra coisa da ordem no HTML: uma tag
            declarada no fim do body e carregada com `async` dispara antes de
            outra declarada no head. Sem isto, a aba prometia "ordem de
            carregamento" e entregava ordem de declaração — e é a ordem de
            disparo que sustenta a acusação de coleta antes do consentimento. */}
        {linhaDoTempo.length > 0 && (
          <div className="mb-6 rounded-lg border p-4" style={{ borderColor: 'var(--laudo-linha)', background: 'var(--laudo-superficie)' }}>
            <p className="voz-evidencia text-[11px] uppercase tracking-widest mb-3" style={{ color: 'var(--laudo-texto-fraco)' }}>
              Quem disparou primeiro
              {typeof primeiroDisparoMs === 'number' && primeiroDisparoMs > 0 && (
                <span style={{ color: 'var(--laudo-critico)' }}>
                  {' '}· o primeiro rastreador saiu {primeiroDisparoMs} ms após o início da página
                </span>
              )}
            </p>
            <ol className="space-y-1.5 list-none p-0 m-0">
              {linhaDoTempo.slice(0, 12).map((e, i) => (
                <li key={i} className="flex items-baseline gap-3 text-sm">
                  <span className="voz-evidencia text-xs w-6 shrink-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                    {e.order ?? i + 1}
                  </span>
                  <span className="voz-evidencia text-xs w-16 shrink-0 text-right" style={{ color: 'var(--laudo-alto)' }}>
                    {typeof e.msSincePageStart === 'number' ? `${e.msSincePageStart} ms` : '—'}
                  </span>
                  <span style={{ color: 'var(--laudo-texto)' }}>{e.owner}</span>
                </li>
              ))}
            </ol>
            {linhaDoTempo.length > 12 && (
              <p className="text-xs mt-2 m-0" style={{ color: 'var(--laudo-texto-fraco)' }}>
                e mais {linhaDoTempo.length - 12} requisição(ões).
              </p>
            )}
          </div>
        )}

        {!hasConsentTool && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-3">
              <Shield className="w-6 h-6 text-red-500 mt-0.5" />
              <div>
                <h4 className="font-semibold text-red-800">⚠️ CMP Não Detectado</h4>
                <p className="text-sm text-red-700 mt-1">
                  Nenhuma ferramenta de consentimento (Cookiebot, OneTrust, Didomi) foi detectada 
                  no site. Isso significa que <strong>todas as tags de tracking estão violando a LGPD</strong>.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Legenda */}
        <div className="mb-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium text-gray-800 mb-3">Legenda de Tipos:</h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries({
              consent: '🔐 Consentimento',
              tag_manager: '📦 Tag Manager',
              analytics: '📊 Analytics',
              advertising: '📢 Publicidade',
              heatmap: '🔥 Heatmap',
              support: '💬 Suporte'
            }).map(([type, label]) => (
              <Badge key={type} className={getTypeBadgeColor(type)}>
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Timeline */}
        <div className="relative">
          {/* Linha vertical */}
          <div className="absolute left-6 top-0 bottom-0 w-0.5 bg-gray-200" />

          <div className="space-y-4">
            {sortedTags.map((tag, index) => {
              const isViolation = tag.isBeforeConsent && tag.type !== 'consent';
              const riskInfo = getRiskLabel(tag.lgpdRisk);
              
              return (
                <div key={index} className="relative flex items-start gap-4">
                  {/* Marcador na timeline */}
                  <div className={`relative z-10 w-12 h-12 rounded-full flex items-center justify-center ${getTypeColor(tag.type)} text-white font-bold shadow-lg`}>
                    {index + 1}
                  </div>

                  {/* Conteúdo do item */}
                  <div className={`flex-1 p-4 rounded-lg border-2 transition-all ${
                    isViolation 
                      ? 'bg-red-50 border-red-300 shadow-red-100' 
                      : tag.type === 'consent'
                        ? 'bg-green-50 border-green-300'
                        : 'bg-white border-gray-200'
                  } shadow-sm hover:shadow-md`}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getSeverityIcon(tag.lgpdRisk, isViolation)}
                        <h4 className="font-semibold text-gray-900">{tag.name}</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getTypeBadgeColor(tag.type)}>
                          {getTypeLabel(tag.type)}
                        </Badge>
                        {isViolation && (
                          <Badge className="bg-red-100 text-red-800 border-red-300">
                            ❌ Violação LGPD
                          </Badge>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Linha no código:</span>
                        <span className="font-mono ml-2">
                          {tag.lineNumber || (
                            <Badge variant="outline" className="text-[10px] uppercase bg-amber-50 text-amber-600 border-amber-200 gap-1 opacity-70">
                              <Lock className="w-2.5 h-2.5" />
                              Premium
                            </Badge>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">Risco LGPD:</span>
                        <Badge className={riskInfo.class}>{riskInfo.text}</Badge>
                      </div>
                    </div>

                    {tag.dataCollected && tag.dataCollected.length > 0 && (
                      <div className="mt-3">
                        <span className="text-sm text-gray-500">Dados coletados:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {tag.dataCollected.map((data, i) => (
                            <Badge key={i} variant="outline" className="text-xs bg-gray-50">
                              {data}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {isViolation && (
                      <div className="mt-3 p-2 bg-red-100 rounded text-sm text-red-800">
                        <strong>⚠️ Problema:</strong> Este script está carregando antes do consentimento do usuário, 
                        violando o Art. 7º e 8º da LGPD.
                      </div>
                    )}

                    {tag.type === 'consent' && (
                      <div className="mt-3 p-2 bg-green-100 rounded text-sm text-green-800">
                        <strong>✅ CMP Detectado:</strong> Ferramenta de consentimento encontrada. 
                        Tags abaixo deste ponto devem aguardar aprovação do usuário.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resumo de Ordem */}
        {loadingOrder && loadingOrder.length > 0 && (
          <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
            <h4 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
              <Zap className="w-5 h-5" />
              Recomendações de Ordem
            </h4>
            <div className="space-y-2">
              {loadingOrder
                .filter(item => item.issues && item.issues.length > 0)
                .map((item, index) => (
                  <div key={index} className="flex items-start gap-2 text-sm">
                    <ArrowDown className="w-4 h-4 text-blue-500 mt-0.5" />
                    <div>
                      <strong>{item.tag}:</strong>{' '}
                      {item.recommendations.join('; ') || item.issues.join('; ')}
                    </div>
                  </div>
                ))}
              {loadingOrder.filter(item => item.issues && item.issues.length > 0).length === 0 && (
                <p className="text-sm text-green-700 flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" />
                  Ordem de carregamento está correta!
                </p>
              )}
            </div>
          </div>
        )}

        {/* Ordem Ideal */}
        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h4 className="font-medium text-gray-800 mb-3">📋 Ordem Ideal de Carregamento:</h4>
          <ol className="list-decimal list-inside space-y-1 text-sm text-gray-700">
            <li>🔐 <strong>CMP (Consentimento)</strong> - Sempre primeiro</li>
            <li>📦 <strong>Google Tag Manager</strong> - Gerencia outras tags</li>
            <li>📊 <strong>Analytics</strong> - Após consentimento</li>
            <li>📢 <strong>Publicidade</strong> - Apenas com consentimento de marketing</li>
            <li>🔥 <strong>Heatmaps</strong> - Requer consentimento específico</li>
            <li>💬 <strong>Chat/Suporte</strong> - Funcional, pode carregar antes</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScriptTimeline;
