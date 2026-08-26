import { useEffect, useMemo, useRef, useState } from 'react';
import { BackendApiError, getApiErrorMessage } from '@/api/errors';
import { supportsGoogleLogin } from '@/api/backend-client';
import { usePanelSession } from '@/auth/panel-session-context';
import { googleClientId } from '@/auth/google-client-id';
import { GoogleIdentity } from '@/auth/google-identity';
import type { PanelInfo } from '@/api/types';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type LinkState = 'idle' | 'rendering' | 'linking' | 'linked' | 'error';

/**
 * Authenticated Google account linking (external-review Finding 3).
 *
 * Runs ONLY while a MinePanel session exists: a FRESH backend challenge is
 * created for every link attempt, GIS renders with that nonce, a FRESH
 * credential is delivered, POST /auth/oauth/google/link is called, and the
 * credential is discarded immediately. The credential that caused an
 * anonymous LinkConfirmationRequired collision is never reused — that flow
 * lives in SignInPage and clears its ref.
 *
 * Backend truth: GET /auth/profile does not expose googleId, so the current
 * Google-link status cannot be displayed without attempting a link; the
 * backend's 409 (already linked / conflicting google id on a different
 * account) is therefore surfaced truthfully instead of fabricating state.
 */
export const GoogleLinkControl = ({ info }: { info: PanelInfo }): React.JSX.Element | null => {
  const { client } = usePanelSession();
  const [linkState, setLinkState] = useState<LinkState>('idle');
  const [error, setError] = useState<string | null>(null);
  const buttonContainerRef = useRef<HTMLDivElement>(null);
  const credentialRef = useRef<string | null>(null);
  const sequenceRef = useRef(0);
  const identity = useMemo(() => new GoogleIdentity(), []);

  const canUseGoogle = client !== null && supportsGoogleLogin(info, googleClientId);

  // Guard: any stale async work (challenge fetch, GIS callback) that settles
  // after unmount or panel switch must not touch UI or submit a credential.
  useEffect(() => {
    const sequence = sequenceRef.current;
    return () => {
      // Bump on unmount so late resolutions become no-ops.
      sequenceRef.current = sequence + 1;
      credentialRef.current = null;
    };
  }, []);

  const submitLink = async (credential: string): Promise<void> => {
    if (client === null) {
      return;
    }
    const sequence = sequenceRef.current;
    setLinkState('linking');
    setError(null);
    try {
      await client.linkGoogleAccount(credential);
      if (sequence === sequenceRef.current) {
        setLinkState('linked');
      }
    } catch (nextError) {
      if (sequence !== sequenceRef.current) {
        return;
      }
      if (nextError instanceof BackendApiError && nextError.status === 409) {
        setError('This Google account is already linked, or belongs to another MinePanel account on this panel.');
        setLinkState('error');
      } else {
        setError(getApiErrorMessage(nextError));
        setLinkState('error');
      }
    } finally {
      credentialRef.current = null;
    }
  };

  const beginLink = async (): Promise<void> => {
    if (client === null || buttonContainerRef.current === null) {
      return;
    }
    const sequence = ++sequenceRef.current;
    setLinkState('rendering');
    setError(null);
    try {
      const nonce = await client.createGoogleChallenge();
      if (sequence !== sequenceRef.current || buttonContainerRef.current === null) {
        return;
      }
      await identity.renderButton(buttonContainerRef.current, {
        clientId: googleClientId,
        nonce,
        onCredential: (credential) => {
          if (sequence !== sequenceRef.current) {
            return;
          }
          credentialRef.current = credential;
          void submitLink(credential);
        },
        onError: (nextError) => {
          if (sequence === sequenceRef.current) {
            setError(String(nextError));
            setLinkState('error');
          }
        },
      });
      if (sequence === sequenceRef.current) {
        setLinkState('idle');
      }
    } catch (nextError) {
      if (sequence === sequenceRef.current) {
        setError(getApiErrorMessage(nextError));
        setLinkState('error');
      }
    }
  };

  if (!canUseGoogle || client === null) {
    return null;
  }

  return (
    <section className="panel-surface grid gap-4 p-5" aria-labelledby="google-link-heading">
      <div>
        <h2 className="text-lg font-bold text-ink" id="google-link-heading">Google account</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Link a Google account to this MinePanel account for Google sign-in. A fresh single-use
          challenge is created for every attempt and the Google credential is discarded immediately
          after linking.
        </p>
      </div>
      {linkState === 'linked' ? (
        <Alert kind="success" role="status">Google account linked successfully.</Alert>
      ) : null}
      {linkState === 'error' && error ? <Alert kind="error" role="alert">{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void beginLink()} loading={linkState === 'rendering' || linkState === 'linking'}>
          Link Google account
        </Button>
        {linkState === 'linking' ? <span className="flex items-center gap-2 text-sm text-ink-muted"><Spinner />Linking…</span> : null}
      </div>
      <div ref={buttonContainerRef} aria-label="Link Google account with Google sign-in" />
    </section>
  );
};