import { useEffect, useRef, useState } from 'react';
import { ChevronLeftIcon } from 'lucide-react';
import clsx from 'clsx';
import { ConnectionsPanel } from './ConnectionsPanel';
import { CredentialsPanel } from './CredentialsPanel';
import { HostsPanel } from './HostsPanel';
import { QuickConnectPanel } from './QuickConnectPanel';
import { SidebarResizer } from './SidebarResizer';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useWorkspaceStore, type NavSection } from '@/lib/workspace-store';

/**
 * Sol menünün açtığı panel.
 *
 * Tek bir kabuk, içeriği seçili bölüme göre değişiyor: başlık, kapatma
 * düğmesi ve yeniden boyutlandırma her bölümde aynı davransın diye. Genişlik
 * `localStorage`da; kullanıcı bir kez ayarlayıp unutabilmeli.
 *
 * Açılış/kapanış genişlik animasyonuyla yapılıyor. Panel bir anda belirip
 * kaybolduğunda içeriğin nereden geldiği gözle takip edilemiyordu; kayarak
 * açılmak paneli menüye görsel olarak bağlıyor. `motion-reduce` altında
 * animasyon kapanır — hareket hassasiyeti olan kullanıcılar için.
 */

type Section = Exclude<NavSection, null>;

const TITLE_KEYS: Record<Section, TranslationKey> = {
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

  /**
   * Kapanırken içerik son bölümde kalır: `nav` hemen `null` oluyor ama panel
   * daralma animasyonunu tamamlayana kadar bir şey göstermeli, yoksa boş bir
   * kutu kayarak kapanır.
   */
  const lastSection = useRef<Section>('hosts');
  if (nav) lastSection.current = nav;
  const section = nav ?? lastSection.current;

  const open = nav !== null;

  /**
   * İçerik, kapanma animasyonu bitene kadar bağlı kalır; sonra sökülür.
   * Sürekli bağlı bırakmak, sıfır genişlikli bir panelin düğmelerini sekme
   * sırasında tutardı — klavyeyle gezen kullanıcı görünmeyen öğelere takılır.
   */
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(timer);
  }, [open]);

  return (
    <>
      <aside
        className={clsx(
          'flex shrink-0 flex-col overflow-hidden border-line bg-surface',
          'transition-[width] duration-200 ease-out motion-reduce:transition-none',
          open && 'border-r',
        )}
        style={{ width: open ? width : 0 }}
        aria-hidden={!open}
      >
        {/* Sabit genişlikli sarmalayıcı: panel daralırken içerik sıkışıp
            yeniden akmasın, olduğu gibi kayarak çıksın. */}
        {mounted && (
          <div className="flex h-full min-h-0 flex-col" style={{ width }}>
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3">
              <h2 className="flex-1 truncate text-[14px] font-semibold tracking-tight">
                {t(TITLE_KEYS[section])}
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

            {section === 'hosts' && <HostsPanel />}
            {section === 'credentials' && <CredentialsPanel />}
            {section === 'connections' && <ConnectionsPanel />}
            {section === 'quick' && <QuickConnectPanel />}
          </div>
        )}
      </aside>

      {open && <SidebarResizer width={width} min={240} onChange={setWidth} />}
    </>
  );
}
