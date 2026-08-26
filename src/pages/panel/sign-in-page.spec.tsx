import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import type { PanelInfo } from '@/api/types';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import type { SignInPage as SignInPageType } from './sign-in-page';

const info: PanelInfo = {
  name: 'MinePanel',
  version: '1',
  api: { protocolVersion: 1 },
  capabilities: {
    auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: true },
    realtime: { websocketTicket: false },
    servers: { requestableDiscovery: false },
  },
};

type GisCallback = (credential: string) => void;

let container: HTMLDivElement | null = null;
let SignInPage: typeof SignInPageType | null = null;
let PanelSessionContext: typeof import('@/auth/panel-session-context').PanelSessionContext | null = null;
let SessionControllerContext: typeof import('@/auth/panel-session-context').SessionControllerContext | null = null;
let root: ReturnType<typeof createRoot> | null = null;
let capturedCallback: ((response: { credential?: string }) => void) | null = null;
let fireCredential: GisCallback = () => undefined;

beforeEach(async () => {
  capturedCallback = null;
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test.apps.googleusercontent.com');
  // googleClientId and the GIS loader are read/module-cached at import time;
  // reset modules so the env stub and per-test fake window.google apply.
  // Test-only module boundary: googleClientId/GIS loader are read at import
  // time, so the module must be re-imported after the env stub (runtime-selected).
  vi.resetModules();
  const loaded = await import('./sign-in-page');
  const ctx = await import('@/auth/panel-session-context');
  SignInPage = loaded.SignInPage;
  PanelSessionContext = ctx.PanelSessionContext;
  SessionControllerContext = ctx.SessionControllerContext;
  (window as unknown as { google?: unknown }).google = {
    accounts: {
      id: {
        initialize: vi.fn((config: { callback?: (response: { credential?: string }) => void }) => {
          capturedCallback = config.callback ?? null;
        }),
        renderButton: vi.fn(),
      },
    },
  };
  fireCredential = (credential: string) => {
    capturedCallback?.({ credential });
  };
});

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllEnvs();
  SignInPage = null;
  PanelSessionContext = null;
  SessionControllerContext = null;
  delete (window as unknown as { google?: unknown }).google;
});

const mountSignIn = async (
  client: Partial<BackendClient>,
  controller: { login: ReturnType<typeof vi.fn>; register: ReturnType<typeof vi.fn>; beginGoogleRestore: ReturnType<typeof vi.fn> },
): Promise<void> => {
  const value: PanelSessionValue = {
    panel: { id: 'panel-a', origin: 'https://panel.example' },
    client: client as BackendClient,
    info,
    infoError: null,
    state: { kind: 'anonymous' },
    signOut: async () => undefined,
    retryRestore: vi.fn(),
    notifyProfileChanged: vi.fn(),
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          {PanelSessionContext && SessionControllerContext ? (
            <PanelSessionContext.Provider value={value}>
              <SessionControllerContext.Provider value={controller as never}>
                {SignInPage ? <SignInPage /> : null}
              </SessionControllerContext.Provider>
            </PanelSessionContext.Provider>
          ) : null}
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

const submitGoogleCredential = async (credential: string): Promise<void> => {
  await act(async () => {
    fireCredential(credential);
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

const fillAndSubmitPasswordForm = async (identifier: string, password: string): Promise<void> => {
  await act(async () => {
    const identifierInput = container?.querySelector('#sign-in-identifier');
    const passwordInput = container?.querySelector('#sign-in-password') as HTMLInputElement;
    if (!(identifierInput instanceof HTMLInputElement) || !passwordInput) throw new Error('Sign-in fields missing');
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    nativeSetter?.call(identifierInput, identifier);
    identifierInput.dispatchEvent(new Event('input', { bubbles: true }));
    nativeSetter?.call(passwordInput, password);
    passwordInput.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    const passwordInput = container?.querySelector('#sign-in-password') as HTMLInputElement;
    passwordInput?.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

describe('SignInPage Google collision (Finding 3 regression)', () => {
  it('never calls the JWT link endpoint from the anonymous collision state and shows guidance', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      getSetupStatus: vi.fn().mockResolvedValue({ initialAdminCreated: true, nextStep: 'complete' }),
      createGoogleChallenge: vi.fn().mockResolvedValue('nonce-1'),
      loginWithGoogle: vi.fn().mockResolvedValue({ status: 'LinkConfirmationRequired' }),
      linkGoogleAccount: vi.fn().mockResolvedValue(undefined),
    };
    const controller = { login: vi.fn().mockRejectedValue(new Error('no-op')), register: vi.fn(), beginGoogleRestore: vi.fn() };

    await mountSignIn(client, controller);
    await submitGoogleCredential('anonymous-collision-google-credential');

    expect(client.linkGoogleAccount).not.toHaveBeenCalled();
    expect(client.loginWithGoogle).toHaveBeenCalledWith('anonymous-collision-google-credential');
    expect(container?.textContent).toContain('Account already exists');
    expect(container?.textContent).toContain('Sign in with that account');
  });

  it('password sign-in after a collision never reuses the Google credential', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      getSetupStatus: vi.fn().mockResolvedValue({ initialAdminCreated: true, nextStep: 'complete' }),
      createGoogleChallenge: vi.fn().mockResolvedValue('nonce-1'),
      loginWithGoogle: vi.fn().mockResolvedValue({ status: 'LinkConfirmationRequired' }),
      linkGoogleAccount: vi.fn().mockResolvedValue(undefined),
    };
    const controller = { login: vi.fn().mockResolvedValue(undefined), register: vi.fn(), beginGoogleRestore: vi.fn() };

    await mountSignIn(client, controller);
    await submitGoogleCredential('collision-credential');
    await fillAndSubmitPasswordForm('existing@example.com', 'user-password');

    expect(controller.login).toHaveBeenCalledWith({ identifier: 'existing@example.com', password: 'user-password' });
    expect(client.linkGoogleAccount).not.toHaveBeenCalled();
  });
});