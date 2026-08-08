import { beforeEach, describe, expect, it } from 'vitest';

import { catalog, connections, data, prefs, sql, structure, transfer } from '@/services/api';
import { CommandError, call, toReport } from '@/services/tauri';

import { invoke } from './setup';

const scope = { connectionId: 'c1', database: 'shop' };

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

/** The arguments the last IPC call was made with. */
function lastCall(): [string, Record<string, unknown>] {
  const call = invoke.mock.calls.at(-1);
  return [call![0] as string, (call![1] ?? {}) as Record<string, unknown>];
}

describe('the IPC wrapper', () => {
  it('passes the command and arguments straight through', async () => {
    invoke.mockResolvedValue(42);
    await expect(call<number>('do_thing', { a: 1 })).resolves.toBe(42);
    expect(lastCall()).toEqual(['do_thing', { a: 1 }]);
  });

  it('wraps a failure in a typed error the dialog can render', async () => {
    invoke.mockRejectedValue({
      message: 'relation does not exist',
      kind: 'postgres',
      sqlstate: '42P01',
      detail: null,
      hint: null,
      position: 15,
      reason: null,
      suggestion: null,
    });

    const error = await call('boom').catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(CommandError);
    expect((error as CommandError).report.sqlstate).toBe('42P01');
    expect((error as CommandError).message).toBe('relation does not exist');
  });

  it('describes a plain throw as an application failure', () => {
    const report = toReport(new Error('something broke'));
    expect(report.kind).toBe('unexpected');
    expect(report.message).toBe('something broke');
    expect(report.suggestion).toContain('Retry');
  });

  it('keeps a backend report as it is', () => {
    const backend = {
      message: 'no',
      kind: 'invalid',
      sqlstate: null,
      detail: null,
      hint: null,
      position: null,
      reason: null,
      suggestion: null,
    };
    expect(toReport(backend)).toBe(backend);
  });

  it('unwraps a report already inside a CommandError', () => {
    const report = toReport('plain string');
    expect(toReport(new CommandError(report))).toBe(report);
  });

  it('stringifies a thrown non-error', () => {
    expect(toReport('just text').message).toBe('just text');
    expect(toReport(404).message).toBe('404');
  });
});

describe('connections', () => {
  it('sends the password alongside the draft when saving', async () => {
    const connection = { id: 'c1', name: 'Local' } as never;
    await connections.save(connection, 'secret');
    const [command, args] = lastCall();
    expect(command).toBe('save_connection');
    expect(args.draft).toMatchObject({ id: 'c1', password: 'secret' });
  });

  it('omits the password when there is none to send', async () => {
    await connections.save({ id: 'c1' } as never);
    expect((lastCall()[1].draft as Record<string, unknown>).password).toBeUndefined();
  });

  it('maps each call to its command', async () => {
    await connections.list();
    expect(lastCall()[0]).toBe('list_connections');

    await connections.remove('c1');
    expect(lastCall()).toEqual(['delete_connection', { id: 'c1' }]);

    await connections.connect('c1', 'shop');
    expect(lastCall()).toEqual(['connect', { id: 'c1', database: 'shop' }]);

    await connections.disconnect('c1');
    expect(lastCall()).toEqual(['disconnect', { id: 'c1' }]);

    await connections.disconnectAll();
    expect(lastCall()[0]).toBe('disconnect_all');

    await connections.connected();
    expect(lastCall()[0]).toBe('connected_ids');

    await connections.storageInfo();
    expect(lastCall()[0]).toBe('storage_info');
  });
});

describe('catalog', () => {
  it('scopes every lookup to a connection and database', async () => {
    await catalog.databases(scope);
    expect(lastCall()).toEqual(['list_databases', scope]);

    await catalog.schemas(scope);
    expect(lastCall()).toEqual(['list_schemas', scope]);

    await catalog.extensions(scope);
    expect(lastCall()).toEqual(['list_extensions', scope]);
  });

  it('passes the relation kinds through', async () => {
    await catalog.relations({ ...scope, schema: 'public', kinds: ['table', 'view'] });
    const [command, args] = lastCall();
    expect(command).toBe('list_relations');
    expect(args.kinds).toEqual(['table', 'view']);
  });

  it('scopes the table lookups to a relation', async () => {
    const table = { ...scope, schema: 'public', table: 'orders' };
    for (const [method, command] of [
      [catalog.columns, 'table_columns'],
      [catalog.indexes, 'table_indexes'],
      [catalog.constraints, 'table_constraints'],
      [catalog.statistics, 'table_statistics'],
      [catalog.definition, 'table_definition'],
    ] as const) {
      await method(table);
      expect(lastCall()).toEqual([command, table]);
    }
  });

  it('sends the search term', async () => {
    await catalog.search({ ...scope, term: 'ord' });
    expect(lastCall()).toEqual(['global_search', { ...scope, term: 'ord' }]);
  });
});

describe('data', () => {
  it('sends a browse request', async () => {
    const request = {
      schema: 'public',
      table: 'orders',
      limit: 100,
      offset: 0,
      sort: [],
      filters: [],
      search: null,
      exactCount: false,
    };
    await data.browse({ ...scope, request });
    expect(lastCall()).toEqual(['browse_table', { ...scope, request }]);
  });

  it('maps the write commands', async () => {
    await data.updateCell({ ...scope, change: {} as never });
    expect(lastCall()[0]).toBe('update_cell');

    await data.insertRow({ ...scope, request: {} as never });
    expect(lastCall()[0]).toBe('insert_row');

    await data.deleteRows({ ...scope, request: {} as never });
    expect(lastCall()[0]).toBe('delete_rows');
  });
});

describe('structure', () => {
  it('maps every DDL command', async () => {
    await structure.addColumn({ ...scope, request: {} as never });
    expect(lastCall()[0]).toBe('add_column');

    await structure.alterColumn({ ...scope, request: {} as never });
    expect(lastCall()[0]).toBe('alter_column');

    await structure.renameRelation({
      ...scope,
      schema: 'public',
      table: 'a',
      newName: 'b',
    });
    expect(lastCall()).toEqual([
      'rename_relation',
      { ...scope, schema: 'public', table: 'a', newName: 'b' },
    ]);

    await structure.truncate({ ...scope, schema: 'public', table: 'a' });
    expect(lastCall()[0]).toBe('truncate_table');

    await structure.drop({ ...scope, schema: 'public', table: 'a', cascade: true });
    expect(lastCall()[1].cascade).toBe(true);

    await structure.setExtension({ ...scope, name: 'pg_trgm', action: 'install' });
    expect(lastCall()).toEqual(['set_extension', { ...scope, name: 'pg_trgm', action: 'install' }]);
  });
});

describe('sql', () => {
  it('runs a script and explains a statement', async () => {
    await sql.run({ ...scope, sql: 'SELECT 1' });
    expect(lastCall()).toEqual(['run_sql', { ...scope, sql: 'SELECT 1' }]);

    await sql.explain({ ...scope, sql: 'SELECT 1', analyze: true });
    expect(lastCall()[1].analyze).toBe(true);
  });
});

describe('transfer', () => {
  it('maps the import and export commands', async () => {
    await transfer.exportRows({ path: '/tmp/a.csv' } as never);
    expect(lastCall()[0]).toBe('export_rows');

    await transfer.previewImport('/tmp/a.csv', true, ',');
    expect(lastCall()).toEqual([
      'preview_import',
      { path: '/tmp/a.csv', hasHeader: true, delimiter: ',' },
    ]);

    await transfer.importRows({ ...scope, request: {} as never });
    expect(lastCall()[0]).toBe('import_rows');
  });

  it('carries the progress token for a backup and a restore', async () => {
    await transfer.backup({ connectionId: 'c1', request: {} as never, token: 'tok' });
    expect(lastCall()).toEqual([
      'backup_database',
      { connectionId: 'c1', request: {}, token: 'tok' },
    ]);

    await transfer.restore({ connectionId: 'c1', request: {} as never, token: 'tok' });
    expect(lastCall()[1].token).toBe('tok');
  });
});

describe('prefs', () => {
  it('maps every preference command', async () => {
    await prefs.settings();
    expect(lastCall()[0]).toBe('get_settings');

    await prefs.saveSettings({} as never);
    expect(lastCall()[0]).toBe('save_settings');

    await prefs.resetSettings();
    expect(lastCall()[0]).toBe('reset_settings');

    await prefs.workspace();
    expect(lastCall()[0]).toBe('get_workspace');

    await prefs.saveWorkspace({} as never);
    expect(lastCall()[0]).toBe('save_workspace');

    await prefs.history();
    expect(lastCall()[0]).toBe('get_history');

    await prefs.clearHistory();
    expect(lastCall()[0]).toBe('clear_history');

    await prefs.savedQueries();
    expect(lastCall()[0]).toBe('list_saved_queries');

    await prefs.saveQuery({ id: '', name: 'x' } as never);
    expect(lastCall()[0]).toBe('save_query');

    await prefs.deleteQuery('q1');
    expect(lastCall()).toEqual(['delete_saved_query', { id: 'q1' }]);
  });
});
