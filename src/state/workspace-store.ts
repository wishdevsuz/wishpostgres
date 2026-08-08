import { create } from 'zustand';

import { prefs } from '@/services/api';
import type { FavoriteTable, MainView, SqlTab, TableTab, TableTarget, Workspace } from '@/types';

const EMPTY_WORKSPACE: Workspace = {
  lastConnectionId: null,
  lastDatabase: null,
  lastSchema: null,
  sqlTabs: [],
  activeTabId: null,
  favoriteTables: [],
  sidebarWidth: null,
};

function newTab(index: number): SqlTab {
  return {
    id: crypto.randomUUID(),
    name: `Query ${index}`,
    sql: '',
    connectionId: null,
    database: null,
  };
}

interface WorkspaceState {
  view: MainView;
  schema: string;
  table: TableTarget | null;
  tableTab: TableTab;
  sqlTabs: SqlTab[];
  activeTabId: string | null;
  favorites: FavoriteTable[];
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  hydrated: boolean;

  hydrate: () => Promise<Workspace>;
  persist: (connectionId: string | null, database: string | null) => void;

  setView: (view: MainView) => void;
  setSchema: (schema: string) => void;
  openTable: (target: TableTarget, tab?: TableTab) => void;
  setTableTab: (tab: TableTab) => void;
  closeTable: () => void;

  addTab: () => SqlTab;
  updateTab: (id: string, patch: Partial<SqlTab>) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  activeTab: () => SqlTab | null;

  toggleFavorite: (favorite: FavoriteTable) => void;
  isFavorite: (favorite: FavoriteTable) => boolean;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;

  /** Follow a table that was renamed so the open page keeps pointing at it. */
  renameTable: (from: TableTarget, newName: string) => void;
}

let persistTimer: ReturnType<typeof setTimeout> | undefined;

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  view: 'welcome',
  schema: 'public',
  table: null,
  tableTab: 'browse',
  sqlTabs: [],
  activeTabId: null,
  favorites: [],
  sidebarWidth: 264,
  sidebarCollapsed: false,
  hydrated: false,

  hydrate: async () => {
    const workspace = await prefs.workspace().catch(() => EMPTY_WORKSPACE);
    const tabs = workspace.sqlTabs.length > 0 ? workspace.sqlTabs : [newTab(1)];
    set({
      sqlTabs: tabs,
      activeTabId: workspace.activeTabId ?? tabs[0]?.id ?? null,
      favorites: workspace.favoriteTables,
      schema: workspace.lastSchema ?? 'public',
      sidebarWidth: workspace.sidebarWidth ?? 264,
      hydrated: true,
    });
    return workspace;
  },

  /** Debounced so typing in a SQL tab does not hit the disk on every keystroke. */
  persist: (connectionId, database) => {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const state = get();
      void prefs
        .saveWorkspace({
          lastConnectionId: connectionId,
          lastDatabase: database,
          lastSchema: state.schema,
          sqlTabs: state.sqlTabs,
          activeTabId: state.activeTabId,
          favoriteTables: state.favorites,
          sidebarWidth: state.sidebarWidth,
        })
        .catch(() => undefined);
    }, 600);
  },

  setView: (view) => set({ view }),

  /**
   * Switching schema closes a table that belongs to the old one, so the main
   * pane can never keep showing a relation the sidebar is no longer scoped to.
   */
  setSchema: (schema) =>
    set((state) => {
      if (state.schema === schema) return { schema };
      const stale = state.table !== null && state.table.schema !== schema;
      return {
        schema,
        table: stale ? null : state.table,
        view: stale && state.view === 'table' ? 'welcome' : state.view,
      };
    }),

  openTable: (table, tab = 'browse') => set({ table, tableTab: tab, view: 'table' }),
  setTableTab: (tableTab) => set({ tableTab }),
  closeTable: () => set({ table: null, view: 'welcome' }),

  addTab: () => {
    const tab = newTab(get().sqlTabs.length + 1);
    set((state) => ({ sqlTabs: [...state.sqlTabs, tab], activeTabId: tab.id, view: 'query' }));
    return tab;
  },

  updateTab: (id, patch) =>
    set((state) => ({
      sqlTabs: state.sqlTabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
    })),

  closeTab: (id) =>
    set((state) => {
      const remaining = state.sqlTabs.filter((tab) => tab.id !== id);
      const tabs = remaining.length > 0 ? remaining : [newTab(1)];
      const activeTabId =
        state.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId;
      return { sqlTabs: tabs, activeTabId };
    }),

  setActiveTab: (activeTabId) => set({ activeTabId, view: 'query' }),

  activeTab: () => {
    const state = get();
    return state.sqlTabs.find((tab) => tab.id === state.activeTabId) ?? state.sqlTabs[0] ?? null;
  },

  toggleFavorite: (favorite) =>
    set((state) => {
      const exists = state.favorites.some((entry) => sameFavorite(entry, favorite));
      return {
        favorites: exists
          ? state.favorites.filter((entry) => !sameFavorite(entry, favorite))
          : [...state.favorites, favorite],
      };
    }),

  isFavorite: (favorite) => get().favorites.some((entry) => sameFavorite(entry, favorite)),

  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),

  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  renameTable: (from, newName) =>
    set((state) => ({
      table:
        state.table && state.table.schema === from.schema && state.table.table === from.table
          ? { ...state.table, table: newName }
          : state.table,
      favorites: state.favorites.map((entry) =>
        entry.schema === from.schema && entry.table === from.table
          ? { ...entry, table: newName }
          : entry,
      ),
    })),
}));

function sameFavorite(a: FavoriteTable, b: FavoriteTable): boolean {
  return (
    a.connectionId === b.connectionId &&
    a.database === b.database &&
    a.schema === b.schema &&
    a.table === b.table
  );
}
