import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, KeyRound, Rows3, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
  MenuShortcut,
} from '@/components/ui/menu';
import { Checkbox } from '@/components/ui/form';
import { toClipboardTable, useClipboard } from '@/hooks/use-clipboard';
import { rawValue } from '@/utils/format';
import type { JsonValue, SortDirection } from '@/types';

import { HeaderCell } from './GridCells';
import { GridRow } from './GridRow';
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
  const [contextRow, setContextRow] = useState<number | null>(null);
  const anchor = useRef<number | null>(null);
  // Read inside callbacks so selecting a row does not change their identity and
  // force every memoised row to re-render.
  const selectionRef = useRef(selectedRows);
  selectionRef.current = selectedRows;

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

  // Rows can shrink under the cursor (a delete, a new page, a re-run), which
  // would otherwise leave the focus ring pointing at a row that is gone.
  useEffect(() => {
    setActive((current) => (current === null || current.row < rows.length ? current : null));
    setEditing((current) => (current === null || current.row < rows.length ? current : null));
  }, [rows.length]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  const totalWidth = useMemo(
    () => visible.reduce((sum, entry) => sum + (widths[entry.column.name] ?? 150), GUTTER_WIDTH),
    [visible, widths],
  );

  const selectRow = useCallback(
    (index: number, event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
      const next = new Set(selectionRef.current);
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
    [onSelectedRowsChange],
  );

  const toggleRow = useCallback(
    (index: number) => {
      const next = new Set(selectionRef.current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      anchor.current = index;
      onSelectedRowsChange(next);
    },
    [onSelectedRowsChange],
  );

  const focusCell = useCallback((row: number, column: number) => setActive({ row, column }), []);
  const beginEdit = useCallback((row: number, column: number) => setEditing({ row, column }), []);
  const cancelEdit = useCallback(() => setEditing(null), []);

  const commitEdit = useCallback(
    (row: number, column: number, value: string | null) => {
      setEditing(null);
      const previous = rows[row]?.[column] ?? null;
      if (value === (previous === null ? null : rawValue(previous))) return;
      void onEditCell?.(row, column, value);
    },
    [onEditCell, rows],
  );

  /**
   * One context menu serves the whole grid. Mounting a Radix menu per row was
   * the dominant cost while scrolling, so the row under the pointer is resolved
   * from the DOM instead.
   */
  const onRowContextMenu = useCallback(
    (event: React.MouseEvent) => {
      const element = (event.target as HTMLElement).closest('[data-row-index]');
      const index = element ? Number(element.getAttribute('data-row-index')) : null;
      setContextRow(index);
      if (index !== null && !selectionRef.current.has(index)) {
        anchor.current = index;
        onSelectedRowsChange(new Set([index]));
      }
    },
    [onSelectedRowsChange],
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
          Math.min(
            visible.length - 1,
            visible.findIndex((entry) => entry.index === base.column) + columnDelta,
          ),
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
      if (key === 'Home')
        return void (event.preventDefault(), setActive({ row: 0, column: visible[0]?.index ?? 0 }));
      if (key === 'End')
        return void (event.preventDefault(),
        setActive({ row: rows.length - 1, column: visible[0]?.index ?? 0 }));

      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'c') {
        event.preventDefault();
        if (selectedRows.size > 0)
          copyRows(
            [...selectedRows].sort((a, b) => a - b),
            true,
          );
        else copyCell();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === 'a') {
        event.preventDefault();
        onSelectedRowsChange(new Set(rows.map((_, index) => index)));
        return;
      }
      if (key === 'Escape' && selectedRows.size > 0) {
        event.preventDefault();
        onSelectedRowsChange(new Set());
        return;
      }
      if (key === 'Enter' && active && onEditCell && columns[active.column]?.editable) {
        event.preventDefault();
        setEditing(active);
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && onDeleteSelected && selectedRows.size > 0) {
        event.preventDefault();
        onDeleteSelected();
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
      onDeleteSelected,
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
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onContextMenu={onRowContextMenu}
          // Captured, because the row checkboxes cancel the default focus and
          // stop the event bubbling. Without this, ticking a row left the
          // keyboard focus outside the grid and Delete or Ctrl+C did nothing.
          onMouseDownCapture={() => scrollRef.current?.focus({ preventScroll: true })}
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
                    onSelectedRowsChange(
                      checked === true ? new Set(rows.map((_, index) => index)) : new Set(),
                    )
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
                    sortIndex={
                      sort.length > 1 ? sort.findIndex((entry) => entry.column === column.name) : -1
                    }
                    onSort={onSort ? (additive) => onSort(column.name, additive) : undefined}
                    onResize={(width) =>
                      setWidths((current) => ({ ...current, [column.name]: width }))
                    }
                    onAutoSize={() =>
                      setWidths((current) => ({
                        ...current,
                        [column.name]: estimateWidth(column, rows, index),
                      }))
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

                return (
                  <GridRow
                    key={virtualRow.key}
                    rowIndex={rowIndex}
                    displayNumber={rowOffset + rowIndex + 1}
                    values={row}
                    visible={visible}
                    widths={widths}
                    height={ROW_HEIGHT}
                    offsetY={virtualRow.start}
                    gutterWidth={GUTTER_WIDTH}
                    selected={selectedRows.has(rowIndex)}
                    activeColumn={active?.row === rowIndex ? active.column : -1}
                    editingColumn={editing?.row === rowIndex ? editing.column : -1}
                    editable={Boolean(onEditCell)}
                    onSelect={selectRow}
                    onToggle={toggleRow}
                    onFocusCell={focusCell}
                    onBeginEdit={beginEdit}
                    onCancelEdit={cancelEdit}
                    onCommitEdit={commitEdit}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuLabel>
          {selectedRows.size > 1 ? `${selectedRows.size} rows selected` : 'Row'}
        </ContextMenuLabel>
        <ContextMenuItem onSelect={copyCell}>
          <Copy /> Copy cell
        </ContextMenuItem>
        <ContextMenuItem
          disabled={contextRow === null}
          onSelect={() => contextRow !== null && copyRows([contextRow], false)}
        >
          <Rows3 /> Copy row
        </ContextMenuItem>
        <ContextMenuItem
          disabled={selectedRows.size === 0}
          onSelect={() =>
            copyRows(
              [...selectedRows].sort((a, b) => a - b),
              true,
            )
          }
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
              <MenuShortcut>Del</MenuShortcut>
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
