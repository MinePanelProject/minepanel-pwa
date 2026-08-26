import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import type { AuthProfile } from '@/api/types';
import { refreshWithBroker, resetRefreshBrokerForTests } from './refresh-broker';

const profile: AuthProfile = { id: 'user-a', username: 'alex', role: 'ADMIN' };

afterEach(() => {
  resetRefreshBrokerForTests();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

describe('refreshWithBroker', () => {
  it('coalesces same-tab callers and rechecks profile while holding the origin lock', async () => {
    const lock = vi.fn(async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback());
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: lock } });
    const client = { origin: 'https://panel.example', getProfile: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(profile), refresh: vi.fn().mockResolvedValue(undefined) } as unknown as BackendClient;
    const [first, second] = await Promise.all([refreshWithBroker(client), refreshWithBroker(client)]);
    expect(lock).toHaveBeenCalledOnce();
    expect(client.refresh).toHaveBeenCalledOnce();
    expect(first).toEqual({ kind: 'profile', profile });
    expect(second).toEqual({ kind: 'profile', profile });
  });

  it('does not refresh when a competing tab has already rotated the cookie', async () => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback() } });
    const client = { origin: 'https://panel.example', getProfile: vi.fn().mockResolvedValue(profile), refresh: vi.fn() } as unknown as BackendClient;
    await expect(refreshWithBroker(client)).resolves.toEqual({ kind: 'profile', profile });
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('refuses automatic refresh without Web Locks rather than racing cookie rotation', async () => {
    const client = { origin: 'https://panel.example', getProfile: vi.fn(), refresh: vi.fn() } as unknown as BackendClient;
    await expect(refreshWithBroker(client)).resolves.toMatchObject({ kind: 'error' });
    expect(client.refresh).not.toHaveBeenCalled();
  });
});
