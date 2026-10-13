import { ApiError } from './api.error';

describe('ApiError', () => {
  it('wraps a structured server error body', () => {
    const err = new ApiError(409, {
      code: 'PORTAL-PLAN-STALE',
      message: 'plan token expired',
      severity: 'warning',
      retryable: true,
    });
    expect(err.body.code).toBe('PORTAL-PLAN-STALE');
    expect(err.body.retryable).toBe(true);
    expect(err.transport).toBe(false);
  });

  it('marks transport failures as PORTAL-UNREACHABLE and retryable', () => {
    const err = new ApiError(0);
    expect(err.transport).toBe(true);
    expect(err.body.code).toBe('PORTAL-UNREACHABLE');
    expect(err.body.retryable).toBe(true);
    expect(err.body.message_key).toBe('error.unreachable');
  });

  it('treats 5xx as retryable and 4xx as not by default', () => {
    expect(new ApiError(503).body.retryable).toBe(true);
    expect(new ApiError(403).body.retryable).toBe(false);
  });
});
