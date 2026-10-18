import { ApiError } from './api.error';
import { guidanceFor } from './error-guidance';

describe('error guidance (Cycle 5 §8.4)', () => {
  it('maps transport failure to the unreachable explanation', () => {
    const g = guidanceFor(new ApiError(0));
    expect(g?.explainKey).toBe('err.explain.unreachable');
    expect(g?.route).toBeUndefined();
  });

  it('maps known codes to an explanation and a real route', () => {
    const cases: [string, string, string | undefined][] = [
      ['PORTAL-SESSION', 'err.explain.session', undefined],
      ['PORTAL-TIMEOUT', 'err.explain.timeout', '/tasks'],
      ['PORTAL-CLI-UNAVAILABLE', 'err.explain.cli', '/install'],
      ['PORTAL-UNSUPPORTED', 'err.explain.unsupported', '/dashboard'],
      ['PORTAL-HOST-ABSENT', 'err.explain.hostAbsent', '/hosts'],
      ['PORTAL-FORGE', 'err.explain.forge', '/federation'],
      ['PORTAL-INTERNAL', 'err.explain.internal', '/observe'],
      ['PORTAL-RATE-LIMITED', 'err.explain.rateLimited', undefined],
      ['PORTAL-CONFIRM', 'err.explain.confirm', undefined],
      ['HTTP-403', 'err.explain.forbidden', undefined],
      ['HTTP-503', 'err.explain.unavailable', undefined],
    ];
    for (const [code, explain, route] of cases) {
      const g = guidanceFor(
        new ApiError(500, { code, message: code, severity: 'error', retryable: true }),
      );
      expect(g?.explainKey, code).toBe(explain);
      expect(g?.route, code).toBe(route);
    }
  });

  it('covers the prefix families without enumerating every code', () => {
    for (const code of [
      'PORTAL-PLAN-REQUIRED',
      'PORTAL-PLAN-STALE',
      'PORTAL-PLAN-INVALID',
      'PORTAL-PLAN-MISMATCH',
    ]) {
      expect(guidanceFor(new ApiError(400, { code }))?.explainKey).toBe('err.explain.plan');
    }
    expect(guidanceFor(new ApiError(403, { code: 'PORTAL-SECRET-MISSING' }))?.route).toBe(
      '/config',
    );
  });

  it('request-shape refusals get the request explanation, not a route', () => {
    for (const code of ['PORTAL-BAD-JSON', 'PORTAL-CONTENT-TYPE', 'PORTAL-ORIGIN']) {
      const g = guidanceFor(new ApiError(400, { code }));
      expect(g?.explainKey).toBe('err.explain.request');
      expect(g?.route).toBeUndefined();
    }
  });

  it('returns null for unknown codes and absent errors', () => {
    expect(guidanceFor(null)).toBeNull();
    expect(guidanceFor(undefined)).toBeNull();
    expect(guidanceFor(new ApiError(418, { code: 'PORTAL-FUTURE-CODE' }))).toBeNull();
    expect(guidanceFor(new ApiError(402, { code: 'HTTP-402' }))).toBeNull();
  });
});
