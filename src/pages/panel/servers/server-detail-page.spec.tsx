import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import { BackendApiError } from '@/api/errors';
import { panelKeys } from '@/api/query-keys';
import type { Server } from '@/api/types';
import { PanelSessionContext, type PanelSessionValue } from '@/auth/panel-session-context';
import { ServerDetailPage } from './server-detail-page';
import { createServerPoller } from './pollers';

const panel = { id: 'panel-a', origin: 'https://panel.example.test' } as const;
const profile = { id: 'admin-a', username: 'admin', role: 'ADMIN' as const };
const server: Server = { id: 'server-a', name: 'Alpha', provider: 'PAPER', version: '1.21.1', port: 25565, status: 'STOPPED', maxPlayers: 20, difficulty: 'NORMAL', gamemode: 'SURVIVAL', pvp: true, memoryLimitMb: 1024, motd: null, levelSeed: null, onlineMode: true, viewDistance: 10, allowFlight: false, ownerId: 'owner-a', accessType: 'OPEN', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };

const makeSession = (client: BackendClient): PanelSessionValue => ({ panel, client, info: null, infoError: null, state: { kind: 'authenticated', profile }, signOut: async () => undefined, retryRestore: () => undefined, notifyProfileChanged: () => undefined });

const renderDetail = (client: BackendClient, queryClient: QueryClient): string => renderToStaticMarkup(
  <QueryClientProvider client={queryClient}><PanelSessionContext.Provider value={makeSession(client)}><MemoryRouter initialEntries={['/panel/panel-a/servers/server-a']}><Routes><Route path="/panel/:instanceId/servers/:serverId" element={<ServerDetailPage />} /></Routes></MemoryRouter></PanelSessionContext.Provider></QueryClientProvider>,
);

describe('server detail lifecycle', () => {
  it('bounds transitional polling by count, elapsed time, and status generation', () => {
    const poller = createServerPoller();
    for (let poll = 0; poll < 30; poll += 1) expect(poller.nextInterval('STARTING', 1_000 + poll)).toBe(2_000);
    expect(poller.nextInterval('STARTING', 2_000)).toBe(false);
    expect(poller.exhausted()).toBe(true);
    expect(poller.nextInterval('RUNNING', 3_000)).toBe(false);
    expect(poller.exhausted()).toBe(false);
    expect(poller.nextInterval('ERROR', 10_000)).toBe(10_000);
    expect(poller.nextInterval('ERROR', 70_000)).toBe(false);
  });

  it('keeps the rendered status authoritative while a lifecycle request is pending and after a 409', async () => {
    let rejectStart: ((reason?: unknown) => void) | undefined;
    const client = {
      getServer: async () => server,
      startServer: async () => new Promise<Server>((_resolve, reject) => { rejectStart = reject; }),
    } as unknown as BackendClient;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(panelKeys.server(panel, profile.id, server.id), server);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}><PanelSessionContext.Provider value={makeSession(client)}><MemoryRouter initialEntries={['/panel/panel-a/servers/server-a']}><Routes><Route path="/panel/:instanceId/servers/:serverId" element={<ServerDetailPage />} /></Routes></MemoryRouter></PanelSessionContext.Provider></QueryClientProvider>);
    });
    const start = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Start'));
    expect(start).toBeDefined();
    await act(async () => start?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(start?.disabled).toBe(true);
    expect(container.textContent).toContain('STOPPED');
    await act(async () => rejectStart?.(new BackendApiError(409, 'conflict')));
    expect(container.textContent).toContain('Server state changed. Status has been refreshed.');
    expect(container.textContent).toContain('STOPPED');
    await act(async () => root.unmount());
  });

  it('states that 202 deletion is synchronous and world data remains on the host', () => {
    const client = { getServer: async () => server } as unknown as BackendClient;
    const queryClient = new QueryClient();
    queryClient.setQueryData(panelKeys.server(panel, profile.id, server.id), server);
    const markup = renderDetail(client, queryClient);
    expect(markup).toContain('Deletion is synchronous despite the 202 response');
    expect(markup).toContain('world data directory is retained on the host');
  });
});
