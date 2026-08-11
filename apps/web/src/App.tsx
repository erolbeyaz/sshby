import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LogoMark } from '@/components/brand/Logo';
import { useAuthStore } from '@/lib/auth-store';
import { AdminAuditPage } from '@/pages/AdminAuditPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AuthPage } from '@/pages/AuthPage';
import { ConfigTransferPage } from '@/pages/ConfigTransferPage';
import { CredentialsPage } from '@/pages/CredentialsPage';
import { HomePage } from '@/pages/HomePage';
import { HostDetailPage } from '@/pages/HostDetailPage';

export function App() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  if (status === 'loading') return <Splash />;
  if (status === 'anonymous') return <AuthPage />;

  return (
    <BrowserRouter>
      <AppShell
        auditEnabled={bootstrap?.auditEnabled ?? false}
        auditIndex={bootstrap?.auditIndexPattern ?? null}
      >
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sunucu/:hostId" element={<HostDetailPage />} />
          <Route path="/kasa" element={<CredentialsPage />} />
          <Route path="/yapilandirma" element={<ConfigTransferPage />} />
          <Route
            path="/yonetim/kullanicilar"
            element={user?.role === 'admin' ? <AdminUsersPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/yonetim/denetim"
            element={user?.role === 'admin' ? <AdminAuditPage /> : <Navigate to="/" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

/** Oturum geri yüklenirken görünen kısa ara ekran. */
function Splash() {
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <LogoMark size={40} className="animate-pulse" />
      <span className="sr-only">Yükleniyor</span>
    </div>
  );
}
