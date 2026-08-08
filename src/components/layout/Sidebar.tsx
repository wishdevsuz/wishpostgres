import { Star, Table2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { ConnectionList } from '@/components/connections/ConnectionList';
import { ObjectTree } from '@/components/layout/ObjectTree';
import { TreeItem, TreeSection } from '@/components/layout/tree';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/misc';
import { cn } from '@/lib/utils';
import { useConnectionStore } from '@/state/connection-store';
import { useWorkspaceStore } from '@/state/workspace-store';

const MIN_WIDTH = 210;
const MAX_WIDTH = 460;

export function Sidebar() {
  const width = useWorkspaceStore((state) => state.sidebarWidth);
  const setWidth = useWorkspaceStore((state) => state.setSidebarWidth);
  const collapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const [connectionsOpen, setConnectionsOpen] = useState(true);
  const [favoritesOpen, setFavoritesOpen] = useState(true);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, event.clientX)));
    },
    [setWidth],
  );

  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // Keep the resize cursor while the pointer is outside the handle, and always
  // put it back — a drag that ends off-window used to leave it stuck.
  useEffect(() => {
    if (!dragging) return;
    document.body.style.cursor = 'col-resize';
    return () => {
      document.body.style.cursor = '';
    };
  }, [dragging]);

  if (collapsed) return null;

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
        title="Drag to resize · double click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => setWidth(264)}
        className={cn(
          'absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize',
          'after:absolute after:inset-y-0 after:left-1 after:w-px after:transition-colors hover:after:bg-accent',
          dragging ? 'after:bg-accent' : 'after:bg-transparent',
        )}
      />
    </aside>
  );
}

function FavoritesSection({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const favorites = useWorkspaceStore((state) => state.favorites);
  const openTable = useWorkspaceStore((state) => state.openTable);
  const toggleFavorite = useWorkspaceStore((state) => state.toggleFavorite);
  const current = useWorkspaceStore((state) => state.table);
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
          active={current?.schema === favorite.schema && current?.table === favorite.table}
          onClick={() =>
            openTable({ schema: favorite.schema, table: favorite.table, kind: 'table' })
          }
          actions={
            <Tooltip content="Remove from favorites">
              <Button
                variant="ghost"
                size="iconXs"
                aria-label="Remove favorite"
                onClick={(event) => {
                  event.stopPropagation();
                  toggleFavorite(favorite);
                }}
              >
                <X />
              </Button>
            </Tooltip>
          }
        />
      ))}
    </TreeSection>
  );
}
