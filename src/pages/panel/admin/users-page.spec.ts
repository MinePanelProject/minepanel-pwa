import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendClient } from '@/api/backend-client';
import { BackendApiError } from '@/api/errors';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import { PanelSessionContext } from '@/auth/panel-session-context';
import type { PublicUser, Role, UserStatus } from '@/api/types';
import { AdminUsersPage } from './users-page';

const roots: Root[] = [];
const users: PublicUser[] = [
  {
    id: 'user-1', email: 'admin@example.test', username: 'admin', googleId: 'google-1', githubId: null,
    role: 'ADMIN', status: 'ACTIVE', totpEnabled: true, tempPasswordExpiresAt: null,
    mustChangePassword: false, minecraftUUID: null, minecraftName: null, minecraftVerified: false,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user-2', email: 'pending@example.test', username: 'pending', googleId: null, githubId: null,
    role: 'USER', status: 'PENDING', totpEnabled: false, tempPasswordExpiresAt: null,
    mustChangePassword: false, minecraftUUID: null, minecraftName: null, minecraftVerified: false,
    createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
  },
];

const sessionValue = (client: BackendClient): PanelSessionValue => ({
  panel: { id: 'panel-a', origin: 'https://panel.example.test' },
  client,
  info: null,
  infoError: null,
  state: { kind: 'authenticated', profile: { id: 'viewer', username: 'viewer', role: 'ADMIN' } },
  signOut: async () => undefined,
  retryRestore: () => undefined,
  notifyProfileChanged: () => undefined,
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
const nextTick = (): Promise<void> =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
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
        null,
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(PanelSessionContext.Provider, { value: sessionValue(client) }, createElement(AdminUsersPage)),
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

describe('AdminUsersPage', () => {
  it('renders provider and security indicators and refetches when filters change', async () => {
    const listUsers = vi.fn((filter: { status?: UserStatus; role?: Role } = {}) =>
      Promise.resolve(users.filter((user) => (!filter.status || user.status === filter.status) && (!filter.role || user.role === filter.role))),
    );
    const client = { listUsers } as unknown as BackendClient;
    const container = await mount(client);

    expect(container.textContent).toContain('admin@example.test');
    expect(container.textContent).toContain('Google linked');
    expect(container.textContent).toContain('2FA enabled');

    const statusFilter = container.querySelector('#user-status-filter');
    if (!(statusFilter instanceof HTMLSelectElement)) throw new Error('Status filter not found');
    await act(async () => {
      statusFilter.value = 'PENDING';
      statusFilter.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      await nextTick();
    });

    expect(listUsers).toHaveBeenLastCalledWith({ status: 'PENDING', role: undefined });
    expect(container.textContent).toContain('pending@example.test');
    expect(container.textContent).not.toContain('admin@example.test');
  });

  it('presents a last-admin conflict after a role update and refetches authoritative users', async () => {
    const listUsers = vi.fn(() => Promise.resolve(users));
    const updateUserRole = vi.fn(() => Promise.reject(new BackendApiError(409, 'Last active administrator')));
    const client = { listUsers, updateUserRole } as unknown as BackendClient;
    const container = await mount(client);
    const roleSelect = container.querySelector('#role-user-1');
    if (!(roleSelect instanceof HTMLSelectElement)) throw new Error('Role control not found');

    await act(async () => {
      roleSelect.value = 'MOD';
      roleSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      buttonByText(document, 'Save role').click();
    });
    await act(async () => {
      await nextTick();
    });

    expect(updateUserRole).toHaveBeenCalledWith('user-1', 'MOD');
    expect(container.textContent).toContain('State changed. The latest user records have been reloaded.');
    expect(listUsers.mock.calls.length).toBeGreaterThan(1);
  });

  it('shows a password reset result once with expiry and session-revocation guidance', async () => {
    const listUsers = vi.fn(() => Promise.resolve(users));
    const resetPassword = vi.fn(() => Promise.resolve({ tempPassword: 'one-time-password' }));
    const client = { listUsers, resetPassword } as unknown as BackendClient;
    const container = await mount(client);

    await act(async () => {
      buttonByText(container, 'Reset password').click();
    });
    const dialog = document.querySelector('dialog');
    if (!(dialog instanceof HTMLDialogElement)) throw new Error('Reset confirmation not found');
    await act(async () => {
      buttonByText(dialog, 'Reset password').click();
      await nextTick();
    });
    expect(resetPassword).toHaveBeenCalledWith('user-1');
    expect(container.textContent).toContain('one-time-password');
    expect(container.textContent).toContain('Use within 24 hours. It forces a password change and revokes all sessions.');
  });
});
