import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest';
import type { InstanceRegistry } from '@/instances/instance-registry';
import { InstanceRegistryContext } from '@/instances/instance-registry-context';
import { AddPanelPage } from './add-panel-page';
type AddInstanceMock = Mock<(input: { origin: string; label?: string }) => Promise<unknown>>;
// React's act() is a no-op unless this process global is set; @types/react does
// not declare it, so an unchecked cast is required.
const globalWithActEnvironment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean };
const setActEnvironment = (enabled: boolean): void => {
  globalWithActEnvironment.IS_REACT_ACT_ENVIRONMENT = enabled;
};

const panelInfo = {
  name: 'MinePanel',
  version: '1',
  api: { protocolVersion: 1 },
  capabilities: {
    auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false },
    realtime: { websocketTicket: false },
  },
};

const origin = 'https://panel.example.com';

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let originalFetch: typeof fetch;
let registryAdd: AddInstanceMock;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  registryAdd = vi.fn();
  setActEnvironment(true);
});

afterEach(async () => {
  setActEnvironment(false);
  globalThis.fetch = originalFetch;
  root?.unmount();
  root = null;
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

const mountPage = async (): Promise<void> => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      <InstanceRegistryContext.Provider value={{ add: registryAdd } as unknown as InstanceRegistry}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={['/add']}>
            <AddPanelPage />
          </MemoryRouter>
        </QueryClientProvider>
      </InstanceRegistryContext.Provider>,
    );
  });
};

const fillAndSubmit = async (): Promise<void> => {
  const input = container!.querySelector<HTMLInputElement>('input[name="panel-origin"]');
  expect(input).not.toBeNull();
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, origin);
    input!.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    container!.querySelector('form')!.requestSubmit();
  });
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const alertText = (): string | undefined => container!.querySelector('[role="alert"]')?.textContent ?? undefined;

const okProbe = (): void => {
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify(panelInfo), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    )) as typeof fetch;
};

describe('AddPanelPage error classification (probe vs local save)', () => {
  it('labels probe/network failures as unreachable and never attempts a local save', async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch;
    await mountPage();
    await fillAndSubmit();
    await flush();

    expect(alertText()).toContain('The panel could not be reached');
    expect(registryAdd).not.toHaveBeenCalled();
  });

  it('preserves the duplicate-panel message without mislabeling it as a probe failure', async () => {
    okProbe();
    registryAdd = vi.fn().mockRejectedValue(new Error('This panel is already saved.'));
    await mountPage();
    await fillAndSubmit();
    await flush();

    expect(alertText()).toBe('This panel is already saved.');
  });

  it('uses a local-save message for unexpected persistence failures', async () => {
    okProbe();
    registryAdd = vi.fn().mockRejectedValue(new Error('QuotaExceededError'));
    await mountPage();
    await fillAndSubmit();
    await flush();

    expect(alertText()).toBe('The panel responded correctly, but it could not be saved on this device.');
  });

  it('saves and reports no error when the probe and the local save succeed', async () => {
    okProbe();
    registryAdd = vi.fn().mockResolvedValue({
      id: 'panel-1',
      origin,
      createdAt: '2026-08-26T00:00:00.000Z',
      lastUsedAt: '2026-08-26T00:00:00.000Z',
    });
    await mountPage();
    await fillAndSubmit();
    await flush();

    expect(registryAdd).toHaveBeenCalledWith({ origin });
    expect(alertText()).toBeUndefined();
    expect(container!.querySelector('button')?.disabled).toBe(false);
  });
});