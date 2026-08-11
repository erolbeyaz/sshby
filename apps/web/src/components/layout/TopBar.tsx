import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowDownUpIcon, KeyRoundIcon, PlugZapIcon, TerminalIcon, ZapIcon } from 'lucide-react';
import { Logo } from '@/components/brand/Logo';

/**
 * Üst bar. Sağdaki mor rozet kalıcıdır: kullanıcı hiçbir zaman
 * "acaba kaydediliyor mu" diye sormasın diye denetim durumu her an ekranda.
 */
export function TopBar({
  hostCount,
  auditEnabled,
  connectionsOpen,
  onToggleConnections,
  quickConnectOpen,
  onToggleQuickConnect,
  isAdmin,
  right,
}: {
  hostCount: number;
  auditEnabled: boolean;
  connectionsOpen?: boolean;
  onToggleConnections?: () => void;
  quickConnectOpen?: boolean;
  onToggleQuickConnect?: () => void;
  isAdmin?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface-2 px-3.5">
      <Logo size={22} />

      {/* Kasa ve terminal arasında geçiş buradan; komut paletine bağımlı olmamalı. */}
      <nav className="ml-3 flex items-center gap-0.5">
        <TopNavLink to="/" icon={<TerminalIcon size={13} />} label="Terminal" />
        <TopNavLink to="/kasa" icon={<KeyRoundIcon size={13} />} label="Kasa" />
        <TopNavLink
          to="/yapilandirma"
          icon={<ArrowDownUpIcon size={13} />}
          label="Yapılandırma"
        />
        <button
          type="button"
          className={clsx(
            'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors',
            connectionsOpen ? 'bg-surface text-fg' : 'text-fg-dim hover:bg-surface hover:text-fg',
          )}
          onClick={onToggleConnections}
          aria-pressed={connectionsOpen}
        >
          <PlugZapIcon size={13} />
          Bağlantılar
        </button>
        <button
          type="button"
          className={clsx(
            'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors',
            quickConnectOpen ? 'bg-surface text-fg' : 'text-fg-dim hover:bg-surface hover:text-fg',
          )}
          onClick={onToggleQuickConnect}
          aria-pressed={quickConnectOpen}
        >
          <ZapIcon size={13} />
          Hızlı bağlantı
        </button>
      </nav>

      <div className="flex-1" />

      <span className="pill">{hostCount} sunucu</span>

      {/*
        Rozet tıklanabilir: admin bir kullanıcı "denetim kapalı" yazısını görüp
        nereden açacağını aramak zorunda kalmamalı. Admin değilse yalnızca
        bilgilendirir.
      */}
      {isAdmin ? (
        <Link
          to="/yonetim/denetim"
          className={clsx('pill transition-colors hover:border-fg-dim', auditEnabled && 'pill-trace')}
          title="Denetim akışı ayarları"
        >
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', auditEnabled ? 'bg-trace' : 'bg-fg-dim')}
            aria-hidden="true"
          />
          {auditEnabled ? "Elastic'e yazılıyor" : 'denetim kapalı'}
        </Link>
      ) : (
        <span className={clsx('pill', auditEnabled && 'pill-trace')}>
          <span
            className={clsx('h-1.5 w-1.5 rounded-full', auditEnabled ? 'bg-trace' : 'bg-fg-dim')}
            aria-hidden="true"
          />
          {auditEnabled ? "Elastic'e yazılıyor" : 'denetim kapalı'}
        </span>
      )}

      {right}
    </header>
  );
}

function TopNavLink({
  to,
  icon,
  label,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <NavLink
      to={to}
      // `end`: "/" yalnızca tam eşleşmede etkin görünsün, her yolda değil.
      end={to === '/'}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-1.5 rounded px-2.5 py-1.5 text-[13px] transition-colors',
          isActive ? 'bg-surface text-fg' : 'text-fg-dim hover:bg-surface hover:text-fg',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}
