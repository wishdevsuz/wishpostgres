import { getCurrentWebview } from '@tauri-apps/api/webview';
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

/** The size every `text-[…px]` utility in the app is authored against. */
const BASE_FONT_SIZE = 13;

function applyToDocument(settings: AppSettings) {
  const root = document.documentElement;
  root.dataset.motion = settings.animations ? 'on' : 'off';

  // Almost every size in the interface is an absolute pixel value, so setting a
  // root font size alone would change nothing. The webview's own zoom scales the
  // whole window — text, icons, paddings and the grid — and unlike a CSS `zoom`
  // it keeps the viewport, fixed positioning and the dialogs' centring correct.
  const size = Math.min(18, Math.max(11, settings.fontSize || BASE_FONT_SIZE));
  root.style.setProperty('--app-font-size', `${size}px`);
  void getCurrentWebview()
    .setZoom(size / BASE_FONT_SIZE)
    .catch(() => undefined);
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
