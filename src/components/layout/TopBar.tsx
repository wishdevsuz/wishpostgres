import {
  ChevronDown,
  Database,
  DownloadCloud,
  Keyboard,
  PanelLeft,
  PanelLeftClose,
  PlugZap,
  Power,
  RefreshCw,
  Search,
  Settings,
  Terminal,
  UploadCloud,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MenuShortcut,
} from '@/components/ui/menu';
import { WindowControls } from '@/components/layout/WindowChrome';
import { Badge, Separator, StatusDot, Tooltip } from '@/components/ui/misc';
import { connections as api } from '@/services/api';
import { useConnectionStore } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';

export function TopBar() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const activeId = useConnectionStore((state) => state.activeId);
  const activeDatabase = useConnectionStore((state) => state.activeDatabase);
  const list = useConnectionStore((state) => state.list);
  const servers = useConnectionStore((state) => state.servers);
  const statuses = useConnectionStore((state) => state.statuses);
  const disconnect = useConnectionStore((state) => state.disconnect);
  const refreshConnections = useConnectionStore((state) => state.refresh);

  const show = useDialogStore((state) => state.show);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const collapsed = useWorkspaceStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useWorkspaceStore((state) => state.toggleSidebar);

  const connection = list.find((entry) => entry.id === activeId) ?? null;
  const server = activeId ? servers[activeId] : undefined;
  const online = activeId ? statuses[activeId] === 'online' : false;
  const openCount = Object.values(statuses).filter((status) => status === 'online').length;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      notify.success('Refreshed');
    } catch (error) {
      notify.failure(error, 'Could not refresh');
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const handleDisconnect = useCallback(async () => {
    if (!activeId) return;
    try {
      await disconnect(activeId);
      queryClient.removeQueries();
      notify.info('Disconnected');
    } catch (error) {
      notify.failure(error, 'Could not disconnect');
    }
  }, [activeId, disconnect, queryClient]);

  const handleDisconnectAll = useCallback(async () => {
    try {
      await api.disconnectAll();
      await refreshConnections();
      useConnectionStore.getState().setActive(null, null);
      queryClient.removeQueries();
      notify.info('All sessions closed');
    } catch (error) {
      notify.failure(error, 'Could not close the sessions');
    }
  }, [queryClient, refreshConnections]);

  return (
    // The window is undecorated, so this strip is the title bar: dragging it
    // moves the window and a double click maximises it. Only the bare
    // background carries `data-tauri-drag-region`, so every control on it stays
    // clickable.
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5"
    >
      <Tooltip content={collapsed ? 'Show sidebar' : 'Hide sidebar'} shortcut="Ctrl B">
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={toggleSidebar}
        >
          {collapsed ? <PanelLeft /> : <PanelLeftClose />}
        </Button>
      </Tooltip>

      <div className="flex items-center gap-2 pr-1" data-tauri-drag-region>
        <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-b from-accent to-[#3d80d4] text-[#08172b]">
          <Database className="size-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">WishPostgres</span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      {connection ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-[#ffffff08] px-2 py-1">
            <StatusDot tone={online ? 'online' : 'offline'} />
            <span className="truncate text-[12.5px] font-medium">{connection.name}</span>
            <span className="text-ink-faint">/</span>
            <span className="truncate text-[12.5px] text-ink-soft">{activeDatabase}</span>
          </div>
          {server && (
            <Tooltip content={server.version}>
              <Badge variant="outline">PG {majorVersion(server.versionNumber)}</Badge>
            </Tooltip>
          )}
          {server?.isSuperuser && <Badge variant="violet">superuser</Badge>}
        </div>
      ) : (
        <span className="text-[12.5px] text-ink-muted">No connection</span>
      )}

      <div className="h-full flex-1" data-tauri-drag-region />

      <Tooltip content="Global search" shortcut="Ctrl ⇧ F">
        <Button
          variant="subtle"
          size="sm"
          className="gap-2 pl-2 pr-1.5 text-ink-muted"
          onClick={() => show('globalSearch')}
          disabled={!activeId}
        >
          <Search />
          <span className="hidden pr-6 sm:inline">Search objects…</span>
        </Button>
      </Tooltip>

      <Tooltip content="New SQL tab" shortcut="Ctrl T">
        <Button variant="ghost" size="icon" aria-label="New SQL tab" onClick={() => addTab()}>
          <Terminal />
        </Button>
      </Tooltip>

      <Tooltip content="Refresh" shortcut="Ctrl R">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh"
          disabled={!activeId || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw className={refreshing ? 'animate-spin' : undefined} />
        </Button>
      </Tooltip>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1 px-1.5" aria-label="More actions">
            <Settings />
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[230px]">
          <DropdownMenuLabel>Database</DropdownMenuLabel>
          <DropdownMenuItem disabled={!activeId} onSelect={() => show('backup')}>
            <DownloadCloud /> Backup database…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!activeId} onSelect={() => show('restore')}>
            <UploadCloud /> Restore from dump…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Application</DropdownMenuLabel>
          <DropdownMenuItem onSelect={toggleSidebar}>
            {collapsed ? <PanelLeft /> : <PanelLeftClose />}
            {collapsed ? 'Show sidebar' : 'Hide sidebar'}
            <MenuShortcut>Ctrl B</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show('settings')}>
            <Settings /> Settings
            <MenuShortcut>Ctrl ,</MenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show('shortcuts')}>
            <Keyboard /> Keyboard shortcuts
            <MenuShortcut>?</MenuShortcut>
          </DropdownMenuItem>
          {openCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                disabled={!activeId}
                onSelect={() => void handleDisconnect()}
              >
                <PlugZap /> Disconnect
              </DropdownMenuItem>
              {openCount > 1 && (
                <DropdownMenuItem danger onSelect={() => void handleDisconnectAll()}>
                  <Power /> Disconnect all ({openCount})
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Separator orientation="vertical" className="ml-1 h-5" />
      <WindowControls />
    </header>
  );
}

function majorVersion(versionNumber: number): string {
  return String(Math.floor(versionNumber / 10_000));
}
