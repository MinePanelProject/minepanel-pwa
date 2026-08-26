import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import { PanelSessionContext } from '@/auth/panel-session-context';
import type { ModPermissionRow, PublicUser } from '@/api/types';
import { AdminUserDetailPage } from './user-detail-page';

const roots: Root[] = [];
const modUser: PublicUser = {
  id: 'mod-1', email: 'mod@example.test', username: 'mod', googleId: null, githubId: null,
  role: 'MOD', status: 'ACTIVE', totpEnabled: false, tempPasswordExpiresAt: null,
  mustChangePassword: false, minecraftUUID: null, minecraftName: null, minecraftVerified: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
};
const grant: ModPermissionRow = {
  id: 'grant-1', userId: 'mod-1', permission: 'SERVER_LIFECYCLE', serverId: null, createdAt: '2026-01-01T00:00:00.000Z',
};

const sessionValue = (client: BackendClient): PanelSessionValue => ({
  panel: { id: 'panel-a', origin: 'https://panel.example.test' }, client, info: null, infoError: null,
  state: { kind: 'authenticated', profile: { id: 'admin-1', username: 'admin', role: 'ADMIN' } },
  signOut: async () => undefined, retryRestore: () => undefined, notifyProfileChanged: () => undefined,
});

const nextTick = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function showModal(this: HTMLDialogElement): void { this.setAttribute('open', ''); } },
    close: { configurable: true, value: function close(this: HTMLDialogElement): void { this.removeAttribute('open'); } },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

const mount = async (client: BackendClient): Promise<HTMLDivElement> => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ['/panel/panel-a/admin/users/mod-1'] },
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            PanelSessionContext.Provider,
            { value: sessionValue(client) },
            createElement(Routes, null, createElement(Route, { path: '/panel/:panelId/admin/users/:userId', Component: AdminUserDetailPage })),
          ),
        ),
      ),
    );
  });
  await act(async () => {
    await nextTick();
  });
  return container;
};

const buttonByText = (container: ParentNode, text: string): HTMLButtonElement => {
  const button = Array.from(container.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Button not found: ${text}`);
  return button;
};

describe('AdminUserDetailPage MOD permissions', () => {
  it('grants global MOD permissions and refreshes the permissions list', async () => {
    const listUsers = vi.fn(() => Promise.resolve([modUser]));
    const listModPermissions = vi.fn(() => Promise.resolve([]));
    const grantModPermission = vi.fn(() => Promise.resolve(grant));
    const client = { listUsers, listModPermissions, grantModPermission } as unknown as BackendClient;
    const container = await mount(client);
    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Permission form not found');

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const dialog = Array.from(document.querySelectorAll('dialog')).find((candidate) => candidate.textContent?.includes('Grant MOD permission'));
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('Grant confirmation not found');
    await act(async () => {
      buttonByText(dialog, 'Grant permission').click();
      await nextTick();
    });

    expect(grantModPermission).toHaveBeenCalledWith('mod-1', { permission: 'SERVER_LIFECYCLE', serverId: null });
    expect(listModPermissions.mock.calls.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('MOD permission granted.');
  });

  it('revokes a scoped permission and refreshes its authoritative list', async () => {
    const scopedGrant = { ...grant, serverId: 'server-9' };
    const listUsers = vi.fn(() => Promise.resolve([modUser]));
    const listModPermissions = vi.fn(() => Promise.resolve([scopedGrant]));
    const revokeModPermission = vi.fn(() => Promise.resolve());
    const client = { listUsers, listModPermissions, revokeModPermission } as unknown as BackendClient;
    const container = await mount(client);

    expect(container.textContent).toContain('Server scope — server-9');
    await act(async () => {
      buttonByText(container, 'Revoke').click();
    });
    await act(async () => {
      buttonByText(document, 'Revoke permission').click();
      await nextTick();
    });

    expect(revokeModPermission).toHaveBeenCalledWith('mod-1', 'grant-1');
    expect(listModPermissions.mock.calls.length).toBeGreaterThan(1);
    expect(container.textContent).toContain('MOD permission revoked.');
  });
});
