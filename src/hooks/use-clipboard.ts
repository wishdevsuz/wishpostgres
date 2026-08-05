import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { useCallback } from 'react';

import { notify } from '@/utils/notify';

export function useClipboard() {
  return useCallback(async (text: string, message = 'Copied') => {
    try {
      await writeText(text);
      notify.success(message);
    } catch {
      // The webview clipboard is a viable fallback when the plugin is blocked.
      try {
        await navigator.clipboard.writeText(text);
        notify.success(message);
      } catch {
        notify.error('Could not write to the clipboard');
      }
    }
  }, []);
}

/** Build a tab-separated block, the format spreadsheets expect on paste. */
export function toClipboardTable(rows: string[][], header?: string[]): string {
  const lines = header ? [header, ...rows] : rows;
  return lines.map((row) => row.map(escapeCell).join('\t')).join('\n');
}

function escapeCell(value: string): string {
  return /[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
