import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { supportsRequestableDiscovery } from '@/api/backend-client';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const PAGE_SIZE = 20;

/**
 * "Discover servers" surface (owner-approved requestable slice): REQUEST
 * servers without approved access, shown ONLY when the backend advertises
 * `capabilities.servers.requestableDiscovery` and the caller is not an ADMIN
 * (admins already see every server in the normal list). PRIVATE is never
 * returned by the backend and never rendered. The discovery summary IS the
 * pre-approval UI — GET /servers/:id is never fetched before approval; once
 * approved, the normal server list becomes authoritative.
 */
export const RequestableServersSection = (): React.JSX.Element | null => {
  const { panel, client, info, state } = usePanelSession();
  const queryClient = useQueryClient();
  const profile = state.kind === 'authenticated' ? state.profile : null;
  const supported =
    state.kind === 'authenticated' &&
    panel !== null &&
    client !== null &&
    info !== null &&
    supportsRequestableDiscovery(info) &&
    profile?.role !== 'ADMIN';
  const [offset, setOffset] = useState(0);
  const page = { limit: PAGE_SIZE, offset };

  const discoverableQuery = useQuery({
    queryKey: panel && profile ? panelKeys.requestableServers(panel, profile.id, page) : ['requestable-disabled'],
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No panel client is available.');
      return client.listRequestableServers(page, signal);
    },
    enabled: supported,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    gcTime: 300_000,
  });

  // Overshoot recovery: if the page the user is on disappears (approval/removal
  // shrinks the collection), jump to the highest still-valid page start instead
  // of leaving a permanently empty unreachable page.
  useEffect(() => {
    const total = discoverableQuery.data?.total;
    if (total === undefined || discoverableQuery.isFetching || discoverableQuery.isLoading) {
      return;
    }
    if (total === 0) {
      if (offset !== 0) {
        setOffset(0);
      }
      return;
    }
    const highestValidOffset = Math.floor((total - 1) / PAGE_SIZE) * PAGE_SIZE;
    if (offset > highestValidOffset) {
      setOffset(highestValidOffset);
    }
  }, [discoverableQuery.data, discoverableQuery.isFetching, discoverableQuery.isLoading, offset]);

  const requestMutation = useMutation({
    mutationFn: async (serverId: string) => {
      if (!client) throw new Error('No panel client is available.');
      return client.requestAccess(serverId);
    },
    onSuccess: async () => {
      if (!panel || !profile) return;
      // Broad invalidation of THIS panel's requestable collection across pages
      // (the current page refetches; Panel B is never touched) plus the normal
      // list, so approval moves the server there.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id).concat(['servers', 'requestable']) }),
        queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id).concat(['servers', 'list']) }),
      ]);
    },
  });

  if (!supported) {
    return null;
  }

  return (
    <section className="panel-surface grid gap-4 p-5" aria-labelledby="discover-heading">
      <div>
        <p className="pixel-title text-xs text-accent">[ Discover servers ]</p>
        <h2 className="mt-2 text-xl font-bold text-ink" id="discover-heading">Requestable servers</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Servers that require administrator approval before you can use them.
        </p>
      </div>
      {discoverableQuery.isLoading ? <div className="flex items-center gap-3 text-ink-muted"><Spinner /> Checking for requestable servers…</div> : null}
      {discoverableQuery.isError ? <Alert kind="error" title="Discovery unavailable">{getApiErrorMessage(discoverableQuery.error)}</Alert> : null}
      {discoverableQuery.data && discoverableQuery.data.data.length === 0 && !discoverableQuery.isLoading ? (
        <p className="text-sm text-ink-muted">No requestable servers found.</p>
      ) : null}
      {discoverableQuery.data && discoverableQuery.data.data.length > 0 ? (
        <ul className="grid gap-3" aria-label="Requestable servers">
          {discoverableQuery.data.data.map((server) => (
            <li className="flex flex-wrap items-center justify-between gap-3 border border-line p-3" key={server.id}>
              <div className="min-w-0">
                <p className="break-words font-bold text-ink">{server.name}</p>
                <p className="mt-1 text-sm text-ink-muted">Access required</p>
              </div>
              {server.requestStatus === 'PENDING' ? (
                <span className="border border-warning bg-warning-dim px-3 py-2 text-sm font-bold text-ink" role="status">
                  Pending approval
                </span>
              ) : (
                <Button
                  loading={requestMutation.isPending && requestMutation.variables === server.id}
                  disabled={requestMutation.isPending}
                  onClick={() => requestMutation.mutate(server.id)}
                >
                  Request access
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {discoverableQuery.data && discoverableQuery.data.total > PAGE_SIZE ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={offset === 0 || discoverableQuery.isFetching} onClick={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}>
            Previous page
          </Button>
          <span className="text-sm text-ink-muted" aria-live="polite">
            Showing {offset + 1}–{Math.min(offset + discoverableQuery.data.data.length, discoverableQuery.data.total)} of {discoverableQuery.data.total}
          </span>
          <Button
            variant="secondary"
            disabled={offset + PAGE_SIZE >= discoverableQuery.data.total || discoverableQuery.isFetching}
            onClick={() => setOffset((current) => current + PAGE_SIZE)}
          >
            Next page
          </Button>
        </div>
      ) : null}
      {requestMutation.isError ? <Alert kind="error" role="alert">{getApiErrorMessage(requestMutation.error)}</Alert> : null}
    </section>
  );
};