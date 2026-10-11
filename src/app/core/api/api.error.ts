import { ApiErrorBody } from './api.models';

/**
 * A failed PortalApi call. `body` is the server's structured error when
 * the response carried the forge/PortalApi/1 envelope; `transport` marks
 * cases where the server could not be reached at all.
 */
export class ApiError extends Error {
  readonly transport: boolean;
  readonly status: number;
  readonly body: ApiErrorBody;

  constructor(status: number, body?: Partial<ApiErrorBody>) {
    const message = body?.message ?? `request failed (${status || 'network'})`;
    super(message);
    this.status = status;
    this.transport = status === 0;
    this.body = {
      code: body?.code ?? (status === 0 ? 'PORTAL-UNREACHABLE' : `HTTP-${status}`),
      message,
      message_key: body?.message_key ?? (status === 0 ? 'error.unreachable' : undefined),
      details: body?.details,
      severity: body?.severity ?? 'error',
      retryable: body?.retryable ?? (status === 0 || status >= 500),
      action: body?.action,
    };
  }
}
