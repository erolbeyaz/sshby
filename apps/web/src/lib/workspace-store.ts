import { create } from 'zustand';

/**
 * Çalışma alanı durumu: hangi sunucu seçili, ağaç filtresi ve komut paleti.
 * Kenar çubuğu, komut paleti ve (Faz 3'te) terminal panelleri aynı seçimi
 * paylaşacağı için bileşen ağacında prop olarak taşımak yerine store'a alındı.
 */
interface WorkspaceState {
  selectedHostId: string | null;
  filter: string;
  paletteOpen: boolean;
  setSelectedHostId: (id: string | null) => void;
  setFilter: (value: string) => void;
  setPaletteOpen: (open: boolean) => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  selectedHostId: null,
  filter: '',
  paletteOpen: false,
  setSelectedHostId: (selectedHostId) => set({ selectedHostId }),
  setFilter: (filter) => set({ filter }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
}));
