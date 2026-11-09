import { ApiError } from '../core/api/api.error';
import {
  confidenceRank,
  fmtMs,
  fmtRate,
  fmtRatio,
  isAuthFailure,
  sentinelFailure,
  sentinelKind,
} from './sentinel-states';

function err(status: number, code: string): ApiError {
  return new ApiError(status, { code, message: code });
}

describe('sentinel-states', () => {
  it('maps health states to honest badge kinds', () => {
    expect(sentinelKind('AVAILABLE')).toBe('ok');
    expect(sentinelKind('PARTIAL')).toBe('warn');
    expect(sentinelKind('UNAVAILABLE')).toBe('error');
    expect(sentinelKind('UNVERIFIED')).toBe('unv');
    expect(sentinelKind('UNKNOWN')).toBe('unv');
    expect(sentinelKind('nonsense')).toBe('muted');
    expect(sentinelKind(null)).toBe('muted');
  });

  it('never upgrades SLO states', () => {
    expect(sentinelKind('MET')).toBe('ok');
    expect(sentinelKind('VIOLATED')).toBe('error');
    expect(sentinelKind('INSUFFICIENT_DATA')).toBe('unv');
    expect(sentinelKind('INCOMPATIBLE_INPUTS')).toBe('warn');
  });

  it('maps confidence ladder without conflating workflow status', () => {
    expect(sentinelKind('OBSERVED')).toBe('info');
    expect(sentinelKind('CORRELATED')).toBe('info');
    expect(sentinelKind('HYPOTHESIZED')).toBe('warn');
    expect(sentinelKind('VERIFIED')).toBe('ok');
    expect(sentinelKind('REFUTED')).toBe('muted');
    expect(sentinelKind('DETECTED')).toBe('warn');
    expect(sentinelKind('RESOLVED')).toBe('ok');
  });

  it('maps capability stages + maturity rungs', () => {
    expect(sentinelKind('available')).toBe('ok');
    expect(sentinelKind('declared')).toBe('info');
    expect(sentinelKind('unavailable')).toBe('unv');
    expect(sentinelKind('implemented')).toBe('muted');
    expect(sentinelKind('production_validated')).toBe('ok');
  });

  it('classifies problem+json failures into typed UI states', () => {
    expect(sentinelFailure(err(0, ''))).toBe('unreachable');
    expect(sentinelFailure(err(401, 'sentinel.unauthorized'))).toBe('unauthorized');
    expect(sentinelFailure(err(403, 'sentinel.forbidden'))).toBe('forbidden');
    expect(sentinelFailure(err(404, 'sentinel.not_found'))).toBe('not_found');
    expect(sentinelFailure(err(409, 'sentinel.conflict'))).toBe('conflict');
    expect(sentinelFailure(err(409, 'sentinel.integration_refused'))).toBe('conflict');
    expect(sentinelFailure(err(422, 'sentinel.validation'))).toBe('validation');
    expect(sentinelFailure(err(503, 'sentinel.unavailable'))).toBe('unavailable');
    expect(sentinelFailure(err(500, 'sentinel.internal'))).toBe('error');
    expect(sentinelFailure(null)).toBeNull();
  });

  it('flags credential failures for the connection card', () => {
    expect(isAuthFailure(err(401, 'sentinel.unauthorized'))).toBe(true);
    expect(isAuthFailure(err(403, 'sentinel.forbidden'))).toBe(true);
    expect(isAuthFailure(err(404, 'sentinel.not_found'))).toBe(false);
    expect(isAuthFailure(err(0, ''))).toBe(false);
  });

  it('ranks the OBSERVED→VERIFIED ladder; REFUTED demoted terminal', () => {
    expect(confidenceRank('OBSERVED')).toBeLessThan(confidenceRank('CORRELATED'));
    expect(confidenceRank('CORRELATED')).toBeLessThan(confidenceRank('HYPOTHESIZED'));
    expect(confidenceRank('HYPOTHESIZED')).toBeLessThan(confidenceRank('VERIFIED'));
    expect(confidenceRank('REFUTED')).toBe(-1);
    expect(confidenceRank('unknown-value')).toBe(-1);
  });

  it('formats metrics honestly — null is a dash, never a zero', () => {
    expect(fmtRatio(null)).toBe('—');
    expect(fmtRatio(0.125)).toBe('12.5%');
    expect(fmtRatio(0)).toBe('0.0%');
    expect(fmtMs(null)).toBe('—');
    expect(fmtMs(250)).toBe('250 ms');
    expect(fmtMs(1250)).toBe('1.25 s');
    expect(fmtRate(null)).toBe('—');
    expect(fmtRate(3.5)).toBe('3.50 req/s');
  });
});
