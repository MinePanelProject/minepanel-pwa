import type { BackendClient } from '@/api/backend-client';
import type { AuthProfile } from '@/api/types';

export type RefreshOutcome =
  | { kind: 'profile'; profile: AuthProfile }
  | { kind: 'anonymous' }
  | { kind: 'error'; error: unknown };

type LockManagerLike = {
  request: <T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ) => Promise<T>;
};

const inFlightRefreshes = new Map<string, Promise<RefreshOutcome>>();

export const hasRefreshLockSupport = (): boolean =>
  typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks !== undefined;

const refreshInsideLock = async (client: BackendClient): Promise<RefreshOutcome> => {
  try {
    const alreadyRefreshed = await client.getProfile();
    if (alreadyRefreshed !== null) return { kind: 'profile', profile: alreadyRefreshed };

    await client.refresh();
    const profile = await client.getProfile();
    return profile === null ? { kind: 'anonymous' } : { kind: 'profile', profile };
  } catch (error) {
    return { kind: 'error', error };
  }
};

/** Coalesces destructive cookie rotation across tabs for one backend origin. */
export const refreshWithBroker = (client: BackendClient): Promise<RefreshOutcome> => {
  const origin = client.origin;
  const active = inFlightRefreshes.get(origin);
  if (active) return active;

  if (!hasRefreshLockSupport()) {
    return Promise.resolve({
      kind: 'error',
      error: new Error('Browser Web Locks are required for secure session refresh.'),
    });
  }

  const locks = navigator.locks as LockManagerLike;
  const operation = locks.request(`minepanel:refresh:${origin}`, { mode: 'exclusive' }, () => refreshInsideLock(client));
  inFlightRefreshes.set(origin, operation);
  void operation.finally(() => {
    if (inFlightRefreshes.get(origin) === operation) inFlightRefreshes.delete(origin);
  });
  return operation;
};

/** Test-only cleanup; refresh outcomes are never persisted. */
export const resetRefreshBrokerForTests = (): void => {
  inFlightRefreshes.clear();
};
