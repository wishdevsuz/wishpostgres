import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '@/state/workspace-store';
import type { FavoriteTable, TableTarget } from '@/types';

import { invoke } from './setup';

const table = (name: string): TableTarget => ({
  schema: 'public',
  table: name,
  kind: 'table',
});

const favorite = (name: string): FavoriteTable => ({
  connectionId: 'c1',
  database: 'shop',
  schema: 'public',
  table: name,
});

/** Reset to the shape a fresh launch produces, without touching the disk. */
function reset() {
  useWorkspaceStore.setState({
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
  });
}

beforeEach(() => {
  vi.useRealTimers();
  reset();
  invoke.mockReset();
});

describe('hydrate', () => {
  it('always leaves at least one SQL tab open', async () => {
    invoke.mockResolvedValue({
      lastConnectionId: null,
      lastDatabase: null,
      lastSchema: null,
      sqlTabs: [],
      activeTabId: null,
      favoriteTables: [],
      sidebarWidth: null,
    });

    await useWorkspaceStore.getState().hydrate();
    const state = useWorkspaceStore.getState();
    expect(state.sqlTabs).toHaveLength(1);
    expect(state.activeTabId).toBe(state.sqlTabs[0]!.id);
    expect(state.hydrated).toBe(true);
  });

  it('restores the saved tabs, schema and sidebar width', async () => {
    invoke.mockResolvedValue({
      lastConnectionId: 'c1',
      lastDatabase: 'shop',
      lastSchema: 'app',
      sqlTabs: [{ id: 't1', name: 'One', sql: 'SELECT 1', connectionId: null, database: null }],
      activeTabId: 't1',
      favoriteTables: [favorite('orders')],
      sidebarWidth: 320,
    });

    const workspace = await useWorkspaceStore.getState().hydrate();
    const state = useWorkspaceStore.getState();
    expect(workspace.lastConnectionId).toBe('c1');
    expect(state.schema).toBe('app');
    expect(state.sidebarWidth).toBe(320);
    expect(state.sqlTabs[0]!.sql).toBe('SELECT 1');
    expect(state.favorites).toHaveLength(1);
  });

  it('starts on the defaults when the workspace cannot be read', async () => {
    invoke.mockRejectedValue(new Error('unreadable'));
    await useWorkspaceStore.getState().hydrate();
    const state = useWorkspaceStore.getState();
    expect(state.schema).toBe('public');
    expect(state.sidebarWidth).toBe(264);
    expect(state.sqlTabs).toHaveLength(1);
  });
});

describe('persist', () => {
  it('debounces so typing does not hit the disk on every keystroke', async () => {
    vi.useFakeTimers();
    useWorkspaceStore.setState({ hydrated: true });
    invoke.mockResolvedValue(undefined);

    const { persist } = useWorkspaceStore.getState();
    persist('c1', 'shop');
    persist('c1', 'shop');
    persist('c1', 'shop');
    expect(invoke).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(700);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'save_workspace',
      expect.objectContaining({
        workspace: expect.objectContaining({ lastConnectionId: 'c1', lastDatabase: 'shop' }),
      }),
    );
  });

  it('swallows a write failure rather than surfacing it mid-typing', async () => {
    vi.useFakeTimers();
    invoke.mockRejectedValue(new Error('disk full'));
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    useWorkspaceStore.getState().persist(null, null);
    await vi.advanceTimersByTimeAsync(700);

    process.off('unhandledRejection', unhandled);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(unhandled).not.toHaveBeenCalled();
  });
});

describe('tabs', () => {
  it('adds a tab, focuses it and switches to the query view', () => {
    const tab = useWorkspaceStore.getState().addTab();
    const state = useWorkspaceStore.getState();
    expect(state.sqlTabs).toHaveLength(1);
    expect(state.activeTabId).toBe(tab.id);
    expect(state.view).toBe('query');
  });

  it('numbers new tabs in order', () => {
    const first = useWorkspaceStore.getState().addTab();
    const second = useWorkspaceStore.getState().addTab();
    expect(first.name).toBe('Query 1');
    expect(second.name).toBe('Query 2');
  });

  it('gives every tab its own id', () => {
    const ids = new Set([
      useWorkspaceStore.getState().addTab().id,
      useWorkspaceStore.getState().addTab().id,
      useWorkspaceStore.getState().addTab().id,
    ]);
    expect(ids.size).toBe(3);
  });

  it('updates only the tab it names', () => {
    const first = useWorkspaceStore.getState().addTab();
    const second = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().updateTab(first.id, { sql: 'SELECT 1' });

    const tabs = useWorkspaceStore.getState().sqlTabs;
    expect(tabs.find((tab) => tab.id === first.id)!.sql).toBe('SELECT 1');
    expect(tabs.find((tab) => tab.id === second.id)!.sql).toBe('');
  });

  it('ignores an update for a tab that is gone', () => {
    useWorkspaceStore.getState().addTab();
    expect(() => useWorkspaceStore.getState().updateTab('missing', { sql: 'x' })).not.toThrow();
    expect(useWorkspaceStore.getState().sqlTabs[0]!.sql).toBe('');
  });

  it('closing the last tab opens a fresh one', () => {
    const only = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().closeTab(only.id);

    const state = useWorkspaceStore.getState();
    expect(state.sqlTabs).toHaveLength(1);
    expect(state.sqlTabs[0]!.id).not.toBe(only.id);
    expect(state.activeTabId).toBe(state.sqlTabs[0]!.id);
  });

  it('closing the active tab focuses the last remaining one', () => {
    const first = useWorkspaceStore.getState().addTab();
    const second = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().closeTab(second.id);
    expect(useWorkspaceStore.getState().activeTabId).toBe(first.id);
  });

  it('closing an inactive tab leaves the focus alone', () => {
    const first = useWorkspaceStore.getState().addTab();
    const second = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.getState().closeTab(first.id);
    expect(useWorkspaceStore.getState().activeTabId).toBe(second.id);
  });

  it('activating a tab switches to the query view', () => {
    const tab = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.setState({ view: 'welcome' });
    useWorkspaceStore.getState().setActiveTab(tab.id);
    expect(useWorkspaceStore.getState().view).toBe('query');
  });

  it('activeTab falls back to the first tab when the id is stale', () => {
    const tab = useWorkspaceStore.getState().addTab();
    useWorkspaceStore.setState({ activeTabId: 'gone' });
    expect(useWorkspaceStore.getState().activeTab()!.id).toBe(tab.id);
  });

  it('activeTab is null when there are no tabs at all', () => {
    expect(useWorkspaceStore.getState().activeTab()).toBeNull();
  });
});

describe('the open relation', () => {
  it('opening a table switches the view and defaults to browse', () => {
    useWorkspaceStore.getState().openTable(table('orders'));
    const state = useWorkspaceStore.getState();
    expect(state.view).toBe('table');
    expect(state.tableTab).toBe('browse');
    expect(state.table!.table).toBe('orders');
  });

  it('a table can be opened straight onto another tab', () => {
    useWorkspaceStore.getState().openTable(table('orders'), 'structure');
    expect(useWorkspaceStore.getState().tableTab).toBe('structure');
  });

  it('closing a table returns to the welcome view', () => {
    useWorkspaceStore.getState().openTable(table('orders'));
    useWorkspaceStore.getState().closeTable();
    const state = useWorkspaceStore.getState();
    expect(state.table).toBeNull();
    expect(state.view).toBe('welcome');
  });
});

describe('schema', () => {
  it('changing schema closes a table that belonged to the old one', () => {
    useWorkspaceStore.getState().openTable(table('orders'));
    useWorkspaceStore.getState().setSchema('app');

    const state = useWorkspaceStore.getState();
    expect(state.schema).toBe('app');
    expect(state.table).toBeNull();
    expect(state.view).toBe('welcome');
  });

  it('keeps a table that lives in the new schema', () => {
    useWorkspaceStore.getState().openTable({ schema: 'app', table: 'orders', kind: 'table' });
    useWorkspaceStore.getState().setSchema('app');
    expect(useWorkspaceStore.getState().table).not.toBeNull();
  });

  it('setting the same schema changes nothing', () => {
    useWorkspaceStore.getState().openTable(table('orders'));
    useWorkspaceStore.getState().setSchema('public');
    expect(useWorkspaceStore.getState().table).not.toBeNull();
  });

  it('leaves a non-table view alone', () => {
    useWorkspaceStore.setState({ view: 'query' });
    useWorkspaceStore.getState().setSchema('app');
    expect(useWorkspaceStore.getState().view).toBe('query');
  });
});

describe('favorites', () => {
  it('toggles on and off', () => {
    const { toggleFavorite, isFavorite } = useWorkspaceStore.getState();
    toggleFavorite(favorite('orders'));
    expect(useWorkspaceStore.getState().isFavorite(favorite('orders'))).toBe(true);

    useWorkspaceStore.getState().toggleFavorite(favorite('orders'));
    expect(useWorkspaceStore.getState().isFavorite(favorite('orders'))).toBe(false);
    expect(isFavorite).toBeTypeOf('function');
  });

  it('treats the same table in another database as a different favorite', () => {
    useWorkspaceStore.getState().toggleFavorite(favorite('orders'));
    const elsewhere = { ...favorite('orders'), database: 'other' };
    expect(useWorkspaceStore.getState().isFavorite(elsewhere)).toBe(false);

    useWorkspaceStore.getState().toggleFavorite(elsewhere);
    expect(useWorkspaceStore.getState().favorites).toHaveLength(2);
  });

  it('keeps several favorites independent', () => {
    useWorkspaceStore.getState().toggleFavorite(favorite('orders'));
    useWorkspaceStore.getState().toggleFavorite(favorite('clients'));
    useWorkspaceStore.getState().toggleFavorite(favorite('orders'));

    const remaining = useWorkspaceStore.getState().favorites;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.table).toBe('clients');
  });
});

describe('rename', () => {
  it('follows the open table', () => {
    useWorkspaceStore.getState().openTable(table('orders'));
    useWorkspaceStore.getState().renameTable(table('orders'), 'purchases');
    expect(useWorkspaceStore.getState().table!.table).toBe('purchases');
  });

  it('follows the favorite too', () => {
    useWorkspaceStore.getState().toggleFavorite(favorite('orders'));
    useWorkspaceStore.getState().renameTable(table('orders'), 'purchases');
    expect(useWorkspaceStore.getState().favorites[0]!.table).toBe('purchases');
  });

  it('leaves a different table alone', () => {
    useWorkspaceStore.getState().openTable(table('clients'));
    useWorkspaceStore.getState().renameTable(table('orders'), 'purchases');
    expect(useWorkspaceStore.getState().table!.table).toBe('clients');
  });

  it('does nothing when no table is open', () => {
    expect(() =>
      useWorkspaceStore.getState().renameTable(table('orders'), 'purchases'),
    ).not.toThrow();
    expect(useWorkspaceStore.getState().table).toBeNull();
  });
});

describe('sidebar', () => {
  it('remembers its width', () => {
    useWorkspaceStore.getState().setSidebarWidth(300);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(300);
  });

  it('toggles collapsed and back', () => {
    useWorkspaceStore.getState().toggleSidebar();
    expect(useWorkspaceStore.getState().sidebarCollapsed).toBe(true);
    useWorkspaceStore.getState().toggleSidebar();
    expect(useWorkspaceStore.getState().sidebarCollapsed).toBe(false);
  });
});
