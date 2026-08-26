import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import type { PanelInfo } from '@/api/types';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import { PanelSessionContext } from '@/auth/panel-session-context';
import { RequestableServersSection } from './requestable-servers-section';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const infoWith = (requestableDiscovery: boolean): PanelInfo => ({
  name: 'MinePanel',
  version: '1',
  api: { protocolVersion: 1 },
  capabilities: {
    auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false },
    realtime: { websocketTicket: false },
    servers: { requestableDiscovery },
  },
});

const sessionValue = (role: 'ADMIN' | 'USER', client: Partial<BackendClient> = {}, info = infoWith(true)): PanelSessionValue => ({
  panel: { id: 'panel-a', origin: 'https://panel.example' },
  client: client as BackendClient,
  info,
  infoError: null,
  state: { kind: 'authenticated', profile: { id: 'user-a', username: role === 'ADMIN' ? 'admin' : 'alex', role } },
  signOut: async () => undefined,
  retryRestore: () => undefined,
  notifyProfileChanged: () => undefined,
});

const makePageClient = (rowsPerCall: (offset: number) => { id: string; name: string; accessType: 'REQUEST'; requestStatus: null | 'PENDING' }[], total: number) => {
  const listRequestableServers = vi.fn().mockImplementation(async ({ offset: requestedOffset }: { offset: number }) => ({
    data: rowsPerCall(requestedOffset),
    total,
  }));
  return { client: { listRequestableServers, requestAccess: vi.fn() } as unknown as Partial<BackendClient>, listRequestableServers };
};

const mountSection = async (value: PanelSessionValue, queryClient: QueryClient): Promise<void> => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <PanelSessionContext.Provider value={value}>
          <RequestableServersSection />
        </PanelSessionContext.Provider>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

afterEach(() => {
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
});

describe('RequestableServersSection (owner-approved slice)', () => {
  it('hides the section for ADMIN callers', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountSection(sessionValue('ADMIN'), queryClient);
    expect(container?.textContent).toBe('');
  });

  it('renders named requestable servers with pending badges and request buttons, then invalidates both lists on request', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      listRequestableServers: vi.fn().mockResolvedValue({
        data: [
          { id: 'req-1', name: 'Requestable', accessType: 'REQUEST', requestStatus: null },
          { id: 'req-2', name: 'PendingServer', accessType: 'REQUEST', requestStatus: 'PENDING' },
        ],
        total: 2,
      }),
      requestAccess: vi.fn().mockResolvedValue({ status: 'PENDING', requestedAt: '2026-01-01T00:00:00.000Z', approvedAt: null }),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountSection(sessionValue('USER', client), queryClient);

    expect(container?.textContent).toContain('Requestable');
    expect(container?.textContent).toContain('PendingServer');
    expect(container?.textContent).toContain('Pending approval');
    expect(container?.textContent).toContain('Request access');

    await act(async () => {
      container?.querySelectorAll('button').forEach((button) => {
        if (button.textContent?.includes('Request access')) button.click();
      });
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    expect(client.requestAccess).toHaveBeenCalledWith('req-1');
    // Invalidating both scoped lists must trigger an authoritative refetch of
    // the requestable collection (initial fetch + post-request refetch).
    expect(client.listRequestableServers.mock.calls.length).toBeGreaterThan(1);
  });

  it('pages through requestable servers: Next fetches offset 20, Previous returns to offset 0, controls obey total', async () => {
    const page = (offset: number): { id: string; name: string; accessType: 'REQUEST'; requestStatus: null | 'PENDING' }[] =>
      offset === 0
        ? [{ id: 'req-1', name: 'First page', accessType: 'REQUEST', requestStatus: null }]
        : [{ id: 'req-2', name: 'Second page', accessType: 'REQUEST', requestStatus: null }];
    const { client, listRequestableServers } = makePageClient(page, 21);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountSection(sessionValue('USER', client), queryClient);

    expect(container?.textContent).toContain('First page');
    expect(listRequestableServers).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }), expect.anything());

    await act(async () => {
      const buttons = Array.from(container?.querySelectorAll('button') ?? []);
      buttons.find((button) => button.textContent?.includes('Next page'))?.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(container?.textContent).toContain('Second page');
    expect(listRequestableServers).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 20 }), expect.anything());
    expect(container?.textContent).toContain('21');

    await act(async () => {
      const buttons = Array.from(container?.querySelectorAll('button') ?? []);
      buttons.find((button) => button.textContent?.includes('Previous page'))?.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(listRequestableServers).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }), expect.anything());
    expect(container?.textContent).toContain('First page');
  });

  it('recovers to the highest valid page when the current page disappears', async () => {
    // Phase 1: total > PAGE_SIZE so the pagination controls render and the
    // user can genuinely move to offset 20.
    let total = 25;
    const rowsAt = (offset: number): { id: string; name: string; accessType: 'REQUEST'; requestStatus: null | 'PENDING' }[] => {
      if (offset >= total) {
        return [];
      }
      return [{ id: `req-${offset}`, name: `Row at offset ${offset}`, accessType: 'REQUEST', requestStatus: null }];
    };
    const listRequestableServers = vi.fn().mockImplementation(async ({ offset: requestedOffset }: { offset: number }) => ({
      data: rowsAt(requestedOffset),
      total,
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = { listRequestableServers, requestAccess: vi.fn() } as any;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountSection(sessionValue('USER', client), queryClient);

    expect(container?.textContent).toContain('Row at offset 0');

    // Genuinely reach page 2: Next button must exist (total > PAGE_SIZE) and
    // clicking it must issue offset 20.
    await act(async () => {
      const next = Array.from(container?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Next page'));
      if (!next) throw new Error('Next page control not rendered');
      next.click();
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(listRequestableServers).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 20 }), expect.anything());
    expect(container?.textContent).toContain('Row at offset 20');

    // Phase 2: the collection shrinks so offset 20 is now beyond total (the
    // requested server was approved and disappeared).
    total = 1;
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: ['panel', 'panel-a', 'https://panel.example', 'user', 'user-a', 'servers', 'requestable'] });
    });
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    // The overshoot-recovery effect must move the offset back to 0 (the only
    // valid page), refetch it, and render the remaining row. This test fails
    // if the effect is removed: offset stays 20, the authoritative fetch of
    // offset 0 never happens, and 'Row at offset 0' never renders.
    expect(listRequestableServers).toHaveBeenCalledWith(expect.objectContaining({ limit: 20, offset: 0 }), expect.anything());
    expect(container?.textContent).toContain('Row at offset 0');
  });

  it('returns null when the capability is missing', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await mountSection(sessionValue('USER', {}, infoWith(false)), queryClient);
    expect(container?.textContent).toBe('');
  });
});