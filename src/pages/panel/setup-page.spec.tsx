import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import { PanelSessionContext, type PanelSessionValue } from '@/auth/panel-session-context';
import { SetupPage } from './setup-page';

let container: HTMLDivElement | null = null;

afterEach(() => {
  container?.remove();
  container = null;
});

const renderSetup = async (client: Partial<BackendClient>) => {
  const value: PanelSessionValue = {
    panel: { id: 'panel-a', origin: 'https://panel.example' },
    client: client as BackendClient,
    info: { name: 'MinePanel', version: '1', api: { protocolVersion: 1 }, capabilities: { auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false }, realtime: { websocketTicket: false }, servers: { requestableDiscovery: true } } },
    infoError: null,
    state: { kind: 'anonymous' },
    signOut: async () => undefined,
    retryRestore: vi.fn(),
    notifyProfileChanged: vi.fn(),
  };
  container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter><QueryClientProvider client={new QueryClient()}><PanelSessionContext.Provider value={value}><SetupPage /></PanelSessionContext.Provider></QueryClientProvider></MemoryRouter>);
  });
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  return root;
};

describe('SetupPage secret handling', () => {
  it('reads the setup token from an uncontrolled input once and clears it after submission', async () => {
    const client = { getSetupStatus: vi.fn().mockResolvedValue({ initialAdminCreated: false, nextStep: 'register_admin' }), initSetup: vi.fn().mockResolvedValue(undefined) };
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const root = await renderSetup(client);
    const token = document.querySelector<HTMLInputElement>('#setup-token');
    expect(token).not.toBeNull();
    if (token === null) throw new Error('Setup token input was not rendered.');
    token.value = 'operator-secret';
    await act(async () => {
      token.form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(client.initSetup).toHaveBeenCalledWith(expect.any(Object), 'operator-secret');
    expect(token.value).toBe('');
    expect(setItem).not.toHaveBeenCalled();
    root.unmount();
  });
});