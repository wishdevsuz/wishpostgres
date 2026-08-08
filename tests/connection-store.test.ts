import { beforeEach, describe, expect, it } from 'vitest';

import { useConnectionStore } from '@/state/connection-store';
import type { SavedConnection, ServerInfo } from '@/types';

import { invoke } from './setup';

const connection = (id: string, name = id): SavedConnection => ({
  id,
  name,
  host: 'localhost',
  port: 5432,
  username: 'postgres',
  database: 'postgres',
  ssl: false,
  verifyCertificate: false,
  favorite: false,
  color: null,
  searchPath: null,
  statementTimeoutMs: null,
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  hasPassword: false,
});

const server: ServerInfo = {
  version: 'PostgreSQL 18.4',
  versionNumber: 180004,
  currentUser: 'postgres',
  currentDatabase: 'shop',
  isSuperuser: false,
};

/** Route each Tauri command to a canned answer. */
function respond(handlers: Record<string, unknown>) {
  invoke.mockImplementation(async (command: string) => {
    if (!(command in handlers)) throw new Error(`unexpected command ${command}`);
    const value = handlers[command];
    if (value instanceof Error) throw value;
    return value;
  });
}

beforeEach(() => {
  invoke.mockReset();
  useConnectionStore.setState({
    list: [],
    statuses: {},
    servers: {},
    activeId: null,
    activeDatabase: null,
    loaded: false,
  });
});

describe('refresh', () => {
  it('marks the sessions the backend reports as open', async () => {
    respond({
      list_connections: [connection('c1'), connection('c2')],
      connected_ids: ['c1'],
    });

    const list = await useConnectionStore.getState().refresh();
    const state = useConnectionStore.getState();
    expect(list).toHaveLength(2);
    expect(state.statuses.c1).toBe('online');
    expect(state.statuses.c2).toBe('offline');
    expect(state.loaded).toBe(true);
  });

  it('keeps a connection that is mid-connect from flickering to offline', async () => {
    useConnectionStore.setState({ statuses: { c1: 'connecting' } });
    respond({ list_connections: [connection('c1')], connected_ids: [] });

    await useConnectionStore.getState().refresh();
    expect(useConnectionStore.getState().statuses.c1).toBe('connecting');
  });

  it('forgets a status for a connection that no longer exists', async () => {
    useConnectionStore.setState({ statuses: { gone: 'online' } });
    respond({ list_connections: [connection('c1')], connected_ids: [] });

    await useConnectionStore.getState().refresh();
    // The stale entry is not revived, and the live one is accurate.
    expect(useConnectionStore.getState().statuses.c1).toBe('offline');
  });

  it('propagates a failure rather than reporting an empty list', async () => {
    respond({ list_connections: new Error('unreadable'), connected_ids: [] });
    await expect(useConnectionStore.getState().refresh()).rejects.toThrow();
  });
});

describe('connect', () => {
  it('goes online, records the server and becomes the active scope', async () => {
    respond({
      connect: server,
      list_connections: [connection('c1')],
      connected_ids: ['c1'],
    });

    const info = await useConnectionStore.getState().connect('c1');
    const state = useConnectionStore.getState();
    expect(info.currentDatabase).toBe('shop');
    expect(state.statuses.c1).toBe('online');
    expect(state.servers.c1).toEqual(server);
    expect(state.activeId).toBe('c1');
    // The scope follows the database the server actually opened.
    expect(state.activeDatabase).toBe('shop');
  });

  it('passes the requested database through', async () => {
    respond({ connect: server, list_connections: [], connected_ids: [] });
    await useConnectionStore.getState().connect('c1', 'other');
    expect(invoke).toHaveBeenCalledWith('connect', { id: 'c1', database: 'other' });
  });

  it('marks the connection as failed and rethrows', async () => {
    respond({ connect: new Error('refused') });
    await expect(useConnectionStore.getState().connect('c1')).rejects.toThrow();
    expect(useConnectionStore.getState().statuses.c1).toBe('error');
    expect(useConnectionStore.getState().activeId).toBeNull();
  });

  it('leaves any other connection untouched when one fails', async () => {
    useConnectionStore.setState({ statuses: { c2: 'online' } });
    respond({ connect: new Error('refused') });
    await expect(useConnectionStore.getState().connect('c1')).rejects.toThrow();
    expect(useConnectionStore.getState().statuses.c2).toBe('online');
  });
});

describe('disconnect', () => {
  it('drops the session, its server info and the active scope', async () => {
    useConnectionStore.setState({
      statuses: { c1: 'online' },
      servers: { c1: server },
      activeId: 'c1',
      activeDatabase: 'shop',
    });
    respond({ disconnect: undefined });

    await useConnectionStore.getState().disconnect('c1');
    const state = useConnectionStore.getState();
    expect(state.statuses.c1).toBe('offline');
    expect(state.servers.c1).toBeUndefined();
    expect(state.activeId).toBeNull();
    expect(state.activeDatabase).toBeNull();
  });

  it('keeps the active scope when a different connection is closed', async () => {
    useConnectionStore.setState({
      statuses: { c1: 'online', c2: 'online' },
      servers: { c1: server, c2: server },
      activeId: 'c1',
      activeDatabase: 'shop',
    });
    respond({ disconnect: undefined });

    await useConnectionStore.getState().disconnect('c2');
    const state = useConnectionStore.getState();
    expect(state.activeId).toBe('c1');
    expect(state.servers.c1).toEqual(server);
  });
});

describe('remove', () => {
  it('deletes the connection and everything about it', async () => {
    useConnectionStore.setState({
      list: [connection('c1'), connection('c2')],
      statuses: { c1: 'online', c2: 'offline' },
      servers: { c1: server },
      activeId: 'c1',
      activeDatabase: 'shop',
    });
    respond({ delete_connection: undefined });

    await useConnectionStore.getState().remove('c1');
    const state = useConnectionStore.getState();
    expect(state.list.map((entry) => entry.id)).toEqual(['c2']);
    expect(state.statuses.c1).toBeUndefined();
    expect(state.servers.c1).toBeUndefined();
    expect(state.activeId).toBeNull();
  });

  it('leaves the active scope alone when another connection is removed', async () => {
    useConnectionStore.setState({
      list: [connection('c1'), connection('c2')],
      activeId: 'c1',
      activeDatabase: 'shop',
    });
    respond({ delete_connection: undefined });

    await useConnectionStore.getState().remove('c2');
    expect(useConnectionStore.getState().activeId).toBe('c1');
  });
});

describe('upsert', () => {
  it('adds a connection that is not there yet', () => {
    useConnectionStore.getState().upsert(connection('c1'));
    expect(useConnectionStore.getState().list).toHaveLength(1);
  });

  it('replaces one that is, in place', () => {
    useConnectionStore.setState({ list: [connection('c1', 'Old'), connection('c2')] });
    useConnectionStore.getState().upsert(connection('c1', 'New'));

    const list = useConnectionStore.getState().list;
    expect(list).toHaveLength(2);
    expect(list[0]!.name).toBe('New');
    expect(list[1]!.id).toBe('c2');
  });
});

describe('active scope', () => {
  it('can be set and cleared', () => {
    useConnectionStore.getState().setActive('c1', 'shop');
    expect(useConnectionStore.getState().activeId).toBe('c1');
    expect(useConnectionStore.getState().activeDatabase).toBe('shop');

    useConnectionStore.getState().setActive(null, null);
    expect(useConnectionStore.getState().activeId).toBeNull();
  });

  it('can switch database without touching the connection', () => {
    useConnectionStore.getState().setActive('c1', 'shop');
    useConnectionStore.getState().setDatabase('other');
    expect(useConnectionStore.getState().activeId).toBe('c1');
    expect(useConnectionStore.getState().activeDatabase).toBe('other');
  });
});

describe('statusOf', () => {
  it('reports offline for anything it has not seen', () => {
    expect(useConnectionStore.getState().statusOf('unknown')).toBe('offline');
  });

  it('reports the recorded status', () => {
    useConnectionStore.setState({ statuses: { c1: 'online' } });
    expect(useConnectionStore.getState().statusOf('c1')).toBe('online');
  });
});
