import { CircleAlert, Copy, Database, Gauge, ListTree, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge, EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { useClipboard } from '@/hooks/use-clipboard';
import {
  useTableConstraints,
  useTableDefinition,
  useTableIndexes,
  useTableStatistics,
} from '@/hooks/use-catalog';
import { formatBytes, formatCount, formatRelativeTime } from '@/utils/format';
import type { TableTarget } from '@/types';

export function IndexesTab({ target }: { target: TableTarget }) {
  const indexes = useTableIndexes(target.schema, target.table);
  const copy = useClipboard();

  if (indexes.isLoading) return <LoadingRows />;
  const list = indexes.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<ListTree />}
        title="No indexes"
        description="Only the heap is scanned for this table. Add an index from the SQL editor when queries need one."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <ul className="space-y-2">
        {list.map((index) => (
          <li key={index.name} className="rounded-lg border border-line bg-[#ffffff04] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-medium text-ink">{index.name}</span>
              {index.isPrimary && <Badge variant="caution">primary key</Badge>}
              {index.isUnique && !index.isPrimary && <Badge variant="accent">unique</Badge>}
              {!index.isValid && <Badge variant="negative">invalid</Badge>}
              <div className="flex-1" />
              <span className="text-[11px] text-ink-faint">{formatBytes(index.size)}</span>
              {index.scans !== null && (
                <Tooltip content="Index scans recorded since the statistics were last reset">
                  <Badge variant="neutral">{formatCount(index.scans)} scans</Badge>
                </Tooltip>
              )}
              <Tooltip content="Copy definition">
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Copy definition"
                  onClick={() => void copy(index.definition, 'Definition copied')}
                >
                  <Copy />
                </Button>
              </Tooltip>
            </div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-muted">
              {index.definition}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ConstraintsTab({ target }: { target: TableTarget }) {
  const constraints = useTableConstraints(target.schema, target.table);
  const copy = useClipboard();

  if (constraints.isLoading) return <LoadingRows />;
  const list = constraints.data ?? [];

  if (list.length === 0) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="No constraints"
        description="This table has no primary key, foreign keys, unique or check constraints."
      />
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <ul className="space-y-2">
        {list.map((constraint) => (
          <li key={constraint.name} className="rounded-lg border border-line bg-[#ffffff04] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[12.5px] font-medium text-ink">{constraint.name}</span>
              <Badge variant={kindTone(constraint.kind)}>{constraint.kind}</Badge>
              {constraint.isDeferrable && <Badge variant="neutral">deferrable</Badge>}
              <div className="flex-1" />
              <Tooltip content="Copy definition">
                <Button
                  variant="ghost"
                  size="iconXs"
                  aria-label="Copy definition"
                  onClick={() => void copy(constraint.definition, 'Definition copied')}
                >
                  <Copy />
                </Button>
              </Tooltip>
            </div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-ink-muted">
              {constraint.definition}
            </pre>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatisticsTab({ target }: { target: TableTarget }) {
  const stats = useTableStatistics(target.schema, target.table);

  if (stats.isLoading) return <LoadingRows />;
  const data = stats.data;
  if (!data) return <EmptyState icon={<Gauge />} title="No statistics available" />;

  const bloat =
    data.liveRows && data.deadRows ? (data.deadRows / (data.liveRows + data.deadRows)) * 100 : 0;

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Live rows" value={formatCount(data.liveRows)} />
        <Metric
          label="Dead rows"
          value={formatCount(data.deadRows)}
          tone={bloat > 20 ? 'caution' : undefined}
          hint={bloat > 0 ? `${bloat.toFixed(1)}% of the table` : undefined}
        />
        <Metric label="Total size" value={formatBytes(data.totalSize)} />
        <Metric label="Index size" value={formatBytes(data.indexSize)} />
        <Metric label="Table size" value={formatBytes(data.tableSize)} />
        <Metric label="TOAST size" value={formatBytes(data.toastSize)} />
        <Metric label="Sequential scans" value={formatCount(data.sequentialScans)} />
        <Metric label="Index scans" value={formatCount(data.indexScans)} />
      </section>

      <section className="grid gap-2 sm:grid-cols-3">
        <Metric label="Inserts" value={formatCount(data.inserts)} />
        <Metric label="Updates" value={formatCount(data.updates)} />
        <Metric label="Deletes" value={formatCount(data.deletes)} />
      </section>

      <section className="rounded-lg border border-line bg-[#ffffff04] p-3">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
          Maintenance
        </h3>
        <dl className="grid gap-1.5 text-[12px] sm:grid-cols-2">
          <Row label="Last vacuum" value={formatRelativeTime(data.lastVacuum)} />
          <Row label="Last autovacuum" value={formatRelativeTime(data.lastAutovacuum)} />
          <Row label="Last analyze" value={formatRelativeTime(data.lastAnalyze)} />
          <Row label="Last autoanalyze" value={formatRelativeTime(data.lastAutoanalyze)} />
        </dl>
      </section>

      {data.columnStats.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted">
            Column statistics
          </h3>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[12px]">
              <thead className="bg-elevated">
                <tr className="text-left">
                  {['Column', 'NULL fraction', 'Distinct', 'Avg width', 'Most common'].map(
                    (label) => (
                      <th
                        key={label}
                        className="whitespace-nowrap border-b border-line px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted"
                      >
                        {label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.columnStats.map((column, index) => (
                  <tr key={column.column} className={index % 2 ? 'bg-[#ffffff03]' : undefined}>
                    <td className="border-b border-line/50 px-3 py-1 font-medium text-ink">
                      {column.column}
                    </td>
                    <td className="border-b border-line/50 px-3 py-1 tabular-nums text-ink-muted">
                      {column.nullFraction === null
                        ? '—'
                        : `${(column.nullFraction * 100).toFixed(1)}%`}
                    </td>
                    <td className="border-b border-line/50 px-3 py-1 tabular-nums text-ink-muted">
                      {distinctLabel(column.distinctValues)}
                    </td>
                    <td className="border-b border-line/50 px-3 py-1 tabular-nums text-ink-muted">
                      {column.averageWidth ?? '—'} B
                    </td>
                    <td className="max-w-[280px] truncate border-b border-line/50 px-3 py-1 text-ink-faint">
                      {column.mostCommon.join(', ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

export function DefinitionTab({ target }: { target: TableTarget }) {
  const definition = useTableDefinition(target.schema, target.table);
  const copy = useClipboard();

  if (definition.isLoading) return <LoadingRows />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <Database className="size-3.5 text-ink-muted" />
        <span className="text-[12.5px] text-ink-muted">
          Reconstructed from the catalog — not a byte-for-byte pg_dump.
        </span>
        <div className="flex-1" />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void copy(definition.data ?? '', 'Definition copied')}
        >
          <Copy />
          Copy SQL
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed text-ink-soft">
        {definition.data}
      </pre>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'caution';
}) {
  return (
    <div className="rounded-lg border border-line bg-[#ffffff04] p-3">
      <p className="text-[11px] uppercase tracking-[0.05em] text-ink-faint">{label}</p>
      <p
        className={
          tone === 'caution'
            ? 'mt-0.5 text-[16px] font-semibold tabular-nums text-caution'
            : 'mt-0.5 text-[16px] font-semibold tabular-nums text-ink'
        }
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-faint">
          {tone === 'caution' && <CircleAlert className="size-3 text-caution" />}
          {hint}
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink-soft">{value}</dd>
    </div>
  );
}

function LoadingRows() {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: 5 }).map((_, index) => (
        <Skeleton key={index} className="h-14" />
      ))}
    </div>
  );
}

function distinctLabel(value: number | null): string {
  if (value === null) return '—';
  // A negative n_distinct is a ratio of the row count rather than a count.
  if (value < 0) return `${(Math.abs(value) * 100).toFixed(0)}% unique`;
  return formatCount(value);
}

function kindTone(kind: string) {
  if (kind === 'PRIMARY KEY') return 'caution' as const;
  if (kind === 'FOREIGN KEY') return 'accent' as const;
  if (kind === 'UNIQUE') return 'violet' as const;
  return 'neutral' as const;
}
