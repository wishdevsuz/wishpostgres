import {
  Boxes,
  Braces,
  Database,
  Eye,
  FileCode2,
  Layers,
  Search,
  Star,
  Table2,
  Trash2,
  Type,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/menu';
import { TreeItem, TreeMessage, TreeSection, TreeSkeleton } from '@/components/layout/tree';
import { useDatabases, useRelations, useSchemas } from '@/hooks/use-catalog';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { formatBytes, formatCount } from '@/utils/format';
import { notify } from '@/utils/notify';
import type { RelationInfo, RelationKind } from '@/types';

const TABLE_KINDS: RelationKind[] = ['table', 'partitionedTable', 'foreignTable'];
const VIEW_KINDS: RelationKind[] = ['view', 'materializedView'];

export function ObjectTree() {
  const activeId = useConnectionStore((state) => state.activeId);
  const activeDatabase = useConnectionStore((state) => state.activeDatabase);
  const connect = useConnectionStore((state) => state.connect);

  const schema = useWorkspaceStore((state) => state.schema);
  const setSchema = useWorkspaceStore((state) => state.setSchema);
  const setView = useWorkspaceStore((state) => state.setView);

  const [open, setOpen] = useState({ databases: true, schemas: true, tables: true, views: false });
  const [filter, setFilter] = useState('');

  const databases = useDatabases();
  const schemas = useSchemas();
  const tables = useRelations(schema, TABLE_KINDS);
  const views = useRelations(schema, VIEW_KINDS);

  const connectable = useMemo(
    () => (databases.data ?? []).filter((entry) => entry.canConnect && !entry.isTemplate),
    [databases.data],
  );

  const userSchemas = useMemo(
    () => (schemas.data ?? []).filter((entry) => !entry.isSystem),
    [schemas.data],
  );

  if (!activeId || !activeDatabase) return null;

  const filterRelations = (list: RelationInfo[] | undefined) => {
    const term = filter.trim().toLowerCase();
    if (!list) return [];
    if (!term) return list;
    return list.filter((relation) => relation.name.toLowerCase().includes(term));
  };

  const visibleTables = filterRelations(tables.data);
  const visibleViews = filterRelations(views.data);

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
        />
      </div>

      <TreeSection
        label="Databases"
        icon={<Database />}
        open={open.databases}
        onToggle={() => setOpen((state) => ({ ...state, databases: !state.databases }))}
        count={connectable.length}
        loading={databases.isFetching}
      >
        {databases.isLoading ? (
          <TreeSkeleton />
        ) : connectable.length === 0 ? (
          <TreeMessage>No databases you can connect to.</TreeMessage>
        ) : (
          connectable.map((entry) => (
            <TreeItem
              key={entry.name}
              depth={1}
              icon={<Database />}
              label={entry.name}
              meta={formatBytes(entry.size)}
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
      >
        {schemas.isLoading ? (
          <TreeSkeleton rows={2} />
        ) : (
          userSchemas.map((entry) => (
            <TreeItem
              key={entry.name}
              depth={1}
              icon={<Layers />}
              label={entry.name}
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
        emptyMessage={filter ? 'No tables match that filter.' : 'This schema has no tables.'}
      />

      <RelationSection
        label="Views"
        icon={<Eye />}
        open={open.views}
        onToggle={() => setOpen((state) => ({ ...state, views: !state.views }))}
        relations={visibleViews}
        loading={views.isLoading}
        fetching={views.isFetching}
        emptyMessage={filter ? 'No views match that filter.' : 'This schema has no views.'}
      />

      <div className="space-y-px pt-1">
        <TreeItem
          icon={<FileCode2 />}
          label="Functions"
          depth={0}
          onClick={() => setView('functions')}
          active={useWorkspaceStore.getState().view === 'functions'}
        />
        <TreeItem icon={<Boxes />} label="Extensions" depth={0} onClick={() => setView('extensions')} />
        <TreeItem icon={<Braces />} label="Query history" depth={0} onClick={() => setView('history')} />
      </div>
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
}: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  relations: RelationInfo[];
  loading: boolean;
  fetching: boolean;
  emptyMessage: string;
}) {
  const openTable = useWorkspaceStore((state) => state.openTable);
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);
  const isFavorite = useWorkspaceStore((state) => state.isFavorite);
  const current = useWorkspaceStore((state) => state.table);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);

  return (
    <TreeSection
      label={label}
      icon={icon}
      open={open}
      onToggle={onToggle}
      count={relations.length}
      loading={fetching && !loading}
    >
      {loading ? (
        <TreeSkeleton rows={5} />
      ) : relations.length === 0 ? (
        <TreeMessage>{emptyMessage}</TreeMessage>
      ) : (
        relations.map((relation) => {
          const favorite =
            connectionId && database
              ? isFavorite({ connectionId, database, schema: relation.schema, table: relation.name })
              : false;

          return (
            <ContextMenu key={`${relation.schema}.${relation.name}`}>
              <ContextMenuTrigger asChild>
                <div>
                  <TreeItem
                    depth={1}
                    icon={relationIcon(relation.kind)}
                    label={relation.name}
                    title={relation.comment ?? relation.name}
                    active={current?.schema === relation.schema && current?.table === relation.name}
                    onClick={() => openTable({ schema: relation.schema, table: relation.name, kind: relation.kind })}
                    meta={
                      relation.estimatedRows !== null ? `~${formatCount(relation.estimatedRows)}` : undefined
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
              <ContextMenuContent>
                <ContextMenuItem
                  onSelect={() => openTable({ schema: relation.schema, table: relation.name, kind: relation.kind })}
                >
                  <Table2 /> Browse data
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    openTable({ schema: relation.schema, table: relation.name, kind: relation.kind }, 'structure')
                  }
                >
                  <Type /> Structure
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() =>
                    openTable({ schema: relation.schema, table: relation.name, kind: relation.kind }, 'sql')
                  }
                >
                  <FileCode2 /> View definition
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem
                  danger
                  onSelect={() =>
                    openTable({ schema: relation.schema, table: relation.name, kind: relation.kind }, 'structure')
                  }
                >
                  <Trash2 /> Drop or truncate…
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
