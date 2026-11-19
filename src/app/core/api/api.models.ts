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
  | 'NOT_APPLICABLE'
  | 'UNVERIFIED'
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

/**
 * forge/InstallLifecycle/v1 (cycle 16.1 §5.3) — the finer-grained honest
 * position of an installation, derived from receipt/health evidence by
 * the writer. Closed vocabulary; `completed` is a legacy receipt-status
 * alias, never a lifecycle state:
 *
 *   planned | blocked | failed | applied | partially_applied |
 *   verified | unverified | ready | certified
 */
export type InstallLifecycleState =
  | 'planned'
  | 'blocked'
  | 'failed'
  | 'applied'
  | 'partially_applied'
  | 'verified'
  | 'unverified'
  | 'ready'
  | 'certified';

export interface InstallLifecycle {
  schema?: 'forge/InstallLifecycle/v1' | string;
  state: InstallLifecycleState | string;
  detail?: string;
}

/** Ledger drift projection some adapters forward verbatim from the
 *  install status doc (others omit it → render UNVERIFIED). */
export interface InstallDrift {
  ok?: number;
  modified?: { path?: string; status?: string }[] | string[];
  missing?: { path?: string; status?: string }[] | string[];
  unsafe?: { path?: string; status?: string }[] | string[];
}

/** One doctor/health check row. `guidance` is the optional structured
 *  PROBLEMA/CAUSA/AÇÃO/ESTADO block adapters may emit (theforge
 *  environment doctor); absent → the UI renders the row without
 *  inventing a cause. */
export interface HealthCheck {
  id: string;
  state: string;
  status?: string;
  detail?: string;
  repairable?: boolean;
  guidance?: {
    problema?: string;
    causa_provavel?: string;
    acao?: string;
    estado?: string;
  };
}

export interface PortalHealth {
  state: InstallState;
  checks: HealthCheck[];
  workspace: string | null;
  profile: string | null;
  updated_at: string | null;
  forge_portal?: ForgePortalPresence;
  account_environment?: AccountEnvironment;
  /** forge/InstallLifecycle/v1 — present only when the adapter forwards
   *  the status/receipt lifecycle block; absent → UNVERIFIED. */
  lifecycle?: InstallLifecycle | null;
  /** Ledger drift projection — optional pass-through. */
  drift?: InstallDrift;
  /** Doctor context block — optional pass-through (profile/managed/tools). */
  context?: {
    profile?: string | null;
    managed_entries?: number | null;
    tools_exposed?: number | null;
  };
  /** Optional install-status fields some adapters forward verbatim. */
  scope?: string | null;
  target_root?: string | null;
  ledger_entries?: number | null;
  receipts?: string[];
}

/**
 * §4.4 named selection state — emitted verbatim by `install_auto` on
 * blocked receipts and on uniform post-apply outcomes. `state` is the
 * closed engine vocabulary: `no_registered_forges`,
 * `empty_manual_selection`, `no_relevant_recommendation`,
 * `recommendation_ambiguous`, `no_installed_runtimes`,
 * `no_supported_component`, `all_already_active`. `next_action` is the
 * operator-facing guidance the engine computed — rendered, never
 * rephrased. Absent on adapters that predate the contract.
 */
export interface SelectionState {
  state?: string;
  requested?: string[] | null;
  detail?: string;
  next_action?: string;
}

/** One delegated per-forge row inside an install-auto receipt. */
export interface ForgeResultRow {
  forge_id?: string;
  via?: string;
  status?: string;
  detail?: string;
  cmd?: string[];
  receipt_id?: string;
  verification?: { status?: string } & Record<string, unknown>;
}

/** forge/SpecialistRecommendation/v1 row — advisory, never self-acting. */
export interface RecommendationRow {
  forge_id?: string;
  role?: string;
  confidence?: string;
  reason?: string;
  evidence?: string[];
  installed?: boolean;
}

/** forge/SpecialistRecommendation/v1 — the engine's advisory block. */
export interface SpecialistRecommendation {
  suggested?: RecommendationRow[];
  alternatives?: RecommendationRow[];
  limitations?: string[];
  note?: string;
}

/** forge/WorkspaceDetection/v1 — evidence-based tech scan (§6.1). */
export interface WorkspaceDetection {
  root?: string;
  members?: {
    path?: string;
    techs?: string[];
    confidence?: string;
    evidence?: { tech?: string; kind?: string; confidence?: string; detail?: string }[];
  }[];
  workspace_techs?: string[];
  limitations?: string[];
}

/**
 * forge/HostOnboarding/v1 — honest per-host states. `state` is the
 * closed vocabulary `not_found|installed|in_path|configurable|
 * integration_written|restart_needed|mcp_verified|validated` — the
 * portal renders it verbatim so `configured` is never promoted to
 * `verified` and `mcp_verified` means a real handshake ran.
 */
export interface HostOnboarding {
  hosts?: {
    host?: string;
    state?: string;
    detail?: string;
    evidence?: { kind?: string; detail?: string }[];
  }[];
  next_steps?: string[];
  limitations?: string[];
  mcp?: Record<string, unknown>;
}

/** forge/WorkspaceInstall/v1 conflict entry (path claimed by ≥2 forges). */
export interface InstallPathConflict {
  path?: string;
  claimants?: string[];
  winner?: string;
  loser?: string;
  resolution?: string | null;
  detail?: string;
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
  /** forge/InstallLifecycle/v1 block the install writer attaches —
   *  absent on adapters that predate the contract. */
  lifecycle?: InstallLifecycle | null;
  /** Plan-phase adapters may nest the raw plan receipt under `receipt`. */
  receipt?: { lifecycle?: InstallLifecycle | null; status?: string } & Record<string, unknown>;
  // ---- install-auto pass-through blocks (cycle 16.1) — all optional;
  // the portal renders them verbatim and never fabricates an absent one.
  /** §4.4 named selection state on blocked/uniform receipts. */
  selection?: SelectionState | null;
  /** Aggregate verification verdict — PASS|FAIL|UNVERIFIED. */
  verification?: { status?: string } & Record<string, unknown>;
  /** Per-forge delegated results. */
  forges?: ForgeResultRow[];
  /** forge/WorkspaceDetection/v1 — workspace tech evidence. */
  workspace_detection?: WorkspaceDetection | null;
  /** forge/SpecialistRecommendation/v1 — advisory specialist suggestion. */
  recommendation?: SpecialistRecommendation | null;
  /** forge/HostOnboarding/v1 — per-host honest states + next steps. */
  onboarding?: HostOnboarding | null;
  /** Setup resolution provenance doc (flag|preset|config|default). */
  setup?: Record<string, unknown> | null;
  /** forge/WorkspaceInstall/v1 doc (order, conflicts, members). */
  installation?: {
    conflicts?: InstallPathConflict[];
    members?: unknown[];
    verification?: string;
  } & Record<string, unknown>;
  /** Workspace-scope member report (forge/WorkspaceInstall/v1 §11). */
  workspace?: {
    members?: { path?: string; state?: string; detail?: string }[];
  } & Record<string, unknown>;
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

export interface InvestigationPlan {
  operation: 'federated_investigation';
  intent: string;
  inputs: string[];
  authorized_risks: string[];
  max_providers: number;
  probe: boolean;
  allow_unverified: boolean;
}

export interface InvestigationPlanResponse {
  status: 'planned';
  plan: InvestigationPlan;
  plan_token: string;
  report: Record<string, unknown>;
}

export interface InvestigationReceipt {
  status: string;
  path: string;
  report: Record<string, unknown>;
  actions: { kind: string; path: string; status: string }[];
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
  state: 'available' | 'no_graph' | 'disabled' | 'unverified' | 'unavailable' | 'computing';
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
  workflows?: FederationWorkflow[];
  workflow_count?: number;
  notes?: string[];
  [key: string]: unknown;
}

export interface FederationWorkflow {
  id: string;
  mode?: string;
  description?: string;
  read_only?: boolean;
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
  /**
   * forge/context-registry/v1 projection — the serving forge's
   * `.forge/context/` read verbatim by the adapter. Optional: older
   * adapters (and forges without the context engine) omit the key —
   * render that as UNVERIFIED, never as "absent".
   */
  context?: ContextRegistryProjection;
}

// ---- forge/context-registry/v1 — granular per-forge projection ------
//
// Served inside the federation snapshot by adapters that vendor the
// forge-context engine. Every field the manifest/registry never
// recorded stays `null` — the UI must not interpolate. Vocabularies
// come from `forge/context/v1`: manifest state
// available|degraded|unavailable, health
// healthy|degraded|unverified|broken, kind from FORGE_KINDS.
export type ForgeContextSectionState = 'registered' | 'absent' | 'corrupt' | 'unverified';

export type ForgeKind =
  | 'specialist'
  | 'orchestrator'
  | 'diagnostic-provider'
  | 'code-intelligence'
  | 'observability'
  | 'user-interface'
  | 'cli-runtime';

export type ForgeManifestState = 'available' | 'degraded' | 'unavailable';
export type ForgeHealthState = 'healthy' | 'degraded' | 'unverified' | 'broken';

export interface ForgeContextProjection {
  state: ForgeManifestState | string | null;
  kind: ForgeKind | string | null;
  health: ForgeHealthState | string | null;
  health_checks: number | null;
  degraded_reasons: string[];
  /** Discovery mechanisms the capability manifest declared
   *  (native-runtime|cli|mcp|bundled|workspace-file), deduped. */
  discovery: string[];
  discovery_manifest: string | null;
  scope: string | null;
  profile: string | null;
  updated_at: string | null;
}

export interface ContextRegistryProjection {
  schema?: string;
  state: ForgeContextSectionState;
  path?: string | null;
  count?: number;
  detail?: string;
  forges: Record<string, ForgeContextProjection>;
}

// ---- forge/PortalAtlasStatus/1 — GET /api/v1/atlas/status ------------
//
// The adapter's read-only loopback probe of code-atlas
// (default http://127.0.0.1:8741, GET /api/v1/health + /index/status).
// Three named states — a reachable-but-unhappy service is `degraded`,
// an unreachable one `unavailable` — never a transport error, so the UI
// renders the verdict as data. `detail` is a stable failure token
// (connection-refused, timeout, http-503, invalid-json, index:…), not
// prose. `checked_at` is the real probe time.
export type AtlasProbeState = 'available' | 'degraded' | 'unavailable';

export interface AtlasRepoIndex {
  repository_id: number | null;
  root_handle: string | null;
  ready_snapshots: number | null;
  latest_ready: number | null;
  counts: Record<string, number>;
}

export interface AtlasIndexStatus {
  items: AtlasRepoIndex[];
  repositories: number;
  ready_snapshots: number;
}

export interface AtlasStatus {
  schema: 'forge/PortalAtlasStatus/1';
  state: AtlasProbeState;
  url: string | null;
  service: string | null;
  api_version: number | null;
  detail: string | null;
  health: Record<string, unknown> | null;
  index: AtlasIndexStatus | null;
  checked_at: string | null;
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
  /**
   * Explicit specialist filter forwarded verbatim to `install_auto`
   * (`forge: str | Sequence[str] | None`). A list is the operator's
   * reviewed selection — `[]` is an *explicit empty* the engine blocks
   * with the named `empty_manual_selection` state, never widened to
   * "all registered". `null`/absent keeps the engine default.
   */
  forge?: string | string[] | null;
}

export interface FederationPlanResponse {
  status: string;
  plan: Record<string, unknown>;
  plan_token: string;
  /** Engine receipt nested by adapters that implement install-auto —
   *  absent on minimal adapters → every block below renders only what
   *  was actually sent. */
  receipt?: InstallationReceipt;
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
export interface ResourceEntry {
  forge_id: string;
  id: string;
  kind: string | null;
  resource_class: string | null;
  availability: string;
  unavailable_reason: string | null;
  location: string | null;
  packaged_location?: string | null;
  tags: string[];
  description: string | null;
  format: string | null;
  /** Manifest-declared version (entry override wins); absent → null. */
  version?: string | null;
  /** Manifest-declared domain — not yet declared by any manifest → null. */
  domain?: string | null;
  /** Entry `hosts` override, else the manifest's `host_adapters`. */
  hosts?: string[];
  /** Declared content hash — never computed here (list+locate policy). */
  hash?: string | null;
  /** Declared integrity state; absent → null, never "ok" by default. */
  integrity?: string | null;
}
/** A detected workspace member repository (§20.1). Marker-driven:
 *  `.git` or a project manifest — gitless members surface too. */
export interface WorkspaceMember {
  name: string;
  /** Workspace-relative path ('.' for the root itself). */
  path: string;
  /** Sorted marker basenames found (e.g. ['.git', 'pyproject.toml']). */
  markers: string[];
  git: boolean;
  manifest: boolean;
}
export interface WorkspaceResources {
  workspace: string | null;
  forges: string[];
  /** Present since the member-detection wave; older servers omit it. */
  members?: WorkspaceMember[];
  resources: ResourceEntry[];
  errors: string[];
}

// ---- theforge/PortalSpecialists/v1 — GET /api/v1/specialists ---------
// Real discovery pass (metadata/files only — probe=false, so a state can
// never reach VERIFIED from this endpoint). `generated_at` is the
// persisted last-check stamp; `probed` tells whether CLI probes ran.
export interface SpecialistCapability {
  id: string;
  description?: string | null;
  version?: string | null;
  finding_class?: string | null;
  execution_mode?: string | null;
  risk?: string | null;
  requires?: string[];
  external_cost?: boolean | null;
  limitations?: string[];
}

export interface SpecialistRow {
  provider: string;
  state?: string | null;
  version?: string | null;
  checks?: Record<string, unknown>;
  notes?: string[];
  limitations?: string[];
  capabilities?: SpecialistCapability[];
  capability_count?: number;
  workflows?: FederationWorkflow[];
  workflow_count?: number;
  agent_roster?: Record<string, unknown> | null;
  compatibility?: { state?: string; detail?: string };
  relations?: {
    declared?: {
      family?: string | null;
      composes_with?: string[];
      preferred_verifiers?: string[];
      fallback?: string[];
    };
  };
  last_check?: string | null;
}

export interface SpecialistsReport {
  schema?: string;
  availability: { state: string; detail?: string | null; probed?: boolean };
  generated_at?: string | null;
  probed?: boolean;
  truncated?: boolean;
  limitations?: string[];
  specialists: SpecialistRow[];
}

// ---- theforge/PortalDelegations/v1 — GET /api/v1/delegations ---------
export interface DelegationEntry {
  coordinator?: string;
  specialist?: string | null;
  capability?: string | null;
  status?: string | null;
  finding_class?: string | null;
  risks?: string[];
  cost_bearing?: boolean;
  justification?: string[];
  command?: string[];
  delegation_stage?: string;
  handoff_status?: string;
  notes?: string[];
}

export interface DelegationRun {
  file?: string | null;
  correlation_id?: string | null;
  kind?: string | null;
  intent?: string | null;
  generated_at?: string | null;
  plan_status?: string | null;
  duration_ms?: number | null;
  entries?: DelegationEntry[];
  findings?: Record<string, unknown>[];
  unresolved?: Record<string, unknown>[];
  recommended?: string[];
  provenance?: Record<string, unknown>;
  limitations?: string[];
  unknowns?: string[];
  prior_runs_same_intent?: number;
}

export interface DelegationsReport {
  schema?: string;
  availability: { state: string; detail?: string | null };
  notes?: string[];
  runs: DelegationRun[];
}

// ---- theforge/PortalDelegationGraph/v1 — /delegations/graph ----------
export interface DelegationGraphNode {
  id: string;
  kind: string;
  label?: string;
  [key: string]: unknown;
}

export interface DelegationGraphEdge {
  source: string;
  target: string;
  kind: string;
  provenance: string;
  detail?: string;
}

export interface DelegationGraph {
  schema?: string;
  availability: {
    state: string;
    detail?: string | null;
    declared?: string;
    observed_reports?: number;
  };
  notes?: string[];
  views: {
    nodes: DelegationGraphNode[];
    edges: DelegationGraphEdge[];
    edge_kinds?: string[];
    provenances?: string[];
  }[];
}
