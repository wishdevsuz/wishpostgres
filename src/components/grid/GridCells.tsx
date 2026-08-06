import { ArrowDown, ArrowUp, KeyRound } from 'lucide-react';
import { useRef } from 'react';

import { displayValue } from '@/utils/format';
import type { JsonValue, SortDirection } from '@/types';

import type { GridColumn } from './types';

/** Renders one value. NULL and booleans are distinguished visually. */
export function CellText({ value }: { value: JsonValue }) {
  if (value === null) {
    return <span className="select-none text-[11px] italic text-ink-faint">NULL</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-positive' : 'text-ink-muted'}>{String(value)}</span>;
  }
  return <span className="truncate">{displayValue(value)}</span>;
}

export function HeaderCell({
  column,
  width,
  sortDirection,
  sortIndex,
  onSort,
  onResize,
  onAutoSize,
}: {
  column: GridColumn;
  width: number;
  sortDirection?: SortDirection;
  /** Position in a multi-column sort, or -1 when sorting on one column. */
  sortIndex: number;
  onSort?: (additive: boolean) => void;
  onResize: (width: number) => void;
  onAutoSize: () => void;
}) {
  const start = useRef<{ x: number; width: number } | null>(null);

  return (
    <div
      className="group/header relative flex shrink-0 items-center border-r border-line px-2"
      style={{ width }}
    >
      <button
        type="button"
        disabled={!onSort}
        onClick={(event) => onSort?.(event.shiftKey)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        title={`${column.name} · ${column.dataType}`}
      >
        {column.isPrimaryKey && <KeyRound className="size-3 shrink-0 text-caution" />}
        <span className="truncate text-[11.5px] font-semibold text-ink-soft">{column.name}</span>
        <span className="truncate text-[10px] font-normal text-ink-faint">{column.dataType}</span>
        {sortDirection === 'asc' && <ArrowUp className="ml-auto size-3 shrink-0 text-accent" />}
        {sortDirection === 'desc' && <ArrowDown className="ml-auto size-3 shrink-0 text-accent" />}
        {sortIndex >= 0 && <span className="text-[9px] text-accent">{sortIndex + 1}</span>}
      </button>

      <div
        role="separator"
        aria-label={`Resize ${column.name}`}
        onDoubleClick={onAutoSize}
        onPointerDown={(event) => {
          start.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          onResize(Math.max(56, start.current.width + event.clientX - start.current.x));
        }}
        onPointerUp={(event) => {
          start.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize after:absolute after:inset-y-1 after:left-1 after:w-px after:bg-transparent after:transition-colors hover:after:bg-accent"
      />
    </div>
  );
}
