import { useQuery } from '@tanstack/react-query';

import { catalog } from '@/services/api';
import { useConnectionStore } from '@/state/connection-store';
import type { RelationKind } from '@/types';

/** The connection and database every catalog query is scoped to. */
export function useScope() {
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const online = useConnectionStore((state) =>
    connectionId ? state.statuses[connectionId] === 'online' : false,
  );
  return { connectionId, database, ready: Boolean(connectionId && database && online) };
}

const STALE = 30_000;

export function useDatabases() {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['databases', connectionId, database],
    queryFn: () => catalog.databases({ connectionId: connectionId!, database: database! }),
    enabled: ready,
    staleTime: STALE,
  });
}

export function useSchemas() {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['schemas', connectionId, database],
    queryFn: () => catalog.schemas({ connectionId: connectionId!, database: database! }),
    enabled: ready,
    staleTime: STALE,
  });
}

export function useRelations(schema: string, kinds: RelationKind[]) {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['relations', connectionId, database, schema, kinds.join(',')],
    queryFn: () =>
      catalog.relations({ connectionId: connectionId!, database: database!, schema, kinds }),
    enabled: ready && Boolean(schema),
    staleTime: STALE,
  });
}

export function useFunctions(schema: string) {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['functions', connectionId, database, schema],
    queryFn: () => catalog.functions({ connectionId: connectionId!, database: database!, schema }),
    enabled: ready && Boolean(schema),
    staleTime: STALE,
  });
}

export function useExtensions() {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['extensions', connectionId, database],
    queryFn: () => catalog.extensions({ connectionId: connectionId!, database: database! }),
    enabled: ready,
    staleTime: STALE,
  });
}

function tableQuery<T>(
  key: string,
  fetcher: (scope: {
    connectionId: string;
    database: string;
    schema: string;
    table: string;
  }) => Promise<T>,
) {
  return (schema: string, table: string, enabled = true) => {
    const { connectionId, database, ready } = useScope();
    return useQuery({
      queryKey: [key, connectionId, database, schema, table],
      queryFn: () => fetcher({ connectionId: connectionId!, database: database!, schema, table }),
      enabled: enabled && ready && Boolean(schema && table),
      staleTime: STALE,
    });
  };
}

export const useTableColumns = tableQuery('columns', catalog.columns);
export const useTableIndexes = tableQuery('indexes', catalog.indexes);
export const useTableConstraints = tableQuery('constraints', catalog.constraints);
export const useTableStatistics = tableQuery('statistics', catalog.statistics);
export const useTableDefinition = tableQuery('definition', catalog.definition);

export function useGlobalSearch(term: string, enabled: boolean) {
  const { connectionId, database, ready } = useScope();
  return useQuery({
    queryKey: ['search', connectionId, database, term],
    queryFn: () => catalog.search({ connectionId: connectionId!, database: database!, term }),
    enabled: enabled && ready && term.trim().length > 0,
    staleTime: 5_000,
  });
}
