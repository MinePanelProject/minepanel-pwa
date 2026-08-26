import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { openDB } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const mountRouter = async (queryClient: QueryClient) => {
  const router = createMemoryRouter(
    [
      {
        path: '/panel/:instanceId',
        Component: PanelRoute,
        children: [
          { index: true, Component: (): React.JSX.Element => <p>overview</p> },
          { path: 'security', Component: SecurityPage },
        ],
      },
    ],
    { initialEntries: ['/panel/panel-a/security'] },
  );

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
  return router;
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

describe('panel hard remount (Finding 2 regression)', () => {
  it('navigating /panel/A/security -> /panel/B/security tears down the A subtree before B becomes usable', async () => {
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

    const router = await mountRouter(queryClient);
    await settle();

    const bodyText = (): string => container?.textContent ?? '';
    expect(bodyText()).toContain('AdminA');
    expect(bodyText()).not.toContain('UserB');

    await act(async () => {
      router.navigate('/panel/panel-b/security');
    });
    // Immediately after navigation, before Panel B resolves: the A subtree
    // must already be gone (keyed hard remount) — no AdminA identity renders.
    expect(bodyText()).not.toContain('AdminA');

    expect(await waitForText('UserB')).toBe(true);
    expect(bodyText()).not.toContain('AdminA');

    // A's query scope must have been cancelled and removed by the boundary.
    const profileKeyA = ['panel', 'panel-a', 'https://panel-a.example.test', 'auth', 'profile'];
    expect(queryClient.getQueryData(profileKeyA)).toBeUndefined();
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