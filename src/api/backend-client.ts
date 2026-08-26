import { BackendClientError, parseApiError } from './errors';
import {
  ACCESS_STATUSES,
  type AccessRequest,
  type AccessStatus,
  type AuthProfile,
  type CreateServerInput,
  type GrantModPermissionInput,
  isAuthProfile,
  isMyAccessRequest,
  isPublicUser,
  isServer,
  isServerListResponse,
  isSessionRow,
  type RequestableServerProjection,
  type LoginInput,
  type ModPermissionRow,
  type MyAccessRequest,
  type PanelCapabilities,
  type PanelInfo,
  type PublicUser,
  type RegisterInput,
  type ResetPasswordResult,
  type Role,
  type Server,
  type ServerListResponse,
  type SessionRow,
  type SetupStatus,
  type TwoFactorChallenge,
  type TwoFactorConfirmResult,
  type TwoFactorSetupResult,
  type UserStatus,
} from './types';
import { validatePanelOrigin } from '@/instances/origin-validation';
import { refreshWithBroker } from '@/auth/refresh-broker';

export type GoogleLoginResult =
  | { status: 'Authenticated' }
  | { status: 'LinkConfirmationRequired' };

type FetchImplementation = typeof fetch;

type RequestOptions = {
  credentials?: RequestCredentials;
  headers?: HeadersInit;
};

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
      servers?: { requestableDiscovery?: unknown };
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

/**
 * Backward-compatible requestable-discovery capability (owner slice): an older
 * protocol-1 backend that omits `capabilities.servers` must remain a fully
 * usable panel; only the discovery UI is disabled.
 */
export const supportsRequestableDiscovery = (info: PanelInfo): boolean =>
  info.api.protocolVersion === 1 && info.capabilities.servers?.requestableDiscovery === true;

const isRequestableServer = (value: unknown): value is RequestableServerProjection => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const row = value as { id?: unknown; name?: unknown; accessType?: unknown; requestStatus?: unknown };
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    row.accessType === 'REQUEST' &&
    (row.requestStatus === null || row.requestStatus === 'PENDING')
  );
};

const isTwoFactorChallenge = (value: unknown): value is TwoFactorChallenge => {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const challenge = value as { requiresTwoFactor?: unknown; preAuthToken?: unknown };
  return (
    challenge.requiresTwoFactor === true && typeof challenge.preAuthToken === 'string'
  );
};

export const supportsGoogleLogin = (info: PanelInfo, googleClientId: string): boolean =>
  info.api.protocolVersion === 1 && info.capabilities.auth.googleOAuth && googleClientId.trim().length > 0;

/**
 * Browser-to-backend client for one canonical panel origin. Every
 * authenticated request uses `credentials: 'include'` and browser-managed
 * HttpOnly cookies; no MinePanel token ever passes through JavaScript.
 */
export class BackendClient {
  readonly origin: string;

  /**
   * Panel-scoped session-boundary callback (Finding 1). Called exactly once
   * when the refresh coordinator proves the session is terminally invalid
   * (refresh outcome anonymous/error) for an authenticated request. The
   * session authority (SessionController) must leave the authenticated state,
   * cancel/remove the panel query scope, and terminate the socket. This is an
   * injected per-instance callback — each BackendClient belongs to exactly one
   * validated panel origin, so no global singleton exists.
   */
  onSessionTerminal: (() => void) | null = null;

  constructor(origin: string, private readonly fetchImplementation: FetchImplementation = fetch) {
    this.origin = validatePanelOrigin(origin);
  }

  // --- Public capability probe (credentials omitted, no-store) ---

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

  // --- Setup (public, X-Setup-Token held by the caller in memory only) ---

  async getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
    const response = await this.ensureOk(
      '/api/setup/status',
      { method: 'GET', credentials: 'omit', signal },
    );
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (value as { initialAdminCreated?: unknown }).initialAdminCreated !== 'boolean' ||
      !['register_admin', 'complete'].includes((value as { nextStep?: unknown }).nextStep as string)
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an unsupported setup status.');
    }

    return value as SetupStatus;
  }

  async initSetup(input: RegisterInput, setupToken: string): Promise<void> {
    await this.ensureOk(
      '/api/setup/init',
      {
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify(input),
      },
      { headers: { 'X-Setup-Token': setupToken } },
      false,
    );
  }

  // --- Auth ---

  async register(input: RegisterInput, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(
      '/api/auth/register',
      { method: 'POST', credentials: 'omit', body: JSON.stringify(input), signal },
      undefined,
      false,
    );
  }

  async login(input: LoginInput, signal?: AbortSignal): Promise<PublicUser | TwoFactorChallenge> {
    const response = await this.ensureOk(
      '/api/auth/login',
      { method: 'POST', credentials: 'include', body: JSON.stringify(input), signal },
      undefined,
      false,
    );
    const value = await this.json(response);

    if (isTwoFactorChallenge(value)) {
      return value;
    }

    if (isPublicUser(value)) {
      return value;
    }

    throw new BackendClientError('invalid-response', 'The panel returned an invalid sign-in response.');
  }

  /**
   * Completes a 2FA login using the five-minute pre-auth token as a Bearer
   * header. The token lives only in the session controller's memory.
   */
  async verifyTwoFactor(token: string, preAuthToken: string, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(
      '/api/auth/2fa/verify',
      { method: 'POST', credentials: 'omit', body: JSON.stringify({ token }), signal },
      { headers: { Authorization: `Bearer ${preAuthToken}` } },
      false,
    );
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid two-factor response.');
    }

    return value;
  }

  /** Rotates the refresh cookie. Only the session controller may call this. */
  async refresh(signal?: AbortSignal): Promise<void> {
    await this.ensureOk('/api/auth/refresh', { method: 'POST', credentials: 'include', signal }, undefined, false);
  }

  async getProfile(signal?: AbortSignal): Promise<AuthProfile | null> {
    const response = await this.request('/api/auth/profile', {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (response.status === 401) {
      return null;
    }

    if (!response.ok) {
      throw await parseApiError(response);
    }

    const value = await this.json(response);
    if (!isAuthProfile(value)) {
      throw new BackendClientError('invalid-response', 'The panel could not restore this browser session.');
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
      throw await parseApiError(response);
    }
  }

  async logoutAll(signal?: AbortSignal): Promise<void> {
    await this.ensureOk('/api/auth/logout-all', { method: 'POST', credentials: 'include', signal });
  }

  async updateProfile(username: string, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(
      '/api/auth/profile',
      { method: 'PATCH', credentials: 'include', body: JSON.stringify({ username }), signal },
    );
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid profile response.');
    }

    return value;
  }

  async changePassword(oldPassword: string, newPassword: string, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(
      '/api/auth/password',
      {
        method: 'PATCH',
        credentials: 'include',
        body: JSON.stringify({ oldPassword, newPassword }),
        signal,
      },
    );
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid password-change response.');
    }

    return value;
  }

  async listSessions(signal?: AbortSignal): Promise<SessionRow[]> {
    const response = await this.ensureOk('/api/auth/sessions', {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!Array.isArray(value) || !value.every(isSessionRow)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid session list.');
    }

    return value;
  }

  async revokeSession(sessionId: string, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(`/api/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      credentials: 'include',
      signal,
    });
  }

  async setupTwoFactor(signal?: AbortSignal): Promise<TwoFactorSetupResult> {
    const response = await this.ensureOk('/api/auth/2fa/setup', {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (value as { secret?: unknown }).secret !== 'string' ||
      typeof (value as { uri?: unknown }).uri !== 'string'
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid two-factor setup response.');
    }

    return value as TwoFactorSetupResult;
  }

  async confirmTwoFactor(token: string, signal?: AbortSignal): Promise<TwoFactorConfirmResult> {
    const response = await this.ensureOk(
      '/api/auth/2fa/confirm',
      { method: 'POST', credentials: 'include', body: JSON.stringify({ token }), signal },
    );
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      !Array.isArray((value as { backupCodes?: unknown }).backupCodes) ||
      !(value as { backupCodes: unknown[] }).backupCodes.every((c) => typeof c === 'string')
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid two-factor confirmation.');
    }

    return value as TwoFactorConfirmResult;
  }

  async disableTwoFactor(token: string, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(
      '/api/auth/2fa/disable',
      { method: 'DELETE', credentials: 'include', body: JSON.stringify({ token }), signal },
    );
  }

  // --- Google OAuth (existing contract, preserved) ---

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
    if (!response.ok) {
      throw await parseApiError(response);
    }
    const value = await this.json(response);

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
      throw await parseApiError(response);
    }
  }

  // --- Servers ---

  async listRequestableServers(
    page: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<{ data: RequestableServerProjection[]; total: number }> {
    const search = new URLSearchParams();
    if (page.limit !== undefined) search.set('limit', String(page.limit));
    if (page.offset !== undefined) search.set('offset', String(page.offset));
    const query = search.size > 0 ? `?${search.toString()}` : '';

    const response = await this.ensureOk(`/api/servers/requestable${query}`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      !Array.isArray((value as { data?: unknown }).data) ||
      !(value as { data: unknown[] }).data.every(isRequestableServer) ||
      typeof (value as { total?: unknown }).total !== 'number'
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid requestable-server list.');
    }

    return value as { data: RequestableServerProjection[]; total: number };
  }

  async listServers(
    page: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<ServerListResponse> {
    const search = new URLSearchParams();
    if (page.limit !== undefined) search.set('limit', String(page.limit));
    if (page.offset !== undefined) search.set('offset', String(page.offset));
    const query = search.size > 0 ? `?${search.toString()}` : '';

    const response = await this.ensureOk(`/api/servers${query}`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!isServerListResponse(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid server list.');
    }

    return value;
  }

  async getServer(serverId: string, signal?: AbortSignal): Promise<Server> {
    const response = await this.ensureOk(`/api/servers/${serverId}`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!isServer(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid server.');
    }

    return value;
  }

  async createServer(input: CreateServerInput, signal?: AbortSignal): Promise<Server> {
    const response = await this.ensureOk('/api/servers', {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(input),
      signal,
    });
    const value = await this.json(response);

    if (!isServer(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid created server.');
    }

    return value;
  }

  async startServer(serverId: string, signal?: AbortSignal): Promise<Server> {
    return this.serverLifecycle(`/api/servers/${serverId}/start`, signal);
  }

  async stopServer(serverId: string, signal?: AbortSignal): Promise<Server> {
    return this.serverLifecycle(`/api/servers/${serverId}/stop`, signal);
  }

  async restartServer(serverId: string, signal?: AbortSignal): Promise<Server> {
    return this.serverLifecycle(`/api/servers/${serverId}/restart`, signal);
  }

  async deleteServer(serverId: string, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(`/api/servers/${serverId}`, {
      method: 'DELETE',
      credentials: 'include',
      signal,
    });
  }

  // --- Server access ---

  async requestAccess(serverId: string, signal?: AbortSignal): Promise<MyAccessRequest> {
    const response = await this.ensureOk(`/api/servers/${serverId}/request-access`, {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!isMyAccessRequest(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid access-request response.');
    }

    return value;
  }

  /** 404 (OPEN/PRIVATE/none) resolves to `null`; other failures throw. */
  async getMyAccessRequest(serverId: string, signal?: AbortSignal): Promise<MyAccessRequest | null> {
    const response = await this.ensureResponse(`/api/servers/${serverId}/my-access-request`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw await parseApiError(response);
    }

    const value = await this.json(response);
    if (!isMyAccessRequest(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid access-request state.');
    }

    return value;
  }

  async listAccessRequests(serverId: string, signal?: AbortSignal): Promise<AccessRequest[]> {
    const response = await this.ensureOk(`/api/servers/${serverId}/access-requests`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      !Array.isArray(value) ||
      !value.every(
        (row): row is AccessRequest =>
          typeof row === 'object' &&
          row !== null &&
          typeof (row as { userId?: unknown }).userId === 'string' &&
          typeof (row as { username?: unknown }).username === 'string' &&
          typeof (row as { email?: unknown }).email === 'string' &&
          typeof (row as { status?: unknown }).status === 'string' &&
          ACCESS_STATUSES.includes((row as { status: AccessStatus }).status),
      )
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid access-request list.');
    }

    return value as AccessRequest[];
  }

  async approveAccess(serverId: string, userId: string, signal?: AbortSignal): Promise<AccessRequest> {
    const response = await this.ensureOk(`/api/servers/${serverId}/access-requests/${userId}/approve`, {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (value as { userId?: unknown }).userId !== 'string' ||
      typeof (value as { status?: unknown }).status !== 'string'
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid access approval.');
    }

    return value as AccessRequest;
  }

  async revokeAccess(serverId: string, userId: string, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(`/api/servers/${serverId}/access-requests/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
      signal,
    });
  }

  // --- Admin ---

  async listUsers(
    filter: { status?: UserStatus; role?: Role } = {},
    signal?: AbortSignal,
  ): Promise<PublicUser[]> {
    const search = new URLSearchParams();
    if (filter.status) search.set('status', filter.status);
    if (filter.role) search.set('role', filter.role);
    const query = search.size > 0 ? `?${search.toString()}` : '';

    const response = await this.ensureOk(`/api/admin/users${query}`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!Array.isArray(value) || !value.every(isPublicUser)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid user list.');
    }

    return value;
  }

  async updateUserStatus(userId: string, status: UserStatus, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(
      `/api/admin/users/${userId}/status`,
      { method: 'PATCH', credentials: 'include', body: JSON.stringify({ status }), signal },
    );
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid user update.');
    }

    return value;
  }

  async updateUserRole(userId: string, role: Role, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(
      `/api/admin/users/${userId}/role`,
      { method: 'PATCH', credentials: 'include', body: JSON.stringify({ role }), signal },
    );
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid role update.');
    }

    return value;
  }

  async resetPassword(userId: string, signal?: AbortSignal): Promise<ResetPasswordResult> {
    const response = await this.ensureOk(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (value as { tempPassword?: unknown }).tempPassword !== 'string'
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid password reset.');
    }

    return value as ResetPasswordResult;
  }

  async removeTwoFactor(userId: string, signal?: AbortSignal): Promise<PublicUser> {
    const response = await this.ensureOk(`/api/admin/users/${userId}/2fa`, {
      method: 'DELETE',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!isPublicUser(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid 2FA removal.');
    }

    return value;
  }

  async listModPermissions(userId: string, signal?: AbortSignal): Promise<ModPermissionRow[]> {
    const response = await this.ensureOk(`/api/admin/users/${userId}/permissions`, {
      method: 'GET',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (
      !Array.isArray(value) ||
      !value.every(
        (row): row is ModPermissionRow =>
          typeof row === 'object' &&
          row !== null &&
          typeof (row as { id?: unknown }).id === 'string' &&
          typeof (row as { permission?: unknown }).permission === 'string' &&
          typeof (row as { userId?: unknown }).userId === 'string',
      )
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned invalid permission grants.');
    }

    return value as ModPermissionRow[];
  }

  async grantModPermission(
    userId: string,
    input: GrantModPermissionInput,
    signal?: AbortSignal,
  ): Promise<ModPermissionRow> {
    const response = await this.ensureOk(
      `/api/admin/users/${userId}/permissions`,
      { method: 'POST', credentials: 'include', body: JSON.stringify(input), signal },
    );
    const value = await this.json(response);

    if (
      value === null ||
      typeof value !== 'object' ||
      typeof (value as { id?: unknown }).id !== 'string' ||
      typeof (value as { permission?: unknown }).permission !== 'string'
    ) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid permission grant.');
    }

    return value as ModPermissionRow;
  }

  async revokeModPermission(userId: string, permId: string, signal?: AbortSignal): Promise<void> {
    await this.ensureOk(`/api/admin/users/${userId}/permissions/${permId}`, {
      method: 'DELETE',
      credentials: 'include',
      signal,
    });
  }

  // --- Internals ---

  private async serverLifecycle(path: string, signal?: AbortSignal): Promise<Server> {
    const response = await this.ensureOk(path, {
      method: 'POST',
      credentials: 'include',
      signal,
    });
    const value = await this.json(response);

    if (!isServer(value)) {
      throw new BackendClientError('invalid-response', 'The panel returned an invalid server state.');
    }

    return value;
  }

  /**
   * Authorized-request coordinator (architect decision §1, external-review
   * Finding 1/Finding 7). One 401 while a session may exist is resolved
   * through the cross-tab refresh broker:
   * - outcome 'profile' -> the original request is retried EXACTLY once. The
   *   original request was rejected by JwtAuthGuard before any controller
   *   processing, so the replay is safe and idempotent.
   * - outcome 'anonymous' | 'error' -> the session is terminally invalid; the
   *   panel-scoped onSessionTerminal callback fires once so the session
   *   authority leaves the authenticated state and cleans the query scope.
   *   The original 401 is then thrown (no replay; no loop).
   * Endpoints whose 401 is a SEMANTIC failure (not guard rejection) pass
   * refreshOn401=false and therefore never enter this branch: login, register,
   * 2FA verify, setup init, refresh itself. Google OAuth login/link use the
   * raw request path and are never auto-refreshed. Backend audit: for every
   * authed mutation (password change, 2FA setup/confirm/disable, session
   * revoke, logout-all, admin, lifecycle, permissions/access) a 401 status is
   * exclusively the JwtAuthGuard rejection — semantic failures are 400/403/
   * 404/409/422 — so replaying after a successful rotation is safe.
   */
  private async ensureResponse(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
    refreshOn401 = true,
  ): Promise<Response> {
    let response = await this.request(path, init, options);

    if (response.status === 401 && refreshOn401) {
      const outcome = await refreshWithBroker(this);
      if (outcome.kind === 'profile') {
        response = await this.request(path, init, options);
      } else {
        this.onSessionTerminal?.();
      }
    }

    return response;
  }

  /** Standard non-OK handling: every !ok response becomes a typed BackendApiError. */
  private async ensureOk(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
    refreshOn401 = true,
  ): Promise<Response> {
    const response = await this.ensureResponse(path, init, options, refreshOn401);

    if (!response.ok) {
      throw await parseApiError(response);
    }

    return response;
  }

  private async request(
    path: string,
    init: RequestInit,
    options: RequestOptions = {},
  ): Promise<Response> {
    const url = new URL(path, this.origin);
    try {
      return await this.fetchImplementation(url, {
        ...init,
        credentials: options.credentials ?? init.credentials ?? 'omit',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...options.headers,
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

export type { PanelInfo, PanelCapabilities, AuthProfile, RequestableServerProjection };