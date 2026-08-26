import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedProfile } from '@/api/backend-client';
import { GoogleLoginFlow, type GoogleAuthBackend } from './google-login-flow';

const profile: AuthenticatedProfile = { id: 'user-1', username: 'player', role: 'USER' };

describe('GoogleLoginFlow', () => {
  let backend: GoogleAuthBackend;
  let flow: GoogleLoginFlow;

  beforeEach(() => {
    backend = {
      createGoogleChallenge: vi.fn().mockResolvedValue('A'.repeat(43)),
      loginWithGoogle: vi.fn().mockResolvedValue({ status: 'Authenticated' }),
      linkGoogleAccount: vi.fn().mockResolvedValue(undefined),
      getProfile: vi.fn().mockResolvedValue(profile),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    flow = new GoogleLoginFlow(backend);
  });

  it('restores the cookie-backed profile after a successful Google credential exchange without storage writes', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await expect(flow.createChallenge()).resolves.toBe('A'.repeat(43));
    await expect(flow.exchangeLoginCredential('transient-google-id-token')).resolves.toEqual({
      kind: 'authenticated',
      profile,
    });

    expect(backend.loginWithGoogle).toHaveBeenCalledWith('transient-google-id-token');
    expect(backend.getProfile).toHaveBeenCalledTimes(1);
    expect(flow.currentProfile).toEqual(profile);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('shows password-login guidance when linking confirmation has no authenticated session', async () => {
    vi.mocked(backend.loginWithGoogle).mockResolvedValue({ status: 'LinkConfirmationRequired' });
    vi.mocked(backend.getProfile).mockResolvedValue(null);

    await expect(flow.exchangeLoginCredential('transient-google-id-token')).resolves.toEqual({
      kind: 'link-confirmation-required',
      canLinkCurrentSession: false,
    });
    expect(backend.linkGoogleAccount).not.toHaveBeenCalled();
  });

  it('uses a current authenticated session only for the explicit link endpoint', async () => {
    vi.mocked(backend.loginWithGoogle).mockResolvedValue({ status: 'LinkConfirmationRequired' });

    await expect(flow.exchangeLoginCredential('first-transient-credential')).resolves.toEqual({
      kind: 'link-confirmation-required',
      canLinkCurrentSession: true,
    });
    await expect(flow.linkGoogleCredential('fresh-link-credential')).resolves.toEqual(profile);

    expect(backend.loginWithGoogle).toHaveBeenCalledWith('first-transient-credential');
    expect(backend.linkGoogleAccount).toHaveBeenCalledWith('fresh-link-credential');
    expect(backend.linkGoogleAccount).toHaveBeenCalledTimes(1);
  });

  it('clears its only in-memory auth view when logging out', async () => {
    await flow.restoreSession();
    await flow.logout();

    expect(backend.logout).toHaveBeenCalledTimes(1);
    expect(flow.currentProfile).toBeNull();
  });
});
