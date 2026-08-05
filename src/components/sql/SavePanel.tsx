import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Save, Search, Star, Trash2, TriangleAlert } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Separator, Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useDebounced } from '@/hooks/use-debounced';
import { prefs } from '@/services/api';
import { notify } from '@/utils/notify';
import { formatDuration, formatRelativeTime, summariseSql } from '@/utils/format';

export function SavePanel({
  currentSql,
  onUse,
}: {
  currentSql: string;
  onUse: (sql: string) => void;
}) {
  const [tab, setTab] = useState<'history' | 'saved'>('history');
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const queryClient = useQueryClient();
  const term = useDebounced(search, 200).trim().toLowerCase();

  const history = useQuery({ queryKey: ['history'], queryFn: prefs.history, staleTime: 5_000 });
  const saved = useQuery({ queryKey: ['saved-queries'], queryFn: prefs.savedQueries, staleTime: 30_000 });

  const saveQuery = useMutation({
    mutationFn: (label: string) =>
      prefs.saveQuery({
        id: '',
        name: label,
        sql: currentSql,
        description: null,
        favorite: false,
        createdAt: '',
        updatedAt: '',
      }),
    onSuccess: () => {
      setName('');
      notify.success('Query saved');
      void queryClient.invalidateQueries({ queryKey: ['saved-queries'] });
    },
    onError: (error) => notify.failure(error, 'Could not save the query'),
  });

  const removeQuery = useMutation({
    mutationFn: prefs.deleteQuery,
    onSuccess: () => {
      notify.success('Query deleted');
      void queryClient.invalidateQueries({ queryKey: ['saved-queries'] });
    },
  });

  const clearHistory = useMutation({
    mutationFn: prefs.clearHistory,
    onSuccess: () => {
      notify.success('History cleared');
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    },
  });

  const historyRows = useMemo(
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

  const savedRows = useMemo(
    () =>
      (saved.data ?? []).filter(
        (entry) => !term || entry.name.toLowerCase().includes(term) || entry.sql.toLowerCase().includes(term),
      ),
    [saved.data, term],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
        <div className="flex items-center gap-0.5">
          {(['history', 'saved'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={cn(
                'rounded px-2 py-0.5 text-[11.5px] capitalize',
                tab === value ? 'bg-accent/20 text-accent' : 'text-ink-muted hover:bg-[#ffffff0d]',
              )}
            >
              {value === 'saved' ? 'Saved queries' : 'History'}
            </button>
          ))}
        </div>

        <Separator orientation="vertical" className="h-4" />

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={tab === 'history' ? 'Search history' : 'Search saved queries'}
          leading={<Search />}
          className="h-7 w-[220px] text-[12px]"
          spellCheck={false}
        />

        <div className="flex-1" />

        {tab === 'saved' ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Name this query"
              className="h-7 w-[190px] text-[12px]"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim() && currentSql.trim()) {
                  saveQuery.mutate(name.trim());
                }
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!name.trim() || !currentSql.trim()}
              loading={saveQuery.isPending}
              onClick={() => saveQuery.mutate(name.trim())}
            >
              <Save />
              Save current
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={(history.data ?? []).length === 0}
            onClick={() => clearHistory.mutate()}
          >
            <Trash2 />
            Clear history
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'history' ? (
          historyRows.length === 0 ? (
            <EmptyState
              icon={<Clock />}
              title={term ? 'Nothing matches' : 'No queries yet'}
              description="Every statement you run is recorded here with its timing and result."
            />
          ) : (
            <ul className="divide-y divide-line">
              {historyRows.map((entry) => (
                <li
                  key={entry.id}
                  className="group/row flex cursor-default items-start gap-3 px-3 py-2 hover:bg-[#ffffff06]"
                  onDoubleClick={() => onUse(entry.sql)}
                >
                  <span className="mt-[3px] shrink-0">
                    {entry.success ? (
                      <CheckCircle2 className="size-3.5 text-positive" />
                    ) : (
                      <TriangleAlert className="size-3.5 text-negative" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-[12px] text-ink-soft">{summariseSql(entry.sql, 140)}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-faint">
                      <span>{formatRelativeTime(entry.executedAt)}</span>
                      <span>·</span>
                      <span>
                        {entry.connectionName}/{entry.database}
                      </span>
                      <span>·</span>
                      <span>{formatDuration(entry.durationMs)}</span>
                      {entry.affectedRows !== null && <Badge variant="neutral">{entry.affectedRows} affected</Badge>}
                      {entry.rowCount !== null && <Badge variant="neutral">{entry.rowCount} rows</Badge>}
                      {entry.errorMessage && (
                        <span className="truncate text-negative">{entry.errorMessage}</span>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="subtle"
                    size="xs"
                    className="shrink-0 opacity-0 group-hover/row:opacity-100"
                    onClick={() => onUse(entry.sql)}
                  >
                    Load
                  </Button>
                </li>
              ))}
            </ul>
          )
        ) : savedRows.length === 0 ? (
          <EmptyState
            icon={<Star />}
            title={term ? 'Nothing matches' : 'No saved queries'}
            description="Name the statement in the editor and save it to keep it around."
          />
        ) : (
          <ul className="divide-y divide-line">
            {savedRows.map((entry) => (
              <li
                key={entry.id}
                className="group/row flex cursor-default items-start gap-3 px-3 py-2 hover:bg-[#ffffff06]"
                onDoubleClick={() => onUse(entry.sql)}
              >
                <Star className="mt-[3px] size-3.5 shrink-0 text-caution" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-ink">{entry.name}</p>
                  <p className="truncate font-mono text-[11.5px] text-ink-faint">{summariseSql(entry.sql, 140)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover/row:opacity-100">
                  <Button variant="subtle" size="xs" onClick={() => onUse(entry.sql)}>
                    Load
                  </Button>
                  <Tooltip content="Delete">
                    <Button
                      variant="ghost"
                      size="iconXs"
                      aria-label="Delete saved query"
                      onClick={() => removeQuery.mutate(entry.id)}
                    >
                      <Trash2 />
                    </Button>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
