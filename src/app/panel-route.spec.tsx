import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryRouter,
  RouterProvider,
  type DataRouter,
  type RouteObject,
} from 'react-router';

import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { router as applicationRouter } from './router';
import { PanelRoute } from '@/components/panel-route';
import { InstanceProvider } from '@/instances/instance-context';
import { SecurityPage } from '@/pages/panel/security-page';

const panelInfo = JSON.stringify({
  name: 'MinePanel',
  version: '1',
  api: { protocolVersion: 1 },
  capabilities: {
    auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false },
    realtime: { websocketTicket: false },
  },
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(async () => {
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: async (_name: string, _options: { mode: string }, callback: () => Promise<unknown>) => callback(),
    },
  });
  const db = await openDB('minepanel-pwa', 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('instances')) {
        database.createObjectStore('instances', { keyPath: 'id' });
      }
    },
  });
  const now = new Date().toISOString();
  await db.put('instances', { id: 'panel-a', origin: 'https://panel-a.example.test', createdAt: now, lastUsedAt: now });
  await db.put('instances', { id: 'panel-b', origin: 'https://panel-b.example.test', createdAt: now, lastUsedAt: now });
  db.close();
});

afterEach(async () => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  const db = await openDB('minepanel-pwa', 1);
  await db.clear('instances');
  db.close();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
});

type MountRouterOptions = {
  initialEntry?: string;
  children?: RouteObject[];
};

const renderRouter = async (
  queryClient: QueryClient,
  router: DataRouter,
): Promise<void> => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <InstanceProvider>
          <RouterProvider router={router} />
        </InstanceProvider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

const mountRouter = async (
  queryClient: QueryClient,
  {
    initialEntry = '/panel/panel-a/security',
    children = [
      { index: true, Component: (): React.JSX.Element => <p>overview</p> },
      { path: 'security', Component: SecurityPage },
    ],
  }: MountRouterOptions = {},
) => {
  const router = createMemoryRouter(
    [
      {
        path: '/panel/:instanceId',
        Component: PanelRoute,
        children,
      },
    ],
    { initialEntries: [initialEntry] },
  );
  await renderRouter(queryClient, router);
  return router;
};

const mountApplicationRouter = async (
  queryClient: QueryClient,
  initialEntry: string,
): Promise<DataRouter> => {
  await applicationRouter.navigate(initialEntry);
  await renderRouter(queryClient, applicationRouter);
  return applicationRouter;
};

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

/** Deterministic small polling for async final states (avoids act flake). */
const waitForText = async (text: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((container?.textContent ?? '').includes(text)) {
      return true;
    }
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
  return (container?.textContent ?? '').includes(text);
};

const waitForApplicationPath = async (pathname: string): Promise<boolean> => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (applicationRouter.state.location.pathname === pathname) {
      return true;
    }
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    });
  }
  return applicationRouter.state.location.pathname === pathname;
};

const createAuthenticatedPanelFetch = () =>
  vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/info')) {
      return new Response(panelInfo, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.endsWith('/api/auth/profile')) {
      return new Response(
        JSON.stringify({ id: 'user-a', username: 'UserA', role: 'USER' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({ statusCode: 404, error: 'Not Found' }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  });

const countRequests = (
  calls: readonly Parameters<typeof fetch>[],
  pathname: string,
): number => {
  let count = 0;
  for (const [input] of calls) {
    if (String(input).endsWith(pathname)) {
      count += 1;
    }
  }
  return count;
};

const expectApplicationRedirect = async (
  initialEntry: string,
  expectedPath: string,
  forbiddenPath?: string,
): Promise<void> => {
  const fetchImplementation = createAuthenticatedPanelFetch();
  vi.stubGlobal('fetch', fetchImplementation);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const visitedPaths: string[] = [];
  const unsubscribe = applicationRouter.subscribe((state) => {
    visitedPaths.push(state.location.pathname);
  });

  try {
    await mountApplicationRouter(queryClient, initialEntry);
    expect(await waitForApplicationPath(expectedPath)).toBe(true);
    await settle();
    await settle();

    expect(applicationRouter.state.location.pathname).toBe(expectedPath);
    expect(applicationRouter.state.historyAction).toBe('REPLACE');
    if (forbiddenPath !== undefined) {
      expect(visitedPaths).not.toContain(forbiddenPath);
    }

    const settledNavigationCount = visitedPaths.length;
    expect(countRequests(fetchImplementation.mock.calls, '/api/info')).toBe(1);
    expect(countRequests(fetchImplementation.mock.calls, '/api/auth/profile')).toBe(1);

    await settle();
    await settle();
    expect(visitedPaths).toHaveLength(settledNavigationCount);
    expect(countRequests(fetchImplementation.mock.calls, '/api/info')).toBe(1);
    expect(countRequests(fetchImplementation.mock.calls, '/api/auth/profile')).toBe(1);
  } finally {
    unsubscribe();
  }
};

describe('panel routing session loop regressions', () => {
  it('same-panel nested navigation does not restart info or profile restoration', async () => {
    const fetchImplementation = createAuthenticatedPanelFetch();
    vi.stubGlobal('fetch', fetchImplementation);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = await mountRouter(queryClient, {
      initialEntry: '/panel/panel-a',
      children: [
        { index: true, Component: (): React.JSX.Element => <p>overview route</p> },
        { path: 'servers', Component: (): React.JSX.Element => <p>servers route</p> },
        { path: 'account', Component: (): React.JSX.Element => <p>account route</p> },
        { path: 'admin/users', Component: (): React.JSX.Element => <p>admin users route</p> },
      ],
    });

    expect(await waitForText('overview route')).toBe(true);
    expect(countRequests(fetchImplementation.mock.calls, '/api/info')).toBe(1);
    expect(countRequests(fetchImplementation.mock.calls, '/api/auth/profile')).toBe(1);

    for (const [pathname, marker] of [
      ['/panel/panel-a/servers', 'servers route'],
      ['/panel/panel-a/account', 'account route'],
      ['/panel/panel-a/admin/users', 'admin users route'],
    ] as const) {
      await act(async () => {
        await router.navigate(pathname);
      });
      expect(await waitForText(marker)).toBe(true);
    }

    await settle();
    await settle();
    expect(countRequests(fetchImplementation.mock.calls, '/api/info')).toBe(1);
    expect(countRequests(fetchImplementation.mock.calls, '/api/auth/profile')).toBe(1);
  });

  it('administration alias redirects once to the sibling admin users route', async () => {
    await expectApplicationRedirect(
      '/panel/panel-a/administration',
      '/panel/panel-a/admin/users',
      '/panel/panel-a/administration/admin/users',
    );
  });

  it('unknown panel route redirects once to the panel root', async () => {
    await expectApplicationRedirect(
      '/panel/panel-a/not-a-real-route',
      '/panel/panel-a',
    );
  });
});

describe('panel hard remount (Finding 2 regression)', () => {
  it('navigating /panel/A/security -> /panel/B/security with B cached hard-remounts the A subtree', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('panel-a.example.test')) {
        if (url.endsWith('/api/info')) {
          return new Response(panelInfo, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/profile')) {
          return new Response(JSON.stringify({ id: 'user-a', username: 'AdminA', role: 'ADMIN' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/sessions')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      if (url.includes('panel-b.example.test')) {
        if (url.endsWith('/api/info')) {
          return new Response(panelInfo, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/profile')) {
          return new Response(JSON.stringify({ id: 'user-b', username: 'UserB', role: 'USER' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/sessions')) {
          return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify({ statusCode: 404, error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImplementation);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const now = new Date().toISOString();
    queryClient.setQueryData(['instances', 'panel-b'], {
      id: 'panel-b',
      origin: 'https://panel-b.example.test',
      createdAt: now,
      lastUsedAt: now,
    });

    const router = await mountRouter(queryClient);
    await settle();
    const sessionsKeyA = [
      'panel',
      'panel-a',
      'https://panel-a.example.test',
      'user',
      'user-a',
      'auth',
      'sessions',
    ] as const;
    for (let attempt = 0; attempt < 40 && queryClient.getQueryData(sessionsKeyA) === undefined; attempt += 1) {
      await act(async () => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      });
    }
    expect(queryClient.getQueryData(sessionsKeyA)).toEqual([]);

    const bodyText = (): string => container?.textContent ?? '';
    expect(bodyText()).toContain('AdminA');
    expect(bodyText()).not.toContain('UserB');

    await act(async () => {
      await router.navigate('/panel/panel-b/security');
    });
    // B's instance is already cached, so only the immutable provider key can
    // remove A before B's session restoration completes.
    expect(bodyText()).not.toContain('AdminA');

    expect(await waitForText('UserB')).toBe(true);
    expect(bodyText()).not.toContain('AdminA');

    // A's populated sessions query must be removed with the full panel scope.
    expect(queryClient.getQueryData(sessionsKeyA)).toBeUndefined();
  });

  it('same route shape A/servers/x -> B/servers/x also hard-remounts (no stale A closure)', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('panel-a.example.test') || url.includes('panel-b.example.test')) {
        if (url.endsWith('/api/info')) {
          return new Response(panelInfo, { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (url.endsWith('/api/auth/profile')) {
          const origin = url.includes('panel-a') ? 'AdminA' : 'UserB';
          const id = url.includes('panel-a') ? 'user-a' : 'user-b';
          return new Response(JSON.stringify({ id, username: origin, role: 'ADMIN' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
      }
      return new Response(JSON.stringify({ statusCode: 404, error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchImplementation);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const router = await mountRouter(queryClient);
    await settle();
    expect(container?.textContent).toContain('AdminA');

    await act(async () => {
      router.navigate('/panel/panel-b/security');
    });
    expect(container?.textContent).not.toContain('AdminA');
    expect(await waitForText('UserB')).toBe(true);
  });
});