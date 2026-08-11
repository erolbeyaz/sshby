import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { CommandPalette } from '@/components/CommandPalette';
import { TerminalWorkspace } from '@/components/terminal/TerminalWorkspace';
import { useInventory } from '@/lib/queries';
import { useTerminalStore } from '@/lib/terminal-store';
import { SideNav } from './SideNav';
import { SidePanel } from './SidePanel';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { UserMenu } from './UserMenu';

/**
 * Uygulama kabuğu: üst bar, sol menü, açılır panel, içerik, alt durum çubuğu.
 *
 * Gezinme sol menüye taşındı; üst bar yalnızca marka, sunucu sayısı, denetim
 * rozeti, dil ve hesap için kaldı. Yükseklik zinciri `h-screen` + `min-h-0`
 * ile kuruldu — terminal panelinin sayfayı taşırmadan kendi içinde kaymasını
 * sağlayan şey bu.
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
  const hasTabs = useTerminalStore(
    (s) =>
      s.tabs.length > 0 ||
      s.fileTabs.length > 0 ||
      s.metricTabs.length > 0 ||
      s.historyTabs.length > 0,
  );
  const { pathname } = useLocation();

  /**
   * Terminal, yönlendirici çıktısının DIŞINDA ve her zaman bağlı duruyor.
   *
   * Önceden ana sayfanın içinde yaşıyordu; kasaya ya da sunucu ayrıntısına
   * geçmek React'in onu DOM'dan sökmesine, dolayısıyla WebSocket'lerin
   * kapanmasına ve tüm SSH oturumlarının ölmesine yol açıyordu. Sekmeler arası
   * geçişte uyguladığımız kuralın aynısı burada da geçerli: terminal asla
   * sökülmez, yalnızca gizlenir.
   *
   * `/dashboard` bilinçli olarak dışarıda: açık oturumu olan kullanıcı da
   * özetlere bakabilmeli, bunun için oturumlarını kapatmak zorunda kalmamalı.
   */
  const terminalVisible = pathname === '/' && hasTabs;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-bg">
      <TopBar
        hostCount={inventory.data?.hosts.length ?? 0}
        auditEnabled={auditEnabled}
        right={<UserMenu />}
      />
      <div className="flex min-h-0 flex-1">
        <SideNav />
        <SidePanel />

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
