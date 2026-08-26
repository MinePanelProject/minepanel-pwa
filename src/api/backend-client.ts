import { BackendClientError } from './errors';
import { validatePanelOrigin } from '@/instances/origin-validation';

export type PanelCapabilities = {
  auth: {
    partitionedCookies: boolean;
    pkceAuthorizationCode: boolean;
    googleOAuth: boolean;
  };
  realtime: {
    websocketTicket: boolean;
  };
};

export type PanelInfo = {
  name: string;
  version: string;
  api: {
    protocolVersion: number;
  };
  capabilities: PanelCapabilities;
};

export type AuthenticatedProfile = {
  id: string;
  username: string;
  role: string;
  temporaryAuth?: boolean;
};

export type GoogleLoginResult =
  | { status: 'Authenticated' }
  | { status: 'LinkConfirmationRequired' };

type FetchImplementation = typeof fetch;

const isPanelInfo = (value: unknown): value is PanelInfo => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const info = value as {
    name?: unknown;
    version?: unknown;
    api?: { protocolVersion?: unknown };
    capabilities?: {
      auth?: {
        partitionedCookies?: unknown;
        pkceAuthorizationCode?: unknown;
        googleOAuth?: unknown;
      };
      realtime?: { websocketTicket?: unknown };
    };
  };
  return (
    typeof info.name === 'string' &&
    typeof info.version === 'string' &&
    typeof info.api?.protocolVersion === 'number' &&
    typeof info.capabilities?.auth?.partitionedCookies === 'boolean' &&
    typeof info.capabilities.auth.pkceAuthorizationCode === 'boolean' &&
    typeof info.capabilities.auth.googleOAuth === 'boolean' &&
    typeof info.capabilities.realtime?.websocketTicket === 'boolean'
  );
};

const isAuthenticatedProfile = (value: unknown): value is AuthenticatedProfile => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const profile = value as {
    id?: unknown;
    username?: unknown;
    role?: unknown;
    temporaryAuth?: unknown;
  };
  return (
    typeof profile.id === 'string' &&
    typeof profile.username === 'string' &&
    typeof profile.role === 'string' &&
    (profile.temporaryAuth === undefined || typeof profile.temporaryAuth === 'boolean')
  );
};
export const supportsGoogleLogin = (info: PanelInfo, googleClientId: string): boolean =>
  info.api.protocolVersion === 1 && info.capabilities.auth.googleOAuth && googleClientId.trim().length > 0;

export class BackendClient {
  readonly origin: string;

  constructor(origin: string, private readonly fetchImplementation: FetchImplementation = fetch) {
    this.origin = validatePanelOrigin(origin);
  }

  async getInfo(signal?: AbortSignal): Promise<PanelInfo> {
    const response = await this.request('/api/info', {
      method: 'GET',
      credentials: 'omit',
      signal,
    });

    if (response.status >= 500) {
      throw new BackendClientError('unavailable', 'The panel is currently unavailable. Try again later.');
    }

    if (!response.ok) {
      throw new BackendClientError('unexpected-response', 'The address did not return MinePanel panel info.');
    }

    const value = await this.json(response);
    if (!isPanelInfo(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an unsupported info response.');
    }

    return value;
  }

  async createGoogleChallenge(signal?: AbortSignal): Promise<string> {
    const response = await this.request('/api/auth/oauth/challenge', {
      method: 'POST',
      credentials: 'omit',
      body: JSON.stringify({ provider: 'google' }),
      signal,
    });
    const value = await this.json(response);

    if (
      !response.ok ||
      value === null ||
      typeof value !== 'object' ||
      !('challenge' in value) ||
      typeof value.challenge !== 'string'
    ) {
      throw new BackendClientError('unexpected-response', 'Google sign-in could not be started for this panel.');
    }

    return value.challenge;
  }

  async loginWithGoogle(credential: string, signal?: AbortSignal): Promise<GoogleLoginResult> {
    const response = await this.request('/api/auth/oauth/google/login', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ credential }),
      signal,
    });
    const value = await this.json(response);

    if (!response.ok) {
      throw new BackendClientError('unexpected-response', 'Google sign-in was not accepted by this panel.');
    }

    if (value !== null && typeof value === 'object') {
      if ('status' in value && value.status === 'LinkConfirmationRequired') {
        return { status: 'LinkConfirmationRequired' };
      }
      if ('id' in value && typeof value.id === 'string') {
        return { status: 'Authenticated' };
      }
    }

    throw new BackendClientError('invalid-response', 'The panel returned an invalid Google sign-in response.');
  }

  async linkGoogleAccount(credential: string, signal?: AbortSignal): Promise<void> {
    const response = await this.request('/api/auth/oauth/google/link', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify({ credential }),
      signal,
    });

    if (!response.ok) {
      throw new BackendClientError('unexpected-response', 'Google account linking was not accepted by this panel.');
    }
  }

  async getProfile(signal?: AbortSignal): Promise<AuthenticatedProfile | null> {
    const response = await this.request('/api/auth/profile', {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (response.status === 401) {
      return null;
    }

    const value = await this.json(response);
    if (!response.ok || !isAuthenticatedProfile(value)) {
      throw new BackendClientError('unexpected-response', 'The panel could not restore this browser session.');
    }

    return value;
  }

  async logout(signal?: AbortSignal): Promise<void> {
    const response = await this.request('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      signal,
    });

    if (!response.ok && response.status !== 401) {
      throw new BackendClientError('unexpected-response', 'The panel could not end this browser session.');
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = new URL(path, this.origin);
    try {
      return await this.fetchImplementation(url, {
        ...init,
        mode: 'cors',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
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
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid response.');
    }
  }
}
