import { useEffect, useMemo, useState } from 'react';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { usePanelSession, useSessionController } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

const cooldownMs = 15 * 60 * 1000;
const tokenPattern = /^(?:\d{6}|[a-f0-9]{8}-[a-f0-9]{8})$/;

export const TwoFactorPage = (): React.JSX.Element => {
  const { state } = usePanelSession();
  const controller = useSessionController();
  const [token, setToken] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const coolingDown = cooldownUntil !== null && cooldownUntil > now;
  const secondsRemaining = useMemo(() => coolingDown && cooldownUntil !== null ? Math.ceil((cooldownUntil - now) / 1000) : 0, [cooldownUntil, coolingDown, now]);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalized = token.trim().toLowerCase();
    if (!tokenPattern.test(normalized)) {
      setError('Enter a six-digit authenticator code or an eight-hexadecimal-pair backup code.');
      return;
    }
    setBusy(true);
    setError(null);
    setToken('');
    try {
      await controller.verifyTwoFactor(normalized);
    } catch (nextError) {
      if (nextError instanceof BackendApiError && nextError.status === 429) {
        setCooldownUntil(Date.now() + cooldownMs);
        setNow(Date.now());
        setError('Too many attempts. Try again in 15 minutes; the server may reset this sooner after a restart.');
      } else {
        setError(getApiErrorMessage(nextError));
      }
    } finally {
      setBusy(false);
    }
  };

  if (state.kind !== 'two-factor-pending') return <Alert kind="warning">Two-factor verification is no longer pending.</Alert>;

  return (
    <section className="mx-auto grid w-full max-w-md gap-6 panel-surface p-6" aria-labelledby="two-factor-heading">
      <div className="grid gap-2"><h1 className="pixel-title" id="two-factor-heading">Two-factor verification</h1><p className="text-sm text-ink-muted">Enter a current authenticator code or one backup code.</p></div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {coolingDown ? <Alert kind="warning" role="status">Try again in {secondsRemaining} seconds.</Alert> : null}
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        <Field id="two-factor-token" label="Authenticator or backup code" autoComplete="one-time-code" inputMode="text" value={token} onChange={(event) => setToken(event.target.value)} disabled={busy || coolingDown} required />
        <Button type="submit" loading={busy} disabled={coolingDown}>Verify and continue</Button>
      </form>
    </section>
  );
};
