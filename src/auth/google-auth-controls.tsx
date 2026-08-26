import { useEffect, useMemo, useRef, useState } from 'react';
import { BackendClient, type AuthenticatedProfile, type PanelInfo, supportsGoogleLogin } from '@/api/backend-client';
import { googleClientId } from './google-client-id';
import { GoogleIdentity } from './google-identity';
import { GoogleLoginFlow } from './google-login-flow';

type SessionState =
  | { kind: 'loading' }
  | { kind: 'anonymous' }
  | { kind: 'authenticated'; profile: AuthenticatedProfile }
  | { kind: 'error'; message: string };

type PendingGoogleAction = { kind: 'login' | 'link'; nonce: string };

const safeErrorMessage = (action: 'login' | 'link' | 'session' | 'logout'): string => {
  if (action === 'logout') return 'The panel could not confirm sign-out. This browser has still cleared its local session view.';
  if (action === 'link') return 'Google account linking could not be completed. Try again from this panel.';
  if (action === 'session') return 'The panel session could not be restored. Check the panel connection and try again.';
  return 'Google sign-in could not be completed. Check the panel connection and try again.';
};

export const GoogleAuthControls = ({ backend, info }: { backend: BackendClient; info: PanelInfo }): React.JSX.Element => {
  const flow = useMemo(() => new GoogleLoginFlow(backend), [backend]);
  const googleIdentity = useMemo(() => new GoogleIdentity(), []);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [session, setSession] = useState<SessionState>({ kind: 'loading' });
  const [pendingAction, setPendingAction] = useState<PendingGoogleAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const googleSupported = supportsGoogleLogin(info, googleClientId);

  useEffect(() => {
    let active = true;
    void flow.restoreSession().then(
      (profile) => {
        if (active) setSession(profile ? { kind: 'authenticated', profile } : { kind: 'anonymous' });
      },
      () => {
        if (active) setSession({ kind: 'error', message: safeErrorMessage('session') });
      },
    );
    return () => {
      active = false;
    };
  }, [flow]);

  useEffect(() => {
    if (!pendingAction || !googleButtonRef.current) return;
    void googleIdentity.renderButton(googleButtonRef.current, {
      clientId: googleClientId,
      nonce: pendingAction.nonce,
      onCredential: (credential) => {
        void (async () => {
          setIsBusy(true);
          try {
            if (pendingAction.kind === 'link') {
              const profile = await flow.linkGoogleCredential(credential);
              setSession({ kind: 'authenticated', profile });
              setMessage('Google is now linked to this MinePanel account.');
            } else {
              const outcome = await flow.exchangeLoginCredential(credential);
              if (outcome.kind === 'authenticated') {
                setSession({ kind: 'authenticated', profile: outcome.profile });
                setMessage(null);
              } else if (outcome.canLinkCurrentSession) {
                setSession({ kind: 'authenticated', profile: flow.currentProfile! });
                setMessage('This Google email belongs to a password account. Choose Google again to link it to the active session.');
              } else {
                setSession({ kind: 'anonymous' });
                setMessage('This Google email belongs to a MinePanel password account. Sign in with your MinePanel password, then try Google again to link it.');
              }
            }
          } catch {
            setMessage(safeErrorMessage(pendingAction.kind));
          } finally {
            setPendingAction(null);
            setIsBusy(false);
          }
        })();
      },
      onError: (error) => {
        setPendingAction(null);
        setMessage(error);
      },
    });
  }, [flow, googleIdentity, pendingAction]);

  const beginGoogleAction = async (kind: PendingGoogleAction['kind']): Promise<void> => {
    setIsBusy(true);
    setMessage(null);
    try {
      setPendingAction({ kind, nonce: await flow.createChallenge() });
    } catch {
      setMessage(safeErrorMessage(kind));
    } finally {
      setIsBusy(false);
    }
  };

  const signOut = async (): Promise<void> => {
    setIsBusy(true);
    try {
      await flow.logout();
      setSession({ kind: 'anonymous' });
      setMessage(null);
    } catch {
      setSession({ kind: 'anonymous' });
      setMessage(safeErrorMessage('logout'));
    } finally {
      setIsBusy(false);
    }
  };

  if (session.kind === 'loading') {
    return <p className="mt-8 text-sm text-[#bdc9b7]">Restoring browser session…</p>;
  }

  if (session.kind === 'error') {
    return <p className="mt-8 text-sm leading-6 text-[#e17878]">{session.message}</p>;
  }

  if (session.kind === 'authenticated') {
    return (
      <div className="mt-8 border-l-4 border-[#69f45a] bg-[#162115] px-5 py-4 text-sm leading-6 text-[#d7e6d2]">
        <p>
          Signed in as <strong>{session.profile.username}</strong>.
        </p>
        {info.api.protocolVersion === 1 && info.capabilities.auth.googleOAuth && (
          <button
            className="mt-4 border border-[#69f45a] px-3 py-2 font-bold text-[#69f45a] disabled:cursor-wait disabled:opacity-60"
            disabled={isBusy || pendingAction !== null || !googleSupported}
            onClick={() => void beginGoogleAction('link')}
            type="button"
          >
            Link Google account
          </button>
        )}
        <button
          className="ml-3 mt-4 border border-[#aab7a3] px-3 py-2 font-bold text-[#f1f6ed] disabled:cursor-wait disabled:opacity-60"
          disabled={isBusy}
          onClick={() => void signOut()}
          type="button"
        >
          Sign out
        </button>
        {message && <p className="mt-3 text-[#f6e5a8]">{message}</p>}
        {pendingAction && <div className="mt-4" ref={googleButtonRef} />}
      </div>
    );
  }

  if (!googleSupported) {
    const reason = info.api.protocolVersion !== 1
      ? 'This panel uses an unsupported API protocol for Google sign-in.'
      : !info.capabilities.auth.googleOAuth
        ? 'This panel does not offer Google sign-in.'
        : 'This app deployment is missing its public Google client ID configuration.';
    return <p className="mt-8 border-l-4 border-[#f5c451] bg-[#302a19] px-5 py-4 text-sm leading-6 text-[#f6e5a8]">{reason}</p>;
  }

  return (
    <div className="mt-8 border-l-4 border-[#69f45a] bg-[#162115] px-5 py-4 text-sm leading-6 text-[#d7e6d2]">
      <p className="font-bold text-[#f1f6ed]">Sign in to this panel</p>
      <p className="mt-2">Google credentials are exchanged directly with the selected panel. MinePanel session tokens remain browser-managed HttpOnly cookies.</p>
      {pendingAction ? (
        <div className="mt-4" ref={googleButtonRef} />
      ) : (
        <button
          className="mt-4 border border-[#69f45a] px-3 py-2 font-bold text-[#69f45a] disabled:cursor-wait disabled:opacity-60"
          disabled={isBusy}
          onClick={() => void beginGoogleAction('login')}
          type="button"
        >
          Continue with Google
        </button>
      )}
      {isBusy && <p className="mt-3 text-[#bdc9b7]">Contacting the selected panel…</p>}
      {message && <p className="mt-3 text-[#f6e5a8]">{message}</p>}
    </div>
  );
};
