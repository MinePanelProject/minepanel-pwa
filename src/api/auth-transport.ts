export interface AuthTransport {
  request(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  connectRealtime(): Promise<never>;
  signOut(): Promise<void>;
}

export class HostedAuthUnavailableError extends Error {
  constructor() {
    super('Hosted authentication is unavailable until MinePanel decision D-1 is implemented.');
    this.name = 'HostedAuthUnavailableError';
  }
}

export class HostedAuthUnavailableTransport implements AuthTransport {
  async request(): Promise<Response> {
    throw new HostedAuthUnavailableError();
  }

  async connectRealtime(): Promise<never> {
    throw new HostedAuthUnavailableError();
  }

  async signOut(): Promise<void> {
    throw new HostedAuthUnavailableError();
  }
}
