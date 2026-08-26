import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { supportsGoogleLogin } from '@/api/backend-client';
import { panelKeys } from '@/api/query-keys';
import { googleClientId } from '@/auth/google-client-id';
import { GoogleIdentity } from '@/auth/google-identity';
import { usePanelSession, useSessionController } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';

type Mode = 'sign-in' | 'register';
type GoogleState = 'idle' | 'collision';
export const SignInPage = (): React.JSX.Element => {
  const { client, info, panel } = usePanelSession();
  const setupStatus = useQuery({
    queryKey: panelKeys.setupStatus(panel ?? { id: 'unselected', origin: 'https://invalid.local' }),
    queryFn: () => client?.getSetupStatus() ?? Promise.reject(new Error('No panel selected.')),
    enabled: client !== null && panel !== null && info?.api.protocolVersion === 1,
    staleTime: 0,
    retry: false,
  });
  const controller = useSessionController();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [googleState, setGoogleState] = useState<GoogleState>('idle');
  const credentialRef = useRef<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const identity = useMemo(() => new GoogleIdentity(), []);
  const canUseGoogle = info !== null && supportsGoogleLogin(info, googleClientId);
  const submitGoogleCredential = useCallback(async (credential: string): Promise<void> => {
    if (client === null) return;
    setBusy(true);
    setError(null);
    try {
      const result = await client.loginWithGoogle(credential);
      if (result.status === 'LinkConfirmationRequired') {
        // Anonymous collision (external-review Finding 3): this Google account
        // matches an existing MinePanel account. There is NO active MinePanel
        // session here, so /oauth/google/link (JWT-only) MUST NOT be called.
        // Discard the transient Google credential immediately and instruct the
        // user to authenticate the existing account first.
        credentialRef.current = null;
        setGoogleState('collision');
        return;
      }
      credentialRef.current = null;
      controller.beginGoogleRestore();
    } catch (nextError) {
      credentialRef.current = null;
      if (nextError instanceof BackendApiError && nextError.code === 'TwoFactorAuthenticationRequired') {
        setError('Use password sign-in to complete two-factor authentication.');
      } else if (nextError instanceof BackendApiError && nextError.code === 'InvalidGoogleChallenge') {
        setError('The sign-in attempt expired. Try again.');
      } else {
        setError(getApiErrorMessage(nextError));
      }
    } finally {
      setBusy(false);
    }
  }, [client, controller]);

  useEffect(() => {
    if (!canUseGoogle || client === null || googleButtonRef.current === null) return;
    let active = true;
    // Guard against a stale challenge: StrictMode/remount can produce two
    // single-use backend nonces; only the latest one may render the button.
    void client.createGoogleChallenge().then(
      (nonce) => {
        if (!active || !googleButtonRef.current) return;
        return identity.renderButton(googleButtonRef.current, {
          clientId: googleClientId,
          nonce,
          onCredential: (credential) => {
            if (!active) return;
            credentialRef.current = credential;
            void submitGoogleCredential(credential);
          },
          onError: (nextError) => {
            if (active) setError(String(nextError));
          },
        });
      },
      (nextError: unknown) => {
        if (active) setError(getApiErrorMessage(nextError));
      },
    );
    return () => {
      active = false;
      credentialRef.current = null;
    };
  }, [canUseGoogle, client, identity, submitGoogleCredential]);

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (mode === 'sign-in') {
        await controller.login({ identifier, password });
      } else {
        await controller.register({ email, username, password });
        setMessage('Registration submitted. An administrator may need to approve your account before sign-in.');
        setPassword('');
      }
    } catch (nextError) {
      setError(getApiErrorMessage(nextError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto grid w-full max-w-md gap-6 panel-surface p-6" aria-labelledby="sign-in-heading">
      <div className="grid gap-2">
        <h1 className="pixel-title" id="sign-in-heading">{mode === 'sign-in' ? 'Sign in' : 'Create account'}</h1>
        <p className="text-sm text-ink-muted">Use your MinePanel account for this selected panel.</p>
      </div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      {message ? <Alert kind="success" role="status">{message}</Alert> : null}
      {googleState === 'collision' ? <Alert kind="warning" role="alert" title="Account already exists"><div className="grid gap-3"><p>This Google account matches an existing MinePanel account. Sign in with that account&rsquo;s email or username and password, then link Google from the Security page.</p></div></Alert> : null}
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
        {mode === 'register' ? <><Field id="register-email" label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><Field id="register-username" label="Username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></> : <Field id="sign-in-identifier" label="Email or username" autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} required />}
        <Field id="sign-in-password" label="Password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(event) => setPassword(event.target.value)} required />
        <Button type="submit" loading={busy}>{mode === 'sign-in' ? 'Sign in' : 'Register'}</Button>
      </form>
      {canUseGoogle ? <div className="grid gap-3 border-t border-line pt-5"><p className="text-sm text-ink-muted">Or continue with Google</p><div ref={googleButtonRef} aria-label="Sign in with Google" /></div> : null}
      <Button variant="secondary" onClick={() => { setMode(mode === 'sign-in' ? 'register' : 'sign-in'); setError(null); setMessage(null); }}>{mode === 'sign-in' ? 'Create an account' : 'Use an existing account'}</Button>
      {setupStatus.data?.nextStep === 'register_admin' ? <Link className="min-h-11 border-2 border-line-strong bg-surface-raised px-4 py-2 text-center text-sm font-bold text-ink hover:border-ink-muted" to="setup">Panel not initialized? Set up the first administrator</Link> : null}
    </section>
  );
};
