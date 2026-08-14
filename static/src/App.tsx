import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { PlanProvider } from "@/context/PlanContext";
import { I18nProvider } from "@/context/I18nContext";
import { AuthProvider } from "@/context/AuthContext";
import { SubscriptionProvider } from "@/context/SubscriptionContext";
import { LocaleProvider } from "@/context/LocaleContext";
import UpgradeModal from "@/components/UpgradeModal";
import DevPlanSwitcher from "@/components/DevPlanSwitcher";
import AdminPlanTesting from "@/components/AdminPlanTesting";

// Pages
import Index from "./pages/Index";
import Historico from "./pages/Historico";
import AuthPage from "./pages/Auth";
import PricingPage from "./pages/Pricing";
import CheckoutPage from "./pages/Checkout";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentPending from "./pages/PaymentPending";
import PaymentFailed from "./pages/PaymentFailed";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";
import AuthCallback from "./pages/AuthCallback";

const queryClient = new QueryClient();

/* Conferência visual do laudo, só em desenvolvimento.
   O ternário sobre `import.meta.env.DEV` não é enfeite: o Vite substitui essa
   expressão por `false` literal no build, e só então o Rollup consegue podar o
   `import()` inteiro. Com o `lazy()` no topo, fora de qualquer condição, o
   chunk era emitido mesmo com a rota ausente — 187 KB de varredura de um site
   de terceiro publicados junto do produto, para nunca serem baixados. */
const ConferenciaDoLaudo = import.meta.env.DEV
  ? lazy(() => import("./pages/dev/ConferenciaDoLaudo"))
  : null;

/* Telas de administração, em chunk separado: elas existem para duas pessoas e
   não têm por que pesar no primeiro carregamento de todo visitante.

   `/admin/confirmar-pix` NÃO é um caminho escolhido aqui — é o que
   `api/pix.py` escreve no botão do e-mail de cobrança
   (`f"{frontend}/admin/confirmar-pix?t={token}"`). Enquanto as duas rotas
   ficaram fora do `Routes`, o dono clicava no e-mail e caía no NotFound, e o
   painel simplesmente não tinha endereço. Mudar este caminho quebra o link de
   todo e-mail já enviado. */
const PainelAdmin = lazy(() => import("./pages/admin/Painel"));
const ConfirmarPix = lazy(() => import("./pages/admin/ConfirmarPix"));

/* Fallback do chunk: um buraco visível e dito, nunca uma tela em branco que o
   admin lê como "quebrou". */
const CarregandoTela = () => (
  <div
    className="min-h-screen flex items-center justify-center t-apoio"
    style={{ background: "var(--sup-0)" }}
  >
    Carregando a tela…
  </div>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <I18nProvider>
      <LocaleProvider>
        <AuthProvider>
          <SubscriptionProvider>
            <PlanProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                {/* BrowserRouter MUST wrap everything that uses useNavigate / useParams */}
                <BrowserRouter>
                  {/* Global modals that use useNavigate must be inside BrowserRouter */}
                  <UpgradeModal />
                  <AdminPlanTesting />
                  <DevPlanSwitcher />
                  <Routes>
                    {/* Main app */}
                    <Route path="/" element={<Index />} />

                    {/* Histórico e comparação entre varreduras.
                        A rota é `/historico`, não `/history`: esta última é o
                        endpoint da API que devolve o JSON do histórico. Ela
                        está no proxy do Vite e registrada antes do catch-all do
                        SPA em main.py, então navegar para lá no browser entrega
                        JSON — em dev e em produção. O menu apontava para
                        `/history` e nunca poderia ter funcionado. */}
                    <Route path="/historico" element={<Historico />} />

                    {/* Auth */}
                    <Route path="/auth" element={<AuthPage />} />
                    <Route path="/auth/callback" element={<AuthCallback />} />

                    {/* Pricing & Checkout */}
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />

                    {/* Post-payment callbacks (Mercado Pago redirects here) */}
                    <Route path="/payment/success" element={<PaymentSuccess />} />
                    <Route path="/payment/pending" element={<PaymentPending />} />
                    <Route path="/payment/failure" element={<PaymentFailed />} />

                    {/* Account Settings */}
                    <Route path="/settings" element={<SettingsPage />} />

                    {/* Administração. A guarda de verdade é `somente_admin` no
                        backend, que responde 404 para quem não é admin; estas
                        telas só evitam montar uma página inteira de erro. */}
                    <Route
                      path="/admin"
                      element={
                        <Suspense fallback={<CarregandoTela />}>
                          <PainelAdmin />
                        </Suspense>
                      }
                    />
                    <Route
                      path="/admin/confirmar-pix"
                      element={
                        <Suspense fallback={<CarregandoTela />}>
                          <ConfirmarPix />
                        </Suspense>
                      }
                    />

                    {/* Conferir o laudo sem sessão, sem cota e sem esperar o
                        Chromium. Em produção esta rota simplesmente não
                        existe, e cai no catch-all abaixo. */}
                    {ConferenciaDoLaudo && (
                      <Route
                        path="/dev/laudo"
                        element={
                          <Suspense fallback={null}>
                            <ConferenciaDoLaudo />
                          </Suspense>
                        }
                      />
                    )}

                    {/* Catch-all */}
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </BrowserRouter>
              </TooltipProvider>
            </PlanProvider>
          </SubscriptionProvider>
        </AuthProvider>
      </LocaleProvider>
    </I18nProvider>
  </QueryClientProvider>
);

export default App;
