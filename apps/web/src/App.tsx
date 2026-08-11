import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { LogoMark } from '@/components/brand/Logo';
import { useAuthStore } from '@/lib/auth-store';
import { useT } from '@/lib/i18n';
import { AdminAuditPage } from '@/pages/AdminAuditPage';
import { AdminUsersPage } from '@/pages/AdminUsersPage';
import { AuthPage } from '@/pages/AuthPage';
import { CredentialsPage } from '@/pages/CredentialsPage';
import { HomePage } from '@/pages/HomePage';
import { HostDetailPage } from '@/pages/HostDetailPage';

/**
 * URL yolları bilinçli olarak **İngilizce**: adres çubuğu, yer imleri ve
 * paylaşılan bağlantılar uygulamanın dışına taşan yüzeyler ve kullanıcının o
 * anki dil seçimine göre değişmemeleri gerekiyor. Arayüz metni iki dilli,
 * rotalar tek dilli.
 */
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
          <Route path="/server/:hostId" element={<HostDetailPage />} />
          <Route path="/vault" element={<CredentialsPage />} />
          <Route
            path="/admin/users"
            element={user?.role === 'admin' ? <AdminUsersPage /> : <Navigate to="/" replace />}
          />
          <Route
            path="/admin/audit"
            element={user?.role === 'admin' ? <AdminAuditPage /> : <Navigate to="/" replace />}
          />
          {/*
            Eski Türkçe yollar: yer imi ya da açık sekmesi olan kullanıcı 404
            görmesin diye yeni karşılıklarına yönlendiriliyor.
          */}
          <Route path="/kasa" element={<Navigate to="/vault" replace />} />
          <Route path="/sunucu/:hostId" element={<LegacyHostRedirect />} />
          <Route path="/yonetim/kullanicilar" element={<Navigate to="/admin/users" replace />} />
          <Route path="/yonetim/denetim" element={<Navigate to="/admin/audit" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}

/** `/sunucu/:hostId` → `/server/:hostId`; kimliği koruyarak taşır. */
function LegacyHostRedirect() {
  const hostId = window.location.pathname.split('/')[2] ?? '';
  return <Navigate to={`/server/${hostId}`} replace />;
}

/** Oturum geri yüklenirken görünen kısa ara ekran. */
function Splash() {
  const t = useT();
  return (
    <div className="flex h-screen items-center justify-center bg-bg">
      <LogoMark size={40} className="animate-pulse" />
      <span className="sr-only">{t('common.loading')}</span>
    </div>
  );
}
