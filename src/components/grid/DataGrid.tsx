import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Copy, KeyRound, Rows3, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/menu';
import { Checkbox } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { toClipboardTable, useClipboard } from '@/hooks/use-clipboard';
import { displayValue, rawValue } from '@/utils/format';
import type { JsonValue, SortDirection } from '@/types';

import { CellEditor } from './CellEditor';
import { estimateWidth, type CellAddress, type GridColumn } from './types';

const ROW_HEIGHT = 28;
const GUTTER_WIDTH = 68;

export interface DataGridProps {
  columns: GridColumn[];
  rows: JsonValue[][];
  /** Absolute index of the first row, so the gutter shows real row numbers. */
  rowOffset?: number;
  sort?: { column: string; direction: SortDirection }[];
  onSort?: (column: string, additive: boolean) => void;
  hiddenColumns?: Set<string>;
  selectedRows: Set<number>;
  onSelectedRowsChange: (rows: Set<number>) => void;
  onEditCell?: (row: number, column: number, value: string | null) => Promise<void>;
  onDeleteSelected?: () => void;
  emptyState?: React.ReactNode;
}

export function DataGrid({
  columns,
  rows,
  rowOffset = 0,
  sort = [],
  onSort,
  hiddenColumns,
  selectedRows,
  onSelectedRowsChange,
  onEditCell,
  onDeleteSelected,
  emptyState,
}: DataGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const copy = useClipboard();

  const [active, setActive] = useState<CellAddress | null>(null);
  const [editing, setEditing] = useState<CellAddress | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const anchor = useRef<number | null>(null);

  const visible = useMemo(
    () =>
      columns
        .map((column, index) => ({ column, index }))
        .filter((entry) => !hiddenColumns?.has(entry.column.name)),
    [columns, hiddenColumns],
  );

  // Widths are measured once per column set; the user can then drag to resize.
  useEffect(() => {
    setWidths((current) => {
      const next = { ...current };
      let changed = false;
      for (const { column, index } of visible) {
        if (next[column.name] === undefined) {
          next[column.name] = estimateWidth(column, rows, index);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [visible, rows]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 14,
  });

  const totalWidth = useMemo(
    () => visible.reduce((sum, entry) => sum + (widths[entry.column.name] ?? 150), GUTTER_WIDTH),
    [visible, widths],
  );

  const selectRow = useCallback(
    (index: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      const next = new Set(selectedRows);
      if (event.shiftKey && anchor.current !== null) {
        const from = Math.min(anchor.current, index);
        const to = Math.max(anchor.current, index);
        for (let row = from; row <= to; row += 1) next.add(row);
      } else if (event.ctrlKey || event.metaKey) {
        if (next.has(index)) next.delete(index);
        else next.add(index);
        anchor.current = index;
      } else {
        next.clear();
        next.add(index);
        anchor.current = index;
      }
      onSelectedRowsChange(next);
    },
    [onSelectedRowsChange, selectedRows],
  );

  const copyCell = useCallback(() => {
    if (!active) return;
    void copy(rawValue(rows[active.row]?.[active.column] ?? null), 'Cell copied');
  }, [active, copy, rows]);

  const copyRows = useCallback(
    (indexes: number[], withHeader: boolean) => {
      const body = indexes.map((index) =>
        visible.map((entry) => rawValue(rows[index]?.[entry.index] ?? null)),
      );
      const header = withHeader ? visible.map((entry) => entry.column.name) : undefined;
      void copy(toClipboardTable(body, header), `${body.length === 1 ? 'Row' : 'Rows'} copied`);
    },
    [copy, rows, visible],
  );

  const move = useCallback(
    (rowDelta: number, columnDelta: number) => {
      setActive((current) => {
        const base = current ?? { row: 0, column: 0 };
        const row = Math.max(0, Math.min(rows.length - 1, base.row + rowDelta));
        const columnIndex = Math.max(
          0,
          Math.min(visible.length - 1, visible.findIndex((entry) => entry.index === base.column) + columnDelta),
        );
        const target = visible[columnIndex];
        virtualizer.scrollToIndex(row, { align: 'auto' });
        return target ? { row, column: target.index } : base;
      });
    },
    [rows.length, virtualizer, visible],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (editing) return;
      const key = event.key;

      if (key === 'ArrowDown') return void (event.preventDefault(), move(1, 0));
      if (key === 'ArrowUp') return void (event.preventDefault(), move(-1, 0));
      if (key === 'ArrowRight') return void (event.preventDefault(), move(0, 1));
      if (key === 'ArrowLeft') return void (event.preventDefault(), move(0, -1));
      if (key === 'PageDown') return void (event.preventDefault(), move(20, 0));
      if (key === 'PageUp') return void (event.preventDefault(), move(-20, 0));
      if (key === 'Home') return void (event.preventDefault(), setActive({ row: 0, column: visible[0]?.index ?? 0 }));
      if (key === 'End')
        return void (event.preventDefault(), setActive({ row: rows.length - 1, column: visible[0]?.index ?? 0 }));

      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'c') {
        event.preventDefault();
        if (selectedRows.size > 0) copyRows([...selectedRows].sort((a, b) => a - b), true);
        else copyCell();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectedRowsChange(new Set(rows.map((_, index) => index)));
        return;
      }
      if (key === 'Enter' && active && onEditCell && columns[active.column]?.editable) {
        event.preventDefault();
        setEditing(active);
        return;
      }
      if (key === ' ' && active) {
        event.preventDefault();
        selectRow(active.row, event);
      }
    },
    [
      active,
      columns,
      copyCell,
      copyRows,
      editing,
      move,
      onEditCell,
      onSelectedRowsChange,
      rows,
      selectRow,
      selectedRows,
      visible,
    ],
  );

  const allSelected = rows.length > 0 && selectedRows.size === rows.length;

  if (rows.length === 0 && emptyState) {
    return <div className="flex min-h-0 flex-1 flex-col">{emptyState}</div>;
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="relative min-h-0 flex-1 overflow-auto outline-none"
    >
      <div style={{ width: totalWidth, minWidth: '100%' }}>
        <div
          className="sticky top-0 z-10 flex h-[30px] border-b border-line-strong bg-elevated"
          style={{ width: totalWidth, minWidth: '100%' }}
        >
          <div
            className="sticky left-0 z-10 flex shrink-0 items-center justify-center border-r border-line bg-elevated"
            style={{ width: GUTTER_WIDTH }}
          >
            <Checkbox
              aria-label="Select all rows"
              checked={allSelected ? true : selectedRows.size > 0 ? 'indeterminate' : false}
              onCheckedChange={(checked) =>
                onSelectedRowsChange(checked === true ? new Set(rows.map((_, index) => index)) : new Set())
              }
            />
          </div>
          {visible.map(({ column, index }) => {
            const sortEntry = sort.find((entry) => entry.column === column.name);
            return (
              <HeaderCell
                key={column.name}
                column={column}
                width={widths[column.name] ?? 150}
                sortDirection={sortEntry?.direction}
                sortIndex={sort.length > 1 ? sort.findIndex((entry) => entry.column === column.name) : -1}
                onSort={onSort ? (additive) => onSort(column.name, additive) : undefined}
                onResize={(width) => setWidths((current) => ({ ...current, [column.name]: width }))}
                onAutoSize={() =>
                  setWidths((current) => ({ ...current, [column.name]: estimateWidth(column, rows, index) }))
                }
              />
            );
          })}
        </div>

        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const rowIndex = virtualRow.index;
            const row = rows[rowIndex];
            if (!row) return null;
            const selected = selectedRows.has(rowIndex);

            return (
              <ContextMenu key={virtualRow.key}>
                <ContextMenuTrigger asChild>
                  <div
                    className={cn(
                      'absolute inset-x-0 flex border-b border-line/60',
                      selected ? 'bg-accent/12' : rowIndex % 2 === 1 ? 'bg-[#ffffff03]' : undefined,
                    )}
                    style={{ height: ROW_HEIGHT, transform: `translateY(${virtualRow.start}px)` }}
                    onContextMenu={() => {
                      if (!selectedRows.has(rowIndex)) {
                        anchor.current = rowIndex;
                        onSelectedRowsChange(new Set([rowIndex]));
                      }
                    }}
                  >
                    <div
                      className={cn(
                        'sticky left-0 z-[5] flex shrink-0 items-center gap-1.5 border-r border-line px-2 text-[11px] tabular-nums text-ink-faint',
                        selected ? 'bg-[#14202f]' : 'bg-canvas',
                      )}
                      style={{ width: GUTTER_WIDTH }}
                      onClick={(event) => selectRow(rowIndex, event)}
                    >
                      <Checkbox
                        aria-label={`Select row ${rowIndex + 1}`}
                        checked={selected}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => {
                          const next = new Set(selectedRows);
                          if (checked === true) next.add(rowIndex);
                          else next.delete(rowIndex);
                          anchor.current = rowIndex;
                          onSelectedRowsChange(next);
                        }}
                      />
                      <span className="truncate">{rowOffset + rowIndex + 1}</span>
                    </div>

                    {visible.map(({ column, index }) => {
                      const isActive = active?.row === rowIndex && active.column === index;
                      const isEditing = editing?.row === rowIndex && editing.column === index;
                      const value = row[index] ?? null;

                      return (
                        <div
                          key={column.name}
                          className={cn(
                            'relative flex shrink-0 items-center border-r border-line/50 px-2 text-[12.5px]',
                            column.typeCategory === 'number' && 'justify-end tabular-nums',
                            isActive && 'z-[6] ring-[1.5px] ring-inset ring-accent',
                          )}
                          style={{ width: widths[column.name] ?? 150 }}
                          onMouseDown={() => setActive({ row: rowIndex, column: index })}
                          onDoubleClick={() => {
                            if (onEditCell && column.editable) setEditing({ row: rowIndex, column: index });
                          }}
                        >
                          {isEditing ? (
                            <CellEditor
                              column={column}
                              initialValue={value === null ? null : rawValue(value)}
                              onCancel={() => setEditing(null)}
                              onCommit={(next) => {
                                setEditing(null);
                                if (next === (value === null ? null : rawValue(value))) return;
                                void onEditCell?.(rowIndex, index, next);
                              }}
                            />
                          ) : (
                            <CellText value={value} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ContextMenuTrigger>

                <ContextMenuContent>
                  <ContextMenuLabel>
                    {selectedRows.size > 1 ? `${selectedRows.size} rows selected` : 'Row'}
                  </ContextMenuLabel>
                  <ContextMenuItem onSelect={copyCell}>
                    <Copy /> Copy cell
                  </ContextMenuItem>
                  <ContextMenuItem onSelect={() => copyRows([rowIndex], false)}>
                    <Rows3 /> Copy row
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={selectedRows.size === 0}
                    onSelect={() => copyRows([...selectedRows].sort((a, b) => a - b), true)}
                  >
                    <Rows3 /> Copy selection with header
                  </ContextMenuItem>
                  {onEditCell && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem
                        disabled={!active || !columns[active.column]?.editable}
                        onSelect={() => active && setEditing(active)}
                      >
                        <KeyRound /> Edit cell
                      </ContextMenuItem>
                      <ContextMenuItem
                        disabled={!active || !columns[active.column]?.nullable}
                        onSelect={() => active && void onEditCell(active.row, active.column, null)}
                      >
                        <KeyRound /> Set to NULL
                      </ContextMenuItem>
                    </>
                  )}
                  {onDeleteSelected && (
                    <>
                      <ContextMenuSeparator />
                      <ContextMenuItem danger disabled={selectedRows.size === 0} onSelect={onDeleteSelected}>
                        <Trash2 /> Delete {selectedRows.size > 1 ? `${selectedRows.size} rows` : 'row'}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function CellText({ value }: { value: JsonValue }) {
  if (value === null) {
    return <span className="select-none text-[11px] italic text-ink-faint">NULL</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-positive' : 'text-ink-muted'}>{String(value)}</span>;
  }
  return <span className="truncate">{displayValue(value)}</span>;
}

function HeaderCell({
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
