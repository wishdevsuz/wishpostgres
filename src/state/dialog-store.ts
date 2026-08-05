import { create } from 'zustand';

import { toReport } from '@/services/tauri';
import type { ErrorReport, SavedConnection, TableTarget } from '@/types';

export type DialogKind =
  | 'connection'
  | 'settings'
  | 'shortcuts'
  | 'globalSearch'
  | 'insertRow'
  | 'addColumn'
  | 'import'
  | 'export'
  | 'backup'
  | 'restore'
  | 'saveQuery';

interface DialogState {
  open: DialogKind | null;
  connectionDraft: SavedConnection | null;
  exportTarget: TableTarget | null;
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
  exportTarget: null,
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
