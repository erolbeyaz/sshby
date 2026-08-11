import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import {
  Columns2Icon,
  FolderIcon,
  GripVerticalIcon,
  GaugeIcon,
  HistoryIcon,
  SquareIcon,
  TerminalIcon,
  XIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { HistoryPanel } from '@/components/history/HistoryPanel';
import { MetricsPanel } from '@/components/metrics/MetricsPanel';
import { FileManager } from '@/components/sftp/FileManager';
import { useT, type TranslationKey } from '@/lib/i18n';
import { useTerminalStore, type SessionState, type TerminalTab } from '@/lib/terminal-store';
import { GridSplitter } from './GridSplitter';
import { PanelResizer } from './PanelResizer';
import { TerminalPane } from './TerminalPane';

/** Durum noktası rengi — kenar çubuğundaki sunucu noktalarıyla aynı dil. */
const STATE_COLOR: Record<SessionState, string> = {
  connecting: 'bg-warn animate-pulse',
  ready: 'bg-accent',
  closed: 'bg-[#4A4A4A]',
  error: 'bg-danger',
};

const STATE_LABEL: Record<SessionState, TranslationKey> = {
  connecting: 'terminal.stateConnecting',
  ready: 'terminal.stateReady',
  closed: 'terminal.stateClosed',
  error: 'terminal.stateError',
};

/**
 * Sürüklenebilir öğe kimlikleri iki listede de benzersiz olmalı: sekme çubuğu
 * ve ızgara başlıkları aynı DndContext içinde yaşıyor.
 */
const tabItemId = (id: string) => `tab:${id}`;
const paneItemId = (id: string) => `pane:${id}`;
const stripPrefix = (id: string) => id.slice(id.indexOf(':') + 1);

/** Bir panelin inebileceği en küçük pay (yüzde). Altında xterm ölçümü bozulur. */
const MIN_TRACK_PERCENT = 8;

function evenSplit(count: number): number[] {
  return Array.from({ length: count }, () => 100 / count);
}

/** Ayırıcı konumları: her komşu çift arasındaki kümülatif yüzde. */
function boundaries(sizes: number[]): { index: number; position: number }[] {
  const result: { index: number; position: number }[] = [];
  let cumulative = 0;
  for (let i = 0; i < sizes.length - 1; i += 1) {
    cumulative += sizes[i] ?? 0;
    result.push({ index: i, position: cumulative });
  }
  return result;
}

/**
 * `index` ile `index+1` arasındaki sınırı `position`a taşır.
 *
 * Yalnızca bu iki iz değişir, toplamları sabit kalır — böylece bir ayırıcıyı
 * çekmek uzaktaki panellerin boyutunu bozmaz. Kullanıcı bir sınırı sürüklerken
 * ekranın öteki ucundaki panelin kayması sinir bozucu olurdu.
 */
function resize(sizes: number[], index: number, position: number): number[] {
  const before = sizes.slice(0, index).reduce((sum, s) => sum + s, 0);
  const pairTotal = (sizes[index] ?? 0) + (sizes[index + 1] ?? 0);

  const first = Math.min(
    Math.max(position - before, MIN_TRACK_PERCENT),
    pairTotal - MIN_TRACK_PERCENT,
  );

  const next = [...sizes];
  next[index] = first;
  next[index + 1] = pairTotal - first;
  return next;
}

export function TerminalWorkspace({
  /** Kabuk, terminal katmanını gizlediğinde false olur; ölçüm buna bağlı. */
  active,
}: {
  active: boolean;
}) {
  const t = useT();
  const tabs = useTerminalStore((s) => s.tabs);
  const activeTabId = useTerminalStore((s) => s.activeTabId);
  const layout = useTerminalStore((s) => s.layout);
  const setActive = useTerminalStore((s) => s.setActive);
  const setLayout = useTerminalStore((s) => s.setLayout);
  const closeTab = useTerminalStore((s) => s.closeTab);
  const moveTab = useTerminalStore((s) => s.moveTab);
  const storedColumns = useTerminalStore((s) => s.gridColumns);
  const storedRows = useTerminalStore((s) => s.gridRows);
  const setGridSizes = useTerminalStore((s) => s.setGridSizes);

  const gridRef = useRef<HTMLDivElement>(null);
  const fileTabs = useTerminalStore((s) => s.fileTabs);
  const activeFileTabId = useTerminalStore((s) => s.activeFileTabId);
  const openFileTab = useTerminalStore((s) => s.openFileTab);
  const closeFileTab = useTerminalStore((s) => s.closeFileTab);
  const setActiveFileTab = useTerminalStore((s) => s.setActiveFileTab);
  const metricTabs = useTerminalStore((s) => s.metricTabs);
  const activeMetricTabId = useTerminalStore((s) => s.activeMetricTabId);
  const closeMetricTab = useTerminalStore((s) => s.closeMetricTab);
  const setActiveMetricTab = useTerminalStore((s) => s.setActiveMetricTab);
  const historyTabs = useTerminalStore((s) => s.historyTabs);
  const activeHistoryTabId = useTerminalStore((s) => s.activeHistoryTabId);
  const closeHistoryTab = useTerminalStore((s) => s.closeHistoryTab);
  const setActiveHistoryTab = useTerminalStore((s) => s.setActiveHistoryTab);
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0] ?? null;
  const panelWidths = useTerminalStore((s) => s.panelWidths);
  const setPanelWidth = useTerminalStore((s) => s.setPanelWidth);

  /**
   * Bir panel tek başınaysa alanı doldurur (sürüklenecek bir sınır yok);
   * yanında başka bir şey varsa sabit genişlikte durur ve sınırı sürüklenebilir.
   */
  const onlyHistory = tabs.length === 0 && fileTabs.length === 0 && metricTabs.length === 0;
  const onlyMetrics = tabs.length === 0 && fileTabs.length === 0;
  const onlyFiles = tabs.length === 0;

  /**
   * Etkin terminal değişince, o sunucunun dosya paneli **açıksa** öne gelir.
   *
   * Panel kendiliğinden açılmaz: kullanıcı dosya paneli istemediyse sekme
   * değiştirmek onu açmamalı. Ama açıksa, terminalde baktığı sunucudan başka
   * bir sunucunun dosyalarını göstermesi kafa karıştırıcıydı.
   */
  const setActiveFileTabRef = useRef(setActiveFileTab);
  setActiveFileTabRef.current = setActiveFileTab;
  useEffect(() => {
    if (!activeTabId) return;
    const host = tabs.find((tab) => tab.id === activeTabId)?.hostId;
    if (!host) return;
    const match = fileTabs.find((tab) => tab.hostId === host);
    if (match && match.id !== activeFileTabId) setActiveFileTabRef.current(match.id);
  }, [activeTabId, activeFileTabId, fileTabs, tabs]);

  /**
   * Izgara boyutu panel sayısından türer: kare köküne yuvarlanmış sütun sayısı,
   * kalanı kadar satır. Sabit 2×2 iken dörtten fazla panel taşıp görünmez
   * oluyordu.
   *
   *   1 → 1×1    3-4 → 2×2    7-9  → 3×3
   *   2 → 2×1    5-6 → 3×2    10-12 → 4×3
   */
  const columnCount = Math.max(1, Math.ceil(Math.sqrt(tabs.length)));
  const rowCount = Math.max(1, Math.ceil(tabs.length / columnCount));

  /**
   * Saklanan paylar yalnızca uzunluk uyuşuyorsa kullanılır; panel sayısı
   * değiştiğinde eski oranlar anlamsız olduğu için eşit dağılıma dönülür.
   */
  const columnSizes = useMemo(
    () => (storedColumns.length === columnCount ? storedColumns : evenSplit(columnCount)),
    [storedColumns, columnCount],
  );
  const rowSizes = useMemo(
    () => (storedRows.length === rowCount ? storedRows : evenSplit(rowCount)),
    [storedRows, rowCount],
  );

  const gridStyle: CSSProperties = {
    gridTemplateColumns: columnSizes.map((s) => `${s}%`).join(' '),
    gridTemplateRows: rowSizes.map((s) => `${s}%`).join(' '),
  };

  const sensors = useSensors(
    // Eşik olmadan her tıklama sürükleme sayılır ve sekme seçilemez olur.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  /**
   * Dosya panelleri terminalden bağımsız yaşayabilmeli.
   *
   * Önceden burada yalnızca terminal sekmelerine bakılıyordu; terminal
   * kapatıldığında (ya da hiç açılmadığında) çalışma alanı komple çizilmiyor
   * ve açık dosya panelleri görünmez oluyordu.
   */
  if (
    tabs.length === 0 &&
    fileTabs.length === 0 &&
    metricTabs.length === 0 &&
    historyTabs.length === 0
  ) {
    return null;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;
    moveTab(stripPrefix(String(dragged.id)), stripPrefix(String(over.id)));
  }

  /**
   * Kritik: TÜM sekmeler her zaman render edilir, yalnızca görünürlükleri
   * değişir. Etkin olmayanı DOM'dan sökmek WebSocket'i kapatır ve kullanıcının
   * çalışan oturumu kaybolur.
   */
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={clsx(
            'flex items-center gap-1 border-b border-line bg-surface px-2 py-1',
            tabs.length === 0 && 'hidden',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <SortableContext
              items={tabs.map((t) => tabItemId(t.id))}
              strategy={horizontalListSortingStrategy}
            >
              {tabs.map((tab) => (
                <SortableTab
                  key={tab.id}
                  tab={tab}
                  highlighted={tab.id === activeTabId}
                  gridMode={layout === 'grid'}
                  onSelect={() => setActive(tab.id)}
                  onClose={() => closeTab(tab.id)}
                />
              ))}
            </SortableContext>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 border-l border-line pl-1.5">
            <button
              type="button"
              className={clsx('btn-ghost rounded p-1.5', fileTabs.length > 0 && 'text-accent')}
              onClick={() => {
                if (activeTab) openFileTab(activeTab.hostId, activeTab.title);
              }}
              aria-label={t('terminal.fileManager')}
              aria-pressed={fileTabs.length > 0}
              title={t('terminal.fileManagerTitle')}
            >
              <FolderIcon size={13} />
            </button>
            <button
              type="button"
              className={clsx('btn-ghost rounded p-1.5', layout === 'tabs' && 'text-accent')}
              onClick={() => setLayout('tabs')}
              aria-label={t('terminal.singleWindow')}
              aria-pressed={layout === 'tabs'}
              title={t('terminal.singleWindow')}
            >
              <SquareIcon size={13} />
            </button>
            <button
              type="button"
              className={clsx('btn-ghost rounded p-1.5', layout === 'grid' && 'text-accent')}
              onClick={() => setLayout('grid')}
              aria-label={t('terminal.splitView')}
              aria-pressed={layout === 'grid'}
              title={t('terminal.splitViewTitle')}
            >
              <Columns2Icon size={13} />
            </button>
          </div>
        </div>

      <div className="flex min-h-0 flex-1">
        <div
          ref={gridRef}
          className={clsx(
            'relative min-h-0',
            // Terminal yokken ızgara alanı yer kaplamamalı; panel tüm genişliği alsın.
            tabs.length === 0 ? 'hidden' : 'flex-1',
            layout === 'grid' && 'grid gap-px bg-line',
          )}
          style={layout === 'grid' ? gridStyle : undefined}
        >
          <SortableContext items={tabs.map((t) => paneItemId(t.id))} strategy={rectSortingStrategy}>
            {tabs.map((tab) => (
              <Pane
                key={tab.id}
                tab={tab}
                gridMode={layout === 'grid'}
                visible={active && (layout === 'grid' || tab.id === activeTabId)}
                onClose={() => closeTab(tab.id)}
              />
            ))}
          </SortableContext>

          {/* Her komşu sütun/satır çifti arasına bir ayırıcı. */}
          {layout === 'grid' &&
            boundaries(columnSizes).map(({ index, position }) => (
              <GridSplitter
                key={`col-${index}`}
                orientation="vertical"
                percent={position}
                containerRef={gridRef}
                onChange={(p) => setGridSizes('column', resize(columnSizes, index, p))}
                onReset={() => setGridSizes('column', evenSplit(columnCount))}
              />
            ))}
          {layout === 'grid' &&
            boundaries(rowSizes).map(({ index, position }) => (
              <GridSplitter
                key={`row-${index}`}
                orientation="horizontal"
                percent={position}
                containerRef={gridRef}
                onChange={(p) => setGridSizes('row', resize(rowSizes, index, p))}
                onReset={() => setGridSizes('row', evenSplit(rowCount))}
              />
            ))}
        </div>

        {/**
         * Dosya paneli etkin sekmenin sunucusunu izler. Sekme başına ayrı
         * panel açmak yerine tek panelin takip etmesi hem daha az yer kaplıyor
         * hem de "hangi sunucunun dosyalarına bakıyorum" sorusunu ortadan
         * kaldırıyor.
         */}
        {historyTabs.length > 0 && (
          <>
            {/* Tek panel açıksa alanı doldurur; başka panel varsa sınır
                sürüklenebilir olmalı. */}
            {!onlyHistory && (
              <PanelResizer
                width={panelWidths.history}
                onChange={(w) => setPanelWidth('history', w)}
                onReset={() => setPanelWidth('history', 380)}
              />
            )}
            <div
              className={clsx(
                'flex min-w-[320px] flex-col border-l border-line',
                onlyHistory && 'flex-1',
              )}
              style={onlyHistory ? undefined : { width: panelWidths.history, flexShrink: 0 }}
            >
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1">
              {historyTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx(
                    'group flex shrink-0 items-center gap-2 rounded px-2.5 py-1 transition-colors',
                    tab.id === activeHistoryTabId
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-dim hover:bg-surface-2',
                  )}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    closeHistoryTab(tab.id);
                  }}
                >
                  <button
                    type="button"
                    className="flex items-center gap-2"
                    onClick={() => setActiveHistoryTab(tab.id)}
                  >
                    <HistoryIcon size={12} className="shrink-0" aria-hidden="true" />
                    <span className="max-w-[140px] truncate font-mono text-[12px]">
                      {tab.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-line hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => closeHistoryTab(tab.id)}
                    aria-label={t('terminal.closeHistoryPanel', { name: tab.title })}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              ))}
            </div>

            <div className="relative min-h-0 flex-1">
              {historyTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx('absolute inset-0', tab.id !== activeHistoryTabId && 'invisible')}
                  aria-hidden={tab.id !== activeHistoryTabId}
                >
                  <HistoryPanel
                    hostId={tab.hostId}
                    hostName={tab.title}
                    onClose={() => closeHistoryTab(tab.id)}
                  />
                </div>
              ))}
            </div>
            </div>
          </>
        )}

        {metricTabs.length > 0 && (
          <>
            {!onlyMetrics && (
              <PanelResizer
                width={panelWidths.metric}
                onChange={(w) => setPanelWidth('metric', w)}
                onReset={() => setPanelWidth('metric', 420)}
              />
            )}
            <div
              className={clsx(
                'flex min-w-[320px] flex-col border-l border-line',
                onlyMetrics && 'flex-1',
              )}
              style={onlyMetrics ? undefined : { width: panelWidths.metric, flexShrink: 0 }}
            >
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1">
              {metricTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx(
                    'group flex shrink-0 items-center gap-2 rounded px-2.5 py-1 transition-colors',
                    tab.id === activeMetricTabId
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-dim hover:bg-surface-2',
                  )}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    closeMetricTab(tab.id);
                  }}
                >
                  <button
                    type="button"
                    className="flex items-center gap-2"
                    onClick={() => setActiveMetricTab(tab.id)}
                  >
                    <GaugeIcon size={12} className="shrink-0" aria-hidden="true" />
                    <span className="max-w-[160px] truncate font-mono text-[12px]">
                      {tab.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-line hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => closeMetricTab(tab.id)}
                    aria-label={t('terminal.closeMetricsPanel', { name: tab.title })}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              ))}
            </div>

            <div className="relative min-h-0 flex-1">
              {metricTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx('absolute inset-0', tab.id !== activeMetricTabId && 'invisible')}
                  aria-hidden={tab.id !== activeMetricTabId}
                >
                  <MetricsPanel
                    hostId={tab.hostId}
                    hostName={tab.title}
                    onClose={() => closeMetricTab(tab.id)}
                  />
                </div>
              ))}
            </div>
            </div>
          </>
        )}

        {fileTabs.length > 0 && (
          <>
            {!onlyFiles && (
              <PanelResizer
                width={panelWidths.file}
                onChange={(w) => setPanelWidth('file', w)}
                onReset={() => setPanelWidth('file', 560)}
              />
            )}
            {/* Ağaç + tablo düzeni için geniş alan gerekiyor; dar panelde
                sütunlar okunmaz hâle geliyordu — bu yüzden alt sınır yüksek. */}
            <div
              className={clsx(
                'flex min-w-[420px] flex-col border-l border-line',
                onlyFiles && 'flex-1',
              )}
              style={onlyFiles ? undefined : { width: panelWidths.file, flexShrink: 0 }}
            >
            {/* Birden çok sunucunun dosyalarına aynı anda bakılabilsin diye
                dosya panellerinin kendi sekme şeridi var. */}
            <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-surface px-2 py-1">
              {fileTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx(
                    'group flex shrink-0 items-center gap-2 rounded px-2.5 py-1 transition-colors',
                    tab.id === activeFileTabId
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-dim hover:bg-surface-2',
                  )}
                  onMouseDown={(event) => {
                    if (event.button === 1) event.preventDefault();
                  }}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    closeFileTab(tab.id);
                  }}
                >
                  <button
                    type="button"
                    className="flex items-center gap-2"
                    onClick={() => setActiveFileTab(tab.id)}
                  >
                    <FolderIcon size={12} className="shrink-0" aria-hidden="true" />
                    <span className="max-w-[160px] truncate font-mono text-[12px]">
                      {tab.title}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rounded p-0.5 opacity-0 transition-opacity hover:bg-line hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                    onClick={() => closeFileTab(tab.id)}
                    aria-label={t('terminal.closeFilePanel', { name: tab.title })}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              ))}
            </div>

            {/* Paneller sökülmez, yalnızca gizlenir: yol, sudo kipi ve açık
                ağaç dalları sekme değiştirince kaybolmasın. */}
            <div className="relative min-h-0 flex-1">
              {fileTabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx(
                    'absolute inset-0',
                    tab.id !== activeFileTabId && 'invisible',
                  )}
                  aria-hidden={tab.id !== activeFileTabId}
                >
                  <FileManager
                    hostId={tab.hostId}
                    hostName={tab.title}
                    onClose={() => closeFileTab(tab.id)}
                  />
                </div>
              ))}
            </div>
            </div>
          </>
        )}
      </div>
      </div>
    </DndContext>
  );
}

/** Izgara/sekme paneli. Izgara modunda başlığından tutup taşınabilir. */
function Pane({
  tab,
  gridMode,
  visible,
  onClose,
}: {
  tab: TerminalTab;
  gridMode: boolean;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: paneItemId(tab.id),
    disabled: !gridMode,
  });

  return (
    <div
      ref={gridMode ? setNodeRef : undefined}
      style={
        gridMode
          ? { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 10 : undefined }
          : undefined
      }
      className={clsx(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-bg',
        gridMode ? '' : clsx('absolute inset-0', !visible && 'invisible'),
        isDragging && 'opacity-60 ring-1 ring-accent',
      )}
      aria-hidden={!visible}
    >
      {gridMode && (
        <div className="flex items-center gap-2 border-b border-line bg-surface px-2.5 py-1">
          <button
            type="button"
            className="cursor-grab text-fg-dim hover:text-fg active:cursor-grabbing"
            aria-label={t('terminal.movePanel', { name: tab.title })}
            title={t('terminal.dragToReorder')}
            {...attributes}
            {...listeners}
          >
            <GripVerticalIcon size={12} />
          </button>
          <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATE_COLOR[tab.state])} />
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-dim">
            {tab.title}
          </span>
          <button
            type="button"
            className="rounded p-0.5 text-fg-dim hover:bg-line hover:text-danger"
            onClick={onClose}
            aria-label={t('terminal.closePanel', { name: tab.title })}
          >
            <XIcon size={11} />
          </button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <TerminalPane tabId={tab.id} hostId={tab.hostId} visible={visible} />
      </div>
    </div>
  );
}

function SortableTab({
  tab,
  highlighted,
  gridMode,
  onSelect,
  onClose,
}: {
  tab: TerminalTab;
  highlighted: boolean;
  gridMode: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: tabItemId(tab.id),
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'group flex shrink-0 items-center gap-2 rounded px-2.5 py-1 transition-colors',
        highlighted && !gridMode ? 'bg-surface-2 text-fg' : 'text-fg-dim hover:bg-surface-2',
        gridMode && 'text-fg',
        isDragging && 'opacity-60 ring-1 ring-accent',
      )}
      /**
       * Orta tık (tekerlek) sekmeyi kapatır — tarayıcı sekmelerindeki alışkanlık.
       * `mousedown`da varsayılanı engellemek şart: aksi hâlde Windows/Linux'ta
       * otomatik kaydırma imleci açılır ve sayfa tuhaflaşır.
       */
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        onClose();
      }}
    >
      <button
        type="button"
        className="flex cursor-grab items-center gap-2 active:cursor-grabbing"
        onClick={onSelect}
        title={t('terminal.tabTitle', { name: tab.title, state: t(STATE_LABEL[tab.state]) })}
        {...attributes}
        {...listeners}
      >
        <span className={clsx('h-1.5 w-1.5 shrink-0 rounded-full', STATE_COLOR[tab.state])} />
        <TerminalIcon size={12} className="shrink-0" aria-hidden="true" />
        <span className="max-w-[160px] truncate font-mono text-[12px]">{tab.title}</span>
      </button>
      <button
        type="button"
        className="rounded p-0.5 opacity-0 transition-opacity hover:bg-line hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
        onClick={onClose}
        aria-label={t('terminal.closeTab', { name: tab.title })}
      >
        <XIcon size={11} />
      </button>
    </div>
  );
}
