import { create } from 'zustand';

/**
 * Açık terminal sekmeleri.
 *
 * Oturumun kendisi (WebSocket + xterm) bileşenin içinde yaşıyor; burada
 * yalnızca hangi sekmelerin açık olduğu tutuluyor. Kritik nokta: sekmeler
 * DOM'dan sökülmez, yalnızca gizlenir — sökülseydi WebSocket kapanır ve
 * kullanıcının oturumu kaybolurdu.
 */

export type SessionState = 'connecting' | 'ready' | 'closed' | 'error';

export interface TerminalTab {
  /** Sekme kimliği — aynı sunucuya birden çok oturum açılabilir. */
  id: string;
  hostId: string;
  title: string;
  state: SessionState;
  /** Durum çubuğunda gösterilecek son hata. */
  error: string | null;
  openedAt: number;
}

export type LayoutMode = 'tabs' | 'grid';

/** Açık bir dosya gezgini paneli. */
export interface FileTab {
  id: string;
  hostId: string;
  title: string;
}

interface TerminalState {
  tabs: TerminalTab[];
  activeTabId: string | null;
  layout: LayoutMode;
  /**
   * Izgara sütun/satır payları (yüzde, toplamı 100). Uzunluk ızgaranın o anki
   * boyutuna eşit değilse bileşen eşit dağılıma düşer — panel sayısı
   * değiştiğinde eski oranlar anlamsız kalıyor.
   */
  gridColumns: number[];
  gridRows: number[];
  setGridSizes: (axis: 'column' | 'row', sizes: number[]) => void;
  /**
   * Açık dosya panelleri. Terminal sekmeleriyle aynı kural: her biri kendi
   * sunucusuna bağlı ve bağımsız yaşıyor. Önceden tek panel etkin sekmeyi
   * izliyordu, bu yüzden iki sunucunun dosyalarına aynı anda bakmak mümkün
   * değildi.
   */
  fileTabs: FileTab[];
  activeFileTabId: string | null;
  openFileTab: (hostId: string, title: string) => void;
  closeFileTab: (id: string) => void;
  setActiveFileTab: (id: string) => void;
  /** Açık metrik panoları — dosya panelleriyle aynı bağımsızlık kuralı. */
  metricTabs: FileTab[];
  activeMetricTabId: string | null;
  openMetricTab: (hostId: string, title: string) => void;
  closeMetricTab: (id: string) => void;
  setActiveMetricTab: (id: string) => void;
  /** Açık komut geçmişi panelleri. */
  historyTabs: FileTab[];
  activeHistoryTabId: string | null;
  openHistoryTab: (hostId: string, title: string) => void;
  closeHistoryTab: (id: string) => void;
  setActiveHistoryTab: (id: string) => void;
  /*
   * Bağlantılar ve hızlı bağlantı panellerinin açıklığı buradan kaldırıldı;
   * sol menü seçimi tek kaynak (`workspace-store` → `nav`). İki ayrı bayrak
   * varken menüdeki vurgu ile panelin gerçek durumu ayrışabiliyordu.
   */
  openTab: (hostId: string, title: string) => string;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  setLayout: (layout: LayoutMode) => void;
  patchTab: (id: string, patch: Partial<TerminalTab>) => void;
  /** Sürükle-bırak sonrası sıralama; ızgara yerleşimi de bu sırayı izler. */
  moveTab: (activeId: string, overId: string) => void;
}

/** Aynı anda açılabilecek sekme sayısı — sunucudaki oturum sınırıyla uyumlu. */
const MAX_TABS = 12;

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  layout: 'tabs',
  gridColumns: [],
  gridRows: [],
  /** Dosya paneli açıksa hangi sunucuya bakıyor — bağlantı listesi bunu gösteriyor. */
  fileTabs: [],
  activeFileTabId: null,

  /** Aynı sunucu için ikinci panel açmak yerine var olana odaklanılır. */
  openFileTab: (hostId, title) => {
    const { fileTabs } = get();
    const existing = fileTabs.find((tab) => tab.hostId === hostId);
    if (existing) {
      set({ activeFileTabId: existing.id });
      return;
    }
    const id = crypto.randomUUID();
    set({ fileTabs: [...fileTabs, { id, hostId, title }], activeFileTabId: id });
  },

  closeFileTab: (id) => {
    const { fileTabs, activeFileTabId } = get();
    const index = fileTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = fileTabs.filter((tab) => tab.id !== id);
    const nextActive =
      activeFileTabId === id ? (next[index] ?? next[index - 1])?.id ?? null : activeFileTabId;
    set({ fileTabs: next, activeFileTabId: nextActive });
  },

  setActiveFileTab: (id) => set({ activeFileTabId: id }),

  metricTabs: [],
  activeMetricTabId: null,

  openMetricTab: (hostId, title) => {
    const { metricTabs } = get();
    const existing = metricTabs.find((tab) => tab.hostId === hostId);
    if (existing) {
      set({ activeMetricTabId: existing.id });
      return;
    }
    const id = crypto.randomUUID();
    set({ metricTabs: [...metricTabs, { id, hostId, title }], activeMetricTabId: id });
  },

  closeMetricTab: (id) => {
    const { metricTabs, activeMetricTabId } = get();
    const index = metricTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = metricTabs.filter((tab) => tab.id !== id);
    const nextActive =
      activeMetricTabId === id ? (next[index] ?? next[index - 1])?.id ?? null : activeMetricTabId;
    set({ metricTabs: next, activeMetricTabId: nextActive });
  },

  setActiveMetricTab: (id) => set({ activeMetricTabId: id }),

  historyTabs: [],
  activeHistoryTabId: null,

  openHistoryTab: (hostId, title) => {
    const { historyTabs } = get();
    const existing = historyTabs.find((tab) => tab.hostId === hostId);
    if (existing) {
      set({ activeHistoryTabId: existing.id });
      return;
    }
    const id = crypto.randomUUID();
    set({ historyTabs: [...historyTabs, { id, hostId, title }], activeHistoryTabId: id });
  },

  closeHistoryTab: (id) => {
    const { historyTabs, activeHistoryTabId } = get();
    const index = historyTabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const next = historyTabs.filter((tab) => tab.id !== id);
    const nextActive =
      activeHistoryTabId === id ? (next[index] ?? next[index - 1])?.id ?? null : activeHistoryTabId;
    set({ historyTabs: next, activeHistoryTabId: nextActive });
  },

  setActiveHistoryTab: (id) => set({ activeHistoryTabId: id }),

  setGridSizes: (axis, sizes) =>
    set(axis === 'column' ? { gridColumns: sizes } : { gridRows: sizes }),

  openTab: (hostId, title) => {
    const id = crypto.randomUUID();
    const tabs = get().tabs;
    if (tabs.length >= MAX_TABS) {
      // Sessizce görmezden gelmek yerine en eskisini kapatmak da bir seçenekti;
      // kullanıcının çalışan bir oturumunu habersiz kapatmak kabul edilemez.
      return '';
    }

    /**
     * Aynı sunucuya birden çok oturum açmak normal bir ihtiyaç (biri log
     * izler, diğeri komut çalıştırır). Sekmeleri numaralandırmazsak hepsi
     * aynı adı taşır ve hangisinin hangisi olduğu anlaşılmaz.
     */
    const sameHostCount = tabs.filter((tab) => tab.hostId === hostId).length;
    const label = sameHostCount === 0 ? title : `${title} (${sameHostCount + 1})`;

    set({
      tabs: [
        ...tabs,
        { id, hostId, title: label, state: 'connecting', error: null, openedAt: Date.now() },
      ],
      activeTabId: id,
    });
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    const next = tabs.filter((t) => t.id !== id);
    // Kapatılan sekme etkinse komşusuna geç — kullanıcı boş ekranla kalmasın.
    const nextActive =
      activeTabId === id ? (next[index] ?? next[index - 1])?.id ?? null : activeTabId;

    set({ tabs: next, activeTabId: nextActive });
  },

  setActive: (id) => set({ activeTabId: id }),
  setLayout: (layout) => set({ layout }),

  patchTab: (id, patch) =>
    set((state) => ({
      tabs: state.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    })),

  moveTab: (activeId, overId) =>
    set((state) => {
      const from = state.tabs.findIndex((t) => t.id === activeId);
      const to = state.tabs.findIndex((t) => t.id === overId);
      if (from === -1 || to === -1 || from === to) return state;

      // Diziyi yeniden kurmak yerine tek öğeyi taşıyoruz: nesne kimlikleri
      // korunuyor, dolayısıyla terminal panelleri yeniden bağlanmıyor.
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(from, 1);
      if (moved) tabs.splice(to, 0, moved);
      return { tabs };
    }),
}));

/** Ağaçtaki nokta için sunucunun bağlantı durumu. */
export type HostConnectionState = 'connected' | 'connecting' | 'disconnected';

/**
 * Bir sunucunun durumu, o sunucuya ait sekmelerin en iyi durumudur: aynı
 * sunucuya birden çok oturum açılabildiği için biri bağlıysa sunucu bağlı
 * sayılır. Kapanmış ya da hata almış sekmeler bağlantısız kabul edilir —
 * kullanıcı için anlamlı olan "şu an erişimim var mı" sorusu.
 */
export function hostConnectionState(
  tabs: TerminalTab[],
  hostId: string,
): HostConnectionState {
  let connecting = false;

  for (const tab of tabs) {
    if (tab.hostId !== hostId) continue;
    if (tab.state === 'ready') return 'connected';
    if (tab.state === 'connecting') connecting = true;
  }

  return connecting ? 'connecting' : 'disconnected';
}
