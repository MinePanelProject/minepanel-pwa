import { type SyntheticEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { MOD_PERMISSIONS, ROLES, USER_STATUSES } from '@/api/types';
import type { GrantModPermissionInput, ModPermission, ModPermissionRow, PublicUser, Role, UserStatus } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field } from '@/components/ui/field';

type UserAction =
  | { kind: 'status'; status: UserStatus }
  | { kind: 'role'; role: Role }
  | { kind: 'reset-password' }
  | { kind: 'remove-2fa' };

const emptyPanel = { id: '', origin: '' } as const;

export const AdminUserDetailPage = (): React.JSX.Element => {
  const { userId = '' } = useParams();
  const session = usePanelSession();
  const queryClient = useQueryClient();
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);
  const [permission, setPermission] = useState<ModPermission>(MOD_PERMISSIONS[0]);
  const [serverId, setServerId] = useState('');
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);
  const [revokePermission, setRevokePermission] = useState<ModPermissionRow | null>(null);
  const [pendingGrant, setPendingGrant] = useState<GrantModPermissionInput | null>(null);

  const profile = session.state.kind === 'authenticated' ? session.state.profile : null;
  const panel = session.panel;
  const client = session.client;
  const isAdmin = profile?.role === 'ADMIN';
  const queryPanel = panel ?? emptyPanel;
  const usersKey = panelKeys.adminUsers(queryPanel, profile?.id ?? '', null, null);
  const permissionsKey = panelKeys.adminPermissions(queryPanel, profile?.id ?? '', userId);
  const usersQuery = useQuery({
    queryKey: usersKey,
    queryFn: () => {
      if (!client) {
        throw new Error('A panel client is required to load a user.');
      }

      return client.listUsers();
    },
    enabled: Boolean(panel && client && profile && isAdmin && userId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const user = usersQuery.data?.find((candidate) => candidate.id === userId);
  const permissionsQuery = useQuery({
    queryKey: permissionsKey,
    queryFn: () => {
      if (!client) {
        throw new Error('A panel client is required to load MOD permissions.');
      }

      return client.listModPermissions(userId);
    },
    enabled: Boolean(panel && client && profile && isAdmin && userId),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const invalidateUsers = async (): Promise<void> => {
    if (!panel || !profile) {
      return;
    }

    await queryClient.invalidateQueries({
      queryKey: panelKeys.adminUsers(panel, profile.id, null, null).slice(0, -2),
    });
  };

  const invalidatePermissions = async (): Promise<void> => {
    if (!panel || !profile) {
      return;
    }

    await queryClient.invalidateQueries({ queryKey: panelKeys.adminPermissions(panel, profile.id, userId) });
  };

  const finishOwnAccountBoundary = async (): Promise<void> => {
    if (!panel) {
      return;
    }

    await queryClient.cancelQueries({ queryKey: panelKeys.root(panel) });
    queryClient.removeQueries({ queryKey: panelKeys.root(panel) });
    session.retryRestore();
  };

  const confirmUserAction = async (): Promise<void> => {
    if (!action || !user || !client || !profile) {
      return;
    }

    setBusy(true);
    setActionError(null);
    setActionNotice(null);
    try {
      if (action.kind === 'status') {
        await client.updateUserStatus(user.id, action.status);
      } else if (action.kind === 'role') {
        await client.updateUserRole(user.id, action.role);
        queryClient.removeQueries({ queryKey: permissionsKey });
      } else if (action.kind === 'reset-password') {
        const result = await client.resetPassword(user.id);
        setTemporaryPassword(result.tempPassword);
      } else {
        await client.removeTwoFactor(user.id);
      }

      await invalidateUsers();
      if (user.id === profile.id) {
        await finishOwnAccountBoundary();
      }
      if (action.kind === 'status' && action.status === 'BANNED') {
        setActionNotice(`${user.username} was banned and their active sessions were revoked.`);
      } else if (action.kind !== 'reset-password') {
        setActionNotice('User changes were saved.');
      }
      setAction(null);
    } catch (requestError) {
      if (requestError instanceof BackendApiError && requestError.status === 409) {
        await invalidateUsers();
        setActionNotice('State changed. The latest user record has been reloaded.');
      } else if (
        requestError instanceof BackendApiError &&
        requestError.status === 400 &&
        requestError.message === 'No changes'
      ) {
        await invalidateUsers();
        setActionNotice('No changes were needed.');
        setAction(null);
      } else {
        setActionError(getApiErrorMessage(requestError));
      }
    } finally {
      setBusy(false);
    }
  };

  const grantPermission = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!client || !user || !profile || user.role !== 'MOD') {
      setPermissionError('User is not a MOD. Change the role before granting permissions.');
      return;
    }
    setPermissionError(null);
    setPendingGrant({ permission, serverId: serverId.trim() || null });
  };

  const confirmGrant = async (): Promise<void> => {
    if (!pendingGrant || !client || !user) {
      return;
    }
    setPermissionBusy(true);
    setPermissionError(null);
    setPermissionNotice(null);
    try {
      await client.grantModPermission(user.id, pendingGrant);
      setServerId('');
      setPendingGrant(null);
      await Promise.all([invalidatePermissions(), invalidateUsers()]);
      setPermissionNotice('MOD permission granted.');
    } catch (requestError) {
      if (requestError instanceof BackendApiError && requestError.status === 409) {
        await Promise.all([invalidatePermissions(), invalidateUsers()]);
        setPermissionNotice('State changed. The latest permission grants have been reloaded.');
      } else if (requestError instanceof BackendApiError && requestError.status === 400) {
        setPermissionError('User is not a MOD. Change the role before granting permissions.');
      } else {
        setPermissionError(getApiErrorMessage(requestError));
      }
    } finally {
      setPermissionBusy(false);
    }
  };

  const confirmRevokePermission = async (): Promise<void> => {
    if (!revokePermission || !client) {
      return;
    }

    setPermissionBusy(true);
    setPermissionError(null);
    try {
      await client.revokeModPermission(userId, revokePermission.id);
      await Promise.all([invalidatePermissions(), invalidateUsers()]);
      setPermissionNotice('MOD permission revoked.');
      setRevokePermission(null);
    } catch (requestError) {
      if (requestError instanceof BackendApiError && requestError.status === 409) {
        await Promise.all([invalidatePermissions(), invalidateUsers()]);
        setPermissionNotice('State changed. The latest permission grants have been reloaded.');
      } else {
        setPermissionError(getApiErrorMessage(requestError));
      }
    } finally {
      setPermissionBusy(false);
    }
  };

  const copyTemporaryPassword = async (): Promise<void> => {
    if (!temporaryPassword || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(temporaryPassword);
      setCopyNotice('Temporary password copied at your request.');
    } catch {
      setCopyNotice('The browser could not copy the temporary password. Select it and copy manually.');
    }
  };

  if (!isAdmin) {
    return <Alert kind="warning" title="Administrator access required">User administration is available only to panel administrators.</Alert>;
  }

  if (!userId) {
    return <Alert kind="warning" title="User unavailable">Choose a user from the administration list.</Alert>;
  }

  if (usersQuery.isLoading) {
    return <p className="text-sm text-ink-muted">Loading user…</p>;
  }

  if (usersQuery.isError) {
    return <Alert kind="error" title="User unavailable">{getApiErrorMessage(usersQuery.error)}</Alert>;
  }

  if (!user) {
    return <Alert kind="warning" title="User unavailable">The requested user could not be found.</Alert>;
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="pixel-title text-accent">[ Administration ]</p>
          <h1 className="mt-3 text-2xl font-bold text-ink">{user.username}</h1>
          <p className="mt-2 break-all text-sm text-ink-muted">{user.email}</p>
        </div>
        <Link className="text-sm font-bold text-accent hover:text-ink" to={`/panel/${panel?.id ?? ''}/admin/users`}>Back to users</Link>
      </header>

      {actionError ? <Alert kind="error" title="User action unavailable">{actionError}</Alert> : null}
      {actionNotice ? <Alert kind="success">{actionNotice}</Alert> : null}
      {temporaryPassword ? (
        <section className="panel-surface border-danger p-5" aria-labelledby="detail-temporary-password-heading">
          <p className="pixel-title text-warning">[ One-time credential ]</p>
          <h2 className="mt-3 text-xl font-bold text-ink" id="detail-temporary-password-heading">Temporary password</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Use within 24 hours. It forces a password change and revokes all sessions.</p>
          <output className="mt-4 block break-all border border-line bg-bg p-4 font-mono text-base text-ink" aria-live="polite">{temporaryPassword}</output>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={copyTemporaryPassword}>Copy temporary password</Button>
            <Button variant="ghost" onClick={() => setTemporaryPassword(null)}>Dismiss password</Button>
          </div>
          {copyNotice ? <p className="mt-3 text-sm text-ink-muted" role="status">{copyNotice}</p> : null}
        </section>
      ) : null}

      <section className="panel-surface grid gap-5 p-5" aria-labelledby="user-access-heading">
        <div>
          <p className="pixel-title text-accent">[ Account access ]</p>
          <h2 className="mt-2 text-xl font-bold text-ink" id="user-access-heading">Role and status</h2>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DetailFact label="Role" value={user.role} />
          <DetailFact label="Status" value={user.status} />
          <DetailFact label="Two-factor" value={user.totpEnabled ? 'Enabled' : 'Disabled'} />
          <DetailFact label="Google" value={user.googleId ? 'Linked' : 'Not linked'} />
        </dl>
        <div className="grid gap-4 lg:grid-cols-2">
          <Field as="select" id="detail-user-status" label="Change status" value={user.status} onChange={(event) => setAction({ kind: 'status', status: event.target.value as UserStatus })}>
            {USER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
          </Field>
          <Field as="select" id="detail-user-role" label="Change role" value={user.role} onChange={(event) => setAction({ kind: 'role', role: event.target.value as Role })}>
            {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
          </Field>
        </div>
        <div className="flex flex-wrap gap-3">
          {user.status === 'PENDING' ? <Button onClick={() => setAction({ kind: 'status', status: 'ACTIVE' })}>Approve user</Button> : null}
          <Button variant="secondary" onClick={() => setAction({ kind: 'reset-password' })}>Reset password</Button>
          {user.totpEnabled ? <Button variant="danger" onClick={() => setAction({ kind: 'remove-2fa' })}>Disable 2FA</Button> : null}
        </div>
      </section>

      <section className="panel-surface grid gap-5 p-5" aria-labelledby="mod-permissions-heading">
        <div>
          <p className="pixel-title text-accent">[ MOD permissions ]</p>
          <h2 className="mt-2 text-xl font-bold text-ink" id="mod-permissions-heading">Permission grants</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">Global grants apply to every visible server. A server ID scopes a grant to one server.</p>
        </div>
        {user.role !== 'MOD' ? <Alert kind="warning" title="User is not a MOD">Change this user’s role to MOD before granting permissions.</Alert> : null}
        <form className="grid gap-4 border border-line bg-bg p-4 lg:grid-cols-[1fr_1fr_auto] lg:items-end" onSubmit={grantPermission}>
          <Field as="select" id="mod-permission" label="Permission" value={permission} disabled={user.role !== 'MOD' || permissionBusy} onChange={(event) => setPermission(event.target.value as ModPermission)}>
            {MOD_PERMISSIONS.map((permissionOption) => <option key={permissionOption} value={permissionOption}>{permissionOption}</option>)}
          </Field>
          <Field id="permission-server-id" label="Server ID (optional)" value={serverId} disabled={user.role !== 'MOD' || permissionBusy} onChange={(event) => setServerId(event.target.value)} hint="Leave blank for a global grant." />
          <Button type="submit" loading={permissionBusy} disabled={user.role !== 'MOD'}>Grant permission</Button>
        </form>
        {permissionError ? <Alert kind="error" title="Permission action unavailable">{permissionError}</Alert> : null}
        {permissionNotice ? <Alert kind="success">{permissionNotice}</Alert> : null}
        {permissionsQuery.isLoading ? <p className="text-sm text-ink-muted">Loading MOD permissions…</p> : null}
        {permissionsQuery.isError ? <Alert kind="error" title="Permission grants unavailable">{getApiErrorMessage(permissionsQuery.error)}</Alert> : null}
        {permissionsQuery.data && permissionsQuery.data.length === 0 ? <p className="border border-line bg-bg p-4 text-sm text-ink-muted">No MOD permissions have been granted.</p> : null}
        {permissionsQuery.data && permissionsQuery.data.length > 0 ? (
          <div className="grid gap-3">
            {permissionsQuery.data.map((grant) => (
              <article className="flex flex-wrap items-center justify-between gap-4 border border-line bg-bg p-4" key={grant.id}>
                <div>
                  <p className="font-bold text-ink">{grant.permission}</p>
                  <p className="mt-1 text-sm text-ink-muted">{grant.serverId === null ? 'Global — all visible servers' : `Server scope — ${grant.serverId}`}</p>
                </div>
                <Button variant="danger" onClick={() => setRevokePermission(grant)}>Revoke</Button>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <ConfirmDialog open={action !== null} title={action ? userActionTitle(action, user) : 'Confirm user action'} confirmLabel={action ? userActionConfirmLabel(action, user) : 'Confirm'} danger={action?.kind === 'reset-password' || action?.kind === 'remove-2fa' || action?.kind === 'status' && action.status === 'BANNED'} busy={busy} onCancel={() => !busy && setAction(null)} onConfirm={confirmUserAction}>
        {action ? userActionDescription(action, user) : null}
      </ConfirmDialog>
      <ConfirmDialog open={revokePermission !== null} title="Revoke MOD permission" confirmLabel="Revoke permission" danger busy={permissionBusy} onCancel={() => !permissionBusy && setRevokePermission(null)} onConfirm={confirmRevokePermission}>
        {revokePermission ? `Revoke ${revokePermission.permission} (${revokePermission.serverId === null ? 'global grant' : `server ${revokePermission.serverId}`}) from ${user.username}?` : null}
      </ConfirmDialog>
      <ConfirmDialog
        open={pendingGrant !== null}
        title="Grant MOD permission"
        confirmLabel="Grant permission"
        busy={permissionBusy}
        onCancel={() => !permissionBusy && setPendingGrant(null)}
        onConfirm={confirmGrant}
      >
        {pendingGrant ? <>Grant {pendingGrant.permission.replace('_', ' ').toLowerCase()} {pendingGrant.serverId ? `for server ${pendingGrant.serverId}` : 'globally (every visible server)'} to {user.username}?</> : null}
      </ConfirmDialog>
    </div>
  );
};

const DetailFact = ({ label, value }: { label: string; value: string }): React.JSX.Element => (
  <div className="border border-line bg-bg p-3"><dt className="pixel-title text-ink-muted">{label}</dt><dd className="mt-2 font-bold text-ink">{value}</dd></div>
);

const userActionTitle = (action: UserAction, user: PublicUser): string => {
  if (action.kind === 'status') return `Change ${user.username}'s status`;
  if (action.kind === 'role') return `Change ${user.username}'s role`;
  if (action.kind === 'reset-password') return `Reset ${user.username}'s password`;
  return `Disable two-factor authentication for ${user.username}`;
};

const userActionConfirmLabel = (action: UserAction, user: PublicUser): string => {
  if (action.kind === 'status') return action.status === 'ACTIVE' && user.status === 'PENDING' ? 'Approve user' : 'Save status';
  if (action.kind === 'role') return 'Save role';
  if (action.kind === 'reset-password') return 'Reset password';
  return 'Disable 2FA';
};

const userActionDescription = (action: UserAction, user: PublicUser): string => {
  if (action.kind === 'status' && action.status === 'BANNED') return `Ban ${user.username}? This immediately revokes all of their active sessions.`;
  if (action.kind === 'status') return `Set ${user.username}'s status to ${action.status}.`;
  if (action.kind === 'role') return `Set ${user.username}'s role to ${action.role}. Existing MOD permission grants are cleared when a role changes.`;
  if (action.kind === 'reset-password') return `Create a one-time temporary password for ${user.username}. It expires in 24 hours, forces a password change, and revokes all sessions.`;
  return `Disable two-factor authentication for ${user.username} as an emergency recovery action.`;
};
