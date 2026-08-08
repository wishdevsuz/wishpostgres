import {
  Boxes,
  Braces,
  Copy,
  Database,
  Eraser,
  Eye,
  FileCode2,
  Layers,
  Pencil,
  RefreshCw,
  Search,
  Star,
  Table2,
  Terminal,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { PromptDialog } from '@/components/dialogs/PromptDialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/form';
import { Tooltip } from '@/components/ui/misc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/menu';
import { TreeItem, TreeMessage, TreeSection, TreeSkeleton } from '@/components/layout/tree';
import { useClipboard } from '@/hooks/use-clipboard';
import { useDatabases, useRelations, useSchemas } from '@/hooks/use-catalog';
import { isTableKind, relationNoun, useRelationActions } from '@/hooks/use-relation-actions';
import { useResetOnScopeChange, useSchemaFocus } from '@/hooks/use-scope-sync';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { formatBytes, formatCount } from '@/utils/format';
import { notify } from '@/utils/notify';
import type { RelationInfo, RelationKind, TableTarget } from '@/types';

const TABLE_KINDS: RelationKind[] = ['table', 'partitionedTable', 'foreignTable'];
const VIEW_KINDS: RelationKind[] = ['view', 'materializedView'];

type Pending =
  | { kind: 'rename'; target: TableTarget }
  | { kind: 'truncate'; target: TableTarget }
  | { kind: 'drop'; target: TableTarget }
  | null;

export function ObjectTree() {
  const activeId = useConnectionStore((state) => state.activeId);
  const activeDatabase = useConnectionStore((state) => state.activeDatabase);
  const connect = useConnectionStore((state) => state.connect);

  const schema = useWorkspaceStore((state) => state.schema);
  const setSchema = useWorkspaceStore((state) => state.setSchema);
  const setView = useWorkspaceStore((state) => state.setView);
  const view = useWorkspaceStore((state) => state.view);

  const [open, setOpen] = useState({ databases: true, schemas: true, tables: true, views: false });
  const [filter, setFilter] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [cascade, setCascade] = useState(false);

  const databases = useDatabases();
  const schemas = useSchemas();
  const tables = useRelations(schema, TABLE_KINDS);
  const views = useRelations(schema, VIEW_KINDS);
  const actions = useRelationActions();

  // Land on a schema that exists in the database the user just opened.
  useSchemaFocus(schemas.data, schemas.isLoading);

  // A filter typed for one database is meaningless in the next one.
  useResetOnScopeChange(useCallback(() => setFilter(''), []));

  const term = filter.trim().toLowerCase();
  const matches = useCallback(
    (value: string) => !term || value.toLowerCase().includes(term),
    [term],
  );

  const connectable = useMemo(
    () =>
      (databases.data ?? []).filter(
        (entry) => entry.canConnect && !entry.isTemplate && matches(entry.name),
      ),
    [databases.data, matches],
  );

  const userSchemas = useMemo(
    () => (schemas.data ?? []).filter((entry) => !entry.isSystem && matches(entry.name)),
    [schemas.data, matches],
  );

  const visibleTables = useMemo(
    () => (tables.data ?? []).filter((relation) => matches(relation.name)),
    [tables.data, matches],
  );

  const visibleViews = useMemo(
    () => (views.data ?? []).filter((relation) => matches(relation.name)),
    [views.data, matches],
  );

  const request = useCallback((next: Pending) => {
    setCascade(false);
    setPending(next);
  }, []);

  if (!activeId || !activeDatabase) return null;

  const noun = pending ? relationNoun(pending.target.kind) : 'table';

  return (
    <div className="space-y-1">
      <div className="px-1 pb-1">
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter objects"
          leading={<Search />}
          className="h-7 text-[12px]"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFilter('');
          }}
          trailing={
            filter ? (
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Clear filter"
                onClick={() => setFilter('')}
              >
                <X />
              </Button>
            ) : undefined
          }
        />
      </div>

      <TreeSection
        label="Databases"
        icon={<Database />}
        open={open.databases}
        onToggle={() => setOpen((state) => ({ ...state, databases: !state.databases }))}
        count={connectable.length}
        loading={databases.isFetching}
        actions={
          <Tooltip content="Reload databases">
            <Button
              variant="ghost"
              size="iconXs"
              aria-label="Reload databases"
              onClick={() => void databases.refetch()}
            >
              <RefreshCw />
            </Button>
          </Tooltip>
        }
      >
        {databases.isLoading ? (
          <TreeSkeleton />
        ) : connectable.length === 0 ? (
          <TreeMessage>
            {term ? 'No databases match that filter.' : 'No databases you can connect to.'}
          </TreeMessage>
        ) : (
          connectable.map((entry) => (
            <TreeItem
              key={entry.name}
              depth={1}
              icon={<Database />}
              label={entry.name}
              meta={formatBytes(entry.size)}
              title={`${entry.name} · owner ${entry.owner} · ${entry.encoding}`}
              active={entry.name === activeDatabase}
              onClick={() => {
                if (entry.name === activeDatabase) return;
                void connect(activeId, entry.name).catch((error) =>
                  notify.failure(error, `Could not open ${entry.name}`),
                );
              }}
            />
          ))
        )}
      </TreeSection>

      <TreeSection
        label="Schemas"
        icon={<Layers />}
        open={open.schemas}
        onToggle={() => setOpen((state) => ({ ...state, schemas: !state.schemas }))}
        count={userSchemas.length}
        loading={schemas.isFetching}
        actions={
          <Tooltip content="Reload schemas">
            <Button
              variant="ghost"
              size="iconXs"
              aria-label="Reload schemas"
              onClick={() => void schemas.refetch()}
            >
              <RefreshCw />
            </Button>
          </Tooltip>
        }
      >
        {schemas.isLoading ? (
          <TreeSkeleton rows={2} />
        ) : userSchemas.length === 0 ? (
          <TreeMessage>
            {term ? 'No schemas match that filter.' : 'This database has no user schemas.'}
          </TreeMessage>
        ) : (
          userSchemas.map((entry) => (
            <TreeItem
              key={entry.name}
              depth={1}
              icon={<Layers />}
              label={entry.name}
              title={`${entry.name} · owner ${entry.owner}`}
              active={entry.name === schema}
              onClick={() => setSchema(entry.name)}
            />
          ))
        )}
      </TreeSection>

      <RelationSection
        label="Tables"
        icon={<Table2 />}
        open={open.tables}
        onToggle={() => setOpen((state) => ({ ...state, tables: !state.tables }))}
        relations={visibleTables}
        loading={tables.isLoading}
        fetching={tables.isFetching}
        onRefresh={() => void tables.refetch()}
        onRequest={request}
        emptyMessage={term ? 'No tables match that filter.' : 'This schema has no tables.'}
      />

      <RelationSection
        label="Views"
        icon={<Eye />}
        open={open.views}
        onToggle={() => setOpen((state) => ({ ...state, views: !state.views }))}
        relations={visibleViews}
        loading={views.isLoading}
        fetching={views.isFetching}
        onRefresh={() => void views.refetch()}
        onRequest={request}
        emptyMessage={term ? 'No views match that filter.' : 'This schema has no views.'}
      />

      <div className="space-y-px pt-1">
        <TreeItem
          icon={<FileCode2 />}
          label="Functions"
          depth={0}
          onClick={() => setView('functions')}
          active={view === 'functions'}
        />
        <TreeItem
          icon={<Boxes />}
          label="Extensions"
          depth={0}
          active={view === 'extensions'}
          onClick={() => setView('extensions')}
        />
        <TreeItem
          icon={<Braces />}
          label="Query history"
          depth={0}
          active={view === 'history'}
          onClick={() => setView('history')}
        />
      </div>

      <PromptDialog
        open={pending?.kind === 'rename'}
        onOpenChange={(next) => !next && setPending(null)}
        title={`Rename ${noun}`}
        description={pending ? `${pending.target.schema}.${pending.target.table}` : undefined}
        label="New name"
        hint="Views, indexes and constraints that reference it follow the rename."
        placeholder="new_name"
        initialValue={pending?.target.table ?? ''}
        confirmLabel="Rename"
        onSubmit={async (value) => {
          if (pending) await actions.rename(pending.target, value);
        }}
      />

      <ConfirmDialog
        open={pending?.kind === 'truncate'}
        onOpenChange={(next) => !next && setPending(null)}
        title={`Truncate ${pending?.target.table ?? ''}?`}
        description="Every row is removed immediately. This cannot be undone."
        confirmLabel="Truncate table"
        destructive
        requireConfirmation
        confirmationWord={pending?.target.table ?? 'truncate'}
        onConfirm={async () => {
          if (pending) await actions.truncate(pending.target);
        }}
      />

      <ConfirmDialog
        open={pending?.kind === 'drop'}
        onOpenChange={(next) => !next && setPending(null)}
        title={`Drop ${pending?.target.table ?? ''}?`}
        description={`The ${noun} and everything in it are removed permanently.`}
        confirmLabel={`Drop ${noun}`}
        destructive
        requireConfirmation
        confirmationWord={pending?.target.table ?? 'drop'}
        onConfirm={async () => {
          if (pending) await actions.drop(pending.target, cascade);
        }}
      >
        <CheckboxField
          id="tree-drop-cascade"
          label="Also drop dependent objects (CASCADE)"
          hint="Without this the statement fails when a view or foreign key still depends on it."
          checked={cascade}
          onCheckedChange={setCascade}
        />
      </ConfirmDialog>
    </div>
  );
}

function RelationSection({
  label,
  icon,
  open,
  onToggle,
  relations,
  loading,
  fetching,
  emptyMessage,
  onRefresh,
  onRequest,
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  relations: RelationInfo[];
  loading: boolean;
  fetching: boolean;
  emptyMessage: string;
  onRefresh: () => void;
  onRequest: (pending: Pending) => void;
}) {
  const openTable = useWorkspaceStore((state) => state.openTable);
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);
  const isFavorite = useWorkspaceStore((state) => state.isFavorite);
  const current = useWorkspaceStore((state) => state.table);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const copy = useClipboard();

  return (
    <TreeSection
      label={label}
      icon={icon}
      open={open}
      onToggle={onToggle}
      count={relations.length}
      loading={fetching && !loading}
      actions={
        <Tooltip content={`Reload ${label.toLowerCase()}`}>
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={`Reload ${label.toLowerCase()}`}
            onClick={onRefresh}
          >
            <RefreshCw />
          </Button>
        </Tooltip>
      }
    >
      {loading ? (
        <TreeSkeleton rows={5} />
      ) : relations.length === 0 ? (
        <TreeMessage>{emptyMessage}</TreeMessage>
      ) : (
        relations.map((relation) => {
          const target: TableTarget = {
            schema: relation.schema,
            table: relation.name,
            kind: relation.kind,
          };
          const qualified = `${relation.schema}.${relation.name}`;
          const favorite =
            connectionId && database
              ? isFavorite({
                  connectionId,
                  database,
                  schema: relation.schema,
                  table: relation.name,
                })
              : false;

          return (
            <ContextMenu key={qualified}>
              <ContextMenuTrigger asChild>
                <div>
                  <TreeItem
                    depth={1}
                    icon={relationIcon(relation.kind)}
                    label={relation.name}
                    title={relation.comment ?? qualified}
                    active={current?.schema === relation.schema && current?.table === relation.name}
                    onClick={() => openTable(target)}
                    meta={
                      relation.estimatedRows !== null
                        ? `~${formatCount(relation.estimatedRows)}`
                        : undefined
                    }
                    actions={
                      connectionId && database ? (
                        <Tooltip content={favorite ? 'Remove favorite' : 'Add favorite'}>
                          <Button
                            variant="ghost"
                            size="iconXs"
                            aria-label="Toggle favorite"
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleFavorite({
                                connectionId,
                                database,
                                schema: relation.schema,
                                table: relation.name,
                              });
                            }}
                          >
                            <Star className={favorite ? 'fill-caution text-caution' : ''} />
                          </Button>
                        </Tooltip>
                      ) : undefined
                    }
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="min-w-[210px]">
                <ContextMenuLabel>{qualified}</ContextMenuLabel>
                <ContextMenuItem onSelect={() => openTable(target)}>
                  <Table2 /> Browse data
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => openTable(target, 'structure')}>
                  <Type /> Structure
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => openTable(target, 'sql')}>
                  <FileCode2 /> View definition
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => {
                    const tab = addTab();
                    updateTab(tab.id, {
                      name: relation.name,
                      sql: `SELECT *\nFROM "${relation.schema}"."${relation.name}"\nLIMIT 100;`,
                    });
                  }}
                >
                  <Terminal /> Query in a new tab
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => void copy(qualified, 'Name copied')}>
                  <Copy /> Copy qualified name
                </ContextMenuItem>
                {connectionId && database && (
                  <ContextMenuItem
                    onSelect={() =>
                      toggleFavorite({
                        connectionId,
                        database,
                        schema: relation.schema,
                        table: relation.name,
                      })
                    }
                  >
                    <Star /> {favorite ? 'Remove from favorites' : 'Add to favorites'}
                  </ContextMenuItem>
                )}
                <ContextMenuItem onSelect={() => onRequest({ kind: 'rename', target })}>
                  <Pencil /> Rename…
                </ContextMenuItem>
                <ContextMenuSeparator />
                {isTableKind(relation.kind) && (
                  <ContextMenuItem danger onSelect={() => onRequest({ kind: 'truncate', target })}>
                    <Eraser /> Truncate…
                  </ContextMenuItem>
                )}
                <ContextMenuItem danger onSelect={() => onRequest({ kind: 'drop', target })}>
                  <Trash2 /> Drop {relationNoun(relation.kind)}…
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })
      )}
    </TreeSection>
  );
}

function relationIcon(kind: RelationKind) {
  if (kind === 'view' || kind === 'materializedView') return <Eye />;
  return <Table2 />;
}
