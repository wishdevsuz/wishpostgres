import { create } from 'zustand';

import { toReport } from '@/services/tauri';
import type { ErrorReport, SavedConnection } from '@/types';

/** Dialogs that live at the app root; everything else is owned by its page. */
export type DialogKind =
  'connection' | 'settings' | 'shortcuts' | 'globalSearch' | 'backup' | 'restore';

interface DialogState {
  open: DialogKind | null;
  connectionDraft: SavedConnection | null;
  error: ErrorReport | null;

  show: (kind: DialogKind) => void;
  close: () => void;
  editConnection: (connection: SavedConnection | null) => void;
  showError: (error: unknown) => ErrorReport;
  dismissError: () => void;
}

export const useDialogStore = create<DialogState>((set) => ({
  open: null,
  connectionDraft: null,
  error: null,

  show: (open) => set({ open }),
  close: () => set({ open: null }),
  editConnection: (connectionDraft) => set({ connectionDraft, open: 'connection' }),

  showError: (error) => {
    const report = toReport(error);
    set({ error: report });
    return report;
  },

  dismissError: () => set({ error: null }),
}));
