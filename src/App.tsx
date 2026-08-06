import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Toaster } from 'sonner';

import { AddColumnDialog } from '@/components/dialogs/AddColumnDialog';
import { BackupDialog, RestoreDialog } from '@/components/dialogs/BackupDialog';
import { ConnectionDialog } from '@/components/dialogs/ConnectionDialog';
import { ErrorDialog } from '@/components/dialogs/ErrorDialog';
import { GlobalSearchDialog } from '@/components/dialogs/GlobalSearchDialog';
import { SettingsDialog } from '@/components/dialogs/SettingsDialog';
import { ShortcutsDialog } from '@/components/dialogs/ShortcutsDialog';
import { Sidebar } from '@/components/layout/Sidebar';
import { SplashScreen, type BootStage } from '@/components/layout/SplashScreen';
import { TopBar } from '@/components/layout/TopBar';
import { TooltipProvider } from '@/components/ui/misc';
import { useScopeReset } from '@/hooks/use-scope-sync';
import { useShortcuts } from '@/hooks/use-shortcuts';
import { CatalogRoutes } from '@/pages/CatalogRoutes';
import { useConnectionStore } from '@/state/connection-store';
import { useDialogStore } from '@/state/dialog-store';
import { useSettingsStore } from '@/state/settings-store';
import { useWorkspaceStore } from '@/state/workspace-store';
import { notify } from '@/utils/notify';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 15_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={350} skipDelayDuration={200}>
        <Shell />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Shell() {
  const boot = useBootstrap();
  useGlobalShortcuts();
  usePersistence();
  useScopeReset();

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      {boot.visible && (
        <SplashScreen stage={boot.stage} detail={boot.detail} leaving={boot.stage === 'ready'} />
      )}
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <CatalogRoutes />
        </main>
      </div>

      <ConnectionDialog />
      <SettingsDialog />
      <ShortcutsDialog />
      <GlobalSearchDialog />
      <BackupDialog />
      <RestoreDialog />
      <ErrorDialog />
      <PendingAddColumn />

      <Toaster
        position="bottom-right"
        theme="dark"
        offset={12}
        gap={8}
        toastOptions={{
          classNames: {
            toast:
              'group border border-line-strong bg-overlay text-ink shadow-[var(--shadow-pop)] rounded-lg text-[12.5px]',
            description: 'text-ink-muted text-[11.5px]',
            actionButton: 'bg-accent text-[#08172b] rounded px-2 h-6 text-[11.5px] font-medium',
            cancelButton: 'bg-[#ffffff14] text-ink-soft rounded px-2 h-6 text-[11.5px]',
            success: '[&_[data-icon]]:text-positive',
            error: '[&_[data-icon]]:text-negative',
            warning: '[&_[data-icon]]:text-caution',
          },
        }}
      />
    </div>
  );
}

/**
 * Load persisted state and, when asked, re-open the last connection, reporting
 * each step so the splash screen can narrate what is happening.
 */
function useBootstrap() {
  const loadSettings = useSettingsStore((state) => state.load);
  const hydrate = useWorkspaceStore((state) => state.hydrate);
  const refresh = useConnectionStore((state) => state.refresh);
  const connect = useConnectionStore((state) => state.connect);

  const [stage, setStage] = useState<BootStage>('settings');
  const [detail, setDetail] = useState<string | undefined>(undefined);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        setStage('settings');
        await loadSettings();
        if (cancelled) return;

        setStage('workspace');
        const workspace = await hydrate();
        if (cancelled) return;

        setStage('connections');
        const list = await refresh();
        if (cancelled) return;

        const settings = useSettingsStore.getState().settings;
        const target = workspace.lastConnectionId
          ? list.find((entry) => entry.id === workspace.lastConnectionId)
          : undefined;

        if (settings.openLastConnection && target) {
          setStage('connecting');
          setDetail(`Connecting to ${target.name}`);
          // Reconnecting can be slow or hang on an unreachable host, so it is
          // never allowed to hold the splash open. The sidebar shows the live
          // status once the window is interactive.
          const attempt = connect(target.id, workspace.lastDatabase ?? undefined).catch((error) =>
            notify.failure(error, `Could not reopen ${target.name}`),
          );
          await Promise.race([attempt, delay(1200)]);
        }
      } finally {
        if (!cancelled) {
          setDetail(undefined);
          setStage('ready');
          // Let the fade finish before the overlay leaves the tree.
          setTimeout(() => setVisible(false), 320);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [connect, hydrate, loadSettings, refresh]);

  return { stage, detail, visible };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Save the workspace whenever anything the user would miss changes. */
function usePersistence() {
  const persist = useWorkspaceStore((state) => state.persist);
  const tabs = useWorkspaceStore((state) => state.sqlTabs);
  const activeTabId = useWorkspaceStore((state) => state.activeTabId);
  const favorites = useWorkspaceStore((state) => state.favorites);
  const schema = useWorkspaceStore((state) => state.schema);
  const sidebarWidth = useWorkspaceStore((state) => state.sidebarWidth);
  const hydrated = useWorkspaceStore((state) => state.hydrated);
  const connectionId = useConnectionStore((state) => state.activeId);
  const database = useConnectionStore((state) => state.activeDatabase);

  useEffect(() => {
    if (!hydrated) return;
    persist(connectionId, database);
  }, [
    persist,
    hydrated,
    tabs,
    activeTabId,
    favorites,
    schema,
    sidebarWidth,
    connectionId,
    database,
  ]);
}

function useGlobalShortcuts() {
  const show = useDialogStore((state) => state.show);
  const editConnection = useDialogStore((state) => state.editConnection);
  const addTab = useWorkspaceStore((state) => state.addTab);
  const queryClient = useQueryClient();

  useShortcuts([
    { key: 'n', ctrl: true, handler: () => editConnection(null) },
    { key: 'f', ctrl: true, shift: true, allowInFields: true, handler: () => show('globalSearch') },
    { key: 'k', ctrl: true, allowInFields: true, handler: () => show('globalSearch') },
    { key: ',', ctrl: true, allowInFields: true, handler: () => show('settings') },
    { key: '?', handler: () => show('shortcuts') },
    { key: 't', ctrl: true, handler: () => addTab() },
    {
      key: 'r',
      ctrl: true,
      allowInFields: true,
      handler: () => {
        void queryClient.invalidateQueries();
        notify.success('Refreshed');
      },
    },
  ]);
}

/** Mounted here so the Structure tab can open it from anywhere. */
function PendingAddColumn() {
  const open = useDialogStore((state) => state.open === 'addColumn');
  const close = useDialogStore((state) => state.close);
  const table = useWorkspaceStore((state) => state.table);

  if (!table) return null;
  return <AddColumnDialog open={open} onOpenChange={(next) => !next && close()} target={table} />;
}
