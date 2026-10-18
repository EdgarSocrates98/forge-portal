import { ApiError } from './api.error';

/**
 * Cycle 5 §8.4 — actionable diagnostics for `ui-error` panels.
 *
 * Maps the refusal codes the PortalApi server actually emits
 * (portal_core/forge_portal.py) plus the client-side `HTTP-*` fallback
 * codes to a short explanation and — only when a real portal page owns
 * the resolution — a route to it. Unknown codes return null: the error
 * panel then shows just the message/code/retry it always had. Nothing
 * here invents a cause; every entry restates what the code already
 * declares, and the server's own `error.action` (when present) always
 * renders verbatim alongside.
 */
export interface ErrorGuidance {
  /** i18n key for the "what this means / what to try" line. */
  explainKey: string;
  /** Portal route where the user acts on this — omitted when retry or
   *  the request flow itself is the only honest answer. */
  route?: string;
  /** i18n key for the route link label. */
  routeKey?: string;
}

const BY_CODE: Record<string, ErrorGuidance> = {
  'PORTAL-UNREACHABLE': { explainKey: 'err.explain.unreachable' },
  'PORTAL-SESSION': { explainKey: 'err.explain.session' },
  'PORTAL-TIMEOUT': {
    explainKey: 'err.explain.timeout',
    route: '/tasks',
    routeKey: 'ops.alert.goTasks',
  },
  'PORTAL-RATE-LIMITED': { explainKey: 'err.explain.rateLimited' },
  'PORTAL-PAYLOAD-TOO-LARGE': { explainKey: 'err.explain.payload' },
  'PORTAL-CLI-UNAVAILABLE': {
    explainKey: 'err.explain.cli',
    route: '/install',
    routeKey: 'ops.alert.goInstall',
  },
  'PORTAL-UNSUPPORTED': {
    explainKey: 'err.explain.unsupported',
    route: '/dashboard',
    routeKey: 'err.go.dashboard',
  },
  'PORTAL-HOST-ABSENT': {
    explainKey: 'err.explain.hostAbsent',
    route: '/hosts',
    routeKey: 'ops.alert.goHosts',
  },
  'PORTAL-FORGE': {
    explainKey: 'err.explain.forge',
    route: '/federation',
    routeKey: 'ops.alert.goFederation',
  },
  'PORTAL-NOT-FOUND': {
    explainKey: 'err.explain.notFound',
    route: '/dashboard',
    routeKey: 'err.go.dashboard',
  },
  'PORTAL-INTERNAL': {
    explainKey: 'err.explain.internal',
    route: '/observe',
    routeKey: 'err.go.observe',
  },
  'PORTAL-CONFIRM': { explainKey: 'err.explain.confirm' },
  'HTTP-403': { explainKey: 'err.explain.forbidden' },
  'HTTP-404': {
    explainKey: 'err.explain.notFound',
    route: '/dashboard',
    routeKey: 'err.go.dashboard',
  },
  'HTTP-500': {
    explainKey: 'err.explain.internal',
    route: '/observe',
    routeKey: 'err.go.observe',
  },
  'HTTP-503': { explainKey: 'err.explain.unavailable' },
};

/** Prefix families — plan-token problems all share "re-run the plan"
 *  and secret/config problems route to the config center. */
const BY_PREFIX: [string, ErrorGuidance][] = [
  ['PORTAL-PLAN-', { explainKey: 'err.explain.plan' }],
  [
    'PORTAL-SECRET-',
    { explainKey: 'err.explain.secret', route: '/config', routeKey: 'ops.alert.goConfig' },
  ],
];

/** Codes that mean "the request never reached the operation" — the
 *  honest explanation is about the request shape, never a guessed
 *  backend fault. */
const REQUEST_SHAPES = new Set([
  'PORTAL-BAD-JSON',
  'PORTAL-CONTENT-TYPE',
  'PORTAL-ORIGIN',
  'PORTAL-MISSING-FIELD',
  'PORTAL-ACTION',
]);

export function guidanceFor(err: ApiError | null | undefined): ErrorGuidance | null {
  if (!err) return null;
  const code = err.body.code;
  const exact = BY_CODE[code];
  if (exact) return exact;
  for (const [prefix, g] of BY_PREFIX) {
    if (code.startsWith(prefix)) return g;
  }
  if (REQUEST_SHAPES.has(code)) return { explainKey: 'err.explain.request' };
  return null;
}
