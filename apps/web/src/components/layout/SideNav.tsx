import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import {
  ArrowDownUpIcon,
  DatabaseIcon,
  KeyRoundIcon,
  PlugZapIcon,
  ServerIcon,
  ShieldIcon,
  ZapIcon,
  type LucideIcon,
} from 'lucide-react';
import { ConfigTransferDialog } from '@/components/dialogs/ConfigTransferDialog';
import { useAuthStore } from '@/lib/auth-store';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useWorkspaceStore, type NavSection } from '@/lib/workspace-store';

/**
 * Sol dikey menü.
 *
 * Uygulamanın birincil gezinmesi buraya taşındı; üst bar yalnızca kimlik,
 * durum ve dil için kaldı. Gerekçe: bölüm sayısı arttıkça yatay bir çubuk
 * dar ekranlarda taşıyor, dikey liste ise sınırsız büyüyebiliyor ve her
 * öğenin adı görünür kalıyor.
 *
 * Seçili öğe vurgulu durur ve içeriği hemen sağdaki panelde açılır — panel
 * ayrı bir sayfa değil, terminal her zaman ayakta kalsın diye.
 */

interface NavItem {
  section: Exclude<NavSection, null>;
  icon: LucideIcon;
  labelKey: TranslationKey;
}

const ITEMS: NavItem[] = [
  { section: 'hosts', icon: ServerIcon, labelKey: 'nav.hosts' },
  { section: 'credentials', icon: KeyRoundIcon, labelKey: 'nav.vault' },
  { section: 'connections', icon: PlugZapIcon, labelKey: 'nav.connections' },
  { section: 'quick', icon: ZapIcon, labelKey: 'nav.quickConnect' },
];

export function SideNav() {
  const t = useT();
  const navigate = useNavigate();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const nav = useWorkspaceStore((s) => s.nav);
  const toggleNav = useWorkspaceStore((s) => s.toggleNav);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <>
      <nav
        className="flex w-[168px] shrink-0 flex-col gap-0.5 border-r border-line bg-surface-2 p-2"
        aria-label={t('nav.sections')}
      >
        {ITEMS.map((item) => (
          <NavButton
            key={item.section}
            icon={item.icon}
            label={t(item.labelKey)}
            active={nav === item.section}
            onClick={() => toggleNav(item.section)}
          />
        ))}

        <div className="my-1.5 border-t border-line" />

        <NavButton
          icon={ArrowDownUpIcon}
          label={t('user.configTransfer')}
          active={false}
          onClick={() => setConfigOpen(true)}
        />

        {isAdmin && (
          <>
            <NavButton
              icon={ShieldIcon}
              label={t('user.manageUsers')}
              active={false}
              onClick={() => navigate('/admin/users')}
            />
            <NavButton
              icon={DatabaseIcon}
              label={t('user.auditStream')}
              active={false}
              onClick={() => navigate('/admin/audit')}
            />
          </>
        )}
      </nav>

      {configOpen && <ConfigTransferDialog onClose={() => setConfigOpen(false)} />}
    </>
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
