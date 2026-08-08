import { Database, Keyboard, Plug, Plus, Search, Terminal } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Kbd, Spinner, StatusDot } from '@/components/ui/misc';
import { useConnectionStore } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { formatRelativeTime } from '@/utils/format';
import { notify } from '@/utils/notify';

export function WelcomePage() {
  const list = useConnectionStore((state) => state.list);
  const statuses = useConnectionStore((state) => state.statuses);
  const connect = useConnectionStore((state) => state.connect);
  const editConnection = useDialogStore((state) => state.editConnection);
  const show = useDialogStore((state) => state.show);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const [busy, setBusy] = useState<string | null>(null);

  if (list.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-8">
        <div className="w-full max-w-[430px] text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-gradient-to-b from-accent to-[#3d80d4] text-[#08172b] shadow-[0_10px_40px_-12px_rgb(94_168_255/0.6)]">
            <Database className="size-7" />
          </div>
          <h1 className="text-balance text-[20px] font-semibold tracking-[-0.02em] text-ink">
            Create your first PostgreSQL connection
          </h1>
          <p className="mx-auto mt-2 max-w-[340px] text-balance text-[13px] leading-relaxed text-ink-muted">
            Point WishPostgres at a server and you can browse data, edit rows, design tables and run
            SQL straight away.
          </p>
          <Button
            variant="primary"
            size="lg"
            className="mt-6 w-full"
            onClick={() => editConnection(null)}
          >
            <Plug className="size-4" />
            Connect
          </Button>
          <p className="mt-4 text-[11.5px] text-ink-faint">
            Passwords go into your system keyring. Nothing leaves this machine.
          </p>
        </div>
      </div>
    );
  }

  // Favourites first, then the most recently used, so the connection the user
  // wants is at the top without them having to hunt for it.
  const recent = [...list]
    .sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '');
    })
    .slice(0, 6);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-[560px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-b from-accent to-[#3d80d4] text-[#08172b]">
            <Database className="size-5" />
          </div>
          <div>
            <h1 className="text-[17px] font-semibold tracking-[-0.02em]">WishPostgres</h1>
            <p className="text-[12px] text-ink-muted">Pick a connection to get started.</p>
          </div>
        </div>

        <div className="space-y-1">
          {recent.map((connection) => {
            const status = statuses[connection.id] ?? 'offline';
            const connecting = status === 'connecting' || busy === connection.id;
            return (
              <button
                key={connection.id}
                type="button"
                disabled={busy !== null}
                onClick={async () => {
                  setBusy(connection.id);
                  try {
                    await connect(connection.id);
                  } catch (error) {
                    notify.failure(error, `Could not connect to ${connection.name}`);
                  } finally {
                    setBusy(null);
                  }
                }}
                className="flex w-full items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-line-strong hover:bg-elevated disabled:opacity-60"
              >
                {connecting ? (
                  <Spinner className="size-3 text-caution" />
                ) : (
                  <StatusDot
                    tone={status === 'online' ? 'online' : status === 'error' ? 'error' : 'offline'}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">{connection.name}</p>
                  <p className="truncate text-[11.5px] text-ink-faint">
                    {connection.username}@{connection.host}:{connection.port}/{connection.database}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {connecting
                    ? 'Connecting…'
                    : connection.lastUsedAt
                      ? formatRelativeTime(connection.lastUsedAt)
                      : 'never used'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => editConnection(null)}>
            <Plus />
            New connection
            <Kbd className="ml-1">Ctrl N</Kbd>
          </Button>
          <Button variant="ghost" size="sm" onClick={() => addTab()}>
            <Terminal />
            New SQL tab
          </Button>
          <Button variant="ghost" size="sm" onClick={() => show('globalSearch')}>
            <Search />
            Search objects
          </Button>
          <Button variant="ghost" size="sm" onClick={() => show('shortcuts')}>
            <Keyboard />
            Shortcuts
          </Button>
        </div>
      </div>
    </div>
  );
}
