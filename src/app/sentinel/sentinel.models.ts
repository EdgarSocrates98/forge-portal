/**
 * API Sentinel wire models — `api-sentinel/v1` payloads over `/v1/*`.
 *
 * These interfaces mirror the Pydantic models in api-sentinel-forge
 * (`src/api_sentinel/api/schemas.py`, `application/use_cases.py`,
 * `domain/models.py`, `incidents/models.py`, `reliability/*`). Sentinel
 * responses are NOT the `forge/PortalApi/1` envelope: every operational
 * payload is the typed model itself plus the honest-read fields
 * `unknowns` and `evidence_refs`. Errors arrive as RFC-7807
 * `application/problem+json` (`SentinelProblemDetails`), never bare 500s.
 *
 * Nullability is contract-faithful: `null` means known-absent; an absent
 * indicator (e.g. `latency_p95_ms: null`) is a source limitation, never
 * a zero to render.
 */

// -- honest-read envelope (every operational response carries both) --------

export interface SentinelEnvelope {
  unknowns: string[];
  evidence_refs: string[];
}

/** RFC-7807 problem body emitted by the Sentinel error handlers. */
export interface SentinelProblemDetails {
  type: string; // urn:api-sentinel:<code>
  title: string;
  status: number;
  detail: string;
  code: string; // sentinel.<name>
  details: Record<string, unknown>;
}

// -- /v1/health + /v1/capabilities -----------------------------------------

export interface SentinelHealth extends SentinelEnvelope {
  /** AVAILABLE when the workspace db is present; PARTIAL when absent. */
  state: 'AVAILABLE' | 'PARTIAL' | string;
  version: string;
  workspace_initialized: boolean;
  database: 'present' | 'absent' | string;
  capabilities: Record<string, number>;
  /** Live self-observability block (table counts, staleness, quarantine)
   *  — shape evolves; render keys, never assume presence. */
  sentinel: Record<string, unknown>;
}

export interface SentinelCapability {
  capability_id: string;
  /** available | declared | unavailable — honest vocabulary. */
  status: string;
  /** implemented|tested|integrated|verified|production_validated —
   *  highest PROVEN maturity rung; may be '' when not yet assessed. */
  stage: string;
  since: string | null;
  notes: string;
}

export interface SentinelCapabilitiesResponse extends SentinelEnvelope {
  capabilities: SentinelCapability[];
}

// -- identity / services ----------------------------------------------------

export interface SentinelExternalRef {
  kind: string;
  ref: string;
  /** declared | verified | inferred — identity provenance (ADR-012). */
  provenance: string;
}

export interface SentinelService {
  service_id: string;
  service_name: string;
  environment_id: string;
  namespace: string | null;
  display_name: string | null;
  external_refs: SentinelExternalRef[];
  created_at: string;
  updated_at: string;
}

// -- metrics ----------------------------------------------------------------

export interface SentinelMergedBucket {
  /** le may arrive as the string '+Inf' (JSON cannot carry Infinity). */
  le: number | '+Inf' | string;
  cum_count: number;
}

/** Windowed indicators for one (service, operation, source) population. */
export interface SentinelWindowAggregate {
  service_id: string;
  operation_id: string | null;
  source_id: string;
  window_start: string;
  window_end: string;
  /** histogram | counter | summary | null (no request data). */
  plane: string | null;
  eligible_requests: number;
  ok_requests: number;
  error_requests: number;
  timeout_requests: number;
  auth_denied_requests: number;
  rate_limited_requests: number;
  request_rate: number | null;
  error_ratio: number | null;
  timeout_ratio: number | null;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  latency_p99_ms: number | null;
  latency_mean_ms: number | null;
  latency_buckets: SentinelMergedBucket[];
  /** COMPLETE | PARTIAL | SAMPLED | STALE | INVALID | UNKNOWN */
  quality: string;
  observations_included: number;
  observations_excluded: number;
  excluded_by_reason: Record<string, number>;
  limitations: string[];
}

export interface SentinelSourceHealth {
  source_id: string;
  registered: boolean;
  observations: number;
  latest_window_end: string | null;
  /** has data, but the newest window is older than the staleness policy. */
  stale: boolean;
}

export interface SentinelHealthReport {
  service_id: string;
  /** AVAILABLE | UNAVAILABLE | PARTIAL | UNVERIFIED | UNKNOWN (ADR-018). */
  state: string;
  /** observed | degraded | failing | no_traffic | unmeasurable |
   *  source_stale | no_observations — WHY the state is what it is. */
  condition: string;
  evaluated_at: string;
  latest_window_start: string | null;
  latest_window_end: string | null;
  latest_indicators: SentinelWindowAggregate | null;
  absent_indicators: string[];
  quality: string;
  sources: SentinelSourceHealth[];
  unknowns: string[];
  limitations: string[];
}

export interface SentinelCoverage {
  sources_registered: number;
  sources_observed: number;
  observations: number;
  latest_window_end: string | null;
}

export interface SentinelServiceSummary {
  service: SentinelService;
  health: SentinelHealthReport;
  coverage: SentinelCoverage;
  open_incidents: number;
  slo_definitions: number;
}

export interface SentinelServiceListResponse extends SentinelEnvelope {
  services: SentinelServiceSummary[];
}

export interface SentinelTelemetrySource {
  source_id: string;
  /** jsonl-file | otlp-json | otel-collector | prometheus | cloudwatch |
   *  api-gateway | other */
  kind: string;
  service_id: string;
  enabled: boolean;
  config: Record<string, string>;
  created_at: string;
}

export interface SentinelServiceDetail extends SentinelServiceSummary {
  sources: SentinelTelemetrySource[];
}

export interface SentinelProductForgeLink {
  /** proven | declared | unproven — correspondence verdict (ADR-011). */
  state: string;
  ref: SentinelExternalRef | null;
  reason: string;
}

export interface SentinelServiceLinks {
  service_id: string;
  links: SentinelExternalRef[];
  correspondence: SentinelProductForgeLink;
  unknowns: string[];
}

export interface SentinelServiceDetailResponse extends SentinelEnvelope {
  detail: SentinelServiceDetail;
  links: SentinelServiceLinks;
}

// -- operations ---------------------------------------------------------------

export interface SentinelOperation {
  operation_id: string | null;
  operation_ref: string | null;
  /** declared | observed | declared+observed — never merged silently. */
  provenance: string;
  protocol: string | null;
  method: string | null;
  route: string | null;
  observations: number;
  sources: string[];
  latest_window_end: string | null;
  quality: string;
}

export interface SentinelOperationsResponse extends SentinelEnvelope {
  operations: SentinelOperation[];
}

// -- metrics series -----------------------------------------------------------

export interface SentinelMetricsWindow {
  window_start: string;
  window_end: string;
  duration_seconds: number;
  aggregates: SentinelWindowAggregate[];
}

export interface SentinelMetricsGap {
  after_window_end: string;
  before_window_start: string;
  estimated_missing_windows: number;
}

export interface SentinelMetrics {
  service_id: string;
  /** explicit units map (latency → ms, request_rate → requests/second…). */
  units: Record<string, string>;
  windows: SentinelMetricsWindow[];
  gaps: SentinelMetricsGap[];
  observations: number;
  qualities: Record<string, number>;
  excluded_by_reason: Record<string, number>;
  truncated: boolean;
  unknowns: string[];
  limitations: string[];
}

export interface SentinelMetricsResponse extends SentinelEnvelope {
  metrics: SentinelMetrics;
}

// -- SLOs -----------------------------------------------------------------------

export interface SentinelSloThresholds {
  latency_ms: number | null;
}

export interface SentinelSloDefinition {
  slo_id: string;
  revision: number;
  service_id: string;
  operation_id: string | null;
  /** availability | latency */
  sli_kind: string;
  /** objective S, e.g. 0.99 */
  target: number;
  window_seconds: number;
  thresholds: SentinelSloThresholds;
  error_classification: {
    error_status_classes?: string[];
    error_status_codes?: number[];
    [key: string]: unknown;
  };
  created_at: string;
}

export interface SentinelSourceAssessment {
  source_id: string;
  eligible: number;
  good: number;
  bad: number;
  sli: number | null;
  quality: string;
}

export interface SentinelSloCoverage {
  sources_used: string[];
  observations_included: number;
  observations_excluded: number;
  excluded_by_reason: Record<string, number>;
  window_seconds: number;
}

export interface SentinelSloAssessment {
  assessment_id: string;
  slo_id: string;
  revision: number;
  service_id: string;
  operation_id: string | null;
  sli_kind: string;
  target: number;
  window_start: string;
  window_end: string;
  sli: number | null;
  eligible: number;
  good: number;
  bad: number;
  budget_total: number | null;
  budget_consumed: number | null;
  budget_remaining: number | null;
  /** MET | VIOLATED | INSUFFICIENT_DATA | INCOMPATIBLE_INPUTS */
  state: string;
  quality: string;
  rule_id: string;
  rule_version: string;
  primary_source_id: string | null;
  per_source: SentinelSourceAssessment[];
  coverage: SentinelSloCoverage;
  limitations: string[];
  evaluated_at: string;
}

export interface SentinelSloPanelEntry {
  definition: SentinelSloDefinition;
  latest_assessment: SentinelSloAssessment | null;
  assessments: SentinelSloAssessment[];
}

export interface SentinelSloPanel {
  service_id: string;
  slos: SentinelSloPanelEntry[];
  unknowns: string[];
}

export interface SentinelSloPanelResponse extends SentinelEnvelope {
  panel: SentinelSloPanel;
}

// -- incidents ------------------------------------------------------------------

export interface SentinelRuleRef {
  rule_id: string;
  rule_revision: number;
  detector_id: string;
  detector_version: string;
}

export interface SentinelHypothesis {
  hypothesis_id: string;
  text: string;
  /** OBSERVED → CORRELATED → HYPOTHESIZED → VERIFIED; REFUTED terminal. */
  confidence: string;
  evidence_refs: string[];
  evidence_for: string[];
  evidence_against: string[];
  unknowns: string[];
  verification_id: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface SentinelVerificationRecord {
  verification_id: string;
  hypothesis_id: string;
  /** VERIFIED | REFUTED | INCONCLUSIVE */
  verdict: string;
  receipts: Record<string, string>[];
  executor: string;
  detail: string;
  executed_at: string;
}

export interface SentinelIncidentAction {
  at: string;
  actor: string;
  kind: string;
  note: string;
}

export interface SentinelDedupInfo {
  group_key: string;
  grouped_by: string[];
  attached_anomalies: number;
}

export interface SentinelIncident {
  incident_id: string;
  title: string;
  /** SEV1 | SEV2 | SEV3 | SEV4 | INFORMATIONAL — impact-driven. */
  severity: string;
  /** DETECTED | TRIAGED | INVESTIGATING | MITIGATING | MONITORING |
   *  RESOLVED | REOPENED | DISMISSED | CLOSED */
  status: string;
  service_id: string;
  operation_id: string | null;
  operation_ref: string | null;
  group_key: string;
  first_observed_at: string;
  detected_at: string;
  acknowledged_at: string | null;
  resolved_at: string | null;
  owner: string | null;
  revision: number;
  service_refs: string[];
  operation_refs: string[];
  rule_refs: SentinelRuleRef[];
  anomaly_ids: string[];
  evidence_refs: string[];
  hypotheses: SentinelHypothesis[];
  verifications: SentinelVerificationRecord[];
  change_refs: string[];
  actions: SentinelIncidentAction[];
  limitations: string[];
  dedup: SentinelDedupInfo | null;
}

export interface SentinelIncidentListResponse extends SentinelEnvelope {
  incidents: SentinelIncident[];
}

export interface SentinelIncidentEvent {
  event_id: string;
  incident_id: string;
  at: string;
  actor: string;
  /** opened | status_transition | anomaly_attached | severity_escalated |
   *  hypothesis_added | hypothesis_updated | action_recorded |
   *  recovery_observed | verification_recorded | session_requested | note */
  kind: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  details: Record<string, string>;
}

export interface SentinelExplanation {
  summary: string;
  math: string | null;
}

export interface SentinelAnomaly {
  anomaly_id: string;
  service_id: string;
  operation_id: string | null;
  operation_ref: string | null;
  detected_at: string;
  window_start: string;
  window_end: string;
  rule: SentinelRuleRef;
  severity: string;
  /** OBSERVED | CORRELATED | HYPOTHESIZED | VERIFIED */
  status: string;
  explanation: SentinelExplanation;
  evidence_refs: string[];
  unknowns: string[];
  dedup_key: string;
  incident_id: string | null;
}

export interface SentinelEvidence {
  evidence_id: string;
  /** metric-export | trace-extract | log-extract | document | receipt | other */
  kind: string;
  created_at: string;
  /** sha256:<hex> */
  hash: string;
  size_bytes: number;
  truncated: boolean;
  loss_notes: string | null;
  source_id: string | null;
  blob_ref: string | null;
}

export interface SentinelIncidentDetail {
  incident: SentinelIncident;
  events: SentinelIncidentEvent[];
  anomalies: SentinelAnomaly[];
  evidence: SentinelEvidence[];
  evidence_unresolved: string[];
}

export interface SentinelIncidentDetailResponse extends SentinelEnvelope {
  detail: SentinelIncidentDetail;
}

export interface SentinelChangeEvent {
  change_id: string;
  service_id: string;
  /** commit | release | deploy | rollback | config | flag | gateway |
   *  auth_policy | contract | dependency | maintenance */
  kind: string;
  at: string;
  /** declared | cli | import:<file> | webhook — provenance. */
  source: string;
  ref: string | null;
  details: Record<string, string>;
  created_at: string;
}

export interface SentinelDependencyObservation {
  edge_id: string;
  service_id: string;
  target: string;
  /** service | datastore | external */
  target_kind: string;
  operation_id: string | null;
  window_start: string;
  window_end: string;
  calls: number;
  errors: number;
  timeouts: number;
  evidence_refs: string[];
  /** observed | inferred — never "declared". */
  provenance: string;
  created_at: string;
}

export interface SentinelInvestigation {
  investigation_id: string;
  incident_id: string;
  /** QUEUED | RUNNING | COMPLETED | FAILED */
  status: string;
  result: Record<string, unknown>;
  context_pack: Record<string, unknown>;
  idempotency_key: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface SentinelIncidentTimeline {
  incident: SentinelIncident;
  events: SentinelIncidentEvent[];
  change_events: SentinelChangeEvent[];
  dependency_observations: SentinelDependencyObservation[];
  investigations: SentinelInvestigation[];
  hypotheses: SentinelHypothesis[];
  verifications: SentinelVerificationRecord[];
  truncated: boolean;
  unknowns: string[];
}

export interface SentinelTimelineResponse extends SentinelEnvelope {
  timeline: SentinelIncidentTimeline;
}

export interface SentinelInvestigationResponse extends SentinelEnvelope {
  investigation: SentinelInvestigation;
  replayed?: boolean;
}

export interface SentinelAnomalyListResponse extends SentinelEnvelope {
  anomalies: SentinelAnomaly[];
  truncated: boolean;
}

export interface SentinelEvidenceResponse extends SentinelEnvelope {
  evidence: SentinelEvidence;
}

export interface SentinelIntegrationsResponse extends SentinelEnvelope {
  /** per-Forge status rows — {forge, state, detail…}; shape is the
   *  integration status report, rendered verbatim. */
  integrations: Record<string, unknown>[];
}
