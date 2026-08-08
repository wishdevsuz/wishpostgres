import { useQueryClient } from '@tanstack/react-query';
import {
  Braces,
  Copy,
  Eraser,
  FileCode2,
  Gauge,
  ListTree,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Star,
  Table2,
  Terminal,
  Trash2,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ImportDialog } from '@/components/dialogs/ImportDialog';
import { PromptDialog } from '@/components/dialogs/PromptDialog';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/form';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuShortcut,
} from '@/components/ui/menu';
import { Badge, Tabs, TabsList, TabsTrigger, Tooltip } from '@/components/ui/misc';
import { useClipboard } from '@/hooks/use-clipboard';
import { useTableColumns } from '@/hooks/use-catalog';
import { isTableKind, relationNoun, useRelationActions } from '@/hooks/use-relation-actions';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';
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
  const addTab = useWorkspaceStore((state) => state.addTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const queryClient = useQueryClient();
  const columns = useTableColumns(target.schema, target.table);
  const actions = useRelationActions();
  const copy = useClipboard();

  const [dialog, setDialog] = useState<'import' | 'truncate' | 'drop' | 'rename' | null>(null);
  const [cascade, setCascade] = useState(false);

  const favorite =
    connectionId && database
      ? isFavorite({ connectionId, database, schema: target.schema, table: target.table })
      : false;

  const isTable = isTableKind(target.kind);
  const noun = relationNoun(target.kind);
  const qualified = `${target.schema}.${target.table}`;

  const request = useCallback((next: typeof dialog) => {
    setCascade(false);
    setDialog(next);
  }, []);

  useShortcuts([{ key: 'f2', handler: () => actions.ready && request('rename') }]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        {target.kind === 'view' || target.kind === 'materializedView' ? (
          <FileCode2 className="size-4 shrink-0 text-violet" />
        ) : (
          <Table2 className="size-4 shrink-0 text-accent" />
        )}
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13.5px] font-semibold tracking-[-0.01em]">
            {target.table}
          </span>
          <span className="shrink-0 text-[11.5px] text-ink-faint">{target.schema}</span>
        </div>
        {!isTable && <Badge variant="violet">{noun}</Badge>}

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

        <Tooltip content="Reload this table">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Reload table"
            onClick={actions.refreshCatalog}
          >
            <RefreshCw />
          </Button>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="iconSm" aria-label="Table actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[220px]">
            <DropdownMenuLabel>{qualified}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setTab('sql')}>
              <Braces /> View definition
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                const sqlTab = addTab();
                updateTab(sqlTab.id, {
                  name: target.table,
                  sql: `SELECT *\nFROM "${target.schema}"."${target.table}"\nLIMIT 100;`,
                });
              }}
            >
              <Terminal /> Query in a new tab
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void copy(qualified, 'Name copied')}>
              <Copy /> Copy qualified name
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('import')} disabled={!isTable}>
              <Upload /> Import data…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!actions.ready} onSelect={() => request('rename')}>
              <Pencil /> Rename…
              <MenuShortcut>F2</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={closeTable}>
              <X /> Close
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              danger
              disabled={!isTable || !actions.ready}
              onSelect={() => request('truncate')}
            >
              <Eraser /> Truncate table…
            </DropdownMenuItem>
            <DropdownMenuItem danger disabled={!actions.ready} onSelect={() => request('drop')}>
              <Trash2 /> Drop {noun}…
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
          {tab === 'browse' && <BrowseTab key={qualified} target={target} />}
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
        onImported={() => {
          void queryClient.invalidateQueries({ queryKey: ['browse'] });
          void queryClient.invalidateQueries({ queryKey: ['statistics'] });
        }}
      />

      <PromptDialog
        open={dialog === 'rename'}
        onOpenChange={(open) => setDialog(open ? 'rename' : null)}
        title={`Rename ${noun}`}
        description={qualified}
        label="New name"
        hint="Views, indexes and constraints that reference it follow the rename."
        placeholder="new_name"
        initialValue={target.table}
        confirmLabel="Rename"
        onSubmit={(value) => actions.rename(target, value)}
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
        onConfirm={() => actions.truncate(target)}
      />

      <ConfirmDialog
        open={dialog === 'drop'}
        onOpenChange={(open) => setDialog(open ? 'drop' : null)}
        title={`Drop ${target.table}?`}
        description={`The ${noun} and everything in it are removed permanently.`}
        confirmLabel={`Drop ${noun}`}
        destructive
        requireConfirmation
        confirmationWord={target.table}
        onConfirm={() => actions.drop(target, cascade)}
      >
        <CheckboxField
          id="table-drop-cascade"
          label="Also drop dependent objects (CASCADE)"
          hint="Without this the statement fails when a view or foreign key still depends on it."
          checked={cascade}
          onCheckedChange={setCascade}
        />
      </ConfirmDialog>
    </div>
  );
}
