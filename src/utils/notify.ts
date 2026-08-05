import { toast } from 'sonner';

import { useDialogStore } from '@/state/dialog-store';
import { toReport } from '@/services/tauri';

export const notify = {
  success: (message: string, description?: string) => toast.success(message, { description }),
  info: (message: string, description?: string) => toast(message, { description }),
  warn: (message: string, description?: string) => toast.warning(message, { description }),
  error: (message: string, description?: string) => toast.error(message, { description }),

  /**
   * Show a compact toast and offer the full diagnostic dialog, so routine
   * failures stay quiet while the SQLSTATE and suggested fix remain one click
   * away.
   */
  failure: (error: unknown, fallback = 'Something went wrong') => {
    const report = toReport(error);
    toast.error(report.message || fallback, {
      description: report.reason ?? undefined,
      action: {
        label: 'Details',
        onClick: () => useDialogStore.getState().showError(report),
      },
    });
    return report;
  },

  promise: <T>(
    promise: Promise<T>,
    messages: { loading: string; success: string | ((value: T) => string); error?: string },
  ) =>
    toast.promise(promise, {
      loading: messages.loading,
      success: messages.success,
      error: (error: unknown) => toReport(error).message || (messages.error ?? 'Failed'),
    }),
};
