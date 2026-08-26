import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import type { AuthProfile, PanelInfo } from '@/api/types';
import { BackendApiError } from '@/api/errors';
import type { ShellSession } from './panel-session-context';
import { resetRefreshBrokerForTests } from './refresh-broker';
import { SessionController } from './session-controller';

const info: PanelInfo = { name: 'MinePanel', version: '1', api: { protocolVersion: 1 }, capabilities: { auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false }, realtime: { websocketTicket: false }, servers: { requestableDiscovery: false } } };
const profile: AuthProfile = { id: 'user-a', username: 'alex', role: 'USER' };

const installLocks = (): void => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback() } });
};

afterEach(() => {
  resetRefreshBrokerForTests();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

const controllerFor = (client: Partial<BackendClient>) => {
  const states: ShellSession[] = [];
  const onBoundary = vi.fn();
  const controller = new SessionController({ client: client as BackendClient, onState: (state) => states.push(state), onInfo: vi.fn(), onBoundary });
  return { controller, states, onBoundary };
};

describe('SessionController', () => {
  it('restores a profile after the broker rotates one expired access cookie', async () => {
    installLocks();
    const client = { origin: 'https://panel.example', getInfo: vi.fn().mockResolvedValue(info), getProfile: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(profile), refresh: vi.fn().mockResolvedValue(undefined) };
    const { controller, states } = controllerFor(client);
    await controller.start();
    expect(client.refresh).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual({ kind: 'authenticated', profile: { id: 'user-a', username: 'alex', role: 'USER' } });
  });

  it('does not treat a reachable 403 pending account as anonymous', async () => {
    installLocks();
    const client = { origin: 'https://panel.example', getInfo: vi.fn().mockResolvedValue(info), getProfile: vi.fn().mockRejectedValue(new BackendApiError(403, 'pending', 'AccountPending')) };
    const { controller, states, onBoundary } = controllerFor(client);
    await controller.start();
    expect(states.at(-1)).toEqual({ kind: 'account-pending' });
    expect(onBoundary).toHaveBeenCalledOnce();
  });

  it('moves a password login two-factor challenge into memory-only pending state', async () => {
    installLocks();
    const client = { origin: 'https://panel.example', getInfo: vi.fn().mockResolvedValue(info), getProfile: vi.fn().mockResolvedValue(null), refresh: vi.fn().mockResolvedValue(undefined), login: vi.fn().mockResolvedValue({ requiresTwoFactor: true, preAuthToken: 'ephemeral-pre-auth' }) };
    const { controller, states } = controllerFor(client);
    await controller.start();
    await controller.login({ identifier: 'alex', password: 'not-retained' });
    expect(states.at(-1)).toEqual({ kind: 'two-factor-pending', preAuthToken: 'ephemeral-pre-auth' });
  });

  it('requires a compatible browser lock before hosted-cookie authentication', async () => {
    const client = { origin: 'https://panel.example', getInfo: vi.fn().mockResolvedValue(info), getProfile: vi.fn() };
    const { controller, states } = controllerFor(client);
    await controller.start();
    expect(client.getProfile).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ kind: 'error', reason: 'incompatible' });
  });
});

describe('two-factor and session-boundary transitions', () => {
  it('restores the canonical profile after a successful two-factor verification', async () => {
    installLocks();
    const client = {
      origin: 'https://panel.example',
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi.fn().mockResolvedValueOnce(profile).mockResolvedValueOnce(profile),
      login: vi.fn().mockResolvedValue({ requiresTwoFactor: true, preAuthToken: 'pre-auth' }),
      verifyTwoFactor: vi.fn().mockResolvedValue({ id: 'user-a' }),
    };
    const { controller, states } = controllerFor(client);
    await controller.start();
    await controller.login({ identifier: 'alex', password: 'password' });
    await controller.verifyTwoFactor('123456');
    expect(client.verifyTwoFactor).toHaveBeenCalledWith('123456', 'pre-auth');
    expect(states.at(-1)).toEqual({ kind: 'authenticated', profile: { id: 'user-a', username: 'alex', role: 'USER' } });
  });

  it('keeps two-factor pending after the server rate-limits verification', async () => {
    installLocks();
    const client = {
      origin: 'https://panel.example',
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi.fn().mockResolvedValue(profile),
      login: vi.fn().mockResolvedValue({ requiresTwoFactor: true, preAuthToken: 'pre-auth' }),
      verifyTwoFactor: vi.fn().mockRejectedValue(new BackendApiError(429, 'slow down')),
    };
    const { controller, states } = controllerFor(client);
    await controller.start();
    await controller.login({ identifier: 'alex', password: 'password' });
    await expect(controller.verifyTwoFactor('123456')).rejects.toMatchObject({ status: 429 });
    expect(states.at(-1)).toEqual({ kind: 'two-factor-pending', preAuthToken: 'pre-auth' });
  });

  it('cleans the panel scope for recovery and logout-all completion', async () => {
    installLocks();
    const client = {
      origin: 'https://panel.example',
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi.fn().mockRejectedValue(new BackendApiError(403, 'recovery', 'PasswordChangeRequired')),
      logoutAll: vi.fn().mockResolvedValue(undefined),
    };
    const { controller, states, onBoundary } = controllerFor(client);
    await controller.start();
    await controller.signOutAll();
    expect(client.logoutAll).toHaveBeenCalledOnce();
    expect(states).toContainEqual({ kind: 'password-change-required' });
    expect(states.at(-1)).toEqual({ kind: 'anonymous' });
    expect(onBoundary).toHaveBeenCalledTimes(2);
  });
});

describe('forced password recovery', () => {
  it('returns to the canonical profile only after a successful temporary-password change', async () => {
    installLocks();
    const client = {
      origin: 'https://panel.example',
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi.fn().mockRejectedValueOnce(new BackendApiError(403, 'recovery', 'PasswordChangeRequired')).mockResolvedValue(profile),
      changePassword: vi.fn().mockResolvedValue({ id: 'user-a' }),
    };
    const { controller, states } = controllerFor(client);
    await controller.start();
    await client.changePassword('temporary-password', 'new-password');
    await controller.restoreProfile();
    expect(client.changePassword).toHaveBeenCalledWith('temporary-password', 'new-password');
    expect(states).toContainEqual({ kind: 'password-change-required' });
    expect(states.at(-1)).toEqual({ kind: 'authenticated', profile: { id: 'user-a', username: 'alex', role: 'USER' } });
  });
});

describe('expired-session retry (BLOCKER-3 regression)', () => {
  it('clears the prior-auth marker so a retry can reach the anonymous presentation', async () => {
    installLocks();
    const profileOnce: AuthProfile = { id: 'user-a', username: 'alex', role: 'USER' };
    const client = {
      origin: 'https://panel.example',
      // First start restores a session; then the refresh token dies.
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi
        .fn()
        .mockResolvedValueOnce(profileOnce)
        .mockResolvedValue(null)
        .mockResolvedValue(null),
      refresh: vi.fn().mockRejectedValue(new BackendApiError(401, 'expired', 'RefreshTokenExpired')),
    };
    const { controller, states } = controllerFor(client);
    await controller.start();
    expect(states.at(-1)).toEqual({ kind: 'authenticated', profile: { id: 'user-a', username: 'alex', role: 'USER' } });

    controller.retryRestore();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(states.at(-1)).toEqual({ kind: 'error', reason: 'expired' });

    // The retry action must now resolve to anonymous instead of looping.
    controller.retryRestore();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(states.at(-1)).toEqual({ kind: 'anonymous' });
    expect(client.refresh).toHaveBeenCalledTimes(2);
  });
});

describe('terminal refresh boundary (Finding 1 regression)', () => {
  it('leaves the authenticated state exactly once and runs the panel boundary once', async () => {
    installLocks();
    const client = {
      origin: 'https://panel.example',
      getInfo: vi.fn().mockResolvedValue(info),
      getProfile: vi.fn().mockResolvedValue(profile),
    };
    const { controller, states, onBoundary } = controllerFor(client);
    await controller.start();
    expect(states.at(-1)).toEqual({ kind: 'authenticated', profile: { id: 'user-a', username: 'alex', role: 'USER' } });

    // Simulate the client coordinator discovering a terminally invalid
    // refresh session on an arbitrary authenticated endpoint.
    controller.handleTerminalRefresh();
    expect(states.at(-1)).toEqual({ kind: 'error', reason: 'expired' });
    expect(onBoundary).toHaveBeenCalledOnce();

    // Idempotent: repeated terminal notifications must not re-run boundary.
    controller.handleTerminalRefresh();
    controller.handleTerminalRefresh();
    expect(onBoundary).toHaveBeenCalledOnce();
  });

  it('does not transition when the shell is already anonymous', () => {
    installLocks();
    const client = { origin: 'https://panel.example', getInfo: vi.fn().mockResolvedValue(info), getProfile: vi.fn().mockResolvedValue(null), refresh: vi.fn().mockResolvedValue(undefined) };
    const { controller, states, onBoundary } = controllerFor(client);
    void controller.handleTerminalRefresh();
    expect(states.at(-1)).toBeUndefined();
    expect(onBoundary).not.toHaveBeenCalled();
  });
});
