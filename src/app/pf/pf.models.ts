/**
 * Product Forge engine wire models — `forge/PortalApi/1` envelope, the
 * `data` half typed per route. Field semantics follow the engine's own
 * contract: absent keys mean "not reported" — pages render UNVERIFIED,
 * never a default that pretends a measurement.
 *
 * Verified against product-forge `src/product_forge/api/app.py`.
 */

export interface PfHealth {
  forge_id: string;
  version: string;
  status: string;
  uptime_s?: number;
}

/** Supervisor-reported state for the portal-managed Agent Bridge
 *  (`GET /agent/health` → `managed`; absent when unsupervised). */
export interface PfManagedBridge {
  state?: string;
  pid?: number | null;
  port?: number;
  url?: string;
  restarts?: number;
  last_exit?: number | null;
  gateway?: string;
}

export interface PfAgentHealth {
  managed?: PfManagedBridge;
  [key: string]: unknown;
}

export interface PfChatCleanup {
  closed: string[];
  kept: string[];
  errors: { id: string; result: unknown }[];
  state?: string;
}

export interface PfWorkspace {
  id: string;
  name: string;
  description?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
}

/** productforge/WorkspaceDiscovery/v1 — metadata-only local discovery. */
export interface PfWorkspaceRepository {
  id: string;
  name: string;
  path: string;
  repository: string;
  is_git?: boolean;
  languages?: string[];
  manifests?: string[];
  state?: string;
}

export interface PfWorkspaceDocument {
  id: string;
  path: string;
  relative_path: string;
  repository: string;
  kind: 'prd' | 'brief' | 'knowledge';
  title: string;
  extension?: string;
  size: number;
  modified_at?: string;
  state?: string;
  readable?: boolean;
}

export interface PfWorkspaceDiscovery {
  schema: string;
  generated_at: string;
  workspace: {
    name: string;
    path: string;
    source: string;
    current_repository?: string | null;
  };
  repositories: PfWorkspaceRepository[];
  projects?: PfWorkspaceRepository[];
  documents: PfWorkspaceDocument[];
  skipped?: string[];
  limits?: Record<string, number>;
  state: 'discovered' | 'degraded' | string;
}

export interface PfWorkspacePreview {
  path: string;
  kind: string;
  title: string;
  size: number;
  preview: string;
  truncated?: boolean;
  state: string;
}

export interface PfWorkspaceImport extends PfDocument {
  state?: string;
  source_path?: string;
  source_kind?: string;
}

/** productforge/ObsidianDocument/v1 — bounded local vault preview. */
export interface PfObsidianPreview {
  schema?: string;
  path: string;
  title: string;
  preview: string;
  content_hash?: string;
  size: number;
  state: string;
  provenance?: Record<string, unknown>;
}

export interface PfObsidianImport extends PfDocument {
  state?: string;
  source_path?: string;
  source_kind?: string;
}

/** productforge/UrlDocument/v1 — bounded remote capture preview. */
export interface PfUrlPreview {
  schema?: string;
  url: string;
  title: string;
  preview: string;
  content_hash?: string;
  size: number;
  content_type?: string;
  extractor?: string;
  state: string;
  warnings?: string[];
  metrics?: Record<string, number>;
  provenance?: Record<string, unknown>;
}

export interface PfUrlImport extends PfDocument {
  state?: string;
  source_url?: string;
  source_kind?: string;
  capture?: Omit<PfUrlPreview, 'preview'>;
}

export interface PfProduct {
  id: string;
  workspace_id: string;
  name: string;
  description?: string;
  domain?: string;
  tags?: string[];
  stakeholders?: string[];
  status?: string;
  created_at?: string;
  updated_at?: string;
}

export interface PfTaskProposal {
  id: string;
  product_id: string;
  source?: string;
  session_id?: string;
  state: 'proposed' | 'approved' | 'rejected';
  tasks: {
    title: string;
    description?: string;
    priority?: string;
    type?: string;
    acceptance_criteria?: string[];
    depends_on?: string[];
    destination?: string;
    agent?: string;
  }[];
  task_ids?: string[];
  created_at?: string;
}

export interface PfList<T> {
  items: T[];
}

/** productforge/ProductContextPackage/v1 */
export interface PfContextPackage {
  schema?: string;
  product: PfProduct;
  sources?: PfKnowledgeSource[];
  entities?: PfEntity[];
  agents?: PfAgent[];
  data_sources?: PfDataSource[];
  generated_at?: string;
}

export interface PfKnowledgeSource {
  id: string;
  product_id?: string;
  name: string;
  type?: string;
  locator?: string;
  status?: string;
  classification?: string;
  last_indexed_at?: string | null;
  created_at?: string;
}

export interface PfDocument {
  id: string;
  product_id?: string;
  title: string;
  status?: string;
  chunk_count?: number;
  content_hash?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface PfDocumentDetail {
  schema?: string;
  document: PfDocument;
  content: {
    chunks: { id: string; document_id: string; seq: number; text: string }[];
    chunk_count: number;
  };
  source?: string;
  versions: { state: string; items: PfDocument[] };
  relations?: unknown[];
}

/** productforge/KnowledgeSearch/v1 — bounded, body-free federated hits. */
export interface PfKnowledgeSearchHit {
  kind?: 'document' | 'source' | 'entity' | 'relation';
  id: string;
  document_id?: string;
  chunk_id?: string;
  seq?: number;
  title: string;
  snippet: string;
  source?: string;
  version?: number;
  from_entity?: string;
  to_entity?: string;
}

/** @deprecated use PfKnowledgeSearchHit for new federated consumers. */
export type PfDocumentSearchHit = PfKnowledgeSearchHit;

export interface PfEntity {
  id: string;
  kind?: string;
  name: string;
  description?: string;
  confidence?: number;
  provisional?: boolean;
  attributes?: Record<string, unknown>;
  evidence?: string[];
}

export interface PfCitation {
  chunk_id: string;
  document_id: string;
  snippet: string;
  title?: string;
}

/** POST …/knowledge/query — `synthesis` is the engine's honest status
 *  string: `ok` | `unavailable:<reason>` | `error:<reason>`. */
export interface PfKnowledgeAnswer {
  question: string;
  citations: PfCitation[];
  answer: string | null;
  synthesis: string;
  synthesis_meta?: Record<string, unknown>;
}

export interface PfKnowledgeHealth {
  schema?: string;
  product_id?: string;
  score: number;
  sources?: { total: number; indexed: number; unverified_or_failed: number };
  documents?: number;
  entities?: { total: number; provisional: number };
  warnings?: string[];
}

export interface PfGraphNode {
  id: string;
  label?: string;
  kind?: string;
  confidence?: number;
  provisional?: boolean;
}

export interface PfGraphEdge {
  id: string;
  from: string;
  to: string;
  kind?: string;
  confidence?: number;
}

export interface PfGraph {
  schema?: string;
  product_id?: string;
  nodes: PfGraphNode[];
  edges: PfGraphEdge[];
  stats?: { nodes: number; edges: number };
}

export interface PfAgentTemplate {
  name: string;
  mission: string;
  tools?: string[];
  skill?: string | null;
  knowledge_scope?: string;
  eval_cases?: number;
}

export interface PfAgent {
  id: string;
  product_id?: string;
  name: string;
  mission?: string;
  template?: string;
  status?: string;
  knowledge_scope?: string[];
  tools_allowed?: string[];
  policies?: Record<string, unknown>;
  version?: number;
  eval_summary?: { score?: number; passed?: number; total?: number; at?: string } | null;
  created_at?: string;
  updated_at?: string;
}

export interface PfRunStep {
  step: string;
  status: string;
  duration_ms?: number;
  detail?: string;
}

export interface PfRunOutput {
  summary?: string;
  citations?: PfCitation[];
  grounded?: boolean;
  note?: string;
  refusal?: string;
  violations?: unknown[];
}

export interface PfAgentRun {
  id: string;
  agent_id?: string;
  agent_version?: number;
  input?: string;
  status: string;
  steps?: PfRunStep[];
  violations?: unknown[];
  output?: PfRunOutput | null;
  created_at?: string;
  updated_at?: string;
}

export interface PfEvalResult {
  case: string;
  passed: boolean;
  checks?: string[];
}

export interface PfEvalReport {
  schema?: string;
  agent_id: string;
  version?: number;
  score: number;
  passed: number;
  total: number;
  results?: PfEvalResult[];
}

export interface PfDataSource {
  id: string;
  product_id?: string;
  name: string;
  connector?: string;
  status?: string;
  locator?: string;
  dialect?: string;
  read_only?: boolean;
  catalog_allowlist?: string[];
  last_verified_at?: string | null;
  created_at?: string;
}

export interface PfSchemaColumn {
  name: string;
  type?: string;
}

export interface PfSchemaTable {
  name: string;
  columns?: (PfSchemaColumn | string)[];
}

export interface PfSourceSchema {
  engine?: string;
  tables?: PfSchemaTable[];
}

export interface PfVerifyResult {
  status: string;
  engine?: string;
  error?: string;
  [key: string]: unknown;
}

/** productforge/QueryValidation/v1 — read-only gate verdict. */
export interface PfQueryValidation {
  schema?: string;
  ok: boolean;
  dialect?: string;
  kind?: string;
  tables?: string[];
  errors?: string[];
  engine?: string;
}

/** productforge/QueryRun/v1 — `result_preview` is the REAL row window
 *  (≤100 rows); `rows` is the full row COUNT, never the row payload. */
export interface PfQueryRun {
  id: string;
  status: string;
  rows?: number;
  duration_ms?: number;
  truncated?: boolean;
  columns?: string[];
  result_preview?: unknown[][];
  masked_columns?: string[];
  error?: string;
  statement?: string;
  dialect?: string;
  created_at?: string;
}

export interface PfCompileResult {
  sql: string;
  spec?: Record<string, unknown>;
}

export interface PfWidget {
  id?: string;
  type?: string;
  title?: string;
  source_id?: string;
  statement?: string;
  spec?: Record<string, unknown>;
}

export interface PfDashboard {
  id: string;
  product_id?: string;
  name: string;
  description?: string;
  widgets?: PfWidget[];
  filters?: Record<string, unknown>;
  created_at?: string;
}

export interface PfWidgetResult {
  id?: string;
  type: string;
  title?: string;
  state: 'ok' | 'error' | 'unavailable' | string;
  error?: string;
  query_id?: string;
  duration_ms?: number;
  truncated?: boolean;
  data?: {
    columns?: string[];
    rows?: unknown[][];
    value?: unknown;
    label?: string;
    labels?: string[];
    series?: { name: string; values: unknown[] }[];
  };
}

export interface PfDashboardRender {
  schema?: string;
  dashboard_id?: string;
  widgets: PfWidgetResult[];
  stats?: { total: number; ok: number; unavailable: number };
}

export interface PfInitiative {
  id: string;
  product_id?: string;
  title: string;
  hypothesis?: string;
  status?: string;
  priority_score?: number;
  evidence?: string[];
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface PfPrioritizeResult {
  initiative_id: string;
  methods?: Record<string, { score: number; inputs?: Record<string, unknown> }>;
  score: number;
  evidence_count?: number;
}

export interface PfRoadmapItem {
  id: string;
  title?: string;
  priority_score?: number;
  status?: string;
  evidence_count?: number;
}

export interface PfRoadmap {
  schema?: string;
  product_id?: string;
  generated_at?: string;
  lanes?: Record<string, PfRoadmapItem[]>;
  stats?: { initiatives: number; rejected: number };
}

export interface PfBoardColumn {
  id: string;
  name: string;
  position?: number;
}

export interface PfTask {
  id: string;
  workspace_id: string;
  product_id: string;
  board_id: string;
  column_id: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  position?: number;
  version?: number;
  comments?: { id: string; author: string; text: string; created_at: string }[];
}

export interface PfBoard {
  schema?: string;
  product_id: string;
  board: { id: string; name: string; columns: PfBoardColumn[] };
  tasks: PfTask[];
  items?: PfInitiative[];
}

export interface PfPrd {
  schema?: string;
  initiative_id: string;
  title?: string;
  markdown?: string;
  evidence?: { chunk_id: string; resolved?: boolean }[];
  related_entities?: number;
}

export interface PfDecision {
  id: string;
  product_id?: string;
  title: string;
  context?: string;
  decision?: string;
  alternatives?: string[];
  evidence?: string[];
  created_at?: string;
}

export interface PfHealthDimension {
  score: number;
  evidence: { kind: string; detail: string; weight?: number }[];
}

export interface PfProductHealth {
  schema: string;
  product_id: string;
  overall: number;
  weakest_dimension: string;
  dimensions: Record<string, PfHealthDimension>;
  note?: string;
}

export interface PfMetric {
  id: string;
  name: string;
  formula: string;
  source_id?: string | null;
  dimensions?: string[];
  granularity?: string;
  owner?: string;
}

export interface PfNlQueryResult {
  ok: boolean;
  sql?: string;
  via?: string;
  reason?: string;
  metric?: { id: string; name: string };
  tables_available?: string[];
}

export interface PfExperiment {
  id: string;
  title: string;
  hypothesis?: string;
  status?: string;
  outcome?: string;
  success_metrics?: string[];
  guardrails?: Record<string, number>;
  baseline?: Record<string, number>;
  results?: Record<string, number>;
}

export interface PfMeeting {
  id: string;
  title: string;
  status?: string;
  transcript?: string;
  draft_items?: { kind: string; text: string; line: number }[];
  published_refs?: string[];
}

export interface PfApiSpec {
  id: string;
  product_id?: string;
  name: string;
  kind?: string;
  version?: string | null;
  surface?: {
    operations?: {
      path: string;
      method: string;
      operation_id?: string;
      summary?: string;
      params?: { name: string; in?: string; required?: boolean; type?: string }[];
      request_body_required?: boolean;
      responses?: string[];
    }[];
    schemas?: Record<string, unknown>;
  };
  created_at?: string;
}

export interface PfApiImportResult {
  api_spec_id: string;
  kind: string;
  entities_created: number;
}

/** productforge/ImpactAnalysis/v1 — BFS over relations from `origin`. */
export interface PfImpactItem {
  entity_id: string;
  name?: string;
  kind?: string;
  depth?: number;
  via?: string;
}

export interface PfImpact {
  schema?: string;
  product_id?: string;
  origin?: string;
  max_depth?: number;
  impacted?: PfImpactItem[];
  count?: number;
}

export interface PfReport {
  id: string;
  product_id?: string;
  kind?: string;
  markdown?: string;
  stats?: Record<string, unknown>;
  created_at?: string;
}

export interface PfAuditEvent {
  id: string;
  created_at?: string;
  actor?: string;
  actor_kind?: string;
  action?: string;
  resource_type?: string;
  resource_id?: string;
  correlation_id?: string;
  product_id?: string | null;
  workspace_id?: string | null;
  details?: Record<string, unknown>;
}

export interface PfDelegate {
  id: string;
  cli?: string;
  workflows?: string[];
  description?: string;
  status?: string;
  resolved?: string | null;
}

export interface PfDelegateCallResult {
  status?: string;
  output?: unknown;
  error?: string;
  [key: string]: unknown;
}

export interface PfCapability {
  id: string;
  state: string;
}

export interface PfCapabilities {
  forge_id: string;
  capabilities: PfCapability[];
}
