import { ApiError } from '../core/api/api.error';

/**
 * Sentinel honest-state vocabulary → Portal badge kinds.
 *
 * The shared `ui-state-badge` maps a `state` string to a tone
 * (ok|warn|error|info|unv|muted); the label stays the translated
 * `sentinel.*` vocabulary via `labelOverride`. No state is ever
 * upgraded — UNVERIFIED/UNKNOWN/INSUFFICIENT_DATA render as unverified,
 * never as success or zero.
 */

export type BadgeKind = 'ok' | 'warn' | 'error' | 'info' | 'unv' | 'muted';

const STATE_KIND: Record<string, BadgeKind> = {
  // service health (ADR-018)
  AVAILABLE: 'ok',
  PARTIAL: 'warn',
  UNAVAILABLE: 'error',
  UNVERIFIED: 'unv',
  UNKNOWN: 'unv',
  STALE: 'warn',
  // health conditions
  observed: 'ok',
  degraded: 'warn',
  failing: 'error',
  no_traffic: 'info',
  unmeasurable: 'unv',
  source_stale: 'warn',
  no_observations: 'unv',
  // quality
  COMPLETE: 'ok',
  SAMPLED: 'warn',
  INVALID: 'error',
  // SLO assessment
  MET: 'ok',
  VIOLATED: 'error',
  INSUFFICIENT_DATA: 'unv',
  INCOMPATIBLE_INPUTS: 'warn',
  // confidence ladder (anomalies + hypotheses)
  OBSERVED: 'info',
  CORRELATED: 'info',
  HYPOTHESIZED: 'warn',
  VERIFIED: 'ok',
  REFUTED: 'muted',
  // incident status (workflow)
  DETECTED: 'warn',
  TRIAGED: 'info',
  INVESTIGATING: 'info',
  MITIGATING: 'info',
  MONITORING: 'info',
  RESOLVED: 'ok',
  REOPENED: 'warn',
  DISMISSED: 'muted',
  CLOSED: 'muted',
  // severity
  SEV1: 'error',
  SEV2: 'error',
  SEV3: 'warn',
  SEV4: 'info',
  INFORMATIONAL: 'muted',
  // capability status / stage
  available: 'ok',
  declared: 'info',
  unavailable: 'unv',
  implemented: 'muted',
  tested: 'info',
  integrated: 'info',
  verified: 'ok',
  production_validated: 'ok',
  // investigation / job status
  QUEUED: 'info',
  RUNNING: 'info',
  COMPLETED: 'ok',
  FAILED: 'error',
  // correspondence verdict
  proven: 'ok',
  unproven: 'unv',
  // operation provenance
  'declared+observed': 'ok',
  // misc flow
  ENABLED: 'ok',
  DISABLED: 'muted',
  fresh: 'ok',
  stale: 'warn',
};

export function sentinelKind(state: string | null | undefined): BadgeKind {
  return STATE_KIND[state ?? ''] ?? 'muted';
}

/**
 * Typed UI failure classes for `problem+json`/transport errors —
 * drives which honest state a panel renders instead of data.
 */
export type SentinelFailure =
  | 'unreachable'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'unavailable'
  | 'error';

export function sentinelFailure(err: ApiError | null | undefined): SentinelFailure | null {
  if (!err) return null;
  if (err.transport) return 'unreachable';
  const code = err.body?.code ?? '';
  if (err.status === 401 || code === 'sentinel.unauthorized') return 'unauthorized';
  if (err.status === 403 || code === 'sentinel.forbidden') return 'forbidden';
  if (err.status === 404 || code === 'sentinel.not_found') return 'not_found';
  if (
    err.status === 409 ||
    code === 'sentinel.conflict' ||
    code === 'sentinel.integration_refused'
  ) {
    return 'conflict';
  }
  if (err.status === 422) return 'validation';
  if (err.status === 503) return 'unavailable';
  return 'error';
}

/** `true` when the failure means "no valid credential" — the connection
 *  card should open and the page should explain, not silently retry. */
export function isAuthFailure(err: ApiError | null | undefined): boolean {
  const f = sentinelFailure(err);
  return f === 'unauthorized' || f === 'forbidden';
}

/** The OBSERVED→VERIFIED ladder rank for progress display; REFUTED
 *  renders below OBSERVED (terminal demotion). Unknown confidences keep
 *  their real label at rank -1 (rendered, never re-ordered silently). */
export function confidenceRank(confidence: string): number {
  switch (confidence) {
    case 'OBSERVED':
      return 0;
    case 'CORRELATED':
      return 1;
    case 'HYPOTHESIZED':
      return 2;
    case 'VERIFIED':
      return 3;
    case 'REFUTED':
      return -1;
    default:
      return -1;
  }
}

/** Format a fraction as a percent with explicit precision; null stays
 *  an honest dash — never "0%" for an absent measurement. */
export function fmtRatio(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${(v * 100).toFixed(v > 0 && v < 0.001 ? 3 : 1)}%`;
}

export function fmtMs(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${Math.round(v)} ms`;
}

export function fmtRate(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(v < 10 ? 2 : 1)} req/s`;
}
