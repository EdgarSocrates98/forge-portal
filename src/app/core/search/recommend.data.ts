import {
  AccountEnvironment,
  AgentDescriptor,
  FederationSnapshot,
  HostDetection,
  McpServerDescriptor,
  McpState,
  RegistryState,
  SkillDescriptor,
  TaskExecution,
} from '../api/api.models';

/**
 * §8.5 — explainable recommendations. Pure derivations over data the
 * portal already loaded; every recommendation answers "why" with a
 * `reasonKey` and "where the proof is" with `source` (endpoint + field).
 *
 * Hard rules (prompt §8.5 + repo contract):
 *  - ZERO value inference: nothing here says an item "improves" anything.
 *    A recommendation states an observed relation — catalog without
 *    install, same declared domain, a required field absent — and names
 *    the endpoint/field that grounds it.
 *  - "related" means *verifiably* related: same declared domain, declared
 *    skills list, declared host binding. Never similarity/score guesses.
 *  - Absent input (`null`) simply produces no recommendation of that
 *    kind — the page reports the source as unverified instead.
 *  - Deterministic: fixed kind order, ids sorted inside each kind.
 */

export type RecommendationKind =
  | 'missing-component' // catalog entry with no install evidence
  | 'incompatible-dependency' // detected host self-reported unsupported
  | 'related-skill' // skills sharing one declared domain
  | 'incomplete-config' // required env var absent/invalid, host detected not integrated
  | 'mcp-unavailable' // MCP server in a non-operational reported state
  | 'recurring-failure'; // same verb failed/refused more than once

/** Display + emit order — fixed, not alphabetical. */
export const REC_KIND_ORDER: readonly RecommendationKind[] = [
  'missing-component',
  'incomplete-config',
  'incompatible-dependency',
  'mcp-unavailable',
  'recurring-failure',
  'related-skill',
];

export const REC_KIND_LABEL: Record<RecommendationKind, string> = {
  'missing-component': 'recommend.kind.missingComponent',
  'incomplete-config': 'recommend.kind.incompleteConfig',
  'incompatible-dependency': 'recommend.kind.incompatibleDependency',
  'mcp-unavailable': 'recommend.kind.mcpUnavailable',
  'recurring-failure': 'recommend.kind.recurringFailure',
  'related-skill': 'recommend.kind.relatedSkill',
};

export interface RecSource {
  /** The adapter op that supplied the grounding field. */
  endpoint: string;
  /** The field inside that payload the recommendation reads. */
  field: string;
}

export interface RecRef {
  kind: 'forge' | 'skill' | 'agent' | 'mcp' | 'host' | 'operation' | 'env';
  id: string;
}

export interface Recommendation {
  /** `${kind}:${slug}` — stable across reloads with the same data. */
  id: string;
  kind: RecommendationKind;
  severity: 'info' | 'warning';
  /** i18n key of the "why" sentence — with `params`. */
  reasonKey: string;
  params: Record<string, string | number>;
  /** Portal route owning the subject (navigation only — no action). */
  route: string;
  refs: RecRef[];
  source: RecSource[];
}

export interface RecommendInput {
  /** GET /api/v1/federation — specialists (catalog) + installed_forges. */
  federation?: FederationSnapshot | null;
  /** GET /api/v1/registry/state — forge-cli install receipts. */
  registry?: RegistryState | null;
  /** bootstrap.account_environment — declared user-scope variables. */
  environment?: AccountEnvironment | null;
  skills?: readonly SkillDescriptor[] | null;
  agents?: readonly AgentDescriptor[] | null;
  mcp?: readonly McpServerDescriptor[] | null;
  hosts?: readonly HostDetection[] | null;
  tasks?: readonly TaskExecution[] | null;
}

const EP = {
  federation: 'GET /api/v1/federation',
  registry: 'GET /api/v1/registry/state',
  bootstrap: 'GET /api/v1/bootstrap',
  skills: 'GET /api/v1/skills',
  agents: 'GET /api/v1/agents',
  mcp: 'GET /api/v1/mcp/servers',
  hosts: 'GET /api/v1/hosts',
  tasks: 'GET /api/v1/tasks',
} as const;

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** MCP states that report the server is not usable right now — the
 *  descriptor's own words, no inference about cause. */
const MCP_DOWN: ReadonlySet<McpState> = new Set(['NOT_CONFIGURED', 'FAILED', 'DEGRADED']);

const taskFailed = (t: TaskExecution): boolean => {
  if (t.refusal) return true;
  const status = t.receipt?.['status'];
  return typeof status === 'string' && status !== 'ok';
};

// ------------------------------------------------------------------
// contextual helpers — the "potentially suitable agents" derivations,
// always grounded on a *declared* field, used by the entity inspector.
// ------------------------------------------------------------------

/** Agents whose descriptor declares `skills[]` containing any of `refs`
 *  (descriptors may reference a skill by id OR by name — the caller
 *  passes the candidates it verified). Sorted by id. */
export function agentsForSkill(
  agents: readonly AgentDescriptor[] | null | undefined,
  refs: string | readonly string[],
): AgentDescriptor[] {
  const wanted = new Set(typeof refs === 'string' ? [refs] : refs);
  if (!agents || wanted.size === 0) return [];
  return agents
    .filter((a) => (a.skills ?? []).some((s) => wanted.has(s)))
    .sort((a, b) => cmp(a.id, b.id));
}

/** Agents declaring `domains[]` containing `domain` — same declared
 *  domain, never a similarity claim. Sorted by id. */
export function agentsForDomain(
  agents: readonly AgentDescriptor[] | null | undefined,
  domain: string,
): AgentDescriptor[] {
  if (!agents || !domain) return [];
  return agents.filter((a) => (a.domains ?? []).includes(domain)).sort((a, b) => cmp(a.id, b.id));
}

/** Skills sharing a declared domain with `skillId`, excluding itself. */
export function skillsInDomain(
  skills: readonly SkillDescriptor[] | null | undefined,
  domain: string,
  excludeId?: string,
): SkillDescriptor[] {
  if (!skills || !domain) return [];
  return skills
    .filter((s) => s.domain === domain && s.id !== excludeId)
    .sort((a, b) => cmp(a.id, b.id));
}

// ------------------------------------------------------------------
// global recommendations
// ------------------------------------------------------------------

function missingComponents(input: RecommendInput): Recommendation[] {
  const fed = input.federation;
  if (!fed) return [];
  const installed = new Set(fed.installed_forges ?? []);
  const registryForges = new Set(Object.keys(input.registry?.forges ?? {}));
  const registryChecked = input.registry != null;
  const out: Recommendation[] = [];
  for (const s of fed.specialists ?? []) {
    const provider = typeof s.provider === 'string' ? s.provider : null;
    if (!provider) continue;
    if (installed.has(provider) || registryForges.has(provider)) continue;
    out.push({
      id: `missing-component:${provider}`,
      kind: 'missing-component',
      severity: 'info',
      reasonKey: 'recommend.reason.missingComponent',
      params: { forge: provider },
      route: '/federation',
      refs: [{ kind: 'forge', id: provider }],
      source: [
        { endpoint: EP.federation, field: 'specialists[].provider' },
        { endpoint: EP.federation, field: 'installed_forges' },
        ...(registryChecked ? [{ endpoint: EP.registry, field: 'forges' }] : []),
      ],
    });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function incompleteConfig(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];
  const env = input.environment;
  if (env) {
    for (const v of env.variables ?? []) {
      if (!v.required) continue;
      if (!v.present) {
        out.push({
          id: `incomplete-config:env:${v.name}`,
          kind: 'incomplete-config',
          severity: 'warning',
          reasonKey: 'recommend.reason.envMissing',
          params: { name: v.name },
          route: '/config',
          refs: [{ kind: 'env', id: v.name }],
          source: [{ endpoint: EP.bootstrap, field: 'account_environment.variables[].present' }],
        });
      } else if (v.valid === false) {
        out.push({
          id: `incomplete-config:env:${v.name}:invalid`,
          kind: 'incomplete-config',
          severity: 'warning',
          reasonKey: 'recommend.reason.envInvalid',
          params: { name: v.name },
          route: '/config',
          refs: [{ kind: 'env', id: v.name }],
          source: [{ endpoint: EP.bootstrap, field: 'account_environment.variables[].valid' }],
        });
      }
    }
  }
  for (const h of input.hosts ?? []) {
    // detected binary but the lifecycle never left NOT_DETECTED —
    // the host itself reports the gap, nothing is assumed.
    if (h.detected && h.integration === 'NOT_DETECTED') {
      out.push({
        id: `incomplete-config:host:${h.host}`,
        kind: 'incomplete-config',
        severity: 'info',
        reasonKey: 'recommend.reason.hostNotIntegrated',
        params: { host: h.host },
        route: '/hosts',
        refs: [{ kind: 'host', id: h.host }],
        source: [{ endpoint: EP.hosts, field: 'integration' }],
      });
    }
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function incompatibleDependencies(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];
  for (const h of input.hosts ?? []) {
    // The adapter detected the host AND reports it unsupported —
    // an observed contradiction, not a judgment call.
    if (h.detected && h.supported === false) {
      out.push({
        id: `incompatible-dependency:${h.host}`,
        kind: 'incompatible-dependency',
        severity: 'warning',
        reasonKey: 'recommend.reason.hostUnsupported',
        params: { host: h.host },
        route: '/hosts',
        refs: [{ kind: 'host', id: h.host }],
        source: [
          { endpoint: EP.hosts, field: 'detected' },
          { endpoint: EP.hosts, field: 'supported' },
        ],
      });
    }
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function mcpUnavailable(input: RecommendInput): Recommendation[] {
  const out: Recommendation[] = [];
  for (const m of input.mcp ?? []) {
    if (!MCP_DOWN.has(m.state)) continue;
    out.push({
      id: `mcp-unavailable:${m.id}`,
      kind: 'mcp-unavailable',
      severity: 'warning',
      reasonKey: 'recommend.reason.mcpState',
      params: { id: m.id, state: m.state },
      route: '/mcp',
      refs: [{ kind: 'mcp', id: m.id }],
      source: [{ endpoint: EP.mcp, field: 'state' }],
    });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function recurringFailures(input: RecommendInput): Recommendation[] {
  const byVerb = new Map<string, { count: number; ids: string[] }>();
  for (const t of input.tasks ?? []) {
    if (!taskFailed(t)) continue;
    const verb = t.verb || t.id;
    const acc = byVerb.get(verb) ?? { count: 0, ids: [] };
    acc.count += 1;
    acc.ids.push(t.id);
    byVerb.set(verb, acc);
  }
  const out: Recommendation[] = [];
  for (const [verb, acc] of byVerb) {
    if (acc.count < 2) continue; // one failure is an event, not a pattern
    out.push({
      id: `recurring-failure:${verb}`,
      kind: 'recurring-failure',
      severity: 'warning',
      reasonKey: 'recommend.reason.recurringFailure',
      params: { verb, count: acc.count },
      route: '/tasks',
      refs: acc.ids.sort(cmp).map((id) => ({ kind: 'operation', id })),
      source: [
        { endpoint: EP.tasks, field: 'refusal' },
        { endpoint: EP.tasks, field: 'receipt.status' },
      ],
    });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

function relatedSkills(input: RecommendInput): Recommendation[] {
  const skills = input.skills;
  if (!skills) return [];
  const byDomain = new Map<string, string[]>();
  for (const s of skills) {
    const domain = typeof s.domain === 'string' && s.domain.trim() ? s.domain.trim() : null;
    if (!domain || !s.id) continue;
    const list = byDomain.get(domain) ?? [];
    list.push(s.id);
    byDomain.set(domain, list);
  }
  const out: Recommendation[] = [];
  for (const [domain, ids] of byDomain) {
    if (ids.length < 2) continue;
    const sorted = ids.sort(cmp);
    out.push({
      id: `related-skill:${domain}`,
      kind: 'related-skill',
      severity: 'info',
      // explicitly "same declared domain" — never "similar".
      reasonKey: 'recommend.reason.sameDomain',
      params: { domain, count: sorted.length },
      route: '/skills',
      refs: sorted.map((id) => ({ kind: 'skill', id })),
      source: [{ endpoint: EP.skills, field: 'domain' }],
    });
  }
  return out.sort((a, b) => cmp(a.id, b.id));
}

/**
 * Every derivable recommendation from the inputs that actually loaded —
 * fixed kind order, ids sorted inside each kind. Absent input data adds
 * nothing and is reported upstream as unverified, never guessed.
 */
export function buildRecommendations(input: RecommendInput): Recommendation[] {
  const byKind: Record<RecommendationKind, Recommendation[]> = {
    'missing-component': missingComponents(input),
    'incomplete-config': incompleteConfig(input),
    'incompatible-dependency': incompatibleDependencies(input),
    'mcp-unavailable': mcpUnavailable(input),
    'recurring-failure': recurringFailures(input),
    'related-skill': relatedSkills(input),
  };
  return REC_KIND_ORDER.flatMap((k) => byKind[k]);
}
