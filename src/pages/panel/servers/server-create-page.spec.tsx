import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import { panelKeys } from '@/api/query-keys';
import { PanelSessionContext, type PanelSessionValue } from '@/auth/panel-session-context';
import { AccessSection } from './access-section';
import { createAccessPoller } from './pollers';
import { ServerCreatePage } from './server-create-page';

const panel = { id: 'panel-a', origin: 'https://panel.example.test' } as const;
const user = { id: 'user-a', username: 'player', role: 'USER' as const };
const admin = { id: 'admin-a', username: 'admin', role: 'ADMIN' as const };
const client = {} as BackendClient;

const session = (profile: typeof user | typeof admin): PanelSessionValue => ({ panel, client, info: null, infoError: null, state: { kind: 'authenticated', profile }, signOut: async () => undefined, retryRestore: () => undefined, notifyProfileChanged: () => undefined });

const renderWith = (children: React.ReactNode, value: PanelSessionValue, queryClient = new QueryClient()): string => renderToStaticMarkup(
  <QueryClientProvider client={queryClient}><PanelSessionContext.Provider value={value}><MemoryRouter initialEntries={['/panel/panel-a/servers/create']}>{children}</MemoryRouter></PanelSessionContext.Provider></QueryClientProvider>,
);

describe('server create form', () => {
  it('renders client-side constraint hints while retaining backend authority', () => {
    const markup = renderWith(<ServerCreatePage />, session(admin));
    expect(markup).toContain('1–50 characters.');
    expect(markup).toContain('Use major.minor or major.minor.patch.');
    expect(markup).toContain('25565–25665.');
    expect(markup).toContain('At least 512 MB.');
    expect(markup).toContain('The panel remains authoritative');
  });
});

describe('access requests', () => {
  it('never offers a request affordance for PRIVATE servers', () => {
    const markup = renderWith(<AccessSection serverId="server-a" accessType="PRIVATE" />, session(user));
    expect(markup).not.toContain('Request access');
  });

  it('renders request, pending, and approved states from authoritative request data', () => {
    const noRequestClient = new QueryClient();
    noRequestClient.setQueryData(panelKeys.myAccess(panel, user.id, 'server-a'), null);
    const none = renderWith(<AccessSection serverId="server-a" accessType="REQUEST" />, session(user), noRequestClient);
    expect(none).toContain('Request access');

    const pendingClient = new QueryClient();
    pendingClient.setQueryData(panelKeys.myAccess(panel, user.id, 'server-a'), { status: 'PENDING', requestedAt: '2026-01-01T00:00:00.000Z', approvedAt: null });
    expect(renderWith(<AccessSection serverId="server-a" accessType="REQUEST" />, session(user), pendingClient)).toContain('Request pending');

    const approvedClient = new QueryClient();
    approvedClient.setQueryData(panelKeys.myAccess(panel, user.id, 'server-a'), { status: 'APPROVED', requestedAt: '2026-01-01T00:00:00.000Z', approvedAt: '2026-01-01T01:00:00.000Z' });
    expect(renderWith(<AccessSection serverId="server-a" accessType="REQUEST" />, session(user), approvedClient)).toContain('approved');
  });

  it('stops pending polling at the documented cap and resumes only for a new generation', () => {
    const poller = createAccessPoller();
    for (let poll = 0; poll < 12; poll += 1) expect(poller.nextInterval('PENDING', 1_000 + poll)).toBe(5_000);
    expect(poller.nextInterval('PENDING', 2_000)).toBe(false);
    expect(poller.exhausted()).toBe(true);
    expect(poller.nextInterval('APPROVED', 3_000)).toBe(false);
    expect(poller.exhausted()).toBe(false);
  });

  it('describes revoked access as deleted, rather than inventing a DENIED state', () => {
    const markup = renderWith(<AccessSection serverId="server-a" accessType="OPEN" />, session(admin));
    expect(markup).toContain('Rejecting removes the request');
    expect(markup).not.toContain('DENIED');
  });
});
