import { Command } from 'cmdk';
import { Columns3, Eye, FileCode2, Layers, Search, Table2 } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Badge, Kbd, Spinner } from '@/components/ui/misc';
import { useDebounced } from '@/hooks/use-debounced';
import { useGlobalSearch } from '@/hooks/use-catalog';
import { useDialogStore } from '@/state/dialog-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import type { SearchHit } from '@/types';

export function GlobalSearchDialog() {
  const open = useDialogStore((state) => state.open === 'globalSearch');
  const close = useDialogStore((state) => state.close);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const setSchema = useWorkspaceStore((state) => state.setSchema);
  const setView = useWorkspaceStore((state) => state.setView);

  const [term, setTerm] = useState('');
  const debounced = useDebounced(term, 220);
  const results = useGlobalSearch(debounced, open);

  function activate(hit: SearchHit) {
    close();
    setTerm('');

    if (hit.kind === 'schema') {
      setSchema(hit.name);
      return;
    }
    if (hit.kind === 'function') {
      setSchema(hit.schema);
      setView('functions');
      return;
    }
    if (hit.kind === 'column') {
      setSchema(hit.schema);
      openTable({ schema: hit.schema, table: hit.parent ?? '', kind: 'table' });
      return;
    }
    setSchema(hit.schema);
    openTable({
      schema: hit.schema,
      table: hit.name,
      kind: hit.kind === 'view' ? 'view' : hit.kind === 'materialized view' ? 'materializedView' : 'table',
    });
  }

  const hits = results.data ?? [];
  const grouped = groupHits(hits);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent size="md" hideClose className="top-[18%] translate-y-0 p-0">
        <Command shouldFilter={false} className="flex max-h-[62vh] flex-col">
          <div className="flex items-center gap-2 border-b border-line px-3">
            <Search className="size-4 shrink-0 text-ink-muted" />
            <Command.Input
              autoFocus
              value={term}
              onValueChange={setTerm}
              placeholder="Search tables, columns, views, functions and schemas…"
              className="h-11 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
            />
            {results.isFetching && <Spinner className="size-3.5 text-ink-faint" />}
            <Kbd>Esc</Kbd>
          </div>

          <Command.List className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {term.trim() === '' ? (
              <p className="px-2 py-8 text-center text-[12px] text-ink-faint">
                Start typing to search this database.
              </p>
            ) : results.isLoading ? (
              <p className="px-2 py-8 text-center text-[12px] text-ink-faint">Searching…</p>
            ) : hits.length === 0 ? (
              <Command.Empty className="px-2 py-8 text-center text-[12px] text-ink-faint">
                Nothing matches “{term}”.
              </Command.Empty>
            ) : (
              Object.entries(grouped).map(([group, entries]) => (
                <Command.Group
                  key={group}
                  heading={
                    <span className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                      {group}
                    </span>
                  }
                >
                  {entries.map((hit, index) => (
                    <Command.Item
                      key={`${hit.kind}-${hit.schema}-${hit.parent ?? ''}-${hit.name}-${index}`}
                      value={`${hit.kind}-${hit.schema}-${hit.parent ?? ''}-${hit.name}-${index}`}
                      onSelect={() => activate(hit)}
                      className="flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] text-ink-soft data-[selected=true]:bg-[#ffffff12] data-[selected=true]:text-ink"
                    >
                      <span className="flex shrink-0 text-ink-faint [&_svg]:size-3.5">{iconFor(hit.kind)}</span>
                      <span className="truncate">{hit.name}</span>
                      {hit.parent && <span className="shrink-0 text-[11px] text-ink-faint">in {hit.parent}</span>}
                      <div className="flex-1" />
                      {hit.detail && (
                        <span className="max-w-[200px] shrink-0 truncate font-mono text-[10.5px] text-ink-faint">
                          {hit.detail}
                        </span>
                      )}
                      <Badge variant="neutral">{hit.schema}</Badge>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))
            )}
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function groupHits(hits: SearchHit[]): Record<string, SearchHit[]> {
  const groups: Record<string, SearchHit[]> = {};
  for (const hit of hits) {
    const key = `${hit.kind}s`;
    (groups[key] ??= []).push(hit);
  }
  return groups;
}

function iconFor(kind: string) {
  switch (kind) {
    case 'schema':
      return <Layers />;
    case 'column':
      return <Columns3 />;
    case 'function':
      return <FileCode2 />;
    case 'view':
    case 'materialized view':
      return <Eye />;
    default:
      return <Table2 />;
  }
}
