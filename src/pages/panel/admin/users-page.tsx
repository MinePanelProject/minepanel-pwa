import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { ROLES, USER_STATUSES } from '@/api/types';
import type { PublicUser, Role, UserStatus } from '@/api/types';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Field } from '@/components/ui/field';

type UserAction =
  | { kind: 'status'; user: PublicUser; status: UserStatus }
  | { kind: 'role'; user: PublicUser; role: Role }
  | { kind: 'reset-password'; user: PublicUser }
  | { kind: 'remove-2fa'; user: PublicUser };

const emptyPanel = { id: '', origin: '' } as const;

export const AdminUsersPage = (): React.JSX.Element => {
  const session = usePanelSession();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<UserStatus | ''>('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [action, setAction] = useState<UserAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [copyNotice, setCopyNotice] = useState<string | null>(null);

  const profile = session.state.kind === 'authenticated' ? session.state.profile : null;
  const panel = session.panel;
  const client = session.client;
  const isAdmin = profile?.role === 'ADMIN';
  const queryPanel = panel ?? emptyPanel;
  const userKey = panelKeys.adminUsers(queryPanel, profile?.id ?? '', statusFilter || null, roleFilter || null);
  const usersQuery = useQuery({
    queryKey: userKey,
    queryFn: () => {
      if (!client) {
        throw new Error('A panel client is required to list users.');
      }

      return client.listUsers({ status: statusFilter || undefined, role: roleFilter || undefined });
    },
    enabled: Boolean(panel && client && profile && isAdmin),
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

  const finishOwnAccountBoundary = async (): Promise<void> => {
    if (!panel) {
      return;
    }

    await queryClient.cancelQueries({ queryKey: panelKeys.root(panel) });
    queryClient.removeQueries({ queryKey: panelKeys.root(panel) });
    session.retryRestore();
  };

  const confirmAction = async (): Promise<void> => {
    if (!action || !panel || !profile || !client) {
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action.kind === 'status') {
        await client.updateUserStatus(action.user.id, action.status);
      } else if (action.kind === 'role') {
        await client.updateUserRole(action.user.id, action.role);
      } else if (action.kind === 'reset-password') {
        const result = await client.resetPassword(action.user.id);
        setTemporaryPassword(result.tempPassword);
      } else {
        await client.removeTwoFactor(action.user.id);
      }
      await invalidateUsers();
      if (action.user.id === profile.id) {
        await finishOwnAccountBoundary();
      }
      if (action.kind === 'status' && action.status === 'BANNED') {
        setNotice(`${action.user.username} was banned and their active sessions were revoked.`);
      } else if (action.kind !== 'reset-password') {
        setNotice('User changes were saved.');
      }
      setAction(null);
    } catch (requestError) {
      if (requestError instanceof BackendApiError && requestError.status === 409) {
        await invalidateUsers();
        setNotice('State changed. The latest user records have been reloaded.');
      } else if (
        requestError instanceof BackendApiError &&
        requestError.status === 400 &&
        requestError.message === 'No changes'
      ) {
        await invalidateUsers();
        setNotice('No changes were needed.');
        setAction(null);
      } else {
        setError(getApiErrorMessage(requestError));
      }
    } finally {
      setBusy(false);
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
    return (
      <Alert kind="warning" title="Administrator access required">
        User management is available only to panel administrators.
      </Alert>
    );
  }

  return (
    <div className="grid gap-6">
      <header>
        <p className="pixel-label text-accent">[ Administration ]</p>
        <h1 className="page-title mt-3">Users</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">Approve accounts, change access, and recover user access safely.</p>
      </header>

      <section className="panel-surface grid gap-4 p-5" aria-label="User filters">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            as="select"
            id="user-status-filter"
            label="Filter by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as UserStatus | '')}
          >
            <option value="">All statuses</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </Field>
          <Field
            as="select"
            id="user-role-filter"
            label="Filter by role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as Role | '')}
          >
            <option value="">All roles</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Field>
        </div>
      </section>

      {error ? <Alert kind="error" title="User action unavailable">{error}</Alert> : null}
      {notice ? <Alert kind="success">{notice}</Alert> : null}
      {temporaryPassword ? (
        <section className="panel-surface border-danger p-5" aria-labelledby="temporary-password-heading">
          <p className="pixel-label text-warning">[ One-time credential ]</p>
          <h2 className="mt-3 text-xl font-bold text-ink" id="temporary-password-heading">
            Temporary password
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            Use within 24 hours. It forces a password change and revokes all sessions.
          </p>
          <output className="mt-4 block break-all border border-line bg-bg p-4 font-mono text-base text-ink" aria-live="polite">
            {temporaryPassword}
          </output>
          <div className="mt-4 flex flex-wrap gap-3">
            <Button variant="secondary" onClick={copyTemporaryPassword}>
              Copy temporary password
            </Button>
            <Button variant="ghost" onClick={() => setTemporaryPassword(null)}>
              Dismiss password
            </Button>
          </div>
          {copyNotice ? <p className="mt-3 text-sm text-ink-muted" role="status">{copyNotice}</p> : null}
        </section>
      ) : null}

      {usersQuery.isLoading ? <p className="text-sm text-ink-muted">Loading users…</p> : null}
      {usersQuery.isError ? (
        <Alert kind="error" title="Users unavailable">
          {getApiErrorMessage(usersQuery.error)}
        </Alert>
      ) : null}
      {usersQuery.data && usersQuery.data.length === 0 ? (
        <EmptyState title="No users found" description="Adjust the status or role filters to view different accounts." />
      ) : null}
      {usersQuery.data && usersQuery.data.length > 0 ? (
        <>
          <div className="grid gap-4 md:hidden">
            {usersQuery.data.map((user) => (
              <UserCard key={user.id} panelId={panel?.id ?? ''} user={user} onAction={setAction} />
            ))}
          </div>
          <div className="hidden overflow-x-auto border border-line md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-surface-raised text-ink-muted">
                <tr>
                  <th className="p-3 font-bold">User</th>
                  <th className="p-3 font-bold">Role</th>
                  <th className="p-3 font-bold">Status</th>
                  <th className="p-3 font-bold">Security</th>
                  <th className="p-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersQuery.data.map((user) => (
                  <tr className="border-t border-line align-top" key={user.id}>
                    <td className="p-3">
                      <Link className="font-bold text-accent hover:text-ink" to={`/panel/${panel?.id ?? ''}/admin/users/${user.id}`}>
                        {user.username}
                      </Link>
                      <p className="mt-1 break-all text-ink-muted">{user.email}</p>
                    </td>
                    <td className="p-3"><RoleBadge role={user.role} /></td>
                    <td className="p-3"><StatusBadge status={user.status} /></td>
                    <td className="p-3 text-ink-muted">
                      <p>{user.totpEnabled ? '2FA enabled' : '2FA disabled'}</p>
                      <p>{user.googleId ? 'Google linked' : 'Google not linked'}</p>
                      <p>{user.mustChangePassword ? 'Password change required' : 'Password current'}</p>
                    </td>
                    <td className="min-w-80 p-3"><UserActions user={user} onAction={setAction} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={action !== null}
        title={action ? actionTitle(action) : 'Confirm user action'}
        confirmLabel={action ? actionConfirmLabel(action) : 'Confirm'}
        danger={action?.kind === 'reset-password' || action?.kind === 'remove-2fa' || action?.kind === 'status' && action.status === 'BANNED'}
        busy={busy}
        onCancel={() => !busy && setAction(null)}
        onConfirm={confirmAction}
      >
        {action ? actionDescription(action) : null}
      </ConfirmDialog>
    </div>
  );
};

const UserCard = ({ panelId, user, onAction }: { panelId: string; user: PublicUser; onAction: (action: UserAction) => void }): React.JSX.Element => (
  <article className="panel-surface grid gap-4 p-4">
    <div>
      <Link className="text-lg font-bold text-accent hover:text-ink" to={`/panel/${panelId}/admin/users/${user.id}`}>
        {user.username}
      </Link>
      <p className="mt-1 break-all text-sm text-ink-muted">{user.email}</p>
    </div>
    <div className="flex flex-wrap gap-2"><RoleBadge role={user.role} /><StatusBadge status={user.status} /></div>
    <dl className="grid gap-2 text-sm text-ink-muted">
      <div className="flex justify-between gap-4"><dt>Two-factor</dt><dd>{user.totpEnabled ? 'Enabled' : 'Disabled'}</dd></div>
      <div className="flex justify-between gap-4"><dt>Google</dt><dd>{user.googleId ? 'Linked' : 'Not linked'}</dd></div>
      <div className="flex justify-between gap-4"><dt>Password</dt><dd>{user.mustChangePassword ? 'Change required' : 'Current'}</dd></div>
    </dl>
    <UserActions user={user} onAction={onAction} />
  </article>
);

const UserActions = ({ user, onAction }: { user: PublicUser; onAction: (action: UserAction) => void }): React.JSX.Element => (
  <div className="admin-actions grid gap-3">
    {user.status === 'PENDING' ? <Button onClick={() => onAction({ kind: 'status', user, status: 'ACTIVE' })}>Approve</Button> : null}
    <div className="grid gap-3 sm:grid-cols-2">
      <Field as="select" id={`status-${user.id}`} label={`Status for ${user.username}`} value={user.status} onChange={(event) => onAction({ kind: 'status', user, status: event.target.value as UserStatus })}>
        {USER_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
      </Field>
      <Field as="select" id={`role-${user.id}`} label={`Role for ${user.username}`} value={user.role} onChange={(event) => onAction({ kind: 'role', user, role: event.target.value as Role })}>
        {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
      </Field>
    </div>
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => onAction({ kind: 'reset-password', user })}>Reset password</Button>
      {user.totpEnabled ? <Button variant="danger" onClick={() => onAction({ kind: 'remove-2fa', user })}>Disable 2FA</Button> : null}
    </div>
  </div>
);

const StatusBadge = ({ status }: { status: UserStatus }): React.JSX.Element => {
  const dotClass = status === 'BANNED' ? 'status-dot status-dot--danger' : status === 'PENDING' ? 'status-dot status-dot--warning' : 'status-dot';
  return <span className="status-badge inline-flex items-center gap-2 border-2 border-line bg-bg px-2 py-1 text-xs font-bold text-ink"><span className={dotClass} aria-hidden="true" />{status}</span>;
};

const RoleBadge = ({ role }: { role: Role }): React.JSX.Element => <span className="role-badge inline-flex border-2 border-line-strong bg-surface-raised px-2 py-1 text-xs font-bold text-ink">{role}</span>;

const actionTitle = (action: UserAction): string => {
  if (action.kind === 'status') return `Change ${action.user.username}'s status`;
  if (action.kind === 'role') return `Change ${action.user.username}'s role`;
  if (action.kind === 'reset-password') return `Reset ${action.user.username}'s password`;
  return `Disable two-factor authentication for ${action.user.username}`;
};

const actionConfirmLabel = (action: UserAction): string => {
  if (action.kind === 'status') return action.status === 'ACTIVE' && action.user.status === 'PENDING' ? 'Approve user' : 'Save status';
  if (action.kind === 'role') return 'Save role';
  if (action.kind === 'reset-password') return 'Reset password';
  return 'Disable 2FA';
};

const actionDescription = (action: UserAction): string => {
  if (action.kind === 'status' && action.status === 'BANNED') return `Ban ${action.user.username}? This immediately revokes all of their active sessions.`;
  if (action.kind === 'status') return `Set ${action.user.username}'s status to ${action.status}.`;
  if (action.kind === 'role') return `Set ${action.user.username}'s role to ${action.role}. Existing MOD permission grants are cleared when a role changes.`;
  if (action.kind === 'reset-password') return `Create a one-time temporary password for ${action.user.username}. It expires in 24 hours, forces a password change, and revokes all sessions.`;
  return `Disable two-factor authentication for ${action.user.username} as an emergency recovery action.`;
};
