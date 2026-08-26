import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import type { Server } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { AccessSection } from './access-section';
import { createServerPoller } from './pollers';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';
import { ServerStatusChip } from './server-list-page';

type LifecycleAction = 'start' | 'stop' | 'restart';

const unavailableCopy = 'This server was not found or is no longer available to you.';

const lifecycleErrorMessage = (error: unknown): string => {
  if (!(error instanceof BackendApiError)) return getApiErrorMessage(error);
  if (error.status === 403) return 'You do not have lifecycle permission for this server.';
  if (error.status === 404) return unavailableCopy;
  if (error.status === 409) return 'Server state changed. Status has been refreshed.';
  if (error.status === 503) return 'The host or server daemon is unavailable. Try again later.';
  if (error.status === 422 && error.code === 'InsufficientResources') {
    const details = error.details;
    if (details !== null && typeof details === 'object') {
      const values = details as { available?: unknown; required?: unknown; resource?: unknown };
      const available = typeof values.available === 'number' && Number.isFinite(values.available) ? values.available : null;
      const required = typeof values.required === 'number' && Number.isFinite(values.required) ? values.required : null;
      const resource = typeof values.resource === 'string' && /^[A-Za-z ]{1,32}$/.test(values.resource) ? values.resource : 'capacity';
      if (available !== null && required !== null) return `Insufficient ${resource}: ${available} available, ${required} required.`;
    }
    return 'Insufficient server resources are available for this action.';
  }
  if (error.status === 400) return 'No changes were needed.';
  return getApiErrorMessage(error);
};

const FieldValue = ({ label, value }: { label: string; value: string | number | boolean | null }): React.JSX.Element => (
  <div className="min-w-0 border-t border-line pt-3">
    <dt className="text-sm text-ink-faint">{label}</dt>
    <dd className="mt-1 break-words font-mono text-sm font-bold text-ink">{value === null ? 'Not set' : String(value)}</dd>
  </div>
);

export const ServerDetailPage = (): React.JSX.Element => {
  const { instanceId, serverId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { panel, client, state } = usePanelSession();
  const authenticated = state.kind === 'authenticated' && panel !== null && client !== null && Boolean(serverId);
  const profile = state.kind === 'authenticated' ? state.profile : null;
  const poller = useRef(createServerPoller()).current;
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Identity-generation guard: a mutation that settles after the session
  // boundary (logout/panel switch) must not re-create the removed query scope.
  const authenticatedRef = useRef(state.kind);
  authenticatedRef.current = state.kind;
  const [feedback, setFeedback] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: authenticated && profile && serverId ? panelKeys.server(panel, profile.id, serverId) : ['server-detail-disabled'],
    queryFn: ({ signal }) => {
      if (!client || !serverId) throw new Error('No server is selected.');
      return client.getServer(serverId, signal);
    },
    enabled: authenticated,
    refetchInterval: (query) => poller.nextInterval((query.state.data as Server | undefined)?.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    gcTime: 300_000,
  });

  const invalidateServerViews = async (): Promise<void> => {
    if (!panel || !profile) return;
    await queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id) });
  };

  const lifecycleMutation = useMutation({
    mutationFn: async (action: LifecycleAction) => {
      if (!client || !serverId) throw new Error('No server is selected.');
      if (action === 'start') return client.startServer(serverId);
      if (action === 'stop') return client.stopServer(serverId);
      return client.restartServer(serverId);
    },
    onSuccess: async (server) => {
      if (!panel || !profile || !serverId || authenticatedRef.current !== 'authenticated') return;
      queryClient.setQueryData(panelKeys.server(panel, profile.id, serverId), server);
      setFeedback(`Server ${server.status}.`);
      await Promise.all([
        invalidateServerViews(),
        queryClient.invalidateQueries({ queryKey: panelKeys.systemStats(panel, profile.id) }),
      ]);
    },
    onError: async (error) => {
      setFeedback(lifecycleErrorMessage(error));
      if (error instanceof BackendApiError && error.status === 409) await invalidateServerViews();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!client || !serverId) throw new Error('No server is selected.');
      await client.deleteServer(serverId);
    },
    onSuccess: async () => {
      if (!panel || !profile || !serverId) return;
      queryClient.removeQueries({ queryKey: panelKeys.server(panel, profile.id, serverId) });
      await invalidateServerViews();
      setDeleteOpen(false);
      navigate(`/panel/${instanceId ?? panel.id}/servers`);
    },
    onError: (error) => setFeedback(error instanceof BackendApiError && error.status === 404 ? unavailableCopy : getApiErrorMessage(error)),
  });

  if (!authenticated || !profile || !panel) return <Alert kind="info">Sign in to view this server.</Alert>;
  if (detailQuery.isLoading) return <div className="flex items-center gap-3 text-ink-muted"><Spinner /> Loading server…</div>;
  if (detailQuery.isError) return <Alert kind="error" title="Server unavailable">{detailQuery.error instanceof BackendApiError && detailQuery.error.status === 404 ? unavailableCopy : getApiErrorMessage(detailQuery.error)}</Alert>;
  if (!detailQuery.data) return <Alert kind="error">{unavailableCopy}</Alert>;

  const server = detailQuery.data;
  const isAdmin = profile.role === 'ADMIN';
  const canAttemptLifecycle = isAdmin || profile.role === 'MOD';
  const lifecyclePending = lifecycleMutation.isPending;
  const startDisabled = lifecyclePending || server.status !== 'STOPPED';
  const runningDisabled = lifecyclePending || server.status !== 'RUNNING';

  return (
    <section aria-labelledby="server-heading" className="grid gap-6">
      <Link className="text-sm font-bold text-accent" to={`/panel/${instanceId ?? panel.id}/servers`}>← All servers</Link>
      <div className="panel-surface p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><p className="pixel-title text-xs text-accent">[ Server ]</p><h1 className="mt-3 break-words text-3xl font-bold text-ink" id="server-heading">{server.name}</h1></div>
          <ServerStatusChip status={server.status} />
        </div>
        <dl className="mt-7 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          <FieldValue label="Provider" value={server.provider} /><FieldValue label="Version" value={server.version} /><FieldValue label="Port" value={server.port} />
          <FieldValue label="Memory limit" value={`${server.memoryLimitMb} MB`} /><FieldValue label="Maximum players" value={server.maxPlayers} /><FieldValue label="Difficulty" value={server.difficulty} />
          <FieldValue label="Game mode" value={server.gamemode} /><FieldValue label="PVP" value={server.pvp} /><FieldValue label="Online mode" value={server.onlineMode} />
          <FieldValue label="View distance" value={server.viewDistance} /><FieldValue label="Allow flight" value={server.allowFlight} /><FieldValue label="Access type" value={server.accessType} />
          <FieldValue label="MOTD" value={server.motd} /><FieldValue label="Level seed" value={server.levelSeed} /><FieldValue label="Owner ID" value={server.ownerId} />
          <FieldValue label="Created" value={server.createdAt} /><FieldValue label="Last updated" value={server.updatedAt} />
        </dl>
      </div>

      {canAttemptLifecycle ? <div className="panel-surface p-5"><h2 className="text-xl font-bold text-ink">Lifecycle</h2>{profile.role === 'MOD' ? <p className="mt-2 text-sm text-ink-muted">Your granted permissions determine whether a lifecycle action is accepted.</p> : null}<div className="mt-5 flex flex-wrap gap-3"><Button disabled={startDisabled} loading={lifecyclePending && lifecycleMutation.variables === 'start'} onClick={() => lifecycleMutation.mutate('start')}>Start</Button><Button variant="secondary" disabled={runningDisabled} loading={lifecyclePending && lifecycleMutation.variables === 'stop'} onClick={() => lifecycleMutation.mutate('stop')}>Stop</Button><Button variant="secondary" disabled={runningDisabled} loading={lifecyclePending && lifecycleMutation.variables === 'restart'} onClick={() => lifecycleMutation.mutate('restart')}>Restart</Button><Button variant="ghost" onClick={() => void detailQuery.refetch()} disabled={detailQuery.isFetching}>Refresh status</Button></div>{poller.exhausted() ? <p className="mt-4 text-sm text-warning" role="status">State not confirmed. Refresh status.</p> : null}</div> : null}

      {isAdmin ? <div className="panel-surface p-5"><h2 className="text-xl font-bold text-ink">Danger zone</h2><p className="mt-2 text-sm text-ink-muted">Delete this server only when it is no longer needed.</p><Button className="mt-4" variant="danger" onClick={() => setDeleteOpen(true)}>Delete server</Button></div> : null}
      <AccessSection serverId={server.id} accessType={server.accessType} />
      {feedback ? <Alert kind="info" role="status" title="Server update">{feedback}</Alert> : null}
      <ConfirmDialog open={deleteOpen} title="Delete this server?" confirmLabel="Delete server" danger busy={deleteMutation.isPending} onConfirm={() => deleteMutation.mutate()} onCancel={() => setDeleteOpen(false)}>
        <p><strong>{server.name}</strong> will be deleted. Deletion is synchronous despite the 202 response: the panel has completed container and database deletion before responding.</p>
        <p className="mt-3">The world data directory is retained on the host.</p>
      </ConfirmDialog>
    </section>
  );
};
