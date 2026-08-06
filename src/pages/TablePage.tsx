import { useQueryClient } from '@tanstack/react-query';
import {
  Braces,
  Download,
  Eraser,
  FileCode2,
  Gauge,
  ListTree,
  MoreHorizontal,
  ShieldCheck,
  Star,
  Table2,
  Trash2,
  Type,
  Upload,
} from 'lucide-react';
import { useState } from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ImportDialog } from '@/components/dialogs/ImportDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/misc';
import { useScope, useTableColumns } from '@/hooks/use-catalog';
import { structure } from '@/services/api';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';
import type { TableTab, TableTarget } from '@/types';

import { BrowseTab } from './table/BrowseTab';
import { StructureTab } from './table/StructureTab';
import { ConstraintsTab, DefinitionTab, IndexesTab, StatisticsTab } from './table/MetaTabs';

const TABS: { value: TableTab; label: string; icon: React.ReactNode }[] = [
  { value: 'browse', label: 'Browse', icon: <Table2 /> },
  { value: 'structure', label: 'Structure', icon: <Type /> },
  { value: 'sql', label: 'SQL', icon: <FileCode2 /> },
  { value: 'indexes', label: 'Indexes', icon: <ListTree /> },
  { value: 'constraints', label: 'Constraints', icon: <ShieldCheck /> },
  { value: 'statistics', label: 'Statistics', icon: <Gauge /> },
];

export function TablePage({ target }: { target: TableTarget }) {
  const tab = useWorkspaceStore((state) => state.tableTab);
  const setTab = useWorkspaceStore((state) => state.setTableTab);
  const closeTable = useWorkspaceStore((state) => state.closeTable);
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);
  const isFavorite = useWorkspaceStore((state) => state.isFavorite);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const { connectionId: scopeConnection, database: scopeDatabase } = useScope();
  const queryClient = useQueryClient();
  const columns = useTableColumns(target.schema, target.table);

  const [dialog, setDialog] = useState<'import' | 'truncate' | 'drop' | null>(null);

  const favorite =
    connectionId && database
      ? isFavorite({ connectionId, database, schema: target.schema, table: target.table })
      : false;

  const isTable = target.kind === 'table' || target.kind === 'partitionedTable';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Table2 className="size-4 shrink-0 text-accent" />
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">
            {target.table}
          </span>
          <span className="shrink-0 text-[11.5px] text-ink-faint">{target.schema}</span>
        </div>

        <Tooltip content={favorite ? 'Remove from favorites' : 'Add to favorites'}>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Toggle favorite"
            disabled={!connectionId || !database}
            onClick={() =>
              connectionId &&
              database &&
              toggleFavorite({ connectionId, database, schema: target.schema, table: target.table })
            }
          >
            <Star className={favorite ? 'fill-caution text-caution' : ''} />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        {isTable && (
          <Button variant="ghost" size="sm" onClick={() => setDialog('import')}>
            <Upload />
            Import
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Table actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>
              {target.schema}.{target.table}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setTab('sql')}>
              <Braces /> View definition
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('import')} disabled={!isTable}>
              <Download /> Import data…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger disabled={!isTable} onSelect={() => setDialog('truncate')}>
              <Eraser /> Truncate table…
            </DropdownMenuItem>
            <DropdownMenuItem danger onSelect={() => setDialog('drop')}>
              <Trash2 /> Drop {target.kind === 'view' ? 'view' : 'table'}…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as TableTab)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList>
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value}>
              {entry.icon}
              {entry.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col">
          {tab === 'browse' && (
            <BrowseTab key={`${target.schema}.${target.table}`} target={target} />
          )}
          {tab === 'structure' && <StructureTab target={target} />}
          {tab === 'sql' && <DefinitionTab target={target} />}
          {tab === 'indexes' && <IndexesTab target={target} />}
          {tab === 'constraints' && <ConstraintsTab target={target} />}
          {tab === 'statistics' && <StatisticsTab target={target} />}
        </div>
      </Tabs>

      <ImportDialog
        open={dialog === 'import'}
        onOpenChange={(open) => setDialog(open ? 'import' : null)}
        target={target}
        columns={columns.data ?? []}
        onImported={() => void queryClient.invalidateQueries()}
      />

      <ConfirmDialog
        open={dialog === 'truncate'}
        onOpenChange={(open) => setDialog(open ? 'truncate' : null)}
        title={`Truncate ${target.table}?`}
        description="Every row is removed immediately. This cannot be undone."
        confirmLabel="Truncate table"
        destructive
        requireConfirmation
        confirmationWord={target.table}
        onConfirm={async () => {
          await structure.truncate({
            connectionId: scopeConnection!,
            database: scopeDatabase!,
            schema: target.schema,
            table: target.table,
          });
          notify.success(`Truncated ${target.table}`);
          void queryClient.invalidateQueries();
        }}
      />

      <ConfirmDialog
        open={dialog === 'drop'}
        onOpenChange={(open) => setDialog(open ? 'drop' : null)}
        title={`Drop ${target.table}?`}
        description="The object and all of its data are removed permanently."
        confirmLabel="Drop it"
        destructive
        requireConfirmation
        confirmationWord={target.table}
        onConfirm={async () => {
          await structure.drop({
            connectionId: scopeConnection!,
            database: scopeDatabase!,
            schema: target.schema,
            table: target.table,
            cascade: false,
          });
          notify.success(`Dropped ${target.table}`);
          void queryClient.invalidateQueries();
          closeTable();
        }}
      />
    </div>
  );
}
