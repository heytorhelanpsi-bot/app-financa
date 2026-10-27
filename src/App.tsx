import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { SyncProvider } from '@/hooks/useSync';
import { useProfile } from '@/hooks/data';
import { useApplyTheme } from '@/hooks/useTheme';
import { isSupabaseConfigured } from '@/lib/supabase';
import { Spinner, ToastProvider } from '@/components/ui';
import { AppLayout } from '@/components/AppLayout';
import { Ambient } from '@/components/Ambient';
import { TxActionsProvider } from '@/features/transactions/TxActions';
import { HomePage } from '@/pages/HomePage';
import { TransactionsPage } from '@/pages/TransactionsPage';
import { AccountsPage } from '@/pages/AccountsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SetupRequiredPage,
  SignUpPage,
} from '@/pages/AuthPages';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err: unknown) => count < 2 && !(err as { code?: string })?.code?.startsWith?.('PGRST3'),
    },
    // Mutações nunca são repetidas automaticamente: a repetição é decisão do usuário
    // e, quando ocorre, reutiliza a mesma chave de idempotência.
    mutations: { retry: false },
  },
});

function AuthenticatedApp({ userId }: { userId: string }) {
  const profile = useProfile();
  useApplyTheme(profile.data?.theme);
  return (
    <SyncProvider userId={userId}>
      <TxActionsProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<HomePage />} />
            <Route path="movimentacoes" element={<TransactionsPage />} />
            <Route path="ordem-de-pagamento" element={<ComingSoonPage area="ordem" />} />
            <Route path="contas" element={<AccountsPage />} />
            <Route path="cartoes" element={<ComingSoonPage area="cartoes" />} />
            <Route path="calendario" element={<ComingSoonPage area="calendario" />} />
            <Route path="relatorios" element={<ComingSoonPage area="relatorios" />} />
            <Route path="configuracoes" element={<SettingsPage />} />
          </Route>
          <Route path="redefinir-senha" element={<ResetPasswordPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </TxActionsProvider>
    </SyncProvider>
  );
}

function Gate() {
  const { session, loading, recovering } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (session && (recovering || location.pathname === '/redefinir-senha')) return <ResetPasswordPage />;
  if (session) return <AuthenticatedApp key={session.user.id} userId={session.user.id} />;
  return (
    <Routes>
      <Route path="entrar" element={<LoginPage />} />
      <Route path="cadastro" element={<SignUpPage />} />
      <Route path="recuperar-senha" element={<ForgotPasswordPage />} />
      <Route path="redefinir-senha" element={<ResetPasswordPage />} />
      <Route path="*" element={<Navigate to="/entrar" replace />} />
    </Routes>
  );
}

export function App() {
  if (!isSupabaseConfigured) {
    return (
      <>
        <Ambient />
        <SetupRequiredPage />
      </>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <Ambient />
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter>
            <Gate />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
