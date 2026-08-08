import { beforeEach, describe, expect, it } from 'vitest';

import { useSettingsStore } from '@/state/settings-store';
import { useDialogStore } from '@/state/dialog-store';
import type { AppSettings } from '@/types';

import { invoke } from './setup';

const defaults: AppSettings = {
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

beforeEach(() => {
  invoke.mockReset();
  useSettingsStore.setState({ settings: defaults, loaded: false });
  document.documentElement.removeAttribute('data-motion');
  document.documentElement.style.removeProperty('--app-font-size');
});

describe('load', () => {
  it('stores what the backend returns', async () => {
    invoke.mockResolvedValue({ ...defaults, rowsPerPage: 250 });
    await useSettingsStore.getState().load();
    expect(useSettingsStore.getState().settings.rowsPerPage).toBe(250);
    expect(useSettingsStore.getState().loaded).toBe(true);
  });

  it('applies the motion flag to the document', async () => {
    invoke.mockResolvedValue({ ...defaults, animations: false });
    await useSettingsStore.getState().load();
    expect(document.documentElement.dataset.motion).toBe('off');

    invoke.mockResolvedValue({ ...defaults, animations: true });
    await useSettingsStore.getState().load();
    expect(document.documentElement.dataset.motion).toBe('on');
  });

  it('publishes the interface size as a CSS variable', async () => {
    invoke.mockResolvedValue({ ...defaults, fontSize: 16 });
    await useSettingsStore.getState().load();
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('16px');
  });

  it('clamps an interface size the user could not have chosen', async () => {
    invoke.mockResolvedValue({ ...defaults, fontSize: 99 });
    await useSettingsStore.getState().load();
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('18px');

    invoke.mockResolvedValue({ ...defaults, fontSize: 2 });
    await useSettingsStore.getState().load();
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('11px');
  });

  it('falls back to the base size when the stored value is missing', async () => {
    invoke.mockResolvedValue({ ...defaults, fontSize: 0 });
    await useSettingsStore.getState().load();
    expect(document.documentElement.style.getPropertyValue('--app-font-size')).toBe('13px');
  });
});

describe('save', () => {
  it('sends the whole settings object, not just the patch', async () => {
    invoke.mockImplementation(
      async (_command, args) => (args as { settings: AppSettings }).settings,
    );
    await useSettingsStore.getState().save({ rowsPerPage: 500 });

    expect(invoke).toHaveBeenCalledWith(
      'save_settings',
      expect.objectContaining({
        settings: expect.objectContaining({ rowsPerPage: 500, defaultSchema: 'public' }),
      }),
    );
    expect(useSettingsStore.getState().settings.rowsPerPage).toBe(500);
  });

  it('keeps whatever the backend hands back, not what was sent', async () => {
    invoke.mockResolvedValue({ ...defaults, rowsPerPage: 100 });
    await useSettingsStore.getState().save({ rowsPerPage: 999_999 });
    expect(useSettingsStore.getState().settings.rowsPerPage).toBe(100);
  });

  it('propagates a rejection so the caller can report it', async () => {
    invoke.mockRejectedValue(new Error('invalid'));
    await expect(useSettingsStore.getState().save({ rowsPerPage: 0 })).rejects.toThrow();
  });
});

describe('reset', () => {
  it('replaces the settings with the defaults the backend returns', async () => {
    useSettingsStore.setState({ settings: { ...defaults, rowsPerPage: 500 } });
    invoke.mockResolvedValue(defaults);

    await useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().settings.rowsPerPage).toBe(100);
    expect(document.documentElement.dataset.motion).toBe('on');
  });
});

describe('dialog store', () => {
  beforeEach(() => {
    useDialogStore.setState({ open: null, connectionDraft: null, error: null });
  });

  it('opens and closes one dialog at a time', () => {
    useDialogStore.getState().show('settings');
    expect(useDialogStore.getState().open).toBe('settings');

    useDialogStore.getState().show('shortcuts');
    expect(useDialogStore.getState().open).toBe('shortcuts');

    useDialogStore.getState().close();
    expect(useDialogStore.getState().open).toBeNull();
  });

  it('editing a connection opens the connection dialog with the draft', () => {
    const draft = { id: 'c1', name: 'Local' } as never;
    useDialogStore.getState().editConnection(draft);
    expect(useDialogStore.getState().open).toBe('connection');
    expect(useDialogStore.getState().connectionDraft).toBe(draft);
  });

  it('a new connection opens the same dialog with no draft', () => {
    useDialogStore.getState().editConnection(null);
    expect(useDialogStore.getState().open).toBe('connection');
    expect(useDialogStore.getState().connectionDraft).toBeNull();
  });

  it('turns an unknown throw into a report the dialog can render', () => {
    const report = useDialogStore.getState().showError(new Error('boom'));
    expect(report.message).toBe('boom');
    expect(report.kind).toBe('unexpected');
    expect(useDialogStore.getState().error).toEqual(report);
  });

  it('keeps a backend report intact', () => {
    const backend = {
      message: 'relation does not exist',
      kind: 'postgres',
      sqlstate: '42P01',
      detail: null,
      hint: null,
      position: 15,
      reason: 'The table is missing.',
      suggestion: 'Check the name.',
    };
    const report = useDialogStore.getState().showError(backend);
    expect(report).toEqual(backend);
  });

  it('dismisses the error', () => {
    useDialogStore.getState().showError(new Error('boom'));
    useDialogStore.getState().dismissError();
    expect(useDialogStore.getState().error).toBeNull();
  });

  it('reports a thrown string as its own message', () => {
    expect(useDialogStore.getState().showError('plain failure').message).toBe('plain failure');
  });
});
