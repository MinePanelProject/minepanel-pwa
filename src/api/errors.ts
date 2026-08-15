export type BackendErrorKind =
  | 'unreachable'
  | 'invalid-response'
  | 'unavailable'
  | 'unexpected-response';

export class BackendClientError extends Error {
  constructor(
    readonly kind: BackendErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'BackendClientError';
  }
}

export const getProbeErrorMessage = (error: unknown): string => {
  if (error instanceof BackendClientError) {
    return error.message;
  }

  return 'The panel could not be reached. Check its HTTPS address and CORS configuration.';
};
