/**
 * Normalized error model for MinePanel backend API calls.
 *
 * Transport failures (network, CORS, certificate, malformed JSON) stay
 * client-side `BackendClientError`s. HTTP responses are parsed into
 * `BackendApiError` carrying the backend's machine-readable `error` code when
 * one is present (NestJS `HttpException` bodies: `{ statusCode, error,
 * message }`).
 */

export type BackendErrorKind =
  | 'unreachable'
  | 'invalid-response'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'unprocessable'
  | 'rate-limited'
  | 'server'
  | 'unexpected-response';

/**
 * Machine-readable codes the backend issues (SPEC §7/§8/§12 and guards).
 * `null` means the response carried no recognized code.
 */
export type BackendErrorCode =
  | 'AccountPending'
  | 'AccountBanned'
  | 'PasswordChangeRequired'
  | 'PasswordRecoveryRequired'
  | 'TwoFactorAuthenticationRequired'
  | 'SetupTokenInvalid'
  | 'SetupAlreadyComplete'
  | 'CsrfOriginForbidden'
  | 'InsufficientResources'
  | 'InvalidGoogleChallenge'
  | 'InvalidGoogleCredential'
  | 'GoogleOAuthUnavailable'
  | 'RefreshTokenMissing'
  | 'RefreshTokenMalformed'
  | 'RefreshTokenExpired'
  | 'RefreshTokenInvalid'
  | 'TokenWrongPurpose'
  | 'WrongCredentials'
  | 'ValidationFailed'
  | null;

const MACHINE_CODES: ReadonlySet<string> = new Set<string>([
  'AccountPending',
  'AccountBanned',
  'PasswordChangeRequired',
  'PasswordRecoveryRequired',
  'TwoFactorAuthenticationRequired',
  'SetupTokenInvalid',
  'SetupAlreadyComplete',
  'CsrfOriginForbidden',
  'InsufficientResources',
  'InvalidGoogleChallenge',
  'InvalidGoogleCredential',
  'GoogleOAuthUnavailable',
  'RefreshTokenMissing',
  'RefreshTokenMalformed',
  'RefreshTokenExpired',
  'RefreshTokenInvalid',
  'TokenWrongPurpose',
]);

const kindForStatus = (status: number): BackendErrorKind => {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status === 409) return 'conflict';
  if (status === 422) return 'unprocessable';
  if (status === 429) return 'rate-limited';
  if (status >= 500) return 'server';
  return 'unexpected-response';
};

type ErrorBody = {
  statusCode?: unknown;
  error?: unknown;
  message?: unknown;
  details?: unknown;
};

const isErrorBody = (value: unknown): value is ErrorBody =>
  value !== null && typeof value === 'object';

export class BackendClientError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'invalid-response' | 'unavailable' | 'unexpected-response',
    message: string,
  ) {
    super(message);
    this.name = 'BackendClientError';
  }
}

export class BackendApiError extends Error {
  readonly kind: BackendErrorKind;
  readonly status: number;
  readonly code: BackendErrorCode;
  readonly details: unknown;

  constructor(status: number, message: string, code: BackendErrorCode = null, details?: unknown) {
    super(message);
    this.name = 'BackendApiError';
    this.kind = kindForStatus(status);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the backend reported a stable machine code. */
  get hasCode(): boolean {
    return this.code !== null;
  }
}

const messageFromBody = (body: ErrorBody): string => {
  if (typeof body.message === 'string') {
    return body.message;
  }

  if (Array.isArray(body.message)) {
    const fields = body.message.filter((m): m is string => typeof m === 'string');
    if (fields.length > 0) {
      return fields.join(' ');
    }
  }

  if (typeof body.error === 'string') {
    return body.error;
  }

  return 'The panel rejected the request.';
};

/**
 * Parse a non-OK backend response into a `BackendApiError`. Falls back to a
 * generic safe message when the body is not the documented NestJS envelope —
 * backend details are never surfaced verbatim to users.
 */
export const parseApiError = async (response: Response): Promise<BackendApiError> => {
  let body: unknown = null;

  try {
    body = await response.json();
  } catch {
    // non-JSON error body (proxy page, plain-text 502, …)
  }

  if (isErrorBody(body)) {
    const rawError = typeof body.error === 'string' ? body.error : null;
    const code: BackendErrorCode =
      rawError !== null && MACHINE_CODES.has(rawError) ? (rawError as BackendErrorCode) : null;

    if (code === null && rawError === null && typeof body.message === 'string') {
      // NestJS throws UnauthorizedException('Wrong credentials') with default
      // error field 'Unauthorized'; recognize the stable message instead.
      if (body.message === 'Wrong credentials') {
        return new BackendApiError(response.status, body.message, 'WrongCredentials');
      }
    }

    if (code === null && response.status === 400) {
      return new BackendApiError(response.status, messageFromBody(body), 'ValidationFailed');
    }

    return new BackendApiError(response.status, messageFromBody(body), code, body.details);
  }

  return new BackendApiError(
    response.status,
    'The panel rejected the request. Check the value and try again.',
  );
};

/**
 * Message suitable for inline UI display: prefers a stable machine-code copy,
 * falls back to a generic HTTP-level message, and never exposes raw backend
 * internals beyond what the backend itself chose to send as `message`.
 */
export const getApiErrorMessage = (error: unknown): string => {
  if (error instanceof BackendApiError) {
    switch (error.code) {
      case 'AccountPending':
        return 'Your account is awaiting administrator approval.';
      case 'AccountBanned':
        return 'This account has been banned. Contact the panel administrator.';
      case 'PasswordChangeRequired':
        return 'A password change is required before you can continue.';
      case 'PasswordRecoveryRequired':
        return 'This account requires a password recovery before signing in this way.';
      case 'TwoFactorAuthenticationRequired':
        return 'Two-factor authentication is required to sign in this way.';
      case 'SetupTokenInvalid':
        return 'The setup token is missing or invalid.';
      case 'SetupAlreadyComplete':
        return 'This panel is already initialized.';
      case 'RefreshTokenExpired':
        return 'Your session expired. Sign in again.';
      case 'RefreshTokenInvalid':
      case 'RefreshTokenMissing':
      case 'RefreshTokenMalformed':
      case 'TokenWrongPurpose':
        return 'Your session is no longer valid. Sign in again.';
      case 'WrongCredentials':
        return 'Wrong email/username or password.';
      default:
        return error.message;
    }
  }

  if (error instanceof BackendClientError) {
    return error.message;
  }

  return 'The panel could not complete the request. Try again.';
};

export const getProbeErrorMessage = (error: unknown): string => {
  if (error instanceof BackendClientError) {
    return error.message;
  }

  return 'The panel could not be reached. Check its HTTPS address and CORS configuration.';
};