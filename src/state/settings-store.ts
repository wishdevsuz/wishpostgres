import { create } from 'zustand';

import { prefs } from '@/services/api';
import type { AppSettings } from '@/types';

const FALLBACK: AppSettings = {
  autoReconnect: true,
  queryTimeoutSeconds: 60,
  rowsPerPage: 100,
  animations: true,
  confirmBeforeDelete: true,
  openLastConnection: true,
  defaultSchema: 'public',
  statementTimeoutMs: 0,
  checkUpdates: true,
  maxHistoryEntries: 1000,
  binaryDirectory: null,
  fontSize: 13,
};

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  load: () => Promise<void>;
  save: (patch: Partial<AppSettings>) => Promise<void>;
  reset: () => Promise<void>;
}

function applyToDocument(settings: AppSettings) {
  const root = document.documentElement;
  root.dataset.motion = settings.animations ? 'on' : 'off';
  root.style.setProperty('--app-font-size', `${settings.fontSize}px`);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: FALLBACK,
  loaded: false,

  load: async () => {
    const settings = await prefs.settings();
    applyToDocument(settings);
    set({ settings, loaded: true });
  },

  save: async (patch) => {
    const next = { ...get().settings, ...patch };
    const saved = await prefs.saveSettings(next);
    applyToDocument(saved);
    set({ settings: saved });
  },

  reset: async () => {
    const settings = await prefs.resetSettings();
    applyToDocument(settings);
    set({ settings });
  },
}));
