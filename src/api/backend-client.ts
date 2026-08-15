import { BackendClientError } from './errors';
import { validatePanelOrigin } from '@/instances/origin-validation';

export type PanelInfo = {
  name: string;
  version: string;
};

type FetchImplementation = typeof fetch;

const isPanelInfo = (value: unknown): value is PanelInfo => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const info = value as Record<string, unknown>;
  return typeof info.name === 'string' && typeof info.version === 'string';
};

export class BackendClient {
  readonly origin: string;

  constructor(origin: string, private readonly fetchImplementation: FetchImplementation = fetch) {
    this.origin = validatePanelOrigin(origin);
  }

  async getInfo(signal?: AbortSignal): Promise<PanelInfo> {
    const url = new URL('/api/info', this.origin);
    let response: Response;

    try {
      response = await this.fetchImplementation(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        signal,
        headers: { Accept: 'application/json' },
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new BackendClientError(
        'unreachable',
        'The panel could not be reached. Check its HTTPS address, certificate, and CORS configuration.',
      );
    }

    if (response.status >= 500) {
      throw new BackendClientError('unavailable', 'The panel is currently unavailable. Try again later.');
    }

    if (!response.ok) {
      throw new BackendClientError('unexpected-response', 'The address did not return MinePanel panel info.');
    }

    let value: unknown;

    try {
      value = await response.json();
    } catch {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid response.');
    }

    if (!isPanelInfo(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an unsupported info response.');
    }

    return value;
  }
}
