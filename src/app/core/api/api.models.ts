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

export interface PortalHealth {
  state: InstallState;
  checks: { id: string; state: string; detail?: string }[];
  workspace: string | null;
  profile: string | null;
  updated_at: string | null;
  forge_portal?: ForgePortalPresence;
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
}

export interface TaskEvent {
  event: string;
  task_id: string;
  stage?: string;
  detail?: string;
  receipt?: Record<string, unknown>;
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
