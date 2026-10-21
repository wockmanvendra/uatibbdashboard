import type { ApiError, ErrorCode } from '../types/api.js';

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  SCOPE_EMPTY: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  UPSTREAM_TIMEOUT: 504,
  INTERNAL: 500,
};

/**
 * An error with a user-facing message. Messages are plain, specific, and about
 * what to do next — never SQL, never a stack trace. (§7.5)
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  /** Detail for the log only. Never serialised to the client. */
  readonly detail?: unknown;

  constructor(code: ErrorCode, message: string, detail?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = STATUS[code];
    this.detail = detail;
  }
}

export const badRequest = (m: string, d?: unknown) => new AppError('BAD_REQUEST', m, d);
export const notFound = (m: string, d?: unknown) => new AppError('NOT_FOUND', m, d);
export const forbidden = (m: string, d?: unknown) => new AppError('FORBIDDEN', m, d);
export const unauthorized = (m: string, d?: unknown) => new AppError('UNAUTHORIZED', m, d);
export const tooManyRequests = (m: string, d?: unknown) => new AppError('TOO_MANY_REQUESTS', m, d);
export const upstreamUnavailable = (m: string, d?: unknown) => new AppError('UPSTREAM_TIMEOUT', m, d);
export const scopeEmpty = (
  m = 'No permitted nodes for this user. Ask your administrator to assign a scope.',
) => new AppError('SCOPE_EMPTY', m);

export function serialiseError(err: unknown): ApiError {
  if (err instanceof AppError) {
    return { error: { code: err.code, message: err.message } };
  }
  return {
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong loading this dashboard. Try again in a moment.',
    },
  };
}
