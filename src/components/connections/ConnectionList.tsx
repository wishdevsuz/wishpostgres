import { Copy, Database, Pencil, Plug, PlugZap, Plus, Star, Trash2, Zap } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/menu';
import { Spinner, StatusDot, Tooltip } from '@/components/ui/misc';
import { TreeItem, TreeMessage, TreeSection } from '@/components/layout/tree';
import { connections as api } from '@/services/api';
import { useConnectionStore, type ConnectionStatus } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { notify } from '@/utils/notify';
import type { SavedConnection } from '@/types';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  online: 'Connected',
  offline: 'Offline',
  connecting: 'Connecting…',
  error: 'Failed',
};

export function ConnectionList({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const list = useConnectionStore((state) => state.list);
  const statuses = useConnectionStore((state) => state.statuses);
  const activeId = useConnectionStore((state) => state.activeId);
  const connect = useConnectionStore((state) => state.connect);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const refresh = useConnectionStore((state) => state.refresh);
  const remove = useConnectionStore((state) => state.remove);
  const setActive = useConnectionStore((state) => state.setActive);
  const editConnection = useDialogStore((state) => state.editConnection);
  const queryClient = useQueryClient();

  const [deleting, setDeleting] = useState<SavedConnection | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  const handleConnect = useCallback(
    async (connection: SavedConnection) => {
      const status = useConnectionStore.getState().statusOf(connection.id);
      if (status === 'online') {
        setActive(
          connection.id,
          useConnectionStore.getState().servers[connection.id]?.currentDatabase ?? null,
        );
        return;
      }
      try {
        const server = await connect(connection.id);
        notify.success(
          `Connected to ${connection.name}`,
          `${server.currentUser} · ${server.currentDatabase}`,
        );
      } catch (error) {
        notify.failure(error, `Could not connect to ${connection.name}`);
      }
    },
    [connect, setActive],
  );

  const handleDuplicate = useCallback(
    async (connection: SavedConnection) => {
      const copy: SavedConnection = {
        ...connection,
        id: crypto.randomUUID(),
        name: `${connection.name} copy`,
        createdAt: '',
        lastUsedAt: null,
        hasPassword: false,
      };
      try {
        await api.save(copy);
        await refresh();
        notify.success('Connection duplicated', 'Re-enter the password before connecting.');
      } catch (error) {
        notify.failure(error, 'Could not duplicate the connection');
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (connection: SavedConnection) => {
      await remove(connection.id);
      queryClient.removeQueries();
      notify.success(`Deleted ${connection.name}`);
    },
    [queryClient, remove],
  );

  const handleTest = useCallback(async (connection: SavedConnection) => {
    setTesting(connection.id);
    try {
      const server = await api.test(connection);
      notify.success(
        'Connection works',
        `PostgreSQL ${server.version.split(' ')[1] ?? ''} · ${server.currentUser}`,
      );
    } catch (error) {
      notify.failure(error, 'Test failed');
    } finally {
      setTesting(null);
    }
  }, []);

  const handleFavorite = useCallback(
    async (connection: SavedConnection) => {
      try {
        await api.save({ ...connection, favorite: !connection.favorite });
        await refresh();
      } catch (error) {
        notify.failure(error, 'Could not update the connection');
      }
    },
    [refresh],
  );

  const ordered = [...list].sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <TreeSection
      label="Connections"
      open={open}
      onToggle={onToggle}
      count={list.length}
      actions={
        <Tooltip content="New connection" shortcut="Ctrl N">
          <Button
            variant="ghost"
            size="iconXs"
            onClick={() => editConnection(null)}
            aria-label="New connection"
          >
            <Plus />
          </Button>
        </Tooltip>
      }
    >
      {ordered.length === 0 ? (
        <TreeMessage>No connections yet.</TreeMessage>
      ) : (
        ordered.map((connection) => {
          const status = statuses[connection.id] ?? 'offline';
          return (
            <ContextMenu key={connection.id}>
              <ContextMenuTrigger asChild>
                <div>
                  <TreeItem
                    depth={1}
                    active={activeId === connection.id}
                    onClick={() => void handleConnect(connection)}
                    title={`${connection.username}@${connection.host}:${connection.port}/${connection.database}`}
                    icon={
                      status === 'connecting' || testing === connection.id ? (
                        <Spinner className="size-3 text-caution" />
                      ) : (
                        <StatusDot tone={statusTone(status)} className="ml-[5px] mr-[5px]" />
                      )
                    }
                    label={
                      <span className="flex items-center gap-1.5">
                        {connection.name}
                        {connection.favorite && (
                          <Star className="size-3 fill-caution text-caution" />
                        )}
                      </span>
                    }
                    meta={status === 'online' ? undefined : STATUS_LABEL[status]}
                  />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onSelect={() => void handleConnect(connection)}>
                  <Plug /> Connect
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={status !== 'online'}
                  onSelect={() => void disconnect(connection.id)}
                >
                  <PlugZap /> Disconnect
                </ContextMenuItem>
                <ContextMenuItem
                  disabled={testing !== null}
                  onSelect={() => void handleTest(connection)}
                >
                  <Zap /> Test connection
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onSelect={() => editConnection(connection)}>
                  <Pencil /> Rename or edit
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleDuplicate(connection)}>
                  <Copy /> Duplicate
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => void handleFavorite(connection)}>
                  <Star /> {connection.favorite ? 'Remove from favorites' : 'Add to favorites'}
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem danger onSelect={() => setDeleting(connection)}>
                  <Trash2 /> Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })
      )}

      {ordered.length === 0 && (
        <div className="px-1 pb-1 pt-1">
          <Button
            variant="subtle"
            size="sm"
            className="w-full"
            onClick={() => editConnection(null)}
          >
            <Database /> Add a connection
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={deleting ? `Delete ${deleting.name}?` : 'Delete this connection?'}
        description="The saved connection and its stored password are removed. The database itself is untouched."
        confirmLabel="Delete connection"
        destructive
        onConfirm={async () => {
          if (deleting) await handleDelete(deleting);
        }}
      />
    </TreeSection>
  );
}

function statusTone(status: ConnectionStatus) {
  if (status === 'online') return 'online' as const;
  if (status === 'error') return 'error' as const;
  if (status === 'connecting') return 'busy' as const;
  return 'offline' as const;
}
