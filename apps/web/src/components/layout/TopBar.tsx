import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Logo } from '@/components/brand/Logo';
import { useAuthStore } from '@/lib/auth-store';
import { useT } from '@/lib/i18n';
import { LanguageSwitch } from './LanguageSwitch';

/**
 * Üst bar. Gezinme sol menüye taşındıktan sonra burada yalnızca marka ve
 * durum kaldı. Sağdaki mor rozet kalıcıdır: kullanıcı hiçbir zaman "acaba
 * kaydediliyor mu" diye sormasın diye denetim durumu her an ekranda.
 */
export function TopBar({
  hostCount,
  auditEnabled,
  right,
}: {
  hostCount: number;
  auditEnabled: boolean;
  right?: React.ReactNode;
}) {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const auditLabel = auditEnabled ? t('nav.auditOn') : t('nav.auditOff');

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-3.5">
      <Link to="/" aria-label={t('nav.terminal')}>
        <Logo size={22} />
      </Link>

      <div className="flex-1" />

      <span className="pill">{t('nav.hostCount', { n: hostCount })}</span>

      {/*
        Rozet tıklanabilir: admin bir kullanıcı "denetim kapalı" yazısını görüp
        nereden açacağını aramak zorunda kalmamalı. Admin değilse yalnızca
        bilgilendirir.
      */}
      {isAdmin ? (
        <Link
          to="/admin/audit"
          className={clsx('pill transition-colors hover:border-fg-dim', auditEnabled && 'pill-trace')}
          title={t('user.auditStream')}
        >
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', auditEnabled ? 'bg-trace' : 'bg-fg-dim')}
            aria-hidden="true"
          />
          {auditLabel}
        </Link>
      ) : (
        <span className={clsx('pill', auditEnabled && 'pill-trace')}>
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', auditEnabled ? 'bg-trace' : 'bg-fg-dim')}
            aria-hidden="true"
          />
          {auditLabel}
        </span>
      )}

      <LanguageSwitch />

      {right}
    </header>
  );
}
