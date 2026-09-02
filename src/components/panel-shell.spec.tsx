import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import { PanelSessionContext } from '@/auth/panel-session-context';
import { CompatibilityPage } from '@/pages/compatibility-page';
import { PanelShell } from './panel-shell';

const actEnvironment = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
let root: Root | null = null;
let container: HTMLDivElement | null = null;

const mount = async (state: PanelSessionValue['state']): Promise<void> => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const value: PanelSessionValue = {
    panel: { id: 'panel-a', origin: 'https://panel.example.com' },
    client: null,
    info: null,
    infoError: null,
    state,
    signOut: vi.fn().mockResolvedValue(undefined),
    retryRestore: vi.fn(),
    notifyProfileChanged: vi.fn(),
  };
  await act(async () => {
    root?.render(
      <PanelSessionContext.Provider value={value}>
        <MemoryRouter initialEntries={['/panel/panel-a']}>
          <Routes>
            <Route path="/panel/panel-a" element={<PanelShell />} />
            <Route path="/compatibility" element={<CompatibilityPage />} />
          </Routes>
        </MemoryRouter>
      </PanelSessionContext.Provider>,
    );
  });
};

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe('PanelShell compatibility guidance', () => {
  it('renders browser-specific copy and navigates to public compatibility guidance', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await mount({ kind: 'error', problem: { kind: 'incompatible', subject: 'browser', reason: 'web-locks-unavailable' } });

    expect(container?.querySelector('h1')?.textContent).toBe('Browser not supported');
    expect(container?.textContent).toContain('cross-tab locking');
    expect(container?.textContent).toContain('Learn more');
    expect(container?.textContent).toContain('Retry');
    await act(async () => {
      container?.querySelector<HTMLAnchorElement>('a[href="/compatibility"]')?.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });
    expect(container?.querySelector('h1')?.textContent).toBe('MinePanel compatibility');
  });

  it('uses protocol-specific wording for backend incompatibility', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await mount({ kind: 'error', problem: { kind: 'incompatible', subject: 'panel', reason: 'unsupported-protocol' } });

    expect(container?.querySelector('h1')?.textContent).toBe('Panel not compatible');
    expect(container?.textContent).toContain('protocol version');
    expect(container?.textContent).toContain('compatible backend version');
    expect(container?.textContent).not.toContain('partitioned-cookie');
    expect(container?.textContent).not.toContain('Browser not supported');
  });

  it('uses partitioned-auth-specific wording for backend incompatibility', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    await mount({ kind: 'error', problem: { kind: 'incompatible', subject: 'panel', reason: 'partitioned-auth-not-advertised' } });

    expect(container?.querySelector('h1')?.textContent).toBe('Panel not compatible');
    expect(container?.textContent).toContain('partitioned-cookie hosted authentication capability');
    expect(container?.textContent).toContain('Update or verify the backend deployment');
    expect(container?.textContent).not.toContain('protocol version');
  });
});

describe('CompatibilityPage', () => {
  it('renders without a saved panel session', async () => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <MemoryRouter initialEntries={['/compatibility']}>
          <CompatibilityPage />
        </MemoryRouter>,
      );
    });

    expect(container.querySelector('h1')?.textContent).toBe('MinePanel compatibility');
    expect(container.textContent).toContain('HttpOnly');
    expect(container.textContent).toContain('Web Locks');
  });
});
