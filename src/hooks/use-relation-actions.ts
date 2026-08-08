import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useScope } from '@/hooks/use-catalog';
import { structure } from '@/services/api';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';
import type { TableTarget } from '@/types';

/**
 * Rename, truncate and drop, shared by the object tree and the table page so
 * both offer exactly the same behaviour and refresh the same caches.
 *
 * Only the catalog and row caches are invalidated; refetching everything on a
 * single DDL statement made the tree flicker for no reason.
 */
export function useRelationActions() {
  const { connectionId, database, ready } = useScope();
  const queryClient = useQueryClient();
  const closeTable = useWorkspaceStore((state) => state.closeTable);
  const renameInWorkspace = useWorkspaceStore((state) => state.renameTable);

  const refreshCatalog = useCallback(() => {
    for (const key of [
      'relations',
      'columns',
      'indexes',
      'constraints',
      'statistics',
      'definition',
      'browse',
      'databases',
      'completions',
    ]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }, [queryClient]);

  const rename = useCallback(
    async (target: TableTarget, newName: string) => {
      if (!ready || !connectionId || !database) throw new Error('Connect to a database first.');
      const trimmed = newName.trim();
      if (!trimmed) throw new Error('Enter a new name.');
      if (trimmed === target.table) return;

      await structure.renameRelation({
        connectionId,
        database,
        schema: target.schema,
        table: target.table,
        newName: trimmed,
      });
      renameInWorkspace(target, trimmed);
      refreshCatalog();
      notify.success(`Renamed to ${trimmed}`);
    },
    [connectionId, database, ready, refreshCatalog, renameInWorkspace],
  );

  const truncate = useCallback(
    async (target: TableTarget) => {
      if (!ready || !connectionId || !database) throw new Error('Connect to a database first.');
      await structure.truncate({
        connectionId,
        database,
        schema: target.schema,
        table: target.table,
      });
      refreshCatalog();
      notify.success(`Truncated ${target.table}`);
    },
    [connectionId, database, ready, refreshCatalog],
  );

  const drop = useCallback(
    async (target: TableTarget, cascade: boolean) => {
      if (!ready || !connectionId || !database) throw new Error('Connect to a database first.');
      await structure.drop({
        connectionId,
        database,
        schema: target.schema,
        table: target.table,
        cascade,
      });

      const open = useWorkspaceStore.getState().table;
      if (open && open.schema === target.schema && open.table === target.table) closeTable();
      refreshCatalog();
      notify.success(`Dropped ${target.table}`);
    },
    [closeTable, connectionId, database, ready, refreshCatalog],
  );

  return { ready, rename, truncate, drop, refreshCatalog };
}

/** The word the UI uses for a relation kind, for menu labels and dialog copy. */
export function relationNoun(kind: TableTarget['kind']): string {
  switch (kind) {
    case 'view':
      return 'view';
    case 'materializedView':
      return 'materialized view';
    case 'foreignTable':
      return 'foreign table';
    default:
      return 'table';
  }
}

export function isTableKind(kind: TableTarget['kind']): boolean {
  return kind === 'table' || kind === 'partitionedTable';
}
