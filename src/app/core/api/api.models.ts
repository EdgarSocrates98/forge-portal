/**
 * forge/PortalApi/1 — typed models mirroring docs/fase0/contracts.md.
 * Field presence semantics: `null` = known-absent; a missing key means
 * the backend could not verify (unknown) — never collapse the two.
 */

export type ForgeId =
  | 'the-forge'
  | 'api-forge'
  | 'spark-forge-aws'
  | 'spark-forge-azure'
  | 'platform-forge'
  | 'forge-doctor-data'
  | 'forge-doctor-api';

export type Severity = 'info' | 'warning' | 'error';

export type HostId = 'claude' | 'devin' | 'codex' | 'copilot';
export type ComponentId = 'skills' | 'agents' | 'mcp' | 'tui' | 'graph-studio';
export type ComponentProfile = 'minimal' | 'recommended' | 'full' | 'custom';
export type ExecutionProfile = 'economy' | 'balanced' | 'deep';

export type HostLifecycleState =
  | 'NOT_DETECTED'
  | 'DETECTED'
  | 'INSTALLED'
  | 'CONFIGURED'
  | 'MCP_REGISTERED'
  | 'HANDSHAKE_VERIFIED'
  | 'TOOLS_DISCOVERED'
  | 'EXECUTION_VERIFIED'
  | 'FAILED'
  | 'BLOCKED';

export interface ApiErrorBody {
  code: string;
  message: string;
  message_key?: string;
  details?: Record<string, unknown>;
  severity: Severity;
  retryable: boolean;
  action?: string;
}

export interface ApiEnvelope<T> {
  schema: 'forge/PortalApi/1';
  correlation_id: string;
  data?: T;
  error?: ApiErrorBody;
}

export type InstallState =
  | 'NOT_INSTALLED'
  | 'INSTALLED'
  | 'CONFIGURED'
  | 'ACTIVE'
  | 'VERIFIED'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'FAILED';

export type McpState =
  | 'NOT_CONFIGURED'
  | 'CONFIGURED'
  | 'STARTING'
  | 'HANDSHAKE_VERIFIED'
  | 'TOOLS_DISCOVERED'
  | 'INVOCATION_VERIFIED'
  | 'DEGRADED'
  | 'FAILED';

export interface PortalCapability {
  id: string;
  state: 'supported' | 'unverified' | 'unsupported' | 'not_applicable';
  label_key?: string;
  detail?: string;
}

export interface PortalNavItem {
  id: string;
  label_key: string;
  route: string;
  icon?: string;
  requires_capability?: string;
}

export interface PortalDescriptor {
  forge_id: ForgeId;
  forge_name: string;
  forge_version: string;
  cli: string;
  theme: ForgeId;
  portal_version: string;
  federated: boolean;
  capabilities: PortalCapability[];
  nav: PortalNavItem[];
  workspace?: { root: string | null; name: string | null };
}

export interface ForgePortalPresence {
  state: 'installed' | 'vendored';
  install_root: string | null;
  manifest: string | null;
  installed_at: string | null;
  locations: { kind: string; path: string }[];
}

export type AccountEnvironmentState = 'READY' | 'PARTIAL' | 'MISSING' | 'INVALID';

export interface AccountEnvironmentVariable {
  name: string;
  required: boolean;
  present: boolean;
  valid: boolean | null;
  kind: 'directory' | 'file';
  path: string | null;
}

export interface AccountEnvironment {
  schema: 'forge/InstallEnvironment/v1';
  scope: 'user';
  forge_id: ForgeId;
  prefix: string;
  state: AccountEnvironmentState;
  variables: AccountEnvironmentVariable[];
  windows_aliases: boolean;
}

export interface PortalHealth {
  state: InstallState;
  checks: { id: string; state: string; detail?: string }[];
  workspace: string | null;
  profile: string | null;
  updated_at: string | null;
  forge_portal?: ForgePortalPresence;
  account_environment?: AccountEnvironment;
}

export interface InstallationReceipt {
  status: string;
  stage?: string;
  plan?: Record<string, unknown>;
  plan_token?: string;
  actions?: { kind: string; path: string; status: string }[];
  refusal?: string;
  detail?: string;
  unlock?: string;
  task?: TaskExecution;
  checks?: { id?: string; status?: string; detail?: string; repairable?: boolean }[];
}

export interface InstallSelection {
  scope: 'project' | 'workspace' | 'user';
  hosts: HostId[];
  component_profile: ComponentProfile;
  execution_profile: ExecutionProfile;
  components: Partial<Record<ComponentId, boolean>>;
}

export interface ProfileDescriptor {
  id: string;
  label_key: string;
  description_key: string;
  current: boolean;
  components: Record<string, boolean>;
}

export interface HostDetection {
  host: HostId;
  detected: boolean;
  version: string | null;
  supported: boolean;
  logged_in: boolean | null;
  integration: HostLifecycleState;
  launchable: boolean;
  detail?: string;
  command_hint?: string;
}

export interface McpServerDescriptor {
  id: string;
  state: McpState;
  host: string | null;
  tools_count: number | null;
  last_verify: string | null;
  detail?: string;
  limitations?: string[];
}

export interface SkillDescriptor {
  id: string;
  name: string;
  domain: string | null;
  description: string;
  state: 'discovered' | 'installed' | 'registered' | 'available' | 'invoked' | 'unverified';
  hosts: string[];
  source?: string;
}

export interface AgentDescriptor {
  id: string;
  name: string;
  role: string;
  description: string;
  authority: string | null;
  domains: string[];
  skills: string[];
  hosts: string[];
  state: string;
}

export interface TaskExecution {
  id: string;
  verb: string;
  label: string;
  stage: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  receipt?: Record<string, unknown>;
  refusal?: string;
  correlation_id?: string;
}

/** §5.4 — local-only metrics. Only real recorded events; no remote telemetry. */
export interface MetricsEvent {
  kind: string; // task | install | verify | repair | …
  at: string;
  duration_ms: number | null;
  status: string;
  origin: string;
  correlation_id: string | null;
  detail?: string;
}

export interface MetricsReport {
  generated_at: string;
  counters: Record<string, number>;
  events: MetricsEvent[];
  truncated: boolean;
}

/** §5.5 — version manager. Remote-dependent fields stay null + unverified. */
export interface VersionInfo {
  installed: { version: string | null; origin: string | null; channel: string | null };
  available: { version: string | null; source: string };
  compat: string;
  integrity?: {
    manifest_sha256: string | null;
    manifest_release?: string | null;
    manifest_path?: string | null;
  };
  changelog: string | null;
  history: { version: string | null; at: string | null; detail?: string }[];
  receipts?: { file: string; operation: string | null; status: string | null }[];
  pending?: string | null;
  upgrade_plan?: string | null;
  rollback: { supported: boolean; hint?: string };
}

export interface TaskEvent {
  event: string;
  task_id: string;
  stage?: string;
  /** ISO-8601 stamp recorded by the emitting adapter, when it records
   *  one — optional because producers are not required to timestamp
   *  (SseResult carries whatever the adapter emits). Consumers sort/
   *  render only when present; the field is never inferred. */
  at?: string;
  detail?: string;
  receipt?: Record<string, unknown>;
}

/**
 * forge/PortalEvent/1 — Cycle 3 execution telemetry.
 * docs/observability/execution-events.md is the contract.
 *
 * Floor: `schema` + `event_type` are guaranteed; `timestamp` is the
 * producer's real emit time — stamped when the event is recorded,
 * never back-filled. Every other field is optional and must be
 * treated as absent-when-unverified, not defaulted:
 *   - `correlation_id`/`span_id`/`trace_id`/`parent_span_id`: real
 *     causal relations; a consumer renders a link only when the
 *     value came off the wire.
 *   - `duration_ms`: real measured wall-clock of the thing the event
 *     ends (e.g. operation.end); absent ≠ zero.
 *   - `metadata`/`evidence`: producer context, already redacted.
 */
export interface PortalEvent {
  schema: 'forge/PortalEvent/1';
  event_type: string;
  event_id?: string;
  timestamp?: string;
  correlation_id?: string;
  trace_id?: string;
  span_id?: string;
  parent_span_id?: string;
  source?: string;
  target?: string;
  status?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

/** forge/PortalEventReport/1 — `GET /events`. `truncated` means the
 *  bounded buffer already evicted older events: the window is REAL
 *  but PARTIAL — consumers must surface the gap, not claim full
 *  history. `count` reflects any applied query filters. */
export interface PortalEventReport {
  schema: 'forge/PortalEventReport/1';
  generated_at: string;
  forge_id?: string | null;
  count: number;
  dropped: number;
  truncated: boolean;
  capacity: number;
  counters: Record<string, number>;
  events: PortalEvent[];
}

/** `GET /tasks/{id}/events` — events really linked to one task
 *  (`metadata.task_id` match or shared correlation_id). `task: null`
 *  discriminates "no such record" from "record exists, no events". */
export interface TaskEventReport {
  schema: 'forge/PortalEventReport/1';
  task_id: string;
  task: TaskExecution | null;
  events: PortalEvent[];
  truncated: boolean;
}

export interface GraphAvailability {
  state: 'available' | 'no_graph' | 'disabled' | 'unverified';
  detail?: string;
  refusal?: string;
  unlock?: string;
}

export interface GraphBundle {
  availability: GraphAvailability;
  views: Record<string, unknown>[];
  studio_url: string | null;
}

export interface DocHit {
  path: string;
  title: string;
  excerpt: string;
  category: string;
  url?: string;
}

export interface BootstrapPayload {
  descriptor: PortalDescriptor;
  health: PortalHealth;
  account_environment?: AccountEnvironment;
}

export interface FederationSpecialist {
  provider: string;
  state?: string;
  status?: string;
  cli?: string | null;
  checkout?: string | null;
  mcp?: Record<string, unknown> | null;
  checks?: { id: string; status: string; detail?: string }[];
  notes?: string[];
  [key: string]: unknown;
}

export interface FederationSummary {
  catalog: number;
  installed: number;
  with_mcp: number;
  with_checkout: number;
}

export interface FederationSnapshot {
  specialists: FederationSpecialist[];
  installed_forges: string[];
  registry: { count: number; path: string };
  summary: FederationSummary;
}

/**
 * forge-cli/RegistryState/v1 — read-only projection of
 * `~/.forge-cli/forges/state.json` served by `GET /api/v1/registry/state`.
 * forge-cli is the only writer; receipts arrive whitelisted to
 * scalars/small containers. `present: false` means absent OR malformed
 * state — `error` discriminates ('malformed') — never treat as empty.
 */
export interface RegistryReceipt {
  forge?: string;
  method?: string;
  dist?: string;
  version?: string;
  bin?: string;
  verifiedHash?: string;
  pinned?: string;
  installedAt?: string;
  history?: { version?: string; installedAt?: string }[];
  [key: string]: unknown;
}

export interface RegistryState {
  schema: 'forge-cli/RegistryState/v1';
  state_path: string;
  present: boolean;
  error?: string;
  forges: Record<string, RegistryReceipt>;
}

/**
 * POST /api/v1/registry/plan|execute — plan → confirm → execute via
 * real forge-cli (argv allowlist server-side). `plan.preview` is the
 * CLI's `--plan` doc (or the offline state preview for pin/unpin,
 * whose CLI verb has no plan mode). `plan_token` is one-time and bound
 * to the exact plan — the client must echo `plan` + `plan_token` on
 * execute.
 */
export type RegistryAction =
  | 'install'
  | 'update'
  | 'reinstall'
  | 'uninstall'
  | 'rollback'
  | 'pin'
  | 'unpin'
  | 'repair'
  | 'verify';

export interface RegistryPlanResponse {
  /** 'planned' | 'plan-failed' — a failed plan still carries the
   *  preview the CLI produced; nothing was executed. */
  status: string;
  plan: { action: string; forge: string; preview?: unknown };
  plan_token: string;
  cli?: string;
}

export interface RegistryExecuteResponse {
  /** 'executed' | 'failed' — the CLI's own verdict, never assumed. */
  status: string;
  result?: unknown;
  state: RegistryState;
}

export interface FederationSelection {
  scope: 'project' | 'workspace' | 'user';
  host: 'all' | 'none' | HostId;
  profile: 'minimal' | 'recommended' | 'full';
  gateway_profile?: ExecutionProfile;
  components: Partial<Record<ComponentId, boolean>>;
  forge?: string | null;
}

export interface FederationPlanResponse {
  status: string;
  plan: Record<string, unknown>;
  plan_token: string;
  receipt: InstallationReceipt;
  actions: { kind: string; path: string; status: string }[];
}

// ---- Forge Lab (cyc9-10) — verbatim shapes from GET /api/v1/lab ----
export interface LabMetric {
  state: string;
  unit: string;
  value: number | null;
}
export interface LabScenarioResult {
  scenario_id: string;
  verdict: string;
  duration_ms?: number;
  detail?: string;
  evidence_ref?: string;
  judge?: string | null;
  metrics?: Record<string, LabMetric>;
}
export interface LabForgeRow {
  forge?: string;
  status?: string;
  suite?: string | null;
  mode?: string;
  results?: LabScenarioResult[];
}
export interface LabRun {
  file: string;
  forges: LabForgeRow[];
}
export interface LabReport {
  file: string;
  content: string;
}
export interface LabData {
  dir: string | null;
  runs: LabRun[];
  reports: LabReport[];
  notes: string[];
}
