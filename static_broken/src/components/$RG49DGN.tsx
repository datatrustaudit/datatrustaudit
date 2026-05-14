import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// A functional wrapper to use hooks inside the class component if needed
class ErrorBoundaryInner extends Component<Props & { t: any }, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in Audit Component:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Card className="w-full mt-6 border-red-200 bg-red-50/50">
          <CardContent className="pt-10 pb-10 flex flex-col items-center text-center">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-red-600" />
            </div>
            <h2 className="text-xl font-bold text-red-900 mb-2">
              Algo deu errado durante a auditoria.
            </h2>
            <p className="text-red-700 max-w-md mb-6">
              Ocorreu um erro inesperado ao renderizar os resultados. Nossos engenheiros foram notificados.
              <br/>
              <span className="text-xs opacity-70 mt-2 block font-mono">
                {this.state.error?.message}
              </span>
            </p>
            <div className="flex gap-4">
              <Button 
                onClick={() => window.location.reload()}
                className="bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
              >
                <RefreshCcw className="w-4 h-4" />
                Tente novamente
              </Button>
              <Button 
                variant="outline"
                onClick={() => window.location.href = '/'}
                className="border-red-200 text-red-700 hover:bg-red-100"
              >
                Voltar ao Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    return this.props.children;
  }
}

export function ErrorBoundary(props: Props) {
  const { t } = useTranslation();
  return <ErrorBoundaryInner {...props} t={t} />;
}

export default ErrorBoundary;
