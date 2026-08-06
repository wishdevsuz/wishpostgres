import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Table2, TriangleAlert } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataGrid } from '@/components/grid/DataGrid';
import { FilterDialog } from '@/components/grid/FilterDialog';
import { GridToolbar } from '@/components/grid/GridToolbar';
import { fromColumnMeta } from '@/components/grid/types';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ExportDialog } from '@/components/dialogs/ExportDialog';
import { InsertRowDialog } from '@/components/dialogs/InsertRowDialog';
import { Badge, EmptyState, Spinner, Tooltip } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { useDebounced } from '@/hooks/use-debounced';
import { useScope } from '@/hooks/use-catalog';
import { data } from '@/services/api';
import { useSettingsStore } from '@/state/settings-store';
import { notify } from '@/utils/notify';
import type { BrowseRequest, BrowseResult, FilterSpec, SortSpec, TableTarget } from '@/types';

export function BrowseTab({ target }: { target: TableTarget }) {
  const { connectionId, database, ready } = useScope();
  const queryClient = useQueryClient();
  const rowsPerPage = useSettingsStore((state) => state.settings.rowsPerPage);
  const confirmBeforeDelete = useSettingsStore((state) => state.settings.confirmBeforeDelete);

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(rowsPerPage);
  const [sort, setSort] = useState<SortSpec[]>([]);
  const [filters, setFilters] = useState<FilterSpec[]>([]);
  const [search, setSearch] = useState('');
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<'filters' | 'insert' | 'delete' | 'export' | null>(null);

  const debouncedSearch = useDebounced(search, 250);

  const request = useMemo<BrowseRequest>(
    () => ({
      schema: target.schema,
      table: target.table,
      limit: pageSize,
      offset: page * pageSize,
      sort,
      filters,
      search: debouncedSearch.trim() || null,
      exactCount: false,
    }),
    [debouncedSearch, filters, page, pageSize, sort, target.schema, target.table],
  );

  const browse = useQuery({
    queryKey: ['browse', connectionId, database, request],
    queryFn: () => data.browse({ connectionId: connectionId!, database: database!, request }),
    enabled: ready,
    placeholderData: (previous) => previous,
  });

  const result: BrowseResult | undefined = browse.data;
  const columns = useMemo(
    () => (result ? fromColumnMeta(result.columns, result.editable) : []),
    [result],
  );

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['browse', connectionId, database] });
    setSelectedRows(new Set());
  }, [connectionId, database, queryClient]);

  const editCell = useMutation({
    mutationFn: async ({
      row,
      column,
      value,
    }: {
      row: number;
      column: number;
      value: string | null;
    }) => {
      if (!result) return;
      const columnMeta = result.columns[column];
      const identityValues = result.identityValues[row];
      if (!columnMeta || !identityValues) throw new Error('That row is no longer loaded.');

      await data.updateCell({
        connectionId: connectionId!,
        database: database!,
        change: {
          schema: target.schema,
          table: target.table,
          identity: result.identity,
          identityValues,
          column: columnMeta.name,
          value,
        },
      });
    },
    onSuccess: () => {
      notify.success('Saved');
      invalidate();
    },
    onError: (error) => notify.failure(error, 'Could not save the change'),
  });

  const deleteRows = useMutation({
    mutationFn: async () => {
      if (!result) return 0;
      const rows = [...selectedRows]
        .map((index) => result.identityValues[index])
        .filter((values): values is NonNullable<typeof values> => Boolean(values));

      return data.deleteRows({
        connectionId: connectionId!,
        database: database!,
        request: {
          schema: target.schema,
          table: target.table,
          identity: result.identity,
          rows,
        },
      });
    },
    onSuccess: (count) => {
      notify.success(`Deleted ${count} row${count === 1 ? '' : 's'}`);
      invalidate();
    },
    onError: (error) => notify.failure(error, 'Could not delete the rows'),
  });

  // A stable identity here is what lets the grid's memoised rows skip
  // re-rendering while scrolling.
  const applyEdit = useCallback(
    async (row: number, column: number, value: string | null) => {
      await editCell.mutateAsync({ row, column, value });
    },
    [editCell],
  );

  const toggleSort = useCallback((column: string, additive: boolean) => {
    setPage(0);
    setSort((current) => {
      const existing = current.find((entry) => entry.column === column);
      const next: SortSpec[] = additive ? current.filter((entry) => entry.column !== column) : [];
      if (!existing) return [...next, { column, direction: 'asc' }];
      if (existing.direction === 'asc') return [...next, { column, direction: 'desc' }];
      return next;
    });
  }, []);

  if (!ready) {
    return (
      <EmptyState
        icon={<Table2 />}
        title="Not connected"
        description="Connect to browse this table."
      />
    );
  }

  if (browse.isError) {
    return (
      <EmptyState
        icon={<TriangleAlert />}
        title="Could not load rows"
        description={(browse.error as Error).message}
        action={
          <Button variant="secondary" size="sm" onClick={() => void browse.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  const rows = result?.rows ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <GridToolbar
        columns={columns}
        hiddenColumns={hiddenColumns}
        onToggleColumn={(name) =>
          setHiddenColumns((current) => {
            const next = new Set(current);
            if (next.has(name)) next.delete(name);
            else next.add(name);
            return next;
          })
        }
        onShowAllColumns={() => setHiddenColumns(new Set())}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(0);
        }}
        filters={filters}
        onOpenFilters={() => setDialog('filters')}
        onClearFilters={() => {
          setFilters([]);
          setPage(0);
        }}
        page={page}
        pageSize={pageSize}
        totalRows={result?.totalRows ?? null}
        isEstimate={result?.isEstimate ?? false}
        loadedRows={rows.length}
        onPageChange={(next) => {
          setPage(next);
          setSelectedRows(new Set());
        }}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        selectedCount={selectedRows.size}
        onInsert={result?.editable ? () => setDialog('insert') : undefined}
        onDelete={result?.editable ? () => setDialog('delete') : undefined}
        onExport={() => setDialog('export')}
        durationMs={result?.durationMs}
        extra={
          <>
            {browse.isFetching && <Spinner className="ml-1 size-3 text-ink-faint" />}
            {result && !result.editable && (
              <Tooltip content="Rows can only be edited when the relation is a table with a primary key or a unique NOT NULL column.">
                <Badge variant="caution">read only</Badge>
              </Tooltip>
            )}
          </>
        }
      />

      <DataGrid
        columns={columns}
        rows={rows}
        rowOffset={page * pageSize}
        sort={sort}
        onSort={toggleSort}
        hiddenColumns={hiddenColumns}
        selectedRows={selectedRows}
        onSelectedRowsChange={setSelectedRows}
        onEditCell={result?.editable ? applyEdit : undefined}
        onDeleteSelected={result?.editable ? () => setDialog('delete') : undefined}
        emptyState={
          <EmptyState
            icon={<Table2 />}
            title={filters.length > 0 || search ? 'No matching rows' : 'This table is empty'}
            description={
              filters.length > 0 || search
                ? 'Adjust the search or filters to see more rows.'
                : 'Insert the first row to get started.'
            }
            action={
              result?.editable ? (
                <Button variant="primary" size="sm" onClick={() => setDialog('insert')}>
                  Insert a row
                </Button>
              ) : undefined
            }
          />
        }
      />

      <FilterDialog
        open={dialog === 'filters'}
        onOpenChange={(open) => setDialog(open ? 'filters' : null)}
        columns={columns}
        filters={filters}
        onApply={(next) => {
          setFilters(next);
          setPage(0);
        }}
      />

      {result && (
        <InsertRowDialog
          open={dialog === 'insert'}
          onOpenChange={(open) => setDialog(open ? 'insert' : null)}
          target={target}
          columns={result.columns}
          onInserted={invalidate}
        />
      )}

      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(open) => setDialog(open ? 'delete' : null)}
        title={`Delete ${selectedRows.size} row${selectedRows.size === 1 ? '' : 's'}?`}
        description="This runs a DELETE statement immediately and cannot be undone."
        confirmLabel="Delete rows"
        destructive
        requireConfirmation={confirmBeforeDelete && selectedRows.size > 10}
        confirmationWord="delete"
        onConfirm={async () => {
          await deleteRows.mutateAsync();
        }}
      />

      {result && (
        <ExportDialog
          open={dialog === 'export'}
          onOpenChange={(open) => setDialog(open ? 'export' : null)}
          columns={result.columns.map((column) => column.name)}
          rows={
            selectedRows.size > 0
              ? [...selectedRows].sort((a, b) => a - b).map((index) => rows[index] ?? [])
              : rows
          }
          defaultName={`${target.schema}.${target.table}`}
          tableName={`${target.schema}.${target.table}`}
        />
      )}
    </div>
  );
}
