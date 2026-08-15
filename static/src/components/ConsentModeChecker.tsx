import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Shield,
    CheckCircle,
    XCircle,
    AlertTriangle,
    HelpCircle,
    Settings,
    Code,
    Copy,
    ExternalLink,
    Info,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import ConfidenceBadge from './ConfidenceBadge';

/** Achado produzido por `audit_engine/consent_auditor.py`. */
interface AchadoDeConsentimento {
    check: string;
    label: string;
    status: string;
    description?: string | null;
    evidence?: string | null;
    recommendation?: string | null;
    confidence?: string | null;
}

/**
 * Bloco `consent` da resposta de `/api/audit` — o `to_dict()` de
 * `ConsentAuditResult`. Todo campo aqui foi medido pelo motor; nenhum é
 * derivado na tela.
 */
export interface AuditoriaDeConsentimento {
    cmpDetected?: boolean;
    cmpName?: string | null;
    consentModeV2?: boolean;
    consentModeVersion?: string | null;
    hasDefaultDenied?: boolean;
    consentSignals?: Record<string, string>;
    /** Tri-estado: `null` = o HTML estático não permite concluir. */
    hasRejectAll?: boolean | null;
    hasPrivacyPolicy?: boolean;
    hasCookiePolicy?: boolean;
    tagsBeforeConsent?: string[];
    findings?: AchadoDeConsentimento[];
}

interface ConsentModeCheckerProps {
    hasConsentTool: boolean;
    detectedTags: any[];
    url: string;
    /** Medição do motor. Ausente = varredura sem auditoria de consentimento. */
    consent?: AuditoriaDeConsentimento | null;
}

/**
 * Os quatro sinais que `_CM_SIGNALS` (consent_auditor.py) procura dentro da
 * chamada `gtag('consent','default', {…})`. A versão anterior desta tela
 * exibia sete — os três extras (`functionality_storage`,
 * `personalization_storage`, `security_storage`) nunca foram lidos por
 * varredura nenhuma, e apareciam com valor fixo. Listar aqui só o que o motor
 * mede é o que impede a tabela de voltar a inventar linha.
 */
const SINAIS_LIDOS_PELO_MOTOR = [
    'analytics_storage',
    'ad_storage',
    'ad_user_data',
    'ad_personalization',
] as const;

const SINAIS_NAO_LIDOS = [
    'functionality_storage',
    'personalization_storage',
    'security_storage',
];

const ESTILO_POR_STATUS: Record<string, { icon: React.ElementType; color: string; bg: string }> = {
    ok: { icon: CheckCircle, color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-900' },
    warning: { icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900' },
    critical: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-900' },
    not_detected: { icon: Info, color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700' },
};

/** Três estados de verdade. `nao_medido` nunca vira "não" na tela. */
type EstadoDoItem = 'ok' | 'falha' | 'nao_medido';

interface ItemDoChecklist {
    label: string;
    estado: EstadoDoItem;
    /** O que sustenta o estado — sempre algo que a varredura leu. */
    detalhe?: string;
}

const ConsentModeChecker = ({ hasConsentTool, detectedTags, url, consent }: ConsentModeCheckerProps) => {
    /*
     * O normalizador do frontend substitui um `consent` ausente por
     * `{ findings: [], cmpDetected: false }` (AuditContainer.tsx). Esse objeto
     * de reposição não tem `consentModeV2`, enquanto o do motor sempre tem um
     * booleano ali — é assim que se separa "medido e deu falso" de "nunca
     * medido". Tratar os dois como a mesma coisa é o que fazia a tela afirmar
     * ausência de Consent Mode em varredura que não olhou para isso.
     */
    const medido = !!consent && typeof consent.consentModeV2 === 'boolean';

    const achados = (consent?.findings ?? []).filter(Boolean);

    // Identificadores do motor, não o nome de exibição: a tag do GTM se chama
    // "Google Tag Manager" e a checagem antiga procurava a substring "gtm" no
    // nome — dava "não instalado" em site com container.
    const temGTM = detectedTags.some((t) => t?.id === 'gtm' || t?.type === 'tag_manager');

    const copiarCodigo = (codigo: string) => {
        navigator.clipboard.writeText(codigo);
        toast({ title: 'Copiado!', description: 'Código copiado para a área de transferência' });
    };

    const codigoPadrao = `<!-- Google Consent Mode v2 — configuração padrão -->
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}

// Configuração padrão ANTES do GTM/GA4
gtag('consent', 'default', {
  'analytics_storage': 'denied',
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'functionality_storage': 'granted',
  'personalization_storage': 'denied',
  'security_storage': 'granted',
  'wait_for_update': 500
});

gtag('set', 'ads_data_redaction', true);
gtag('set', 'url_passthrough', true);
</script>`;

    const codigoDeAtualizacao = `// Atualizar consentimento após a escolha do usuário
function updateConsent(preferences) {
  gtag('consent', 'update', {
    'analytics_storage': preferences.analytics ? 'granted' : 'denied',
    'ad_storage': preferences.marketing ? 'granted' : 'denied',
    'ad_user_data': preferences.marketing ? 'granted' : 'denied',
    'ad_personalization': preferences.marketing ? 'granted' : 'denied'
  });
}

// Exemplo de uso com o seu CMP:
// updateConsent({ analytics: true, marketing: false });`;

    // ── Status principal ─────────────────────────────────────────────────────
    // Quatro leituras possíveis, todas ancoradas em campo medido. "v2 detectado"
    // sem `hasDefaultDenied` não é conformidade: o padrão continua liberando.
    const versao = consent?.consentModeVersion ?? null;
    const temV2 = consent?.consentModeV2 === true;
    const padraoNegado = consent?.hasDefaultDenied === true;

    let tomStatus: 'ok' | 'alerta' | 'falha' | 'neutro';
    let tituloStatus: string;
    let textoStatus: string;

    if (!medido) {
        tomStatus = 'neutro';
        tituloStatus = 'Consent Mode não verificado nesta varredura';
        textoStatus =
            'A resposta desta auditoria não trouxe o bloco de consentimento. Nada é afirmado aqui — ' +
            'nem a presença nem a ausência do Google Consent Mode. Refaça a varredura para obter a medição.';
    } else if (temV2 && padraoNegado) {
        tomStatus = 'ok';
        tituloStatus = 'Consent Mode v2 configurado com padrão negado';
        textoStatus =
            'A chamada gtag(\'consent\',\'default\') foi encontrada no HTML com os quatro sinais da v2, ' +
            'e ao menos um deles em "denied" por padrão.';
    } else if (temV2) {
        tomStatus = 'alerta';
        tituloStatus = 'Consent Mode v2 presente, mas sem padrão negado';
        textoStatus =
            'Os quatro sinais da v2 foram declarados, porém nenhum aparece como "denied" na configuração ' +
            'padrão: o rastreamento pode disparar antes de qualquer escolha do visitante.';
    } else if (versao) {
        tomStatus = 'falha';
        tituloStatus = `Consent Mode ${versao} — abaixo do exigido`;
        textoStatus =
            'Há chamada de consentimento no HTML, mas sem os sinais ad_user_data e ad_personalization ' +
            'que a v2 exige desde março de 2024.';
    } else {
        tomStatus = 'falha';
        tituloStatus = 'Consent Mode não detectado';
        textoStatus =
            'Nenhuma chamada gtag(\'consent\',\'default\') foi encontrada no HTML analisado.';
    }

    const CLASSES_DO_TOM: Record<typeof tomStatus, { caixa: string; titulo: string; texto: string; icon: React.ElementType; cor: string }> = {
        ok: {
            caixa: 'bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800',
            titulo: 'text-green-800 dark:text-green-200',
            texto: 'text-green-700 dark:text-green-300',
            icon: CheckCircle,
            cor: 'text-green-600',
        },
        alerta: {
            caixa: 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800',
            titulo: 'text-amber-900 dark:text-amber-200',
            texto: 'text-amber-800 dark:text-amber-300',
            icon: AlertTriangle,
            cor: 'text-amber-600',
        },
        falha: {
            caixa: 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800',
            titulo: 'text-red-800 dark:text-red-200',
            texto: 'text-red-700 dark:text-red-300',
            icon: XCircle,
            cor: 'text-red-600',
        },
        neutro: {
            caixa: 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700',
            titulo: 'text-gray-800 dark:text-gray-200',
            texto: 'text-gray-600 dark:text-gray-400',
            icon: HelpCircle,
            cor: 'text-gray-500',
        },
    };

    const estilo = CLASSES_DO_TOM[tomStatus];
    const IconeDoStatus = estilo.icon;

    // ── Checklist ────────────────────────────────────────────────────────────
    // `hasConsentTool` só responde por CMP. Reaproveitá-lo para as linhas de
    // Consent Mode foi exatamente o defeito que esta tela tinha: um booleano
    // sobre banner virava afirmação sobre sinais que ninguém leu.
    const cmpDetectada = medido ? consent?.cmpDetected === true : hasConsentTool;

    const checklist: ItemDoChecklist[] = [
        {
            label: 'Google Tag Manager instalado',
            estado: temGTM ? 'ok' : 'falha',
            detalhe: temGTM ? undefined : 'nenhum container GTM entre as tags detectadas',
        },
        {
            label: 'CMP / plataforma de consentimento detectada',
            estado: cmpDetectada ? 'ok' : 'falha',
            detalhe: cmpDetectada ? (consent?.cmpName ?? undefined) : 'nenhuma assinatura de CMP no HTML',
        },
    ];

    if (medido) {
        checklist.push(
            {
                label: 'Consent Mode v2 configurado',
                estado: temV2 ? 'ok' : 'falha',
                detalhe: versao ? `versão encontrada: ${versao}` : 'nenhuma chamada gtag(\'consent\',\'default\')',
            },
            {
                label: 'Estado padrão definido como denied',
                estado: padraoNegado ? 'ok' : 'falha',
                detalhe: versao
                    ? undefined
                    : 'sem chamada de consentimento padrão, não há o que negar por padrão',
            },
            {
                /* Tri-estado de verdade: o motor devolve `null` quando o banner
                   é montado por JavaScript e o HTML não permite concluir.
                   Rebaixar isso para "não" acusa o site de algo não medido. */
                label: 'Opção de recusar tudo',
                estado:
                    consent?.hasRejectAll === true
                        ? 'ok'
                        : consent?.hasRejectAll === false
                            ? 'falha'
                            : 'nao_medido',
                detalhe:
                    consent?.hasRejectAll === null || consent?.hasRejectAll === undefined
                        ? 'banner dinâmico: não confirmável a partir do HTML'
                        : undefined,
            },
            {
                label: 'Política de privacidade referenciada',
                estado: consent?.hasPrivacyPolicy ? 'ok' : 'falha',
            },
            {
                label: 'Política de cookies referenciada',
                estado: consent?.hasCookiePolicy ? 'ok' : 'falha',
            },
        );
    } else {
        checklist.push({
            label: 'Consent Mode v2, padrão negado e recusa',
            estado: 'nao_medido',
            detalhe: 'a varredura não trouxe a auditoria de consentimento',
        });
    }

    const ICONE_DO_ESTADO: Record<EstadoDoItem, { icon: React.ElementType; cor: string; caixa: string }> = {
        ok: { icon: CheckCircle, cor: 'text-green-600', caixa: 'bg-green-50 dark:bg-green-950/20' },
        falha: { icon: XCircle, cor: 'text-red-600', caixa: 'bg-red-50 dark:bg-red-950/20' },
        nao_medido: { icon: HelpCircle, cor: 'text-gray-400', caixa: 'bg-gray-50 dark:bg-gray-800' },
    };

    const tagsAntesDoConsentimento = consent?.tagsBeforeConsent ?? [];

    return (
        <Card className="border-0 shadow-xl dark:bg-gray-900">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-gradient-to-br from-green-500 to-emerald-600 text-white">
                        <Shield className="h-5 w-5" />
                    </div>
                    Google Consent Mode v2
                </CardTitle>
                <CardDescription>
                    O que a varredura de {url} leu sobre consentimento — e o que ela não conseguiu ler.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Status principal */}
                <div className={`p-6 rounded-xl ${estilo.caixa}`}>
                    <div className="flex items-start gap-4">
                        <IconeDoStatus className={`h-12 w-12 flex-shrink-0 ${estilo.cor}`} />
                        <div>
                            <h3 className={`text-xl font-bold ${estilo.titulo}`}>{tituloStatus}</h3>
                            <p className={`text-sm mt-1 ${estilo.texto}`}>{textoStatus}</p>
                        </div>
                    </div>
                </div>

                {/* Achados do motor — a íntegra do que consent_auditor concluiu */}
                <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                        <Shield className="h-4 w-4" />
                        Achados da auditoria de consentimento
                    </h4>
                    {achados.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                            {medido
                                ? 'O motor não registrou nenhum achado de consentimento nesta varredura.'
                                : 'Esta varredura não trouxe achados de consentimento.'}
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {achados.map((achado, i) => {
                                const cfg = ESTILO_POR_STATUS[achado.status] || ESTILO_POR_STATUS.warning;
                                const IconeDoAchado = cfg.icon;
                                return (
                                    <div key={`${achado.check}-${i}`} className={`p-4 rounded-lg border ${cfg.bg}`}>
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="flex items-start gap-3 flex-1 min-w-0">
                                                <IconeDoAchado className={`w-5 h-5 mt-0.5 flex-shrink-0 ${cfg.color}`} />
                                                <div className="min-w-0">
                                                    <p className="font-semibold text-sm">{achado.label}</p>
                                                    {achado.description && (
                                                        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
                                                            {achado.description}
                                                        </p>
                                                    )}
                                                    {achado.evidence && (
                                                        <pre className="text-[11px] bg-gray-900 text-gray-100 p-2 rounded mt-2 overflow-x-auto max-w-full">
                                                            {achado.evidence}
                                                        </pre>
                                                    )}
                                                    {achado.recommendation && (
                                                        <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded p-2 mt-2">
                                                            {achado.recommendation}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            {achado.confidence && (
                                                <ConfidenceBadge level={achado.confidence as 'high' | 'medium' | 'low'} />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Sinais de consentimento */}
                <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                        <Settings className="h-4 w-4" />
                        Sinais de consentimento
                    </h4>

                    {!medido ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                            Não medido nesta varredura — nenhum valor é exibido aqui.
                        </p>
                    ) : !versao ? (
                        <p className="text-sm text-gray-600 dark:text-gray-300 p-3 rounded-lg bg-gray-50 dark:bg-gray-800">
                            Nenhuma chamada <code className="font-mono">gtag('consent','default')</code> foi
                            encontrada no HTML, então não há sinal declarado para ler. A tabela fica vazia de
                            propósito: sinal não declarado não tem valor a exibir.
                        </p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {SINAIS_LIDOS_PELO_MOTOR.map((sinal) => {
                                    const valor = consent?.consentSignals?.[sinal];
                                    const rotulo =
                                        valor === 'denied'
                                            ? { cor: 'bg-green-500', texto: 'denied (correto por padrão)' }
                                            : valor === 'granted'
                                                ? { cor: 'bg-red-500', texto: 'granted (libera antes da escolha)' }
                                                : { cor: 'bg-gray-400', texto: 'não declarado na chamada' };
                                    return (
                                        <div
                                            key={sinal}
                                            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800"
                                        >
                                            <div>
                                                <code className="text-xs font-mono">{sinal}</code>
                                                <div className="flex items-center gap-1 mt-1">
                                                    <div className={`w-2 h-2 rounded-full ${rotulo.cor}`} />
                                                    <span className="text-xs text-gray-500 dark:text-gray-400">
                                                        {rotulo.texto}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-xs text-gray-500 dark:text-gray-400">
                                Esta varredura lê apenas os quatro sinais acima. {SINAIS_NAO_LIDOS.join(', ')} não
                                foram verificados e por isso não aparecem com valor.
                            </p>
                        </>
                    )}
                </div>

                {/* Tags que carregaram antes de qualquer consentimento */}
                {tagsAntesDoConsentimento.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="font-medium">Tags observadas antes de qualquer consentimento</h4>
                        <ul className="text-sm text-gray-700 dark:text-gray-300 list-disc pl-5 space-y-1">
                            {tagsAntesDoConsentimento.map((nome, i) => (
                                <li key={`${nome}-${i}`}>{nome}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {!medido && (
                    <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                            Sem o bloco de consentimento na resposta, esta aba não afirma nada sobre o site. O
                            material abaixo é referência de implementação, não resultado da varredura.
                        </AlertDescription>
                    </Alert>
                )}

                {medido && !temV2 && (
                    <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                            <strong>Exposição atual:</strong> desde março de 2024 o Google exige os sinais da v2
                            para tráfego sujeito à política de consentimento. Sem eles, campanhas do Google Ads
                            perdem atribuição e remarketing, e o rastreamento segue sem base legal registrada.
                        </AlertDescription>
                    </Alert>
                )}

                {/* Código de implementação — referência, não evidência */}
                <div className="space-y-3">
                    <h4 className="font-medium flex items-center gap-2">
                        <Code className="h-4 w-4" />
                        Modelo de implementação (referência)
                    </h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                        Trechos genéricos de documentação. Não descrevem o código do site auditado.
                    </p>

                    <div className="relative">
                        <pre className="p-4 bg-gray-900 rounded-xl text-xs text-green-400 overflow-x-auto">
                            {codigoPadrao}
                        </pre>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="absolute top-2 right-2"
                            onClick={() => copiarCodigo(codigoPadrao)}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>

                    <div className="relative">
                        <pre className="p-4 bg-gray-900 rounded-xl text-xs text-blue-400 overflow-x-auto">
                            {codigoDeAtualizacao}
                        </pre>
                        <Button
                            size="sm"
                            variant="secondary"
                            className="absolute top-2 right-2"
                            onClick={() => copiarCodigo(codigoDeAtualizacao)}
                        >
                            <Copy className="h-4 w-4" />
                        </Button>
                    </div>
                </div>

                {/* Checklist */}
                <div className="space-y-3">
                    <h4 className="font-medium">Checklist de requisitos</h4>
                    <div className="space-y-2">
                        {checklist.map((item, i) => {
                            const cfg = ICONE_DO_ESTADO[item.estado];
                            const IconeDoItem = cfg.icon;
                            return (
                                <div key={i} className={`flex items-start gap-2 p-2 rounded ${cfg.caixa}`}>
                                    <IconeDoItem className={`h-4 w-4 mt-0.5 flex-shrink-0 ${cfg.cor}`} />
                                    <div className="text-sm">
                                        <span>{item.label}</span>
                                        {item.estado === 'nao_medido' && (
                                            <span className="ml-1 text-gray-500 dark:text-gray-400">— não medido</span>
                                        )}
                                        {item.detalhe && (
                                            <span className="block text-xs text-gray-500 dark:text-gray-400">
                                                {item.detalhe}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Links úteis */}
                <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" size="sm" asChild>
                        <a href="https://support.google.com/google-ads/answer/10000067" target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Docs Google Ads
                        </a>
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                        <a href="https://developers.google.com/tag-platform/security/guides/consent" target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4 mr-1" />
                            Consent Mode Docs
                        </a>
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
};

export default ConsentModeChecker;
