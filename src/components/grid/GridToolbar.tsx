import {
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Filter,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Badge, Separator, Tooltip } from '@/components/ui/misc';
import { formatCount, formatDuration } from '@/utils/format';
import type { FilterSpec } from '@/types';

import type { GridColumn } from './types';

export interface GridToolbarProps {
  columns: GridColumn[];
  hiddenColumns: Set<string>;
  onToggleColumn: (name: string) => void;
  onShowAllColumns: () => void;

  search: string;
  onSearchChange: (value: string) => void;

  filters: FilterSpec[];
  onOpenFilters: () => void;
  onClearFilters: () => void;

  page: number;
  pageSize: number;
  totalRows: number | null;
  isEstimate: boolean;
  loadedRows: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;

  selectedCount: number;
  onInsert?: () => void;
  onDelete?: () => void;
  onExport?: () => void;

  durationMs?: number;
  extra?: ReactNode;
}

const PAGE_SIZES = [50, 100, 250, 500, 1000];

export function GridToolbar({
  columns,
  hiddenColumns,
  onToggleColumn,
  onShowAllColumns,
  search,
  onSearchChange,
  filters,
  onOpenFilters,
  onClearFilters,
  page,
  pageSize,
  totalRows,
  isEstimate,
  loadedRows,
  onPageChange,
  onPageSizeChange,
  selectedCount,
  onInsert,
  onDelete,
  onExport,
  durationMs,
  extra,
}: GridToolbarProps) {
  const lastPage = totalRows === null ? page : Math.max(0, Math.ceil(totalRows / pageSize) - 1);
  const from = totalRows === 0 ? 0 : page * pageSize + 1;
  const to = page * pageSize + loadedRows;

  return (
    <div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-line bg-surface px-2">
      <Input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search all columns"
        leading={<Search />}
        spellCheck={false}
        className="h-7 w-[210px] text-[12px]"
        trailing={
          search ? (
            <Button
              variant="ghost"
              size="iconXs"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
            >
              <X />
            </Button>
          ) : undefined
        }
      />

      <Tooltip content="Filters">
        <Button
          variant={filters.length > 0 ? 'primary' : 'ghost'}
          size="sm"
          onClick={onOpenFilters}
        >
          <Filter />
          Filter
          {filters.length > 0 && <Badge variant="neutral">{filters.length}</Badge>}
        </Button>
      </Tooltip>
      {filters.length > 0 && (
        <Tooltip content="Clear filters">
          <Button variant="ghost" size="iconSm" aria-label="Clear filters" onClick={onClearFilters}>
            <X />
          </Button>
        </Tooltip>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Columns3 />
            Columns
            {hiddenColumns.size > 0 && <Badge variant="caution">{hiddenColumns.size} hidden</Badge>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[340px] overflow-y-auto">
          <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
          {columns.map((column) => (
            <DropdownMenuCheckboxItem
              key={column.name}
              checked={!hiddenColumns.has(column.name)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={() => onToggleColumn(column.name)}
            >
              <span className="truncate">{column.name}</span>
              <span className="ml-auto pl-3 text-[10px] text-ink-faint">{column.dataType}</span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onShowAllColumns}>Show all</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {extra}

      <div className="flex-1" />

      {selectedCount > 0 && (
        <>
          <Badge variant="accent" size="md">
            {formatCount(selectedCount)} selected
          </Badge>
          {onDelete && (
            <Tooltip content="Delete selected rows" shortcut="Del">
              <Button variant="dangerGhost" size="sm" onClick={onDelete}>
                <Trash2 />
                Delete
              </Button>
            </Tooltip>
          )}
          <Separator orientation="vertical" className="h-5" />
        </>
      )}

      {onInsert && (
        <Tooltip content="Insert a row">
          <Button variant="secondary" size="sm" onClick={onInsert}>
            <Plus />
            Insert
          </Button>
        </Tooltip>
      )}

      {onExport && (
        <Tooltip content="Export result">
          <Button variant="ghost" size="iconSm" aria-label="Export" onClick={onExport}>
            <Download />
          </Button>
        </Tooltip>
      )}

      <Separator orientation="vertical" className="h-5" />

      <div className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        {durationMs !== undefined && (
          <span className="tabular-nums text-ink-faint">{formatDuration(durationMs)}</span>
        )}
        <span className="tabular-nums">
          {formatCount(from)}–{formatCount(to)}
          {totalRows !== null && (
            <>
              {' of '}
              {isEstimate && '~'}
              {formatCount(totalRows)}
            </>
          )}
        </span>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="tabular-nums">
            {pageSize} / page
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {PAGE_SIZES.map((size) => (
            <DropdownMenuItem key={size} onSelect={() => onPageSizeChange(size)}>
              {size} rows
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="flex items-center gap-0.5">
        <Tooltip content="Previous page">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft />
          </Button>
        </Tooltip>
        <Tooltip content="Next page">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Next page"
            disabled={loadedRows < pageSize || page >= lastPage}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
