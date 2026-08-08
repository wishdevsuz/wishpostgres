import { Boxes, Database, Eye, FileCode2, Search, Table2, Terminal, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useDatabases, useFunctions, useRelations, useScope } from '@/hooks/use-catalog';
import { useDebounced } from '@/hooks/use-debounced';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { formatBytes, formatCount } from '@/utils/format';
import type { RelationInfo, RelationKind } from '@/types';

const TABLE_KINDS: RelationKind[] = ['table', 'partitionedTable', 'foreignTable'];
const VIEW_KINDS: RelationKind[] = ['view', 'materializedView'];

/**
 * What the main pane shows once a database is open: everything inside it, laid
 * out so a relation can be found and opened without hunting through the tree.
 */
export function DatabaseOverviewPage() {
  const { database } = useScope();
  const schema = useWorkspaceStore((state) => state.schema);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const setView = useWorkspaceStore((state) => state.setView);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const connectionId = useConnectionStore((state) => state.activeId);

  const [search, setSearch] = useState('');
  const term = useDebounced(search, 180).trim().toLowerCase();

  const databases = useDatabases();
  const tables = useRelations(schema, TABLE_KINDS);
  const views = useRelations(schema, VIEW_KINDS);
  const functions = useFunctions(schema);

  const current = useMemo(
    () => (databases.data ?? []).find((entry) => entry.name === database),
    [databases.data, database],
  );

  const matching = (list: RelationInfo[] | undefined) =>
    (list ?? []).filter((entry) => !term || entry.name.toLowerCase().includes(term));

  const visibleTables = matching(tables.data);
  const visibleViews = matching(views.data);
  const visibleFunctions = (functions.data ?? []).filter(
    (entry) => !term || entry.name.toLowerCase().includes(term),
  );

  const loading = tables.isLoading || views.isLoading;
  const nothing =
    !loading &&
    visibleTables.length === 0 &&
    visibleViews.length === 0 &&
    visibleFunctions.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Database className="size-4 shrink-0 text-accent" />
        <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">{database}</span>
        <Badge variant="neutral">{schema}</Badge>
        {current?.size !== undefined && current?.size !== null && (
          <span className="text-[11.5px] text-ink-faint">{formatBytes(current.size)}</span>
        )}

        <div className="flex-1" />

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Find a table, view or function"
          leading={<Search />}
          data-view-search
          className="h-7 w-[260px] text-[12px]"
          spellCheck={false}
          trailing={
            search ? (
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Clear"
                onClick={() => setSearch('')}
              >
                <X />
              </Button>
            ) : undefined
          }
        />
        <Button variant="secondary" size="sm" onClick={() => addTab()}>
          <Terminal />
          New query
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-[62px]" />
            ))}
          </div>
        ) : nothing ? (
          <EmptyState
            icon={<Table2 />}
            title={term ? `Nothing matches “${search}”` : `${schema} is empty`}
            description={
              term
                ? 'Try another name, or pick a different schema in the sidebar.'
                : 'This schema has no tables, views or functions yet. Create one from a SQL tab.'
            }
            action={
              !term ? (
                <Button variant="secondary" size="sm" onClick={() => addTab()}>
                  <Terminal />
                  Open a SQL tab
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-5">
            <Section
              title="Tables"
              icon={<Table2 />}
              count={visibleTables.length}
              total={tables.data?.length ?? 0}
            >
              {visibleTables.map((relation) => (
                <RelationCard
                  key={relation.name}
                  relation={relation}
                  onOpen={() =>
                    openTable({
                      schema: relation.schema,
                      table: relation.name,
                      kind: relation.kind,
                    })
                  }
                />
              ))}
            </Section>

            {visibleViews.length > 0 && (
              <Section
                title="Views"
                icon={<Eye />}
                count={visibleViews.length}
                total={views.data?.length ?? 0}
              >
                {visibleViews.map((relation) => (
                  <RelationCard
                    key={relation.name}
                    relation={relation}
                    onOpen={() =>
                      openTable({
                        schema: relation.schema,
                        table: relation.name,
                        kind: relation.kind,
                      })
                    }
                  />
                ))}
              </Section>
            )}

            {visibleFunctions.length > 0 && (
              <section className="space-y-2">
                <Heading icon={<FileCode2 />} title="Functions" count={visibleFunctions.length} />
                <div className="flex flex-wrap gap-1.5">
                  {visibleFunctions.slice(0, 24).map((entry) => (
                    <button
                      key={`${entry.name}-${entry.arguments}`}
                      type="button"
                      onClick={() => setView('functions')}
                      title={`${entry.name}(${entry.arguments}) returns ${entry.returns}`}
                      className="max-w-[280px] truncate rounded-md border border-line bg-[#ffffff04] px-2 py-1 text-[12px] text-ink-soft transition-colors hover:border-line-strong hover:bg-elevated hover:text-ink"
                    >
                      {entry.name}
                    </button>
                  ))}
                  {visibleFunctions.length > 24 && (
                    <Button variant="ghost" size="sm" onClick={() => setView('functions')}>
                      +{visibleFunctions.length - 24} more
                    </Button>
                  )}
                </div>
              </section>
            )}

            {!term && (
              <section className="flex flex-wrap gap-2 border-t border-line pt-4">
                <Button variant="ghost" size="sm" onClick={() => setView('functions')}>
                  <FileCode2 />
                  All functions
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setView('extensions')}>
                  <Boxes />
                  Extensions
                </Button>
                {connectionId && (
                  <Button variant="ghost" size="sm" onClick={() => setView('history')}>
                    Query history
                  </Button>
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon,
  count,
  total,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="space-y-2">
      <Heading icon={icon} title={title} count={count} total={total} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{children}</div>
    </section>
  );
}

function Heading({
  icon,
  title,
  count,
  total,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  total?: number;
}) {
  return (
    <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-muted [&_svg]:size-3.5">
      {icon}
      {title}
      <span className="font-normal text-ink-faint">
        {total !== undefined && total !== count ? `${count} of ${total}` : count}
      </span>
    </h2>
  );
}

function RelationCard({ relation, onOpen }: { relation: RelationInfo; onOpen: () => void }) {
  const isView = relation.kind === 'view' || relation.kind === 'materializedView';

  return (
    <button
      type="button"
      onClick={onOpen}
      title={relation.comment ?? undefined}
      className={cn(
        'group flex flex-col gap-1 rounded-lg border border-line bg-[#ffffff04] px-3 py-2.5 text-left',
        'transition-colors duration-150 hover:border-accent/45 hover:bg-elevated',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {isView ? (
          <Eye className="size-3.5 shrink-0 text-violet" />
        ) : (
          <Table2 className="size-3.5 shrink-0 text-accent" />
        )}
        <span className="truncate text-[12.5px] font-medium text-ink">{relation.name}</span>
      </span>

      <span className="flex items-center gap-2 text-[11px] text-ink-faint">
        {relation.estimatedRows !== null && (
          <span>~{formatCount(relation.estimatedRows)} rows</span>
        )}
        {relation.size !== null && relation.size > 0 && <span>{formatBytes(relation.size)}</span>}
        {relation.comment && <span className="truncate">{relation.comment}</span>}
      </span>
    </button>
  );
}
