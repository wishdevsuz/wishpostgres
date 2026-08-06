import { Check } from 'lucide-react';
import { memo } from 'react';

import { cn } from '@/lib/utils';
import { rawValue } from '@/utils/format';
import type { JsonValue } from '@/types';

import { CellEditor } from './CellEditor';
import { CellText } from './GridCells';
import type { GridColumn } from './types';

export interface VisibleColumn {
  column: GridColumn;
  index: number;
}

interface GridRowProps {
  rowIndex: number;
  /** Number shown in the gutter, already offset by the current page. */
  displayNumber: number;
  values: JsonValue[];
  visible: VisibleColumn[];
  widths: Record<string, number>;
  height: number;
  offsetY: number;
  gutterWidth: number;
  selected: boolean;
  /** Column index of the active cell on this row, or -1. */
  activeColumn: number;
  /** Column index being edited on this row, or -1. */
  editingColumn: number;
  editable: boolean;
  onSelect: (
    rowIndex: number,
    event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  ) => void;
  onToggle: (rowIndex: number) => void;
  onFocusCell: (rowIndex: number, columnIndex: number) => void;
  onBeginEdit: (rowIndex: number, columnIndex: number) => void;
  onCancelEdit: () => void;
  onCommitEdit: (rowIndex: number, columnIndex: number, value: string | null) => void;
}

/**
 * One virtualised row.
 *
 * Memoised because the virtualiser keeps rows mounted while scrolling: without
 * this every visible row re-rendered on each scroll frame. The props are all
 * primitives or referentially stable values so the comparison actually holds.
 */
export const GridRow = memo(function GridRow({
  rowIndex,
  displayNumber,
  values,
  visible,
  widths,
  height,
  offsetY,
  gutterWidth,
  selected,
  activeColumn,
  editingColumn,
  editable,
  onSelect,
  onToggle,
  onFocusCell,
  onBeginEdit,
  onCancelEdit,
  onCommitEdit,
}: GridRowProps) {
  return (
    <div
      data-row-index={rowIndex}
      className={cn(
        'absolute inset-x-0 flex border-b border-line/60 [contain:layout_style]',
        selected ? 'bg-accent/12' : rowIndex % 2 === 1 ? 'bg-[#ffffff03]' : undefined,
      )}
      style={{ height, transform: `translateY(${offsetY}px)` }}
    >
      <div
        className={cn(
          'sticky left-0 z-[5] flex shrink-0 items-center gap-1.5 border-r border-line px-2 text-[11px] tabular-nums text-ink-faint',
          selected ? 'bg-[#14202f]' : 'bg-canvas',
        )}
        style={{ width: gutterWidth }}
        onMouseDown={(event) => onSelect(rowIndex, event)}
      >
        <span
          role="checkbox"
          aria-checked={selected}
          aria-label={`Select row ${displayNumber}`}
          tabIndex={-1}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggle(rowIndex);
          }}
          className={cn(
            'flex size-[15px] shrink-0 cursor-default items-center justify-center rounded-[4px] border transition-colors',
            selected ? 'border-accent bg-accent text-[#08172b]' : 'border-line-strong bg-[#0d1014]',
          )}
        >
          {selected && <Check className="size-3 stroke-[3]" />}
        </span>
        <span className="truncate">{displayNumber}</span>
      </div>

      {visible.map(({ column, index }) => {
        const value = values[index] ?? null;
        const isEditing = editingColumn === index;

        return (
          <div
            key={column.name}
            className={cn(
              'relative flex shrink-0 items-center border-r border-line/50 px-2 text-[12.5px]',
              column.typeCategory === 'number' && 'justify-end tabular-nums',
              activeColumn === index && 'z-[6] ring-[1.5px] ring-inset ring-accent',
            )}
            style={{ width: widths[column.name] ?? 150 }}
            onMouseDown={() => onFocusCell(rowIndex, index)}
            onDoubleClick={() => {
              if (editable && column.editable) onBeginEdit(rowIndex, index);
            }}
          >
            {isEditing ? (
              <CellEditor
                column={column}
                initialValue={value === null ? null : rawValue(value)}
                onCancel={onCancelEdit}
                onCommit={(next) => onCommitEdit(rowIndex, index, next)}
              />
            ) : (
              <CellText value={value} />
            )}
          </div>
        );
      })}
    </div>
  );
});
