import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import type { AccessStatus, AccessType } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Spinner } from '@/components/ui/spinner';


import { createAccessPoller } from './pollers';

const unavailableCopy = 'This server was not found or is no longer available to you.';

export const AccessSection = ({ serverId, accessType }: { serverId: string; accessType: AccessType }): React.JSX.Element | null => {
  const queryClient = useQueryClient();
  const { panel, client, state } = usePanelSession();
  const authenticated = state.kind === 'authenticated' && panel !== null && client !== null;
  const profile = state.kind === 'authenticated' ? state.profile : null;
  const isAdmin = profile?.role === 'ADMIN';
  const poller = useRef(createAccessPoller()).current;
  const shouldReadOwnRequest = authenticated && !isAdmin && accessType === 'REQUEST';

  const ownRequestQuery = useQuery({
    queryKey: panel && profile ? panelKeys.myAccess(panel, profile.id, serverId) : ['my-access-disabled'],
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No panel client is available.');
      return client.getMyAccessRequest(serverId, signal);
    },
    enabled: shouldReadOwnRequest,
    staleTime: 0,
    refetchInterval: (query) => poller.nextInterval((query.state.data as { status?: AccessStatus } | null | undefined)?.status),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    gcTime: 300_000,
  });
  const adminRequestsQuery = useQuery({
    queryKey: panel && profile ? panelKeys.accessRequests(panel, profile.id, serverId) : ['access-requests-disabled'],
    queryFn: ({ signal }) => {
      if (!client) throw new Error('No panel client is available.');
      return client.listAccessRequests(serverId, signal);
    },
    enabled: authenticated && isAdmin,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
    gcTime: 300_000,
  });

  const refreshOwnAccess = async (): Promise<void> => {
    if (!panel || !profile) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: panelKeys.myAccess(panel, profile.id, serverId) }),
      queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id) }),
    ]);
  };

  const requestMutation = useMutation({
    mutationFn: async () => {
      if (!client) throw new Error('No panel client is available.');
      return client.requestAccess(serverId);
    },
    onSuccess: async (request) => {
      if (panel && profile) queryClient.setQueryData(panelKeys.myAccess(panel, profile.id, serverId), request);
      await refreshOwnAccess();
    },
  });

  const adminMutation = useMutation({
    mutationFn: async ({ userId, action }: { userId: string; action: 'approve' | 'revoke' }) => {
      if (!client) throw new Error('No panel client is available.');
      if (action === 'approve') return client.approveAccess(serverId, userId);
      await client.revokeAccess(serverId, userId);
      return null;
    },
    onSuccess: async () => {
      if (!panel || !profile) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: panelKeys.accessRequests(panel, profile.id, serverId) }),
        queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, profile.id) }),
      ]);
      await adminRequestsQuery.refetch();
    },
  });

  const [rejectTarget, setRejectTarget] = useState<{ userId: string; username: string } | null>(null);

  if (!authenticated || !profile) return null;

  if (isAdmin) {
    const pending = adminRequestsQuery.data?.filter((request) => request.status === 'PENDING') ?? [];
    return (
      <section className="panel-surface p-5" aria-labelledby="access-requests-heading">
        <h2 className="text-xl font-bold text-ink" id="access-requests-heading">Access requests</h2>
        <p className="mt-2 text-sm text-ink-muted">Approve a request to grant access. Rejecting removes the request; it does not create a denied state.</p>
        {adminRequestsQuery.isLoading ? <div className="mt-4 flex items-center gap-3 text-ink-muted"><Spinner /> Loading requests…</div> : null}
        {adminRequestsQuery.isError ? <Alert kind="error" title="Requests unavailable">{adminRequestsQuery.error instanceof BackendApiError && adminRequestsQuery.error.status === 404 ? unavailableCopy : getApiErrorMessage(adminRequestsQuery.error)}</Alert> : null}
        {pending.length === 0 && !adminRequestsQuery.isLoading ? <p className="mt-4 text-sm text-ink-muted">No pending access requests.</p> : null}
        {pending.length > 0 ? <ul className="mt-4 grid gap-3" aria-label="Pending access requests">{pending.map((request) => <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3" key={request.userId}><div className="min-w-0"><p className="break-words font-bold text-ink">{request.username}</p><p className="break-all text-sm text-ink-muted">{request.email}</p></div><div className="flex flex-wrap gap-2"><Button loading={adminMutation.isPending && adminMutation.variables?.userId === request.userId && adminMutation.variables.action === 'approve'} onClick={() => adminMutation.mutate({ userId: request.userId, action: 'approve' })}>Approve</Button><Button variant="danger" onClick={() => setRejectTarget({ userId: request.userId, username: request.username })}>Reject request</Button></div></li>)}</ul> : null}
        {adminMutation.isError ? <Alert kind="error" title="Request not updated">{adminMutation.error instanceof BackendApiError && adminMutation.error.status === 404 ? unavailableCopy : getApiErrorMessage(adminMutation.error)}</Alert> : null}
        {rejectTarget ? (
          <ConfirmDialog
            open
            title="Reject access request"
            danger
            confirmLabel="Reject request"
            busy={adminMutation.isPending}
            onCancel={() => setRejectTarget(null)}
            onConfirm={() => {
              adminMutation.mutate({ userId: rejectTarget.userId, action: 'revoke' });
              setRejectTarget(null);
            }}
          >
            Remove {rejectTarget.username}&rsquo;s pending access request for this server. A rejected request is deleted and cannot be approved later.
          </ConfirmDialog>
        ) : null}
      </section>
    );
  }

  if (accessType === 'OPEN' || accessType === 'PRIVATE') return null;
  if (ownRequestQuery.isLoading) return <section className="panel-surface p-5"><div className="flex items-center gap-3 text-ink-muted"><Spinner /> Checking access request…</div></section>;
  if (ownRequestQuery.isError) return <section className="panel-surface p-5"><Alert kind="error">{ownRequestQuery.error instanceof BackendApiError && ownRequestQuery.error.status === 404 ? unavailableCopy : getApiErrorMessage(ownRequestQuery.error)}</Alert></section>;
  if (ownRequestQuery.data?.status === 'PENDING') return <section className="panel-surface p-5" aria-labelledby="access-heading"><h2 className="text-xl font-bold text-ink" id="access-heading">Access</h2><p className="mt-2 text-ink-muted" role="status">Request pending</p>{poller.exhausted() ? <p className="mt-2 text-sm text-warning">Request status was not confirmed. Refresh this page to check again.</p> : null}</section>;
  if (ownRequestQuery.data?.status === 'APPROVED') return <section className="panel-surface p-5" aria-labelledby="access-heading"><h2 className="text-xl font-bold text-ink" id="access-heading">Access</h2><p className="mt-2 text-ink-muted" role="status">Your access request has been approved.</p></section>;

  return <section className="panel-surface p-5" aria-labelledby="access-heading"><h2 className="text-xl font-bold text-ink" id="access-heading">Access</h2><p className="mt-2 text-sm text-ink-muted">This server requires administrator approval before you can join.</p><Button className="mt-4" loading={requestMutation.isPending} onClick={() => requestMutation.mutate()}>Request access</Button>{requestMutation.isError ? <div className="mt-4"><Alert kind="error">{requestMutation.error instanceof BackendApiError && requestMutation.error.status === 404 ? unavailableCopy : getApiErrorMessage(requestMutation.error)}</Alert></div> : null}</section>;
};
