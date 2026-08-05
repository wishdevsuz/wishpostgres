import { call } from './tauri';

import type {
  AppSettings,
  BackupRequest,
  BrowseRequest,
  BrowseResult,
  ColumnMeta,
  ConstraintInfo,
  DatabaseInfo,
  DeleteRequest,
  ExportRequest,
  ExtensionInfo,
  FunctionInfo,
  HistoryEntry,
  ImportOutcome,
  ImportPreview,
  ImportRequest,
  IndexInfo,
  InsertRequest,
  QueryResult,
  RelationInfo,
  RelationKind,
  RestoreRequest,
  RowChange,
  SavedConnection,
  SavedQuery,
  SchemaInfo,
  SearchHit,
  ServerInfo,
  StorageInfo,
  TableStatistics,
  TransferOutcome,
  Workspace,
} from '@/types';

interface Scope {
  connectionId: string;
  database: string;
}

interface TableScope extends Scope {
  schema: string;
  table: string;
}

export const connections = {
  list: () => call<SavedConnection[]>('list_connections'),
  save: (connection: SavedConnection, password?: string) =>
    call<SavedConnection>('save_connection', { draft: { ...connection, password } }),
  remove: (id: string) => call<void>('delete_connection', { id }),
  test: (connection: SavedConnection, password?: string) =>
    call<ServerInfo>('test_connection', { draft: { ...connection, password } }),
  connect: (id: string, database?: string) => call<ServerInfo>('connect', { id, database }),
  disconnect: (id: string) => call<void>('disconnect', { id }),
  disconnectAll: () => call<void>('disconnect_all'),
  connected: () => call<string[]>('connected_ids'),
  storageInfo: () => call<StorageInfo>('storage_info'),
};

export const catalog = {
  databases: (scope: Scope) => call<DatabaseInfo[]>('list_databases', { ...scope }),
  schemas: (scope: Scope) => call<SchemaInfo[]>('list_schemas', { ...scope }),
  relations: (scope: Scope & { schema: string; kinds: RelationKind[] }) =>
    call<RelationInfo[]>('list_relations', { ...scope }),
  functions: (scope: Scope & { schema: string }) => call<FunctionInfo[]>('list_functions', { ...scope }),
  extensions: (scope: Scope) => call<ExtensionInfo[]>('list_extensions', { ...scope }),
  columns: (scope: TableScope) => call<ColumnMeta[]>('table_columns', { ...scope }),
  indexes: (scope: TableScope) => call<IndexInfo[]>('table_indexes', { ...scope }),
  constraints: (scope: TableScope) => call<ConstraintInfo[]>('table_constraints', { ...scope }),
  statistics: (scope: TableScope) => call<TableStatistics>('table_statistics', { ...scope }),
  definition: (scope: TableScope) => call<string>('table_definition', { ...scope }),
  search: (scope: Scope & { term: string }) => call<SearchHit[]>('global_search', { ...scope }),
};

export const data = {
  browse: (scope: Scope & { request: BrowseRequest }) => call<BrowseResult>('browse_table', { ...scope }),
  updateCell: (scope: Scope & { change: RowChange }) => call<number>('update_cell', { ...scope }),
  insertRow: (scope: Scope & { request: InsertRequest }) => call<number>('insert_row', { ...scope }),
  deleteRows: (scope: Scope & { request: DeleteRequest }) => call<number>('delete_rows', { ...scope }),
};

export const structure = {
  addColumn: (
    scope: Scope & {
      request: {
        schema: string;
        table: string;
        name: string;
        dataType: string;
        nullable: boolean;
        default: string | null;
        unique: boolean;
        comment: string | null;
      };
    },
  ) => call<string>('add_column', { ...scope }),
  alterColumn: (
    scope: Scope & {
      request: {
        schema: string;
        table: string;
        column: string;
        action: Record<string, unknown>;
      };
    },
  ) => call<string>('alter_column', { ...scope }),
  renameRelation: (scope: TableScope & { newName: string }) => call<string>('rename_relation', { ...scope }),
  truncate: (scope: TableScope) => call<string>('truncate_table', { ...scope }),
  drop: (scope: TableScope & { cascade: boolean }) => call<string>('drop_relation', { ...scope }),
};

export const sql = {
  run: (scope: Scope & { sql: string }) => call<QueryResult[]>('run_sql', { ...scope }),
  explain: (scope: Scope & { sql: string; analyze: boolean }) => call<string>('explain_sql', { ...scope }),
};

export const transfer = {
  exportRows: (request: ExportRequest) => call<number>('export_rows', { request }),
  previewImport: (path: string, hasHeader: boolean, delimiter: string | null) =>
    call<ImportPreview>('preview_import', { path, hasHeader, delimiter }),
  importRows: (scope: Scope & { request: ImportRequest }) => call<ImportOutcome>('import_rows', { ...scope }),
  backup: (scope: { connectionId: string; request: BackupRequest; token: string }) =>
    call<TransferOutcome>('backup_database', { ...scope }),
  restore: (scope: { connectionId: string; request: RestoreRequest; token: string }) =>
    call<TransferOutcome>('restore_database', { ...scope }),
};

export const prefs = {
  settings: () => call<AppSettings>('get_settings'),
  saveSettings: (settings: AppSettings) => call<AppSettings>('save_settings', { settings }),
  resetSettings: () => call<AppSettings>('reset_settings'),
  workspace: () => call<Workspace>('get_workspace'),
  saveWorkspace: (workspace: Workspace) => call<void>('save_workspace', { workspace }),
  history: () => call<HistoryEntry[]>('get_history'),
  clearHistory: () => call<void>('clear_history'),
  savedQueries: () => call<SavedQuery[]>('list_saved_queries'),
  saveQuery: (query: SavedQuery) => call<SavedQuery>('save_query', { query }),
  deleteQuery: (id: string) => call<void>('delete_saved_query', { id }),
};
