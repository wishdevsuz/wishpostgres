import {
  ChevronDown,
  Database,
  DownloadCloud,
  Keyboard,
  PlugZap,
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
import { Badge, Separator, StatusDot, Tooltip } from '@/components/ui/misc';
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
  const disconnect = useConnectionStore((state) => state.disconnect);

  const show = useDialogStore((state) => state.show);
  const addTab = useWorkspaceStore((state) => state.addTab);

  const connection = list.find((entry) => entry.id === activeId) ?? null;
  const server = activeId ? servers[activeId] : undefined;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries();
      notify.success('Refreshed');
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  return (
    <header className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-surface px-2.5">
      <div className="flex items-center gap-2 pr-1">
        <div className="flex size-6 items-center justify-center rounded-md bg-gradient-to-b from-accent to-[#3d80d4] text-[#08172b]">
          <Database className="size-3.5" />
        </div>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Postgres Lite</span>
      </div>

      <Separator orientation="vertical" className="h-5" />

      {connection ? (
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 rounded-md bg-[#ffffff08] px-2 py-1">
            <StatusDot tone="online" />
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

      <div className="flex-1" />

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

      <Tooltip content="New SQL tab">
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
        <DropdownMenuContent align="end" className="min-w-[220px]">
          <DropdownMenuLabel>Database</DropdownMenuLabel>
          <DropdownMenuItem disabled={!activeId} onSelect={() => show('backup')}>
            <DownloadCloud /> Backup database…
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!activeId} onSelect={() => show('restore')}>
            <UploadCloud /> Restore from dump…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Application</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => show('settings')}>
            <Settings /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => show('shortcuts')}>
            <Keyboard /> Keyboard shortcuts
            <MenuShortcut>?</MenuShortcut>
          </DropdownMenuItem>
          {activeId && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                danger
                onSelect={() => {
                  void disconnect(activeId);
                  notify.info('Disconnected');
                }}
              >
                <PlugZap /> Disconnect
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}

function majorVersion(versionNumber: number): string {
  return String(Math.floor(versionNumber / 10_000));
}
