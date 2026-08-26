import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendClient, supportsGoogleLogin, supportsRequestableDiscovery, type PanelInfo } from './backend-client';
import { BackendClientError } from './errors';

const panelInfo = (overrides: Partial<PanelInfo> = {}): PanelInfo => ({
  name: 'Home panel',
  version: '1.0',
  api: { protocolVersion: 1 },
  capabilities: {
    auth: {
      partitionedCookies: true,
      pkceAuthorizationCode: false,
      googleOAuth: true,
    },
    realtime: { websocketTicket: false },
    servers: { requestableDiscovery: true },
  },
  ...overrides,
});

describe('BackendClient', () => {
  it('parses the complete protocol-1 capability contract and gates Google login explicitly', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(panelInfo()), { headers: { 'Content-Type': 'application/json' } }),
    );
    const info = await new BackendClient('https://panel.example.com', fetchImplementation).getInfo();

    expect(info.capabilities.auth).toEqual({
      partitionedCookies: true,
      pkceAuthorizationCode: false,
      googleOAuth: true,
    });
    expect(supportsGoogleLogin(info, 'client.apps.googleusercontent.com')).toBe(true);
    expect(supportsGoogleLogin(panelInfo({ capabilities: { ...panelInfo().capabilities, auth: { ...panelInfo().capabilities.auth, googleOAuth: false } } }), 'client.apps.googleusercontent.com')).toBe(false);
    expect(supportsGoogleLogin(panelInfo({ api: { protocolVersion: 2 } }), 'client.apps.googleusercontent.com')).toBe(false);
    expect(supportsGoogleLogin(info, '')).toBe(false);
  });

  it('probes the selected backend with an isolated no-store public request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(panelInfo()), { headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getInfo()).resolves.toEqual(panelInfo());

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url.toString()).toBe('https://panel.example.com/api/info');
    expect(init).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });

  it('creates a Google challenge without browser credentials and sends the exact provider payload', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ challenge: 'A'.repeat(43) }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.createGoogleChallenge()).resolves.toBe('A'.repeat(43));

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url.toString()).toBe('https://panel.example.com/api/auth/oauth/challenge');
    expect(init).toMatchObject({ credentials: 'omit', body: JSON.stringify({ provider: 'google' }) });
  });

  it('uses the selected origin independently for authenticated browser-cookie requests', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async () =>
      new Response(JSON.stringify({ id: 'user-1' }), { headers: { 'Content-Type': 'application/json' } }),
    );
    const first = new BackendClient('https://first.example.com', fetchImplementation);
    const second = new BackendClient('https://second.example.com', fetchImplementation);

    await first.loginWithGoogle('first-google-credential');
    await second.loginWithGoogle('second-google-credential');

    expect(fetchImplementation.mock.calls.map(([url]) => url.toString())).toEqual([
      'https://first.example.com/api/auth/oauth/google/login',
      'https://second.example.com/api/auth/oauth/google/login',
    ]);
    expect(fetchImplementation.mock.calls.map(([, init]) => init?.credentials)).toEqual(['include', 'include']);
    expect(fetchImplementation.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify({ credential: 'first-google-credential' }),
      JSON.stringify({ credential: 'second-google-credential' }),
    ]);
  });

  it('maps CORS or network failures to a safe error without exposing browser internals', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch: internal browser detail'));
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.createGoogleChallenge()).rejects.toEqual(
      expect.objectContaining<Partial<BackendClientError>>({
        kind: 'unreachable',
        message: 'The panel could not be reached. Check its HTTPS address, certificate, and CORS configuration.',
      }),
    );
  });

  it('rejects malformed panel-info responses', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ version: 1 })));
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getInfo()).rejects.toEqual(
      expect.objectContaining<Partial<BackendClientError>>({ kind: 'invalid-response' }),
    );
  });
});

describe('authorized-request refresh coordinator (HIGH regression)', () => {
  const installLocks = (): void => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback(),
      },
    });
  };

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('rotates cookies once through the broker and replays a rejected read exactly once', async () => {
    installLocks();
    // Sequence for listServers after restore: 401, then refresh endpoint 200,
    // then profile 200 (broker recheck), then the replayed list 200.
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers')) {
        const priorServerCalls = fetchImplementation.mock.calls.filter(([call]) => String(call).includes('/api/servers')).length;
        if (priorServerCalls > 1) {
          return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized', message: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(null, { status: 200 });
      }
      if (url.endsWith('/api/auth/profile')) {
        const priorProfileCalls = fetchImplementation.mock.calls.filter(([call]) => String(call).includes('/api/auth/profile')).length;
        if (priorProfileCalls === 1) {
          return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'user-a', username: 'alex', role: 'USER' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    const result = await client.listServers();
    expect(result).toEqual({ data: [], total: 0 });
    const refreshCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    const listCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).includes('/api/servers'));
    expect(listCalls).toHaveLength(2);
  });

  it('never replays a wrong-credential login through the broker', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 401, message: 'Wrong credentials' }), { status: 401, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.login({ identifier: 'alex', password: 'bad' })).rejects.toMatchObject({ code: 'WrongCredentials' });
    const loginCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/login'));
    expect(loginCalls).toHaveLength(1);
  });
});

describe('state boundaries and access-request coordinator (Finding 1 / Finding 7 regression)', () => {
  const installLocks = (): void => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async <T>(_name: string, _options: { mode: 'exclusive' }, callback: () => Promise<T>) => callback(),
      },
    });
  };

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('terminal refresh: no replay, original 401 thrown, and onSessionTerminal fires', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/profile')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'RefreshTokenExpired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);
    const terminal = vi.fn();
    client.onSessionTerminal = terminal;

    await expect(client.listServers()).rejects.toMatchObject({ status: 401 });
    expect(terminal).toHaveBeenCalledOnce();
    const serverCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/servers'));
    expect(serverCalls).toHaveLength(1);
    const refreshCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('concurrent 401s produce one refresh attempt and each caller surfaces the 401', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/profile')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'RefreshTokenExpired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);
    client.onSessionTerminal = vi.fn();

    await Promise.allSettled([client.listServers(), client.listServers(), client.listServers()]);
    const refreshCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
    const serverCalls = fetchImplementation.mock.calls.filter(([url]) => String(url).endsWith('/api/servers'));
    expect(serverCalls).toHaveLength(3);
  });

  it('semantic 400 mutation failures are never replayed', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ statusCode: 400, error: 'Bad Request', message: 'Invalid two-factor code' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);
    client.onSessionTerminal = vi.fn();

    await expect(client.confirmTwoFactor('000000')).rejects.toMatchObject({ status: 400 });
    const totalCalls = fetchImplementation.mock.calls.length;
    expect(totalCalls).toBe(1);
  });

  it('getMyAccessRequest replays once after refresh and resolves 404 to null', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers/server-a/my-access-request')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/my-access-request')).length;
        if (prior > 1) {
          return new Response(JSON.stringify({ statusCode: 404, error: 'Not Found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/profile')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/api/auth/profile')).length;
        if (prior === 1) {
          return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'user-a', username: 'alex', role: 'USER' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getMyAccessRequest('server-a')).resolves.toBeNull();
    const accessCalls = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/my-access-request'));
    expect(accessCalls).toHaveLength(2);
  });

  it('getMyAccessRequest returns authoritative PENDING after refresh replay', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers/server-a/my-access-request')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/my-access-request')).length;
        if (prior > 1) {
          return new Response(JSON.stringify({ status: 'PENDING', requestedAt: '2026-01-01T00:00:00.000Z', approvedAt: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/profile')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/api/auth/profile')).length;
        if (prior === 1) {
          return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'user-a', username: 'alex', role: 'USER' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getMyAccessRequest('server-a')).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('getMyAccessRequest terminal refresh throws and fires the boundary', async () => {
    installLocks();
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers/server-a/my-access-request') || url.endsWith('/api/auth/profile')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(JSON.stringify({ statusCode: 401, error: 'RefreshTokenExpired' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);
    const terminal = vi.fn();
    client.onSessionTerminal = terminal;

    await expect(client.getMyAccessRequest('server-a')).rejects.toMatchObject({ status: 401 });
    expect(terminal).toHaveBeenCalledOnce();
  });
});

describe('requestable server discovery (owner-approved slice)', () => {
  const installLocks = (): void => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      value: {
        request: async (_name: string, _options: { mode: string }, callback: () => Promise<unknown>) => callback(),
      },
    });
  };

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('parses the capability backward-compatibly: legacy protocol-1 info stays compatible and discovery is unsupported', async () => {
    const legacy = {
      name: 'MinePanel',
      version: '1',
      api: { protocolVersion: 1 },
      capabilities: {
        auth: { partitionedCookies: true, pkceAuthorizationCode: false, googleOAuth: false },
        realtime: { websocketTicket: false },
      },
    };
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(legacy), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);
    const info = await client.getInfo();

    // Type-level proof: a legacy wire shape without `capabilities.servers`
    // satisfies the optional capability contract and stays a valid PanelInfo.
    const typedLegacy: PanelInfo = { ...legacy };
    expect(typedLegacy.api.protocolVersion).toBe(1);

    expect(info.api.protocolVersion).toBe(1);
    expect(supportsRequestableDiscovery(info)).toBe(false);
    expect(supportsRequestableDiscovery({ ...info, capabilities: { ...info.capabilities, servers: { requestableDiscovery: true } } })).toBe(true);
  });

  it('replays GET /servers/requestable exactly once after a successful refresh', async () => {
    installLocks();
    const listResponse = { data: [{ id: 'req-1', name: 'Requestable', accessType: 'REQUEST', requestStatus: 'PENDING' }], total: 1 };
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith('/api/servers/requestable')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/servers/requestable')).length;
        if (prior === 1) {
          return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify(listResponse), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/profile')) {
        const prior = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/api/auth/profile')).length;
        if (prior === 1) {
          return new Response(JSON.stringify({ statusCode: 401, error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ id: 'user-a', username: 'alex', role: 'USER' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/auth/refresh')) {
        return new Response(null, { status: 200 });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.listRequestableServers()).resolves.toEqual(listResponse);
    const calls = fetchImplementation.mock.calls.filter(([c]) => String(c).includes('/servers/requestable'));
    expect(calls).toHaveLength(2);
  });

  it.each([
    ['non-REQUEST accessType', { data: [{ id: 'x', name: 'X', accessType: 'OPEN', requestStatus: null }], total: 1 }],
    ['invalid requestStatus', { data: [{ id: 'x', name: 'X', accessType: 'REQUEST', requestStatus: 'APPROVED' }], total: 1 }],
    ['non-string id', { data: [{ id: 7, name: 'X', accessType: 'REQUEST', requestStatus: null }], total: 1 }],
    ['non-number total', { data: [{ id: 'x', name: 'X', accessType: 'REQUEST', requestStatus: null }], total: 'one' }],
  ])('rejects a malformed requestable response: %s', async (_label, body) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.listRequestableServers()).rejects.toMatchObject({ kind: 'invalid-response' });
  });

  it('accepts additive unknown fields on requestable rows (forward-compatible response contract)', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ id: 'x', name: 'X', accessType: 'REQUEST', requestStatus: null, futureField: 'ignored' }], total: 1 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.listRequestableServers()).resolves.toMatchObject({
      data: [{ id: 'x', name: 'X', accessType: 'REQUEST', requestStatus: null }],
      total: 1,
    });
  });
});
describe('default fetch receiver binding (Firefox regression)', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('invokes the default global fetch with a safe receiver, not the BackendClient instance', async () => {
    // Receiver recorded on a property, not aliased to a local variable, so the
    // invocation `this` is observable without tripping no-this-alias.
    const probe = { receiver: undefined as unknown };
    globalThis.fetch = function (this: unknown) {
      probe.receiver = this;
      return Promise.resolve(
        new Response(JSON.stringify(panelInfo()), { headers: { 'Content-Type': 'application/json' } }),
      );
    } as typeof fetch;

    // Replaced BEFORE construction so the counterfactual (constructor captures
    // `fetch` by default and calls it as `this.fetchImplementation(...)`) stores
    // the recording function and fails the receiver assertion below.
    const client = new BackendClient('https://panel.example.com');

    await expect(client.getInfo()).resolves.toEqual(panelInfo());

    expect(probe.receiver).not.toBe(client);
    expect(probe.receiver).toBeUndefined();
  });
});
