import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  KeyRoundIcon,
  LayoutDashboardIcon,
  PlugZapIcon,
  ServerIcon,
  TerminalIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useWorkspaceStore, type NavSection } from '@/lib/workspace-store';

/**
 * Sol dikey menü.
 *
 * İki tür öğe var: **panel açanlar** (sunucular, kimlik bilgileri, bağlantılar,
 * hızlı bağlantı) ve **sayfaya götürenler** (gösterge paneli, terminal).
 * Yönetim işleri (kullanıcılar, denetim, yapılandırma aktarımı) bilinçli olarak
 * burada değil — hesap menüsünde. Günlük kullanımda girilmeyen bölümler
 * birincil gezinmede yer kaplamamalı.
 *
 * Seçili öğe vurgulu durur ve panel açan öğelerin içeriği hemen sağdaki
 * panelde görünür.
 */

interface PanelItem {
  section: Exclude<NavSection, null>;
  icon: LucideIcon;
  labelKey: TranslationKey;
}

const PANEL_ITEMS: PanelItem[] = [
  { section: 'hosts', icon: ServerIcon, labelKey: 'nav.hosts' },
  { section: 'credentials', icon: KeyRoundIcon, labelKey: 'nav.vault' },
  { section: 'connections', icon: PlugZapIcon, labelKey: 'nav.connections' },
  { section: 'quick', icon: ZapIcon, labelKey: 'nav.quickConnect' },
];

export function SideNav() {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nav = useWorkspaceStore((s) => s.nav);
  const toggleNav = useWorkspaceStore((s) => s.toggleNav);

  return (
    <nav
      className="flex w-[168px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface-2 p-2"
      aria-label={t('nav.sections')}
    >
      <NavButton
        icon={TerminalIcon}
        label={t('nav.terminal')}
        active={pathname === '/'}
        onClick={() => navigate('/')}
      />
      <NavButton
        icon={LayoutDashboardIcon}
        label={t('nav.dashboard')}
        active={pathname === '/dashboard'}
        onClick={() => navigate('/dashboard')}
      />

      <div className="my-1.5 border-t border-line" />

      {PANEL_ITEMS.map((item) => (
        <NavButton
          key={item.section}
          icon={item.icon}
          label={t(item.labelKey)}
          active={nav === item.section}
          onClick={() => toggleNav(item.section)}
        />
      ))}
    </nav>
  );
}

function NavButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        'flex items-center gap-2.5 rounded px-2.5 py-2 text-left text-[12.5px] transition-colors',
        active
          ? // Seçili öğe vurgulu kalır: panelde ne olduğunu menüye bakarak
            // anlamak, panelin başlığını okumaktan hızlı.
            'bg-accent-muted text-accent'
          : 'text-fg-dim hover:bg-surface hover:text-fg',
      )}
    >
      <Icon size={14} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </button>
  );
}
