import { create } from 'zustand';

/**
 * Sol menüdeki bölümler. Panel açıkken hangi içeriğin gösterileceğini
 * belirler; `null` panelin tamamen kapalı olduğu durumdur.
 */
export type NavSection = 'hosts' | 'credentials' | 'connections' | 'quick' | null;

const NAV_STORAGE_KEY = 'sshby.nav';

/**
 * Açılışta panel son bırakıldığı bölümde açılır. Kullanıcı çoğu oturumu aynı
 * bölümde geçiriyor; her açılışta sunucu ağacına dönmek fazladan bir tıklama.
 */
function loadNav(): NavSection {
  try {
    const saved = localStorage.getItem(NAV_STORAGE_KEY);
    if (saved === 'hosts' || saved === 'credentials' || saved === 'connections') return saved;
    if (saved === 'quick' || saved === 'none') return saved === 'none' ? null : saved;
  } catch {
    // Gizli sekmede localStorage erişimi hata verebiliyor.
  }
  return 'hosts';
}

/**
 * Çalışma alanı durumu: sol menü seçimi, seçili sunucu, ağaç filtresi ve
 * komut paleti. Kenar çubuğu, komut paleti ve terminal panelleri aynı seçimi
 * paylaştığı için bileşen ağacında prop olarak taşımak yerine store'da.
 */
interface WorkspaceState {
  /** Sol menüde seçili bölüm; `null` = panel kapalı. */
  nav: NavSection;
  selectedHostId: string | null;
  filter: string;
  paletteOpen: boolean;
  /**
   * Menüden bölüm seçer. Zaten açık olan bölüme tekrar tıklamak paneli
   * kapatır — Termix'teki davranış ve tek düğmeyle aç/kapa sağlıyor.
   */
  toggleNav: (section: Exclude<NavSection, null>) => void;
  /** Paneli koşulsuz olarak belirli bir bölümde açar. */
  openNav: (section: Exclude<NavSection, null>) => void;
  closeNav: () => void;
  setSelectedHostId: (id: string | null) => void;
  setFilter: (value: string) => void;
  setPaletteOpen: (open: boolean) => void;
}

function persist(nav: NavSection): void {
  try {
    localStorage.setItem(NAV_STORAGE_KEY, nav ?? 'none');
  } catch {
    // Kaydedilemezse seçim yalnızca bu oturumda geçerli olur.
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  nav: loadNav(),
  selectedHostId: null,
  filter: '',
  paletteOpen: false,
  toggleNav: (section) =>
    set((state) => {
      const nav = state.nav === section ? null : section;
      persist(nav);
      return { nav };
    }),
  openNav: (section) => {
    persist(section);
    return set({ nav: section });
  },
  closeNav: () => {
    persist(null);
    return set({ nav: null });
  },
  setSelectedHostId: (selectedHostId) => set({ selectedHostId }),
  setFilter: (filter) => set({ filter }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
