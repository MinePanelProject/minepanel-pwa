import { useState } from 'react';
import { getApiErrorMessage } from '@/api/errors';
import { usePanelSession, useSessionController } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

export const PasswordChangePage = (): React.JSX.Element => {
  const { client } = usePanelSession();
  const controller = useSessionController();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (client === null) return;
    if (newPassword !== confirmation) {
      setError('The new password confirmation does not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await client.changePassword(oldPassword, newPassword);
      setOldPassword('');
      setNewPassword('');
      setConfirmation('');
      controller.notifyProfileChanged();
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto grid w-full max-w-md gap-6 panel-surface p-6" aria-labelledby="recovery-heading">
      <div className="grid gap-2"><h1 className="page-title" id="recovery-heading">Set a new password</h1><p className="text-sm text-ink-muted">A password change is required before this account can continue. Your identity is unavailable until the change is complete.</p></div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <Field id="recovery-old-password" label="Temporary password" type="password" autoComplete="current-password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} required />
        <Field id="recovery-new-password" label="New password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
        <Field id="recovery-confirm-password" label="Confirm new password" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required />
        <Button type="submit" loading={busy}>Change password</Button>
      </form>
    </section>
  );
};
