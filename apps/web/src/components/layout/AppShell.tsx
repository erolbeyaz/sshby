import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { CommandPalette } from '@/components/CommandPalette';
import { TerminalWorkspace } from '@/components/terminal/TerminalWorkspace';
import { useAuthStore } from '@/lib/auth-store';
import { useInventory } from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';
import { ConnectionsPanel } from './ConnectionsPanel';
import { QuickConnectPanel } from './QuickConnectPanel';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { UserMenu } from './UserMenu';

/**
 * Uygulama kabuğu: üst bar, sol ağaç, içerik, alt durum çubuğu.
 * Yükseklik zinciri `h-screen` + `min-h-0` ile kuruldu — terminal panelinin
 * sayfayı taşırmadan kendi içinde kaymasını sağlayan şey bu.
 */
export function AppShell({
  children,
  auditEnabled = false,
  auditIndex = null,
}: {
  children: ReactNode;
  auditEnabled?: boolean;
  auditIndex?: string | null;
}) {
  const inventory = useInventory();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const hasTabs = useTerminalStore((s) => s.tabs.length > 0 || s.fileTabs.length > 0 || s.metricTabs.length > 0 || s.historyTabs.length > 0);
  const { pathname } = useLocation();
  const connectionsOpen = useTerminalStore((s) => s.connectionsOpen);
  const setConnectionsOpen = useTerminalStore((s) => s.setConnectionsOpen);
  const quickConnectOpen = useTerminalStore((s) => s.quickConnectOpen);
  const setQuickConnectOpen = useTerminalStore((s) => s.setQuickConnectOpen);

  /**
   * Terminal, yönlendirici çıktısının DIŞINDA ve her zaman bağlı duruyor.
   *
   * Önceden ana sayfanın içinde yaşıyordu; kasaya ya da sunucu ayrıntısına
   * geçmek React'in onu DOM'dan sökmesine, dolayısıyla WebSocket'lerin
   * kapanmasına ve tüm SSH oturumlarının ölmesine yol açıyordu. Sekmeler arası
   * geçişte uyguladığımız kuralın aynısı burada da geçerli: terminal asla
   * sökülmez, yalnızca gizlenir.
   */
  const terminalVisible = pathname === '/' && hasTabs;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <TopBar
        hostCount={inventory.data?.hosts.length ?? 0}
        auditEnabled={auditEnabled}
        connectionsOpen={connectionsOpen}
        onToggleConnections={() => setConnectionsOpen(!connectionsOpen)}
        quickConnectOpen={quickConnectOpen}
        onToggleQuickConnect={() => setQuickConnectOpen(!quickConnectOpen)}
        isAdmin={isAdmin}
        right={<UserMenu />}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {connectionsOpen && <ConnectionsPanel onClose={() => setConnectionsOpen(false)} />}
        {quickConnectOpen && <QuickConnectPanel onClose={() => setQuickConnectOpen(false)} />}

        <main className="relative min-w-0 flex-1">
          {/* Terminal katmanı: sayfadan bağımsız, kalıcı. */}
          {hasTabs && (
            <div
              className={clsx('absolute inset-0', !terminalVisible && 'invisible')}
              aria-hidden={!terminalVisible}
            >
              <TerminalWorkspace active={terminalVisible} />
            </div>
          )}

          {/* Sayfa katmanı: terminal görünürken gizlenir. */}
          <div
            className={clsx('absolute inset-0 overflow-auto', terminalVisible && 'invisible')}
            aria-hidden={terminalVisible}
          >
            {children}
          </div>
        </main>
      </div>
      <StatusBar auditIndex={auditIndex} />
      <CommandPalette />
    </div>
  );
}
