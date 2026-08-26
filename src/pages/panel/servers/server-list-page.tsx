import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import type { Server, ServerStatus } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { RequestableServersSection } from './requestable-servers-section';

const PAGE_SIZE = 20;

const statusDotClass: Record<ServerStatus, string> = {
  STOPPED: 'status-dot--neutral',
  CREATING: 'status-dot--warning',
  STARTING: 'status-dot--warning',
  RUNNING: '',
  STOPPING: 'status-dot--warning',
  ERROR: 'status-dot--danger',
};

export const ServerStatusChip = ({ status }: { status: ServerStatus }): React.JSX.Element => (
  <span className="inline-flex items-center gap-2 border border-line-strong bg-surface-raised px-2 py-1 font-mono text-xs font-bold text-ink">
    <span className={`status-dot ${statusDotClass[status]}`} aria-hidden="true" />
    {status}
  </span>
);

const ServerCard = ({ server, detailPath }: { server: Server; detailPath: string }): React.JSX.Element => (
  <li className="panel-surface flex min-w-0 flex-col gap-5 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="break-words text-xl font-bold text-ink">{server.name}</h2>
        <p className="mt-1 font-mono text-sm text-ink-muted">{server.provider} {server.version}</p>
      </div>
      <ServerStatusChip status={server.status} />
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
      <div><dt className="text-ink-faint">Port</dt><dd className="mt-1 font-bold text-ink">{server.port}</dd></div>
      <div><dt className="text-ink-faint">Memory</dt><dd className="mt-1 font-bold text-ink">{server.memoryLimitMb} MB</dd></div>
      <div><dt className="text-ink-faint">Access</dt><dd className="mt-1 font-bold text-ink">{server.accessType}</dd></div>
      <div><dt className="text-ink-faint">Players</dt><dd className="mt-1 font-bold text-ink">{server.maxPlayers}</dd></div>
    </dl>
    <Link className="inline-flex min-h-11 items-center justify-center border-2 border-accent bg-accent-strong px-4 py-2 text-sm font-bold text-accent-ink" to={detailPath}>
      View server
    </Link>
  </li>
);

export const ServerListPage = (): React.JSX.Element => {
  const { instanceId } = useParams();
  const { panel, client, state } = usePanelSession();
  const authenticated = state.kind === 'authenticated' && panel !== null && client !== null;
  const profile = state.kind === 'authenticated' ? state.profile : null;
  const [offset, setOffset] = useState(0);
  const page = { limit: PAGE_SIZE, offset };
  const query = useQuery({
    queryKey: panel && profile ? panelKeys.servers(panel, profile.id, page) : ['server-list-disabled'],
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No panel client is available.');
      return client.listServers(page, signal);
    },
    enabled: authenticated,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    gcTime: 300_000,
  });

  if (!authenticated || !profile || !panel) {
    return <Alert kind="info">Sign in to view servers.</Alert>;
  }

  const basePath = `/panel/${instanceId ?? panel.id}/servers`;
  const canCreate = profile.role === 'ADMIN';

  return (
    <section aria-labelledby="servers-heading" className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="pixel-title text-xs text-accent">[ Server management ]</p>
          <h1 className="mt-3 text-3xl font-bold text-ink" id="servers-heading">Servers</h1>
        </div>
        {canCreate ? <Link className="inline-flex min-h-11 items-center justify-center border-2 border-accent bg-accent-strong px-4 py-2 font-bold text-accent-ink" to={`${basePath}/new`}>Create server</Link> : null}
      </div>

      {query.isLoading ? <div className="flex items-center gap-3 text-ink-muted"><Spinner /> Loading servers…</div> : null}
      {query.isError ? <Alert kind="error" title="Servers unavailable">{getApiErrorMessage(query.error)}</Alert> : null}
      {query.data && query.data.data.length === 0 ? (
        <EmptyState
          title="No servers available"
          description={canCreate ? 'Create the first server for this panel.' : 'You do not currently have access to any servers.'}
          action={canCreate ? <Link className="inline-flex min-h-11 items-center justify-center border-2 border-accent bg-accent-strong px-4 py-2 font-bold text-accent-ink" to={`${basePath}/new`}>Create server</Link> : undefined}
        />
      ) : null}
      {query.data && query.data.data.length > 0 ? (
        <>
          <p className="text-sm text-ink-muted" aria-live="polite">{query.data.total} server{query.data.total === 1 ? '' : 's'} available</p>
          <ul className="grid gap-4 md:grid-cols-2" aria-label="Servers">
            {query.data.data.map((server) => <ServerCard key={server.id} server={server} detailPath={`${basePath}/${server.id}`} />)}
          </ul>
          {query.data.total > PAGE_SIZE ? <div className="flex flex-wrap items-center gap-3"><Button variant="secondary" disabled={offset === 0 || query.isFetching} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>Previous page</Button><span className="text-sm text-ink-muted" aria-live="polite">Showing {offset + 1}–{Math.min(offset + query.data.data.length, query.data.total)} of {query.data.total}</span><Button variant="secondary" disabled={offset + PAGE_SIZE >= query.data.total || query.isFetching} onClick={() => setOffset((current) => current + PAGE_SIZE)}>Next page</Button></div> : null}
        </>
      ) : null}
      <Button variant="secondary" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh servers</Button>

      <RequestableServersSection />
    </section>
  );
};
