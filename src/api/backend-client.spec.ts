import { describe, expect, it, vi } from 'vitest';
import { BackendClient, supportsGoogleLogin, type PanelInfo } from './backend-client';
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
