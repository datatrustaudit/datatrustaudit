import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MessageCircle, X, Send, Bot, User, Minimize2, Maximize2, Loader2 } from 'lucide-react';

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

interface AuditContext {
    violations?: number;
    score?: number;
    hasConsentTool?: boolean;
    tags?: any[];
    estimatedFine?: string;
    url?: string;
    piiExposure?: number;
    securityIssues?: number;
    isDeepScan?: boolean;
}

interface AIChatProps {
    context?: AuditContext;
    isMinimized?: boolean;
}

const AIChat = ({ context = {}, isMinimized: initialMinimized = true }: AIChatProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isMinimized, setIsMinimized] = useState(initialMinimized);
    const [messages, setMessages] = useState<Message[]>([]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    useEffect(() => {
        const handleFixEvent = (e: any) => {
            const { tag, violation } = e.detail;
            setIsOpen(true);
            setIsMinimized(false);
            
            const prompt = `Como posso corrigir a violação de LGPD da tag "${tag}"? Violação identificada: ${violation}. Me ensine a configurar corretamente no GTM.`;
            
            // Usamos um pequeno delay para garantir que o chat abriu
            setTimeout(() => {
                sendMessageDirectly(prompt);
            }, 500);
        };

        window.addEventListener('gtm-audit-fix-violation', handleFixEvent);
        return () => window.removeEventListener('gtm-audit-fix-violation', handleFixEvent);
    }, []);

    const sendMessageDirectly = async (text: string) => {
        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: text,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setIsLoading(true);

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: text,
                    context: {
                        violations: context.violations,
                        score: context.score,
                        hasConsentTool: context.hasConsentTool,
                        tagCount: context.tags?.length
                    }
                })
            });

            const data = await response.json();
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.response || 'Desculpe, não consegui processar sua pergunta.',
                timestamp: new Date()
            };
            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error('Chat error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen && messages.length === 0) {
            // Mensagem de boas-vindas baseada no contexto
            const welcomeMessage = generateWelcomeMessage(context);
            setMessages([{
                id: 'welcome',
                role: 'assistant',
                content: welcomeMessage,
                timestamp: new Date()
            }]);
        }
    }, [isOpen, context]);

    const generateWelcomeMessage = (ctx: AuditContext): string => {
        if (ctx.violations && ctx.violations > 0) {
            return `👋 Olá! Analisei seu site e encontrei **${ctx.violations} violações** de LGPD.

${ctx.score !== undefined ? `📊 Score de conformidade: **${ctx.score}%**` : ''}
${ctx.estimatedFine ? `💰 Multa estimada: **${ctx.estimatedFine}**` : ''}

Como posso ajudar? Pergunte sobre:
- 📋 Detalhes das multas LGPD
- 🔐 Como implementar consentimento
- 📊 Configurar GTM corretamente
- ⚠️ Entender cada violação`;
        }

        return `👋 Olá! Sou o assistente do **DataTrust Audit**.

Posso ajudar com dúvidas sobre:
- 📋 Lei LGPD e multas
- 🔐 Ferramentas de consentimento (CMP)
- 📊 Google Tag Manager
- 📈 Google Analytics 4
- 🔍 Análise de conformidade

Faça sua auditoria ou me pergunte algo!`;
    };

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMessage: Message = {
            id: Date.now().toString(),
            role: 'user',
            content: input.trim(),
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch('/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: input.trim(),
                    context: {
                        violations: context.violations,
                        score: context.score,
                        hasConsentTool: context.hasConsentTool,
                        tagCount: context.tags?.length
                    }
                })
            });

            const data = await response.json();

            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: data.response || 'Desculpe, não consegui processar sua pergunta.',
                timestamp: new Date()
            };

            setMessages(prev => [...prev, assistantMessage]);
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: '❌ Erro ao conectar com o servidor. Tente novamente.',
                timestamp: new Date()
            }]);
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const quickQuestions = [
        'O que é a LGPD?',
        'Quanto é a multa máxima?',
        'Como implementar CMP?',
        'GTM e consentimento'
    ];

    const formatMessage = (content: string) => {
        // O conteúdo vai para dangerouslySetInnerHTML, então precisa ser
        // escapado ANTES de qualquer formatação. A versão anterior injetava o
        // texto cru: o contexto enviado ao chat inclui dados do site auditado
        // (URL, nomes de tag), e um site malicioso podia devolver
        // <img src=x onerror=...> que executava no navegador de quem audita.
        const escapado = content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        // Só depois de escapado o markdown vira marcação — as tags abaixo são
        // as únicas que este componente introduz.
        return escapado
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br />');
    };

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-xl transition-all hover:scale-110 flex items-center justify-center z-50"
            >
                <MessageCircle className="w-6 h-6" />
                {context.violations && context.violations > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center">
                        {context.violations}
                    </span>
                )}
            </button>
        );
    }

    return (
        <Card className={`fixed bottom-6 right-6 shadow-2xl z-50 transition-all duration-300 flex flex-col ${isMinimized ? 'w-80 h-14' : 'w-96 h-[500px]'
            }`}>
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-t-lg">
                <div className="flex items-center gap-2">
                    <Bot className="w-5 h-5" />
                    <span className="font-semibold">Assistente LGPD</span>
                    {context.violations && context.violations > 0 && (
                        <Badge variant="destructive" className="text-xs">
                            {context.violations} violações
                        </Badge>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => setIsMinimized(!isMinimized)}
                        className="p-1 hover:bg-white/20 rounded"
                    >
                        {isMinimized ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={() => setIsOpen(false)}
                        className="p-1 hover:bg-white/20 rounded"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <>
                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
                        {messages.map((msg) => (
                            <div
                                key={msg.id}
                                className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                            >
                                {msg.role === 'assistant' && (
                                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                                        <Bot className="w-4 h-4 text-blue-600" />
                                    </div>
                                )}
                                <div
                                    className={`max-w-[80%] p-3 rounded-lg ${msg.role === 'user'
                                            ? 'bg-blue-600 text-white rounded-br-none'
                                            : 'bg-white border shadow-sm rounded-bl-none'
                                        }`}
                                >
                                    <div
                                        className="text-sm"
                                        dangerouslySetInnerHTML={{ __html: formatMessage(msg.content) }}
                                    />
                                    <div className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                                        {msg.timestamp.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                    </div>
                                </div>
                                {msg.role === 'user' && (
                                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                                        <User className="w-4 h-4 text-gray-600" />
                                    </div>
                                )}
                            </div>
                        ))}

                        {isLoading && (
                            <div className="flex gap-2 justify-start">
                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                                    <Bot className="w-4 h-4 text-blue-600" />
                                </div>
                                <div className="bg-white border shadow-sm rounded-lg rounded-bl-none p-3">
                                    <div className="flex items-center gap-2 text-gray-500">
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span className="text-sm">Digitando...</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div ref={messagesEndRef} />
                    </div>

                    {/* Quick Questions */}
                    {messages.length <= 1 && (
                        <div className="p-2 border-t bg-white">
                            <div className="text-xs text-gray-500 mb-2">Perguntas rápidas:</div>
                            <div className="flex flex-wrap gap-1">
                                {quickQuestions.map((q, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            setInput(q);
                                            setTimeout(() => handleSend(), 100);
                                        }}
                                        className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded-full transition-colors"
                                    >
                                        {q}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-3 border-t bg-white rounded-b-lg">
                        <div className="flex gap-2">
                            <Input
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={handleKeyPress}
                                placeholder="Digite sua pergunta..."
                                disabled={isLoading}
                                className="flex-1"
                            />
                            <Button
                                onClick={handleSend}
                                disabled={!input.trim() || isLoading}
                                size="icon"
                                className="bg-blue-600 hover:bg-blue-700"
                            >
                                <Send className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </Card>
    );
};

export default AIChat;
