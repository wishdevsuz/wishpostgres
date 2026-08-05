import { create } from 'zustand';

import { connections as api } from '@/services/api';
import type { SavedConnection, ServerInfo } from '@/types';

export type ConnectionStatus = 'offline' | 'connecting' | 'online' | 'error';

interface ConnectionState {
  list: SavedConnection[];
  statuses: Record<string, ConnectionStatus>;
  servers: Record<string, ServerInfo>;
  activeId: string | null;
  activeDatabase: string | null;
  loaded: boolean;

  refresh: () => Promise<SavedConnection[]>;
  connect: (id: string, database?: string) => Promise<ServerInfo>;
  disconnect: (id: string) => Promise<void>;
  setActive: (id: string | null, database: string | null) => void;
  setDatabase: (database: string) => void;
  remove: (id: string) => Promise<void>;
  upsert: (connection: SavedConnection) => void;
  statusOf: (id: string) => ConnectionStatus;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  list: [],
  statuses: {},
  servers: {},
  activeId: null,
  activeDatabase: null,
  loaded: false,

  refresh: async () => {
    const [list, open] = await Promise.all([api.list(), api.connected()]);
    const statuses = { ...get().statuses };
    for (const connection of list) {
      statuses[connection.id] = open.includes(connection.id)
        ? 'online'
        : statuses[connection.id] === 'connecting'
          ? 'connecting'
          : 'offline';
    }
    set({ list, statuses, loaded: true });
    return list;
  },

  connect: async (id, database) => {
    set((state) => ({ statuses: { ...state.statuses, [id]: 'connecting' } }));
    try {
      const server = await api.connect(id, database);
      set((state) => ({
        statuses: { ...state.statuses, [id]: 'online' },
        servers: { ...state.servers, [id]: server },
        activeId: id,
        activeDatabase: server.currentDatabase,
      }));
      await get().refresh();
      return server;
    } catch (error) {
      set((state) => ({ statuses: { ...state.statuses, [id]: 'error' } }));
      throw error;
    }
  },

  disconnect: async (id) => {
    await api.disconnect(id);
    set((state) => {
      const servers = { ...state.servers };
      delete servers[id];
      return {
        statuses: { ...state.statuses, [id]: 'offline' },
        servers,
        activeId: state.activeId === id ? null : state.activeId,
        activeDatabase: state.activeId === id ? null : state.activeDatabase,
      };
    });
  },

  setActive: (id, database) => set({ activeId: id, activeDatabase: database }),

  setDatabase: (database) => set({ activeDatabase: database }),

  remove: async (id) => {
    await api.remove(id);
    set((state) => {
      const statuses = { ...state.statuses };
      const servers = { ...state.servers };
      delete statuses[id];
      delete servers[id];
      return {
        list: state.list.filter((connection) => connection.id !== id),
        statuses,
        servers,
        activeId: state.activeId === id ? null : state.activeId,
        activeDatabase: state.activeId === id ? null : state.activeDatabase,
      };
    });
  },

  upsert: (connection) =>
    set((state) => {
      const index = state.list.findIndex((existing) => existing.id === connection.id);
      const list = [...state.list];
      if (index >= 0) list[index] = connection;
      else list.push(connection);
      return { list };
    }),

  statusOf: (id) => get().statuses[id] ?? 'offline',
}));
