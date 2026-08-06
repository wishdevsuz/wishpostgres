import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, MoreHorizontal, Plus, Trash2, Type } from 'lucide-react';
import { useState } from 'react';

import { AddColumnDialog } from '@/components/dialogs/AddColumnDialog';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { Badge, EmptyState, Skeleton, Tooltip } from '@/components/ui/misc';
import { useScope, useTableColumns } from '@/hooks/use-catalog';
import { structure } from '@/services/api';
import { notify } from '@/utils/notify';
import type { ColumnMeta, TableTarget } from '@/types';

import { InlineEditPrompt } from './InlineEditPrompt';

type Pending =
  | { kind: 'rename'; column: ColumnMeta }
  | { kind: 'type'; column: ColumnMeta }
  | { kind: 'default'; column: ColumnMeta }
  | { kind: 'comment'; column: ColumnMeta }
  | { kind: 'drop'; column: ColumnMeta }
  | null;

export function StructureTab({ target }: { target: TableTarget }) {
  const { connectionId, database } = useScope();
  const queryClient = useQueryClient();
  const columns = useTableColumns(target.schema, target.table);
  const [pending, setPending] = useState<Pending>(null);
  const [adding, setAdding] = useState(false);

  const alter = useMutation({
    mutationFn: ({ column, action }: { column: string; action: Record<string, unknown> }) =>
      structure.alterColumn({
        connectionId: connectionId!,
        database: database!,
        request: { schema: target.schema, table: target.table, column, action },
      }),
    onSuccess: (statement) => {
      notify.success('Structure updated', statement);
      setPending(null);
      void queryClient.invalidateQueries();
    },
    onError: (error) => notify.failure(error, 'Could not alter the column'),
  });

  if (columns.isLoading) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-8" />
        ))}
      </div>
    );
  }

  const list = columns.data ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-surface px-3">
        <span className="text-[12.5px] text-ink-muted">
          {list.length} column{list.length === 1 ? '' : 's'}
        </span>
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => setAdding(true)}>
          <Plus />
          Add column
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {list.length === 0 ? (
          <EmptyState icon={<Type />} title="No columns" />
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-elevated">
              <tr className="text-left">
                {['Column', 'Type', 'Nullable', 'Default', 'Attributes', 'Comment', ''].map(
                  (label) => (
                    <th
                      key={label}
                      className="whitespace-nowrap border-b border-line-strong px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-muted"
                    >
                      {label}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {list.map((column, index) => (
                <tr key={column.name} className={index % 2 ? 'bg-[#ffffff03]' : undefined}>
                  <td className="border-b border-line/60 px-3 py-1.5">
                    <span className="flex items-center gap-1.5">
                      {column.isPrimaryKey && (
                        <Tooltip content="Primary key">
                          <KeyRound className="size-3 text-caution" />
                        </Tooltip>
                      )}
                      <span className="font-medium text-ink">{column.name}</span>
                    </span>
                  </td>
                  <td className="border-b border-line/60 px-3 py-1.5 font-mono text-[12px] text-accent">
                    {column.dataType}
                  </td>
                  <td className="border-b border-line/60 px-3 py-1.5">
                    {column.nullable ? (
                      <span className="text-ink-faint">NULL</span>
                    ) : (
                      <Badge variant="neutral">NOT NULL</Badge>
                    )}
                  </td>
                  <td className="max-w-[220px] truncate border-b border-line/60 px-3 py-1.5 font-mono text-[11.5px] text-ink-muted">
                    {column.default ?? '—'}
                  </td>
                  <td className="border-b border-line/60 px-3 py-1.5">
                    <span className="flex flex-wrap gap-1">
                      {column.isUnique && <Badge variant="accent">unique</Badge>}
                      {column.isIdentity && <Badge variant="violet">identity</Badge>}
                      {column.isGenerated && <Badge variant="violet">generated</Badge>}
                    </span>
                  </td>
                  <td className="max-w-[220px] truncate border-b border-line/60 px-3 py-1.5 text-ink-muted">
                    {column.comment ?? '—'}
                  </td>
                  <td className="border-b border-line/60 px-2 py-1.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="iconXs"
                          aria-label={`Actions for ${column.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{column.name}</DropdownMenuLabel>
                        <DropdownMenuItem onSelect={() => setPending({ kind: 'rename', column })}>
                          Rename…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPending({ kind: 'type', column })}>
                          Change type…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPending({ kind: 'default', column })}>
                          Set default…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPending({ kind: 'comment', column })}>
                          Set comment…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            alter.mutate({
                              column: column.name,
                              action: { type: 'setNullable', value: !column.nullable },
                            })
                          }
                        >
                          {column.nullable ? 'Set NOT NULL' : 'Allow NULL'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          danger
                          onSelect={() => setPending({ kind: 'drop', column })}
                        >
                          <Trash2 /> Drop column
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <AddColumnDialog open={adding} onOpenChange={setAdding} target={target} />

      <InlineEditPrompt
        pending={pending}
        onCancel={() => setPending(null)}
        onSubmit={(action) => pending && alter.mutate({ column: pending.column.name, action })}
        busy={alter.isPending}
      />

      <ConfirmDialog
        open={pending?.kind === 'drop'}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Drop column ${pending?.column.name}?`}
        description="The column and every value in it are removed permanently."
        confirmLabel="Drop column"
        destructive
        requireConfirmation
        confirmationWord={pending?.column.name ?? 'drop'}
        onConfirm={async () => {
          if (!pending) return;
          await alter.mutateAsync({
            column: pending.column.name,
            action: { type: 'drop', value: { cascade: false } },
          });
        }}
      />
    </div>
  );
}
