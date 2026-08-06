import { useScope } from '@/hooks/use-catalog';
import { useWorkspaceStore } from '@/state/workspace-store';

import { ExtensionsPage, FunctionsPage, HistoryPage } from './CatalogPages';
import { DatabaseOverviewPage } from './DatabaseOverviewPage';
import { QueryPage } from './QueryPage';
import { TablePage } from './TablePage';
import { WelcomePage } from './WelcomePage';

/** Single switch over the active view; the app has no URL router by design. */
export function CatalogRoutes() {
  const view = useWorkspaceStore((state) => state.view);
  const table = useWorkspaceStore((state) => state.table);
  const { ready } = useScope();

  if (view === 'table' && table) return <TablePage target={table} />;
  if (view === 'query') return <QueryPage />;
  if (view === 'functions') return <FunctionsPage />;
  if (view === 'extensions') return <ExtensionsPage />;
  if (view === 'history') return <HistoryPage />;

  // With a database open the useful landing page is its contents, not the
  // connection picker the user has already moved past.
  return ready ? <DatabaseOverviewPage /> : <WelcomePage />;
}
