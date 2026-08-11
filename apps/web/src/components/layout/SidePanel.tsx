import { useEffect, useState } from 'react';
import { ChevronLeftIcon } from 'lucide-react';
import { ConnectionsPanel } from './ConnectionsPanel';
import { CredentialsPanel } from './CredentialsPanel';
import { HostsPanel } from './HostsPanel';
import { QuickConnectPanel } from './QuickConnectPanel';
import { SidebarResizer } from './SidebarResizer';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useWorkspaceStore } from '@/lib/workspace-store';

/**
 * Sol menünün açtığı panel.
 *
 * Tek bir kabuk, içeriği seçili bölüme göre değişiyor: başlık, kapatma
 * düğmesi ve yeniden boyutlandırma her bölümde aynı davransın diye. Genişlik
 * `localStorage`da; kullanıcı bir kez ayarlayıp unutabilmeli.
 */

const TITLE_KEYS: Record<'hosts' | 'credentials' | 'connections' | 'quick', TranslationKey> = {
  hosts: 'nav.hosts',
  credentials: 'nav.vault',
  connections: 'nav.connections',
  quick: 'nav.quickConnect',
};

export function SidePanel() {
  const t = useT();
  const nav = useWorkspaceStore((s) => s.nav);
  const closeNav = useWorkspaceStore((s) => s.closeNav);

  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem('sshby.sidebar.width'));
    return Number.isFinite(stored) && stored >= 240 ? stored : 300;
  });
  useEffect(() => {
    localStorage.setItem('sshby.sidebar.width', String(width));
  }, [width]);

  if (!nav) return null;

  return (
    <>
      <aside
        className="flex shrink-0 flex-col border-r border-line bg-surface"
        style={{ width }}
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
          <h2 className="flex-1 truncate text-[14px] font-semibold tracking-tight">
            {t(TITLE_KEYS[nav])}
          </h2>
          <button
            type="button"
            className="btn-ghost rounded p-1.5"
            onClick={closeNav}
            aria-label={t('nav.collapsePanel')}
            title={t('nav.collapsePanel')}
          >
            <ChevronLeftIcon size={15} />
          </button>
        </div>

        {/*
          Bölümler koşullu render ediliyor; panel içeriğinin DOM'da kalması
          gerekmiyor çünkü hiçbiri canlı bağlantı taşımıyor. Terminal ve dosya
          oturumları `main` altındaki çalışma alanında yaşıyor.
        */}
        {nav === 'hosts' && <HostsPanel />}
        {nav === 'credentials' && <CredentialsPanel />}
        {nav === 'connections' && <ConnectionsPanel />}
        {nav === 'quick' && <QuickConnectPanel />}
      </aside>

      <SidebarResizer width={width} min={240} onChange={setWidth} />
    </>
  );
}
