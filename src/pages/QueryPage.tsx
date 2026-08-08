import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SQLNamespace } from '@codemirror/lang-sql';
import { ChevronDown, Eraser, History, Pencil, Play, Plus, Save, X, Zap } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { PromptDialog } from '@/components/dialogs/PromptDialog';
import { ResultPanel } from '@/components/sql/ResultPanel';
import { SqlEditor, type SqlEditorHandle } from '@/components/sql/SqlEditor';
import { SavePanel } from '@/components/sql/SavePanel';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Separator, Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useRelations, useScope } from '@/hooks/use-catalog';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { catalog, prefs, sql as sqlApi } from '@/services/api';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';
import type { QueryResult } from '@/types';

export function QueryPage() {
  const { connectionId, database, ready } = useScope();
  const queryClient = useQueryClient();

  const tabs = useWorkspaceStore((state) => state.sqlTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const setActiveTab = useWorkspaceStore((state) => state.setActiveTab);
  const updateTab = useWorkspaceStore((state) => state.updateTab);
  const closeTab = useWorkspaceStore((state) => state.closeTab);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const schema = useWorkspaceStore((state) => state.schema);

  const [results, setResults] = useState<QueryResult[]>([]);
  const [panel, setPanel] = useState<'results' | 'library'>('results');
  const [prompt, setPrompt] = useState<'save' | 'rename' | null>(null);
  const editor = useRef<SqlEditorHandle>(null);

  const tab = tabs.find((entry) => entry.id === activeTabId) ?? tabs[0] ?? null;
  const completions = useCompletions(schema);

  const run = useMutation({
    mutationFn: async (statement: string) => {
      if (!connectionId || !database) throw new Error('Connect to a database first.');
      return sqlApi.run({ connectionId, database, sql: statement });
    },
    onSuccess: (data) => {
      setResults(data);
      setPanel('results');
      const changed = data.some((result) => result.affectedRows !== null);
      if (changed) {
        void queryClient.invalidateQueries({ queryKey: ['browse'] });
        void queryClient.invalidateQueries({ queryKey: ['relations'] });
        void queryClient.invalidateQueries({ queryKey: ['columns'] });
      }
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      const total = data.reduce((sum, result) => sum + result.durationMs, 0);
      notify.success(
        `${data.length} statement${data.length === 1 ? '' : 's'} in ${total} ms`,
        summariseOutcome(data),
      );
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      notify.failure(error, 'Query failed');
    },
  });

  const explain = useMutation({
    mutationFn: async (analyze: boolean) => {
      if (!connectionId || !database) throw new Error('Connect to a database first.');
      const statement = editor.current?.currentStatement() || tab?.sql || '';
      if (!statement.trim()) throw new Error('There is nothing to explain.');
      const plan = await sqlApi.explain({ connectionId, database, sql: statement, analyze });
      return { plan, analyze };
    },
    onSuccess: ({ plan, analyze }) => {
      const lines = plan.split('\n');
      setResults([
        {
          columns: [{ name: 'QUERY PLAN', dataType: 'text', typeCategory: 'text' }],
          rows: lines.map((line) => [line]),
          rowCount: lines.length,
          affectedRows: null,
          durationMs: 0,
          command: analyze ? 'EXPLAIN ANALYZE' : 'EXPLAIN',
          truncated: false,
        },
      ]);
      setPanel('results');
    },
    onError: (error) => notify.failure(error, 'Could not explain the query'),
  });

  const saveQuery = useMutation({
    mutationFn: (name: string) =>
      prefs.saveQuery({
        id: '',
        name,
        sql: tab?.sql ?? '',
        description: null,
        favorite: false,
        createdAt: '',
        updatedAt: '',
      }),
    onSuccess: (saved) => {
      notify.success(`Saved as “${saved.name}”`);
      void queryClient.invalidateQueries({ queryKey: ['saved-queries'] });
      if (tab) updateTab(tab.id, { name: saved.name });
    },
    onError: (error) => notify.failure(error, 'Could not save the query'),
  });

  const execute = useCallback(
    (statement: string | null) => {
      const text = (statement ?? tab?.sql ?? '').trim();
      if (!text) {
        notify.warn('There is nothing to run');
        return;
      }
      run.mutate(text);
    },
    [run, tab?.sql],
  );

  const runCurrent = useCallback(() => {
    execute(editor.current?.currentStatement() ?? null);
  }, [execute]);

  const requestSave = useCallback(() => {
    if (!tab?.sql.trim()) {
      notify.warn('There is nothing to save');
      return;
    }
    setPrompt('save');
  }, [tab?.sql]);

  useShortcuts(
    [
      {
        key: 'l',
        ctrl: true,
        allowInFields: true,
        handler: () => tab && updateTab(tab.id, { sql: '' }),
      },
      { key: 'w', ctrl: true, allowInFields: true, handler: () => tab && closeTab(tab.id) },
      { key: 's', ctrl: true, allowInFields: true, handler: requestSave },
    ],
    Boolean(tab),
  );

  if (!tab) return null;

  const busy = run.isPending || explain.isPending;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-surface">
        <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
          {tabs.map((entry) => (
            <div
              key={entry.id}
              className={cn(
                'group/tab relative flex shrink-0 items-center gap-1.5 border-r border-line px-3 text-[12.5px] transition-colors',
                entry.id === tab.id
                  ? 'bg-canvas text-ink'
                  : 'text-ink-muted hover:bg-[#ffffff06] hover:text-ink-soft',
              )}
            >
              {entry.id === tab.id && (
                <span className="absolute inset-x-0 top-0 h-[2px] bg-accent" />
              )}
              <button
                type="button"
                onClick={() => setActiveTab(entry.id)}
                onDoubleClick={() => {
                  setActiveTab(entry.id);
                  setPrompt('rename');
                }}
                title={`${entry.name} — double click to rename`}
                className="max-w-[160px] truncate"
              >
                {entry.name}
                {entry.sql.trim() !== '' && <span className="pl-1 text-accent">•</span>}
              </button>
              <button
                type="button"
                aria-label={`Close ${entry.name}`}
                title={`Close ${entry.name}`}
                onClick={() => closeTab(entry.id)}
                className="flex size-4 items-center justify-center rounded text-ink-faint opacity-0 transition-opacity hover:bg-[#ffffff14] hover:text-ink group-hover/tab:opacity-100"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <Tooltip content="New tab" shortcut="Ctrl T">
            <Button
              variant="ghost"
              size="iconSm"
              aria-label="New SQL tab"
              className="my-1 ml-1"
              onClick={() => addTab()}
            >
              <Plus />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
        <Tooltip content="Run the selection, or the statement under the cursor" shortcut="Ctrl ⏎">
          <Button
            variant="primary"
            size="sm"
            disabled={!ready}
            loading={run.isPending}
            onClick={runCurrent}
          >
            <Play />
            Run
          </Button>
        </Tooltip>
        <Tooltip content="Run every statement in this tab" shortcut="Ctrl ⇧ ⏎">
          <Button
            variant="secondary"
            size="sm"
            disabled={!ready || busy}
            onClick={() => execute(tab.sql)}
          >
            Run all
          </Button>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={!ready || !tab.sql.trim()}
              loading={explain.isPending}
            >
              <Zap />
              Explain
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px]">
            <DropdownMenuItem onSelect={() => explain.mutate(false)}>
              <Zap /> Explain the plan
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => explain.mutate(true)}>
              <Zap /> Explain analyze (runs it, then rolls back)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-5" />

        <Tooltip content="Save this tab as a named query" shortcut="Ctrl S">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Save query"
            disabled={!tab.sql.trim()}
            onClick={requestSave}
          >
            <Save />
          </Button>
        </Tooltip>

        <Tooltip content="Rename this tab">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Rename tab"
            onClick={() => setPrompt('rename')}
          >
            <Pencil />
          </Button>
        </Tooltip>

        <Tooltip content="Clear the editor" shortcut="Ctrl L">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Clear"
            disabled={!tab.sql}
            onClick={() => updateTab(tab.id, { sql: '' })}
          >
            <Eraser />
          </Button>
        </Tooltip>

        <div className="flex-1" />

        <Button
          variant={panel === 'library' ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setPanel(panel === 'library' ? 'results' : 'library')}
        >
          <History />
          History & saved
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-[140px] flex-[2] flex-col border-b border-line">
          <SqlEditor
            key={tab.id}
            handle={editor}
            value={tab.sql}
            completions={completions}
            onChange={(value) => updateTab(tab.id, { sql: value })}
            onRun={execute}
            onRunAll={() => execute(tab.sql)}
            onSave={requestSave}
            autoFocus
          />
        </div>

        <div className="flex min-h-[160px] flex-[3] flex-col">
          {panel === 'results' ? (
            <ResultPanel results={results} />
          ) : (
            <SavePanel
              currentSql={tab.sql}
              onUse={(statement) => {
                updateTab(tab.id, { sql: statement });
                setPanel('results');
              }}
            />
          )}
        </div>
      </div>

      <PromptDialog
        open={prompt === 'save'}
        onOpenChange={(open) => setPrompt(open ? 'save' : null)}
        title="Save this query"
        description="It appears under “History & saved” on every connection."
        label="Name"
        placeholder="Daily signups"
        initialValue={tab.name.startsWith('Query ') ? '' : tab.name}
        confirmLabel="Save"
        onSubmit={(name) => saveQuery.mutateAsync(name).then(() => undefined)}
      />

      <PromptDialog
        open={prompt === 'rename'}
        onOpenChange={(open) => setPrompt(open ? 'rename' : null)}
        title="Rename tab"
        label="Tab name"
        initialValue={tab.name}
        confirmLabel="Rename"
        onSubmit={(name) => updateTab(tab.id, { name })}
      />
    </div>
  );
}

function summariseOutcome(results: QueryResult[]): string | undefined {
  const affected = results.reduce((sum, result) => sum + (result.affectedRows ?? 0), 0);
  if (affected > 0) return `${affected} row${affected === 1 ? '' : 's'} affected`;
  const returned = results.reduce((sum, result) => sum + result.rowCount, 0);
  if (returned > 0) return `${returned} row${returned === 1 ? '' : 's'} returned`;
  return undefined;
}

/** Build the table/column map CodeMirror uses for completion. */
function useCompletions(schema: string): SQLNamespace | undefined {
  const { connectionId, database, ready } = useScope();
  const relations = useRelations(schema, ['table', 'view', 'materializedView', 'partitionedTable']);

  const names = useMemo(
    () => (relations.data ?? []).map((relation) => relation.name).slice(0, 300),
    [relations.data],
  );

  const columns = useQuery({
    queryKey: ['completions', connectionId, database, schema, names.length],
    enabled: ready && names.length > 0,
    staleTime: 120_000,
    queryFn: async () => {
      const entries = await Promise.all(
        names.slice(0, 60).map(async (table) => {
          const list = await catalog
            .columns({ connectionId: connectionId!, database: database!, schema, table })
            .catch(() => []);
          return [table, list.map((column) => column.name)] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
  });

  return useMemo(() => {
    if (names.length === 0) return undefined;
    const namespace: SQLNamespace = {};
    for (const table of names) {
      namespace[table] = columns.data?.[table] ?? [];
    }
    return namespace;
  }, [names, columns.data]);
}
