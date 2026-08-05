import { invoke } from '@tauri-apps/api/core';

import type { ErrorReport } from '@/types';

/**
 * Errors crossing the IPC boundary are always an `ErrorReport`, so they are
 * re-thrown as a typed class the error dialog can render directly.
 */
export class CommandError extends Error {
  readonly report: ErrorReport;

  constructor(report: ErrorReport) {
    super(report.message);
    this.name = 'CommandError';
    this.report = report;
  }
}

function isErrorReport(value: unknown): value is ErrorReport {
  return typeof value === 'object' && value !== null && 'message' in value && 'kind' in value;
}

export function toReport(error: unknown): ErrorReport {
  if (error instanceof CommandError) return error.report;
  if (isErrorReport(error)) return error;

  return {
    message: error instanceof Error ? error.message : String(error),
    kind: 'unexpected',
    sqlstate: null,
    detail: null,
    hint: null,
    position: null,
    reason: 'Something failed inside the application rather than the database.',
    suggestion: 'Retry the action. If it keeps failing, restart Postgres Lite.',
  };
}

export async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw new CommandError(toReport(error));
  }
}
