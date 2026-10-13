import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, map } from 'rxjs';
import { SessionStore } from '../session/session.store';
import { ApiError } from './api.error';
import { ApiEnvelope } from './api.models';

let correlationSeq = 0;
function nextCorrelationId(): string {
  correlationSeq = (correlationSeq + 1) % 0xffff;
  return `ui-${Date.now().toString(36)}-${correlationSeq.toString(36)}`;
}

/**
 * Attaches the local-session header + correlation id to `/api` calls and
 * normalizes every failure into an `ApiError` carrying the server's
 * structured envelope (code / message_key / retryable).
 */
export const forgeApiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith('/api/')) return next(req);

  const session = inject(SessionStore);
  let headers = req.headers.set('X-Correlation-Id', nextCorrelationId());
  const token = session.token();
  if (token) headers = headers.set('X-Forge-Session', token);
  if (req.method !== 'GET' && !req.headers.has('Content-Type')) {
    headers = headers.set('Content-Type', 'application/json');
  }

  return next(req.clone({ headers, withCredentials: true })).pipe(
    map((event) => {
      // 2xx responses still validate the envelope shape when present.
      if (event.type === 4 && event.body && typeof event.body === 'object') {
        const body = event.body as ApiEnvelope<unknown>;
        if (body.schema === 'forge/PortalApi/1' && body.error) {
          throw new ApiError(event.status, body.error);
        }
      }
      return event;
    }),
    catchError((err: unknown) => {
      if (err instanceof ApiError) throw err;
      if (err instanceof HttpErrorResponse) {
        const body = err.error as ApiEnvelope<unknown> | null;
        throw new ApiError(err.status, body?.error ?? undefined);
      }
      throw new ApiError(0);
    }),
  );
};
