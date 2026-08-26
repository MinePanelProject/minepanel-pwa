import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export const AccountPage = (): React.JSX.Element => {
  const { panel, client, state, notifyProfileChanged } = usePanelSession();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState(state.kind === 'authenticated' ? state.profile.username : '');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (state.kind !== 'authenticated' || panel === null || client === null) return <Alert kind="warning">Sign in to manage your account.</Alert>;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setFeedback(null);
    try {
      await client.updateProfile(username);
      setFeedback('Profile saved.');
    } catch (nextError) {
      if (nextError instanceof BackendApiError && nextError.status === 400) {
        setFeedback('No profile changes were needed.');
      } else {
        setError(getApiErrorMessage(nextError));
        return;
      }
    } finally {
      setBusy(false);
    }
    await queryClient.invalidateQueries({ queryKey: panelKeys.profile(panel) });
    await queryClient.invalidateQueries({ queryKey: panelKeys.userRoot(panel, state.profile.id) });
    notifyProfileChanged();
  };

  return (
    <section className="grid max-w-xl gap-6" aria-labelledby="account-heading">
      <div>
        <h1 className="pixel-title" id="account-heading">Account</h1>
        <p className="mt-2 text-sm text-ink-muted">Profile details for this panel.</p>
      </div>
      <div className="grid gap-3">
        <Link className="w-fit min-h-11 border-2 border-line-strong bg-surface-raised px-4 py-2 text-sm font-bold text-ink hover:border-ink-muted" to="security">Security &amp; sessions</Link>
      </div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {feedback ? <Alert kind="success" role="status">{feedback}</Alert> : null}
      <dl className="grid gap-3 panel-surface p-5 text-sm">
        <div className="grid gap-1"><dt className="font-bold text-ink-muted">Username</dt><dd className="text-ink">{state.profile.username}</dd></div>
        <div className="grid gap-1"><dt className="font-bold text-ink-muted">Email</dt><dd className="text-ink-muted">This panel does not include email in its session profile.</dd></div>
      </dl>
      <form className="grid gap-4 panel-surface p-5" onSubmit={(event) => void submit(event)}>
        <Field id="account-username" label="Username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required />
        <Button type="submit" loading={busy}>Save username</Button>
      </form>
    </section>
  );
};