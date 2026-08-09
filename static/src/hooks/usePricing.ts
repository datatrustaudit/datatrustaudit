/**
 * usePricing — preços vindos do backend (GET /api/payments/plans).
 *
 * O backend é a única fonte de preço: é ele que monta a preferência de
 * pagamento. Antes existiam três tabelas divergentes (api/payments.py,
 * SubscriptionContext.tsx e pricing.config.ts) e o cliente via um valor na
 * tela enquanto o checkout cobrava outro — Pro aparecia como R$ 49,90 e era
 * cobrado R$ 97.
 *
 * PLAN_PRICING continua exportado como fallback para a primeira renderização
 * (e caso a API não responda), mas o valor exibido na hora de pagar tem que
 * ser o que vem daqui.
 */
import { useEffect, useState } from 'react';

export type FormaDePagamento = 'pix' | 'card';

export interface PlanPrice {
    /** Preço cheio, sem desconto de método. */
    price: number;
    /** Valor à vista no PIX. */
    pix: number;
    /** Valor no cartão — igual ao cheio. */
    card: number;
    /** Quanto o PIX economiza, em reais. */
    pixSavings: number;
}

export interface PricingResponse {
    currency: string;
    /** `one_time`: compra avulsa, sem renovação automática. */
    billing: string;
    /** Por quantos dias o acesso vale depois de pago. */
    accessDays: number;
    pixDiscountPct: number;
    plans: Record<'free' | 'pro' | 'premium', PlanPrice>;
}

export function usePricing() {
    const [pricing, setPricing] = useState<PricingResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelado = false;

        (async () => {
            try {
                const res = await fetch('/api/payments/plans');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const dados: PricingResponse = await res.json();
                if (!cancelado) {
                    setPricing(dados);
                    setError(null);
                }
            } catch (err) {
                // Não bloqueia a tela: o componente cai no fallback local e o
                // checkout continua cobrando o valor do servidor de qualquer forma.
                if (!cancelado) setError(err instanceof Error ? err.message : 'erro');
            } finally {
                if (!cancelado) setIsLoading(false);
            }
        })();

        return () => { cancelado = true; };
    }, []);

    return { pricing, isLoading, error };
}
