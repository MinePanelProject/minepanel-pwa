import type { BackendClient, PanelInfo } from '@/api/backend-client';
import { BackendApiError, BackendClientError } from '@/api/errors';
import type { AuthProfile, LoginInput, PublicUser, RegisterInput } from '@/api/types';
import { hasRefreshLockSupport, refreshWithBroker } from './refresh-broker';
import type { ShellSession } from './panel-session-context';

export type SessionControllerOptions = {
  client: BackendClient;
  onState: (state: ShellSession) => void;
  onInfo: (info: PanelInfo | null, error: unknown) => void;
  onBoundary: () => void;
  /** Server-wide session termination (logout-all, ban, forced recovery). */
  onWholeSessionEnded?: () => void;
};

const refreshFailureCodes = new Set([
  'RefreshTokenMissing',
  'RefreshTokenMalformed',
  'RefreshTokenExpired',
  'RefreshTokenInvalid',
  'TokenWrongPurpose',
]);

const profileForShell = (profile: AuthProfile): Extract<ShellSession, { kind: 'authenticated' }> => ({
  kind: 'authenticated',
  profile: {
    id: profile.id,
    username: profile.username,
    role: profile.role,
  },
});

const isCapabilityCompatible = (info: PanelInfo): boolean =>
  info.api.protocolVersion === 1 && info.capabilities.auth.partitionedCookies;

const isApiCode = (error: unknown, code: string): boolean =>
  error instanceof BackendApiError && error.code === code;

const isUnavailable = (error: unknown): boolean =>
  error instanceof BackendClientError && error.kind !== 'invalid-response' && error.kind !== 'unexpected-response';
/**
 * Owns the ephemeral shell identity for exactly one panel. It deliberately
 * exposes no token state and is the sole refresh caller through the broker.
 */
export class SessionController {
  private state: ShellSession = { kind: 'loading' };
  private info: PanelInfo | null = null;
  private disposed = false;
  private operation = 0;
  private hadAuthenticatedSession = false;

  constructor(private readonly options: SessionControllerOptions) {}

  get currentState(): ShellSession {
    return this.state;
  }

  get panelInfo(): PanelInfo | null {
    return this.info;
  }

  /**
   * Terminally invalid refresh session (external-review Finding 1): the
   * refresh coordinator proved this panel's session cannot be restored. Leave
   * the authenticated state, run the panel boundary (query scope cancel +
   * removal, stale socket teardown follows from the state change), and show
   * the expired presentation. Idempotent: later terminal notifications are
   * ignored once the shell is no longer authenticated.
   */
  handleTerminalRefresh(): void {
    if (this.state.kind === 'authenticated') {
      this.hadAuthenticatedSession = false;
      this.options.onBoundary();
      this.setState({ kind: 'error', reason: 'expired' });
    }
  }

  /** Another tab reported a server-wide session termination. */
  handleWholeSessionEnded(): void {
    if (this.state.kind === 'authenticated' || this.state.kind === 'error') {
      this.hadAuthenticatedSession = false;
      this.options.onBoundary();
      this.setState({ kind: 'anonymous' });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.operation += 1;
  }

  async start(): Promise<void> {
    this.disposed = false;
    const operation = ++this.operation;
    this.setState({ kind: 'loading' });
    try {
      const info = await this.options.client.getInfo();
      if (!this.isCurrent(operation)) return;
      this.info = info;
      this.options.onInfo(info, null);
      if (!isCapabilityCompatible(info) || !hasRefreshLockSupport()) {
        this.setState({ kind: 'error', reason: 'incompatible' });
        return;
      }
      await this.restore(operation);
    } catch (error) {
      if (!this.isCurrent(operation)) return;
      this.info = null;
      this.options.onInfo(null, error);
      this.setState({ kind: 'error', reason: isUnavailable(error) ? 'offline' : 'incompatible' });
    }
  }

  retryRestore = (): void => {
    void this.start();
  };

  async restoreProfile(): Promise<void> {
    const operation = ++this.operation;
    await this.restore(operation);
  }

  async login(input: LoginInput): Promise<void> {
    this.ensureCompatible();
    try {
      const result = await this.options.client.login(input);
      if ('requiresTwoFactor' in result) {
        this.setState({ kind: 'two-factor-pending', preAuthToken: result.preAuthToken });
        return;
      }
      this.options.onBoundary();
      if (result.mustChangePassword) {
        this.setState({ kind: 'password-change-required' });
        return;
      }
      await this.restoreProfile();
    } catch (error) {
      this.mapTerminalError(error, false);
      throw error;
    }
  }

  async register(input: RegisterInput): Promise<void> {
    this.ensureCompatible();
    await this.options.client.register(input);
  }

  beginGoogleRestore(): void {
    this.options.onBoundary();
    void this.restoreProfile();
  }

  async verifyTwoFactor(token: string): Promise<void> {
    if (this.state.kind !== 'two-factor-pending') {
      throw new Error('Two-factor verification is not pending.');
    }
    const preAuthToken = this.state.preAuthToken;
    this.setState({ kind: 'loading' });
    try {
      await this.options.client.verifyTwoFactor(token, preAuthToken);
      this.options.onBoundary();
      await this.restoreProfile();
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 401) {
        this.setState({ kind: 'two-factor-pending', preAuthToken });
      } else if (
        isApiCode(error, 'PasswordChangeRequired') ||
        isApiCode(error, 'AccountPending') ||
        isApiCode(error, 'AccountBanned') ||
        isApiCode(error, 'CsrfOriginForbidden') ||
        error instanceof BackendClientError && error.kind === 'invalid-response'
      ) {
        this.mapTerminalError(error, false);
      } else {
        this.setState({ kind: 'two-factor-pending', preAuthToken });
      }
      throw error;
    }
  }

  async signOut(): Promise<void> {
    await this.options.client.logout();
    this.hadAuthenticatedSession = false;
    this.options.onBoundary();
    this.setState({ kind: 'anonymous' });
  }

  async signOutAll(): Promise<void> {
    await this.options.client.logoutAll();
    this.hadAuthenticatedSession = false;
    this.options.onBoundary();
    this.options.onWholeSessionEnded?.();
    this.setState({ kind: 'anonymous' });
  }

  transitionToPasswordChangeRequired(): void {
    this.options.onBoundary();
    this.options.onWholeSessionEnded?.();
    this.setState({ kind: 'password-change-required' });
  }

  notifyProfileChanged = (): void => {
    void this.restoreProfile();
  };

  private async restore(operation: number): Promise<void> {
    try {
      const profile = await this.options.client.getProfile();
      if (!this.isCurrent(operation)) return;
      if (profile !== null) {
        this.hadAuthenticatedSession = true;
        this.setState(profileForShell(profile));
        return;
      }

      const outcome = await refreshWithBroker(this.options.client);
      if (!this.isCurrent(operation)) return;
      if (outcome.kind === 'profile') {
        this.hadAuthenticatedSession = true;
        this.setState(profileForShell(outcome.profile));
        return;
      }
      if (outcome.kind === 'anonymous') {
        this.hadAuthenticatedSession = false;
        this.setState({ kind: 'anonymous' });
        return;
      }
      this.mapRefreshError(outcome.error);
    } catch (error) {
      if (!this.isCurrent(operation)) return;
      this.mapTerminalError(error, true);
    }
  }

  private mapRefreshError(error: unknown): void {
    if (error instanceof BackendApiError && error.status === 401 && refreshFailureCodes.has(error.code ?? '')) {
      // Terminal refresh failure ends the session authority: clear the
      // prior-auth marker so a later retry transitions to the anonymous
      // presentation instead of re-entering the expired loop.
      const wasAuthenticated = this.hadAuthenticatedSession;
      this.hadAuthenticatedSession = false;
      this.options.onBoundary();
      this.setState(wasAuthenticated ? { kind: 'error', reason: 'expired' } : { kind: 'anonymous' });
      return;
    }
    this.mapTerminalError(error, true);
  }

  private mapTerminalError(error: unknown, restoring: boolean): void {
    if (isApiCode(error, 'PasswordChangeRequired')) {
      this.options.onBoundary();
      this.options.onWholeSessionEnded?.();
      this.setState({ kind: 'password-change-required' });
      return;
    }
    if (isApiCode(error, 'AccountPending')) {
      this.options.onBoundary();
      this.setState({ kind: 'account-pending' });
      return;
    }
    if (isApiCode(error, 'AccountBanned')) {
      this.options.onBoundary();
      this.options.onWholeSessionEnded?.();
      this.setState({ kind: 'account-banned' });
      return;
    }
    if (isApiCode(error, 'CsrfOriginForbidden') || error instanceof BackendClientError && error.kind === 'invalid-response') {
      this.options.onBoundary();
      this.setState({ kind: 'error', reason: 'incompatible' });
      return;
    }
    if (restoring && (isUnavailable(error) || error instanceof BackendApiError && error.status >= 500)) {
      this.setState({ kind: 'error', reason: 'offline' });
      return;
    }
    if (restoring) {
      this.options.onBoundary();
      this.setState({ kind: 'error', reason: 'incompatible' });
    }
  }

  private ensureCompatible(): void {
    if (this.info === null || !isCapabilityCompatible(this.info) || !hasRefreshLockSupport()) {
      this.setState({ kind: 'error', reason: 'incompatible' });
      throw new Error('This panel cannot safely use hosted cookie authentication in this browser.');
    }
  }

  private isCurrent(operation: number): boolean {
    return !this.disposed && operation === this.operation;
  }

  private setState(state: ShellSession): void {
    if (this.disposed) return;
    this.state = state;
    this.options.onState(state);
  }
}

export const shellProfileFromLogin = (user: PublicUser): ShellSession | null =>
  user.mustChangePassword ? { kind: 'password-change-required' } : null;
