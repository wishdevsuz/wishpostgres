export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type TypeCategory =
  | 'number'
  | 'text'
  | 'boolean'
  | 'date'
  | 'time'
  | 'timestamp'
  | 'json'
  | 'uuid'
  | 'enum'
  | 'array'
  | 'binary'
  | 'network'
  | 'geometric'
  | 'interval'
  | 'other';

export type RelationKind = 'table' | 'view' | 'materializedView' | 'foreignTable' | 'partitionedTable';

export type IdentityKind = 'primaryKey' | 'unique' | 'ctid' | 'none';

export type SortDirection = 'asc' | 'desc';

export type FilterOperator =
  | 'equals'
  | 'notEquals'
  | 'greaterThan'
  | 'greaterOrEqual'
  | 'lessThan'
  | 'lessOrEqual'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isNull'
  | 'isNotNull';

export type ExportFormat = 'csv' | 'json' | 'xlsx' | 'sqlInsert' | 'sqlCopy';

export interface ErrorReport {
  message: string;
  kind: string;
  sqlstate: string | null;
  detail: string | null;
  hint: string | null;
  position: number | null;
  reason: string | null;
  suggestion: string | null;
}

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  database: string;
  ssl: boolean;
  verifyCertificate: boolean;
  favorite: boolean;
  color: string | null;
  searchPath: string | null;
  statementTimeoutMs: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  hasPassword: boolean;
}

export interface ServerInfo {
  version: string;
  versionNumber: number;
  currentUser: string;
  currentDatabase: string;
  isSuperuser: boolean;
}

export interface DatabaseInfo {
  name: string;
  owner: string;
  encoding: string;
  size: number | null;
  isTemplate: boolean;
  canConnect: boolean;
}

export interface SchemaInfo {
  name: string;
  owner: string;
  isSystem: boolean;
}

export interface RelationInfo {
  schema: string;
  name: string;
  kind: RelationKind;
  owner: string;
  size: number | null;
  estimatedRows: number | null;
  comment: string | null;
}

export interface FunctionInfo {
  schema: string;
  name: string;
  arguments: string;
  returns: string;
  language: string;
  kind: string;
}

export interface ExtensionInfo {
  name: string;
  schema: string | null;
  installedVersion: string | null;
  defaultVersion: string | null;
  comment: string | null;
  installed: boolean;
}

export interface ColumnMeta {
  name: string;
  dataType: string;
  typeCategory: TypeCategory;
  nullable: boolean;
  default: string | null;
  isPrimaryKey: boolean;
  isUnique: boolean;
  isIdentity: boolean;
  isGenerated: boolean;
  comment: string | null;
  ordinal: number;
  enumValues: string[];
  maxLength: number | null;
}

export interface ResultColumn {
  name: string;
  dataType: string;
  typeCategory: TypeCategory;
}

export interface QueryResult {
  columns: ResultColumn[];
  rows: JsonValue[][];
  rowCount: number;
  affectedRows: number | null;
  durationMs: number;
  command: string;
  truncated: boolean;
}

export interface RowIdentity {
  kind: IdentityKind;
  columns: string[];
}

export interface BrowseResult {
  columns: ColumnMeta[];
  rows: JsonValue[][];
  totalRows: number | null;
  isEstimate: boolean;
  durationMs: number;
  identity: RowIdentity;
  identityValues: JsonValue[][];
  editable: boolean;
}

export interface SortSpec {
  column: string;
  direction: SortDirection;
}

export interface FilterSpec {
  column: string;
  operator: FilterOperator;
  value: string | null;
}

export interface BrowseRequest {
  schema: string;
  table: string;
  limit: number;
  offset: number;
  sort: SortSpec[];
  filters: FilterSpec[];
  search: string | null;
  exactCount: boolean;
}

export interface IndexInfo {
  name: string;
  definition: string;
  isUnique: boolean;
  isPrimary: boolean;
  isValid: boolean;
  size: number | null;
  scans: number | null;
  columns: string[];
}

export interface ConstraintInfo {
  name: string;
  kind: string;
  definition: string;
  isDeferrable: boolean;
}

export interface ColumnStatistic {
  column: string;
  nullFraction: number | null;
  distinctValues: number | null;
  averageWidth: number | null;
  mostCommon: string[];
}

export interface TableStatistics {
  liveRows: number | null;
  deadRows: number | null;
  totalSize: number | null;
  tableSize: number | null;
  indexSize: number | null;
  toastSize: number | null;
  sequentialScans: number | null;
  indexScans: number | null;
  inserts: number | null;
  updates: number | null;
  deletes: number | null;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  columnStats: ColumnStatistic[];
}

export interface SearchHit {
  kind: string;
  schema: string;
  name: string;
  detail: string | null;
  parent: string | null;
}

export interface FieldValue {
  column: string;
  value: string | null;
  useDefault: boolean;
}

export interface InsertRequest {
  schema: string;
  table: string;
  values: FieldValue[];
}

export interface RowChange {
  schema: string;
  table: string;
  identity: RowIdentity;
  identityValues: JsonValue[];
  column: string;
  value: string | null;
}

export interface DeleteRequest {
  schema: string;
  table: string;
  identity: RowIdentity;
  rows: JsonValue[][];
}

export interface ExportRequest {
  path: string;
  format: ExportFormat;
  columns: string[];
  rows: JsonValue[][];
  tableName: string | null;
  includeHeader: boolean;
}

export interface ImportPreview {
  columns: string[];
  rows: (string | null)[][];
  totalRows: number;
  truncated: boolean;
}

export interface ColumnMapping {
  source: string;
  target: string;
}

export interface ImportRequest {
  path: string;
  schema: string;
  table: string;
  mapping: ColumnMapping[];
  hasHeader: boolean;
  delimiter: string | null;
  truncateFirst: boolean;
  stopOnError: boolean;
  nullLiteral: string | null;
}

export interface ImportOutcome {
  inserted: number;
  failed: number;
  errors: string[];
  durationMs: number;
}

export interface BackupRequest {
  database: string;
  path: string;
  schemaOnly: boolean;
  dataOnly: boolean;
  includeDrop: boolean;
  includeCreate: boolean;
  schemas: string[];
  tables: string[];
  binaryDirectory: string | null;
}

export interface RestoreRequest {
  database: string;
  path: string;
  stopOnError: boolean;
  singleTransaction: boolean;
  binaryDirectory: string | null;
}

export interface TransferOutcome {
  path: string;
  bytes: number;
  durationMs: number;
  warnings: string[];
}

export interface TransferProgress {
  token: string;
  stage: string;
  percent: number | null;
  message: string;
  done: boolean;
}

export interface AppSettings {
  autoReconnect: boolean;
  queryTimeoutSeconds: number;
  rowsPerPage: number;
  animations: boolean;
  confirmBeforeDelete: boolean;
  openLastConnection: boolean;
  defaultSchema: string;
  statementTimeoutMs: number;
  checkUpdates: boolean;
  maxHistoryEntries: number;
  binaryDirectory: string | null;
  fontSize: number;
}

export interface SqlTab {
  id: string;
  name: string;
  sql: string;
  connectionId: string | null;
  database: string | null;
}

export interface FavoriteTable {
  connectionId: string;
  database: string;
  schema: string;
  table: string;
}

export interface Workspace {
  lastConnectionId: string | null;
  lastDatabase: string | null;
  lastSchema: string | null;
  sqlTabs: SqlTab[];
  activeTabId: string | null;
  favoriteTables: FavoriteTable[];
  sidebarWidth: number | null;
}

export interface HistoryEntry {
  id: string;
  sql: string;
  connectionId: string;
  connectionName: string;
  database: string;
  executedAt: string;
  durationMs: number;
  rowCount: number | null;
  affectedRows: number | null;
  success: boolean;
  errorMessage: string | null;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  description: string | null;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StorageInfo {
  configDirectory: string;
  secretBackend: 'keyring' | 'encryptedFile';
  pgDumpVersion: string | null;
  psqlVersion: string | null;
}

export type TableTab = 'browse' | 'structure' | 'sql' | 'indexes' | 'constraints' | 'statistics';

export type MainView = 'welcome' | 'table' | 'query' | 'functions' | 'extensions' | 'history';

export interface TableTarget {
  schema: string;
  table: string;
  kind: RelationKind;
}
