import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelSessionValue } from '@/auth/panel-session-context';
import { PanelSessionContext } from '@/auth/panel-session-context';

const mocks = vi.hoisted(() => ({ useSystemStats: vi.fn() }));

vi.mock('@/realtime/system-stats', () => ({ useSystemStats: mocks.useSystemStats }));

import { SystemMetricsPanel } from './system-metrics-panel';

const roots: Root[] = [];

const sessionValue = (role: 'ADMIN' | 'MOD'): PanelSessionValue => ({
  panel: null,
  client: null,
  info: null,
  infoError: null,
  state: { kind: 'authenticated', profile: { id: 'viewer', username: 'viewer', role } },
  signOut: async () => undefined,
  retryRestore: () => undefined,
  notifyProfileChanged: () => undefined,
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    root.unmount();
  }
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('SystemMetricsPanel', () => {
  it('renders telemetry only for administrators', async () => {
    mocks.useSystemStats.mockReturnValue({
      stats: { totalRamMb: 2_048, usedRamMb: 1_024, freeDiskMb: 3_072, cpuCount: 4 },
      lastUpdatedAt: Date.UTC(2026, 0, 1),
      connection: 'connected',
      reconnect: () => undefined,
    });
    const adminContainer = document.createElement('div');
    document.body.append(adminContainer);
    const adminRoot = createRoot(adminContainer);
    roots.push(adminRoot);

    await act(async () => {
      adminRoot.render(
        createElement(
          PanelSessionContext.Provider,
          { value: sessionValue('ADMIN') },
          createElement(SystemMetricsPanel),
        ),
      );
    });

    expect(adminContainer.textContent).toContain('Host metrics');
    expect(adminContainer.textContent).toContain('2.0 GiB');
    expect(adminContainer.textContent).toContain('Live metrics connected');

    const modContainer = document.createElement('div');
    document.body.append(modContainer);
    const modRoot = createRoot(modContainer);
    roots.push(modRoot);
    await act(async () => {
      modRoot.render(
        createElement(
          PanelSessionContext.Provider,
          { value: sessionValue('MOD') },
          createElement(SystemMetricsPanel),
        ),
      );
    });

    expect(modContainer.textContent).toBe('');
  });
});
