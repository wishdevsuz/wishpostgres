import { useEffect, useRef } from 'react';

import { useConnectionStore } from '@/state/connection-store';
import { useSettingsStore } from '@/state/settings-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import type { SchemaInfo } from '@/types';

/**
 * Close anything that belongs to a database the user has just navigated away
 * from. Without this the table page keeps rendering the previous database's
 * relation, which either shows the wrong rows or fails outright.
 *
 * SQL tabs are deliberately left alone: they are scratch text, not bound to one
 * database, and losing them on a database switch would be worse than keeping
 * them.
 */
export function useScopeReset() {
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    const scope = connectionId && database ? `${connectionId}::${database}` : null;
    if (previous.current === scope) return;

    const isFirstScope = previous.current === null;
    previous.current = scope;
    if (isFirstScope) return;

    const { table, view, closeTable, setView } = useWorkspaceStore.getState();
    if (table) closeTable();
    else if (view === 'table') setView('welcome');
  }, [connectionId, database]);
}

/**
 * Keep the selected schema pointing at something that exists.
 *
 * Entering a database whose schemas differ from the last one would otherwise
 * leave the tree filtering on a schema that is not there, so it would report an
 * empty database. The preferred schema from Settings wins when present.
 */
export function useSchemaFocus(schemas: SchemaInfo[] | undefined, loading: boolean) {
  const schema = useWorkspaceStore((state) => state.schema);
  const setSchema = useWorkspaceStore((state) => state.setSchema);
  const preferred = useSettingsStore((state) => state.settings.defaultSchema);

  useEffect(() => {
    if (loading || !schemas || schemas.length === 0) return;
    if (schemas.some((entry) => entry.name === schema)) return;

    const userSchemas = schemas.filter((entry) => !entry.isSystem);
    const next =
      userSchemas.find((entry) => entry.name === preferred) ??
      userSchemas.find((entry) => entry.name === 'public') ??
      userSchemas[0] ??
      schemas[0];

    if (next) setSchema(next.name);
  }, [schemas, loading, schema, preferred, setSchema]);
}

/** Reset a value whenever the active connection or database changes. */
export function useResetOnScopeChange(reset: () => void) {
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);
  const latest = useRef(reset);
  latest.current = reset;

  useEffect(() => {
    latest.current();
  }, [connectionId, database]);
}
