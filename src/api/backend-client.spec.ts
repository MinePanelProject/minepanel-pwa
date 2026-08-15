import { describe, expect, it, vi } from 'vitest';
import { BackendClient } from './backend-client';
import { BackendClientError } from './errors';

describe('BackendClient', () => {
  it('probes the selected backend with an isolated no-store public request', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ name: 'Home panel', version: '1.0' }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getInfo()).resolves.toEqual({ name: 'Home panel', version: '1.0' });

    const [url, init] = fetchImplementation.mock.calls[0]!;
    expect(url.toString()).toBe('https://panel.example.com/api/info');
    expect(init).toMatchObject({
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
  });

  it('does not join a path from one panel onto another selected origin', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async () => {
      return new Response(JSON.stringify({ name: 'Second panel', version: '1.0' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const first = new BackendClient('https://first.example.com', fetchImplementation);
    const second = new BackendClient('https://second.example.com', fetchImplementation);

    await first.getInfo();
    await second.getInfo();

    expect(fetchImplementation.mock.calls[0]![0].toString()).toBe('https://first.example.com/api/info');
    expect(fetchImplementation.mock.calls[1]![0].toString()).toBe('https://second.example.com/api/info');
  });

  it('maps network failures to a safe error without exposing browser internals', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError('Failed to fetch: internal browser detail'));
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getInfo()).rejects.toEqual(
      expect.objectContaining<Partial<BackendClientError>>({
        kind: 'unreachable',
        message: 'The panel could not be reached. Check its HTTPS address, certificate, and CORS configuration.',
      }),
    );
  });

  it('rejects malformed panel-info responses', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ version: 1 })));
    const client = new BackendClient('https://panel.example.com', fetchImplementation);

    await expect(client.getInfo()).rejects.toEqual(
      expect.objectContaining<Partial<BackendClientError>>({ kind: 'invalid-response' }),
    );
  });
});
