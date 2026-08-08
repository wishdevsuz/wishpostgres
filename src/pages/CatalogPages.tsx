import {
  ArrowUpCircle,
  Boxes,
  Clock,
  Copy,
  FileCode2,
  Search,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { useClipboard } from '@/hooks/use-clipboard';
import { useDebounced } from '@/hooks/use-debounced';
import { useExtensions, useFunctions, useScope } from '@/hooks/use-catalog';
import { prefs, structure } from '@/services/api';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';
import { formatDuration, formatRelativeTime, summariseSql } from '@/utils/format';
import type { ExtensionAction, ExtensionInfo } from '@/types';

function PageShell({
  title,
  subtitle,
  search,
  onSearchChange,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  search: string;
  onSearchChange: (value: string) => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="text-[13.5px] font-semibold tracking-[-0.01em]">{title}</span>
        {subtitle && <span className="text-[11.5px] text-ink-faint">{subtitle}</span>}
        <div className="flex-1" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Filter"
          leading={<Search />}
          data-view-search
          className="h-7 w-[220px] text-[12px]"
          spellCheck={false}
        />
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

export function FunctionsPage() {
  const schema = useWorkspaceStore((state) => state.schema);
  const functions = useFunctions(schema);
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 200).trim().toLowerCase();
  const copy = useClipboard();
  const addTab = useWorkspaceStore((state) => state.addTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);

  const list = useMemo(
    () =>
      (functions.data ?? []).filter(
        (entry) =>
          !term ||
          entry.name.toLowerCase().includes(term) ||
          entry.arguments.toLowerCase().includes(term),
      ),
    [functions.data, term],
  );

  return (
    <PageShell title="Functions" subtitle={schema} search={search} onSearchChange={setSearch}>
      {functions.isLoading ? (
        <LoadingList />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<FileCode2 />}
          title={term ? 'Nothing matches' : 'No routines in this schema'}
          description="Functions, procedures and aggregates defined in the selected schema appear here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((entry) => (
            <li
              key={`${entry.name}-${entry.arguments}`}
              className="group/row px-3 py-2 hover:bg-[#ffffff05]"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[12.5px] font-medium text-ink">{entry.name}</span>
                <Badge variant={entry.kind === 'procedure' ? 'violet' : 'accent'}>
                  {entry.kind}
                </Badge>
                <Badge variant="neutral">{entry.language}</Badge>
                <div className="flex-1" />
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover/row:opacity-100">
                  <Tooltip content="Copy call signature">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      aria-label="Copy signature"
                      onClick={() =>
                        void copy(
                          `${entry.schema}.${entry.name}(${entry.arguments})`,
                          'Signature copied',
                        )
                      }
                    >
                      <Copy />
                    </Button>
                  </Tooltip>
                  <Tooltip content="Draft a call in a new SQL tab">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      aria-label="Call in a SQL tab"
                      onClick={() => {
                        const tab = addTab();
                        updateTab(tab.id, {
                          name: entry.name,
                          sql:
                            entry.kind === 'procedure'
                              ? `CALL "${entry.schema}"."${entry.name}"();`
                              : `SELECT "${entry.schema}"."${entry.name}"();`,
                        });
                      }}
                    >
                      <Terminal />
                    </Button>
                  </Tooltip>
                </div>
              </div>
              <p className="truncate font-mono text-[11.5px] text-ink-muted">({entry.arguments})</p>
              <p className="truncate font-mono text-[11.5px] text-ink-faint">
                returns {entry.returns}
              </p>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

export function ExtensionsPage() {
  const extensions = useExtensions();
  const { connectionId, database, ready } = useScope();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [removing, setRemoving] = useState<ExtensionInfo | null>(null);
  const term = useDebounced(search, 200).trim().toLowerCase();

  const change = useMutation({
    mutationFn: ({ name, action }: { name: string; action: ExtensionAction }) =>
      structure.setExtension({
        connectionId: connectionId!,
        database: database!,
        name,
        action,
      }),
    onSuccess: (statement, { action }) => {
      notify.success(
        action === 'install'
          ? 'Extension installed'
          : action === 'update'
            ? 'Extension updated'
            : 'Extension removed',
        statement,
      );
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['functions'] });
      void queryClient.invalidateQueries({ queryKey: ['schemas'] });
    },
    onError: (error) => notify.failure(error, 'Could not change the extension'),
  });

  const list = useMemo(
    () =>
      (extensions.data ?? []).filter(
        (entry) =>
          !term ||
          entry.name.toLowerCase().includes(term) ||
          (entry.comment ?? '').toLowerCase().includes(term),
      ),
    [extensions.data, term],
  );

  const installed = list.filter((entry) => entry.installed);
  const available = list.filter((entry) => !entry.installed);
  const pending = change.isPending ? change.variables?.name : undefined;

  const row = (entry: ExtensionInfo) => (
    <ExtensionRow
      key={entry.name}
      entry={entry}
      busy={pending === entry.name}
      disabled={!ready || change.isPending}
      onInstall={() => change.mutate({ name: entry.name, action: 'install' })}
      onUpdate={() => change.mutate({ name: entry.name, action: 'update' })}
      onUninstall={() => setRemoving(entry)}
    />
  );

  return (
    <PageShell
      title="Extensions"
      subtitle={`${installed.length} installed`}
      search={search}
      onSearchChange={setSearch}
    >
      {extensions.isLoading ? (
        <LoadingList />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Boxes />}
          title={term ? 'Nothing matches' : 'No extensions available'}
          description="Extensions come from the packages installed alongside the PostgreSQL server."
        />
      ) : (
        <>
          {installed.length > 0 && <GroupHeading>Installed</GroupHeading>}
          <ul className="divide-y divide-line">{installed.map(row)}</ul>
          {available.length > 0 && <GroupHeading>Available</GroupHeading>}
          <ul className="divide-y divide-line">{available.map(row)}</ul>
        </>
      )}

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : 'Remove this extension?'}
        description="Objects the extension provides are dropped with it. Anything that depends on them has to be dropped too."
        confirmLabel="Remove extension"
        destructive
        onConfirm={async () => {
          if (removing) await change.mutateAsync({ name: removing.name, action: 'uninstall' });
        }}
      />
    </PageShell>
  );
}

function ExtensionRow({
  entry,
  busy,
  disabled,
  onInstall,
  onUpdate,
  onUninstall,
}: {
  entry: ExtensionInfo;
  busy: boolean;
  disabled: boolean;
  onInstall: () => void;
  onUpdate: () => void;
  onUninstall: () => void;
}) {
  const upgradable =
    entry.installed &&
    entry.defaultVersion !== null &&
    entry.installedVersion !== entry.defaultVersion;

  return (
    <li className="group/row flex items-start gap-3 px-3 py-2 hover:bg-[#ffffff05]">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12.5px] font-medium text-ink">{entry.name}</span>
          {entry.installed ? (
            <Badge variant="positive">v{entry.installedVersion}</Badge>
          ) : (
            <Badge variant="outline">v{entry.defaultVersion}</Badge>
          )}
          {entry.schema && <Badge variant="neutral">{entry.schema}</Badge>}
          {upgradable && <Badge variant="caution">update to {entry.defaultVersion}</Badge>}
        </div>
        {entry.comment && (
          <p className="text-[11.5px] leading-snug text-ink-muted">{entry.comment}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {upgradable && (
          <Tooltip content={`Update to ${entry.defaultVersion}`}>
            <Button
              variant="subtle"
              size="xs"
              loading={busy}
              disabled={disabled}
              onClick={onUpdate}
            >
              <ArrowUpCircle />
              Update
            </Button>
          </Tooltip>
        )}
        {entry.installed ? (
          <Button
            variant="ghost"
            size="iconXs"
            aria-label={`Remove ${entry.name}`}
            title={`Remove ${entry.name}`}
            className="opacity-0 group-hover/row:opacity-100"
            disabled={disabled}
            onClick={onUninstall}
          >
            <Trash2 />
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="xs"
            loading={busy}
            disabled={disabled}
            onClick={onInstall}
          >
            Install
          </Button>
        )}
      </div>
    </li>
  );
}

export function HistoryPage() {
  const history = useQuery({ queryKey: ['history'], queryFn: prefs.history, staleTime: 5_000 });
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const term = useDebounced(search, 200).trim().toLowerCase();
  const copy = useClipboard();
  const addTab = useWorkspaceStore((state) => state.addTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const [clearing, setClearing] = useState(false);

  const clear = useMutation({
    mutationFn: prefs.clearHistory,
    onSuccess: () => {
      notify.success('History cleared');
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    },
    onError: (error) => notify.failure(error, 'Could not clear the history'),
  });

  const list = useMemo(
    () =>
      (history.data ?? []).filter(
        (entry) =>
          !term ||
          entry.sql.toLowerCase().includes(term) ||
          entry.database.toLowerCase().includes(term) ||
          entry.connectionName.toLowerCase().includes(term),
      ),
    [history.data, term],
  );

  return (
    <PageShell
      title="Query history"
      subtitle={`${list.length} entries`}
      search={search}
      onSearchChange={setSearch}
      actions={
        <Button
          variant="ghost"
          size="sm"
          disabled={(history.data ?? []).length === 0}
          loading={clear.isPending}
          onClick={() => setClearing(true)}
        >
          <Trash2 />
          Clear
        </Button>
      }
    >
      {list.length === 0 ? (
        <EmptyState
          icon={<Clock />}
          title={term ? 'Nothing matches' : 'No history yet'}
          description="Every statement you run through the SQL editor is recorded here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((entry) => (
            <li
              key={entry.id}
              className="group/row flex items-start gap-3 px-3 py-2 hover:bg-[#ffffff05]"
            >
              <span
                className={
                  entry.success
                    ? 'mt-1.5 size-1.5 shrink-0 rounded-full bg-positive'
                    : 'mt-1.5 size-1.5 shrink-0 rounded-full bg-negative'
                }
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[12px] text-ink-soft">
                  {summariseSql(entry.sql, 160)}
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
                  <span>{formatRelativeTime(entry.executedAt)}</span>
                  <span>·</span>
                  <span>
                    {entry.connectionName}/{entry.database}
                  </span>
                  <span>·</span>
                  <span>{formatDuration(entry.durationMs)}</span>
                  {entry.errorMessage && (
                    <span className="truncate text-negative">{entry.errorMessage}</span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover/row:opacity-100">
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Copy"
                  onClick={() => void copy(entry.sql)}
                >
                  <Copy />
                </Button>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => {
                    const tab = addTab();
                    updateTab(tab.id, { sql: entry.sql, name: 'From history' });
                  }}
                >
                  Open
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={clearing}
        onOpenChange={setClearing}
        title="Clear the query history?"
        description="Every recorded statement is removed. Saved queries are not affected."
        confirmLabel="Clear history"
        destructive
        onConfirm={() => clear.mutateAsync()}
      />
    </PageShell>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="sticky top-0 z-10 bg-elevated px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
      {children}
    </p>
  );
}

function LoadingList() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <Skeleton key={index} className="h-10" />
      ))}
    </div>
  );
}
