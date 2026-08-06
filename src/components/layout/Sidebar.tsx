import { Star, Table2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConnectionList } from '@/components/connections/ConnectionList';
import { ObjectTree } from '@/components/layout/ObjectTree';
import { TreeItem, TreeSection } from '@/components/layout/tree';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';

const MIN_WIDTH = 210;
const MAX_WIDTH = 460;

export function Sidebar() {
  const width = useWorkspaceStore((state) => state.sidebarWidth);
  const setWidth = useWorkspaceStore((state) => state.setSidebarWidth);
  const [connectionsOpen, setConnectionsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const dragging = useRef(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX)));
    },
    [setWidth],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  useEffect(() => {
    document.body.style.cursor = dragging.current ? 'col-resize' : '';
  }, [width]);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-line bg-surface"
      style={{ width }}
    >
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-1.5 py-2">
        <ConnectionList
          open={connectionsOpen}
          onToggle={() => setConnectionsOpen((open) => !open)}
        />
        <FavoritesSection open={favoritesOpen} onToggle={() => setFavoritesOpen((open) => !open)} />
        <ObjectTree />
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className={cn(
          'absolute inset-y-0 -right-1 w-2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1 after:w-px after:bg-transparent after:transition-colors hover:after:bg-accent',
        )}
      />
    </aside>
  );
}

function FavoritesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const favorites = useWorkspaceStore((state) => state.favorites);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);

  const scoped = favorites.filter(
    (favorite) => favorite.connectionId === connectionId && favorite.database === database,
  );

  if (scoped.length === 0) return null;

  return (
    <TreeSection
      label="Favorites"
      icon={<Star />}
      open={open}
      onToggle={onToggle}
      count={scoped.length}
    >
      {scoped.map((favorite) => (
        <TreeItem
          key={`${favorite.schema}.${favorite.table}`}
          depth={1}
          icon={<Table2 />}
          label={favorite.table}
          meta={favorite.schema}
          onClick={() =>
            openTable({ schema: favorite.schema, table: favorite.table, kind: 'table' })
          }
          actions={
            <button
              type="button"
              aria-label="Remove favorite"
              className="flex size-6 items-center justify-center rounded text-caution hover:bg-[#ffffff0f]"
              onClick={(event) => {
                event.stopPropagation();
                toggleFavorite(favorite);
              }}
            >
              <Star className="size-3 fill-caution" />
            </button>
          }
        />
      ))}
    </TreeSection>
  );
}
