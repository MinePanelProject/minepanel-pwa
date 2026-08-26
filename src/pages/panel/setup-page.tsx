import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import { usePanelSession } from '@/auth/panel-session-context';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';

export const SetupPage = (): React.JSX.Element => {
  const { panel, client, info } = usePanelSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const tokenRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = panel !== null && client !== null && info?.api.protocolVersion === 1 && info.capabilities.auth.partitionedCookies;
  const status = useQuery({
    queryKey: panelKeys.setupStatus(panel ?? { id: 'unselected', origin: 'https://invalid.local' }),
    queryFn: () => client?.getSetupStatus() ?? Promise.reject(new Error('No panel selected.')),
    enabled: ready,
    staleTime: 0,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: false,
  });

  const returnToSignIn = (): void => {
    void navigate('..');
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (panel === null || client === null || tokenRef.current === null) return;
    const setupToken = tokenRef.current.value;
    setBusy(true);
    setError(null);
    try {
      await client.initSetup({ email, username, password }, setupToken);
      setEmail('');
      setUsername('');
      setPassword('');
      queryClient.removeQueries({ queryKey: panelKeys.setupStatus(panel) });
      await queryClient.fetchQuery({ queryKey: panelKeys.setupStatus(panel), queryFn: () => client.getSetupStatus(), staleTime: 0 });
      returnToSignIn();
    } catch (nextError) {
      if (nextError instanceof BackendApiError && nextError.code === 'SetupTokenInvalid') {
        setError('The setup token was not accepted; obtain the current token and try again.');
      } else if (nextError instanceof BackendApiError && (nextError.code === 'SetupAlreadyComplete' || nextError.status === 409)) {
        setEmail('');
        setUsername('');
        setPassword('');
        await queryClient.refetchQueries({ queryKey: panelKeys.setupStatus(panel) });
        returnToSignIn();
      } else {
        setError(getApiErrorMessage(nextError));
      }
    } finally {
      if (tokenRef.current !== null) tokenRef.current.value = '';
      setBusy(false);
    }
  };

  if (!ready) return <Alert kind="warning" title="Panel setup unavailable">This browser or panel configuration cannot safely complete hosted setup.</Alert>;
  if (status.isLoading) return <span className="flex items-center gap-2 text-sm text-ink-muted"><Spinner />Checking panel setup</span>;
  if (status.isError) return <Alert kind="error">{getApiErrorMessage(status.error)}</Alert>;
  if (status.data?.nextStep === 'complete') return <section className="grid max-w-md gap-4 panel-surface p-6"><h1 className="pixel-title">Panel already set up</h1><p className="text-sm text-ink-muted">An administrator already exists for this panel.</p><Button onClick={returnToSignIn}>Go to sign in</Button></section>;

  return (
    <section className="mx-auto grid w-full max-w-md gap-6 panel-surface p-6" aria-labelledby="setup-heading">
      <div><h1 className="pixel-title" id="setup-heading">Create first administrator</h1><p className="mt-2 text-sm text-ink-muted">Enter the setup token supplied by the panel operator. It is cleared as soon as this request finishes.</p></div>
      {error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      <form className="grid gap-4" onSubmit={(event) => void submit(event)}><Field id="setup-email" label="Email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /><Field id="setup-username" label="Username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /><label className="grid gap-2" htmlFor="setup-token"><span className="font-bold text-ink">Setup token</span><input ref={tokenRef} id="setup-token" type="password" autoComplete="off" required className="w-full border-2 border-line-strong bg-bg px-4 py-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none" /></label><Field id="setup-password" label="Administrator password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><Button type="submit" loading={busy}>Create administrator</Button></form>
    </section>
  );
};
