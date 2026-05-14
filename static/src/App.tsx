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

// Pages
import Index from "./pages/Index";
import AuthPage from "./pages/Auth";
import PricingPage from "./pages/Pricing";
import CheckoutPage from "./pages/Checkout";
import PaymentSuccess from "./pages/PaymentSuccess";
import PaymentPending from "./pages/PaymentPending";
import PaymentFailed from "./pages/PaymentFailed";
import SettingsPage from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
                  <DevPlanSwitcher />
                  <Routes>
                    {/* Main app */}
                    <Route path="/" element={<Index />} />

                    {/* Auth */}
                    <Route path="/auth" element={<AuthPage />} />

                    {/* Pricing & Checkout */}
                    <Route path="/pricing" element={<PricingPage />} />
                    <Route path="/checkout" element={<CheckoutPage />} />

                    {/* Post-payment callbacks (Mercado Pago redirects here) */}
                    <Route path="/payment/success" element={<PaymentSuccess />} />
                    <Route path="/payment/pending" element={<PaymentPending />} />
                    <Route path="/payment/failure" element={<PaymentFailed />} />

                    {/* Account Settings */}
                    <Route path="/settings" element={<SettingsPage />} />

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
