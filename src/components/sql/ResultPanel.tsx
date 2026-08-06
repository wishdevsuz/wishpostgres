import { CheckCircle2, Clock, Download, Search, Table2, X } from 'lucide-react';
import { useMemo, useState } from 'react';

import { DataGrid } from '@/components/grid/DataGrid';
import { fromResultColumns } from '@/components/grid/types';
import { ExportDialog } from '@/components/dialogs/ExportDialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, EmptyState, Separator, Tooltip } from '@/components/ui/misc';
import { useDebounced } from '@/hooks/use-debounced';
import { formatCount, formatDuration, rawValue } from '@/utils/format';
import type { QueryResult } from '@/types';

const PAGE_SIZE = 500;

export function ResultPanel({ results }: { results: QueryResult[] }) {
  const [index, setIndex] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [exporting, setExporting] = useState(false);

  const active = results[Math.min(index, results.length - 1)];
  const debounced = useDebounced(search, 200);

  const filtered = useMemo(() => {
    if (!active) return [];
    const term = debounced.trim().toLowerCase();
    if (!term) return active.rows;
    return active.rows.filter((row) =>
      row.some((cell) => rawValue(cell).toLowerCase().includes(term)),
    );
  }, [active, debounced]);

  const columns = useMemo(() => (active ? fromResultColumns(active.columns) : []), [active]);
  const pageRows = useMemo(
    () => filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    [filtered, page],
  );

  if (results.length === 0) {
    return (
      <EmptyState
        icon={<Table2 />}
        title="No results yet"
        description="Press Ctrl+Enter to run the statement under the cursor, or Ctrl+Shift+Enter to run the whole tab."
      />
    );
  }

  if (!active) return null;

  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
        {results.length > 1 && (
          <>
            <div className="flex items-center gap-0.5">
              {results.map((result, position) => (
                <button
                  key={position}
                  type="button"
                  onClick={() => {
                    setIndex(position);
                    setPage(0);
                  }}
                  className={
                    position === index
                      ? 'rounded bg-accent/20 px-2 py-0.5 text-[11.5px] font-medium text-accent'
                      : 'rounded px-2 py-0.5 text-[11.5px] text-ink-muted hover:bg-[#ffffff0d]'
                  }
                >
                  {result.command} {position + 1}
                </button>
              ))}
            </div>
            <Separator orientation="vertical" className="h-4" />
          </>
        )}

        <Badge variant={active.affectedRows !== null ? 'positive' : 'accent'} size="md">
          {active.affectedRows !== null ? (
            <>
              <CheckCircle2 />
              {formatCount(active.affectedRows)} row{active.affectedRows === 1 ? '' : 's'} affected
            </>
          ) : (
            <>
              <Table2 />
              {formatCount(active.rowCount)} row{active.rowCount === 1 ? '' : 's'}
            </>
          )}
        </Badge>

        <Badge variant="neutral" size="md">
          <Clock />
          {formatDuration(active.durationMs)}
        </Badge>

        {active.truncated && (
          <Tooltip content="The result was capped to keep memory bounded. Add a LIMIT to see a precise slice.">
            <Badge variant="caution" size="md">
              truncated
            </Badge>
          </Tooltip>
        )}

        <div className="flex-1" />

        {active.rows.length > 0 && (
          <>
            <Input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search results"
              leading={<Search />}
              className="h-7 w-[190px] text-[12px]"
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
            <Tooltip content="Export result">
              <Button
                variant="ghost"
                size="iconSm"
                aria-label="Export"
                onClick={() => setExporting(true)}
              >
                <Download />
              </Button>
            </Tooltip>
          </>
        )}

        {filtered.length > PAGE_SIZE && (
          <div className="flex items-center gap-1 text-[11.5px] text-ink-muted">
            <Button
              variant="ghost"
              size="xs"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              Prev
            </Button>
            <span className="tabular-nums">
              {page + 1} / {lastPage + 1}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={page >= lastPage}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {active.columns.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 />}
          title={`${active.command} completed`}
          description={`${formatCount(active.affectedRows ?? 0)} rows affected in ${formatDuration(active.durationMs)}.`}
        />
      ) : (
        <DataGrid
          columns={columns}
          rows={pageRows}
          rowOffset={page * PAGE_SIZE}
          selectedRows={selectedRows}
          onSelectedRowsChange={setSelectedRows}
          emptyState={
            <EmptyState
              icon={<Search />}
              title="Nothing matches that search"
              description="Clear the search box to see every returned row."
            />
          }
        />
      )}

      <ExportDialog
        open={exporting}
        onOpenChange={setExporting}
        columns={active.columns.map((column) => column.name)}
        rows={
          selectedRows.size > 0
            ? [...selectedRows].sort((a, b) => a - b).map((row) => pageRows[row] ?? [])
            : filtered
        }
        defaultName="query-result"
      />
    </div>
  );
}
