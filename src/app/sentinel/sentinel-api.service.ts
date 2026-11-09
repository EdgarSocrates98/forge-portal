import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { ApiError } from '../core/api/api.error';
import {
  SentinelAnomalyListResponse,
  SentinelCapabilitiesResponse,
  SentinelEvidenceResponse,
  SentinelHealth,
  SentinelIncidentDetailResponse,
  SentinelIncidentListResponse,
  SentinelIntegrationsResponse,
  SentinelInvestigationResponse,
  SentinelMetricsResponse,
  SentinelOperationsResponse,
  SentinelProblemDetails,
  SentinelServiceDetailResponse,
  SentinelServiceListResponse,
  SentinelSloPanelResponse,
  SentinelTimelineResponse,
} from './sentinel.models';

export const SENTINEL_BASE_URL_KEY = 'sentinel.baseUrl';
export const SENTINEL_TOKEN_KEY = 'sentinel.token';
/** One configured Sentinel instance per the workspace contract —
 *  `api-sentinel serve` on the documented loopback port. */
export const SENTINEL_DEFAULT_BASE_URL = 'http://127.0.0.1:8317';

function readStored(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.sessionStorage?.removeItem(key);
    else globalThis.sessionStorage?.setItem(key, value);
    // Tokens must not survive a browser restart or remain under the old
    // persistent key (same policy as PfApi).
    globalThis.localStorage?.removeItem(key);
  } catch {
    // storage unavailable — in-memory value still applies for the session
  }
}

/**
 * Typed client for the API Sentinel `/v1` surface — a SEPARATE backend
 * from the Product Forge engine. Sentinel emits `api-sentinel/v1`
 * payloads (typed model + `unknowns` + `evidence_refs`), not the
 * `forge/PortalApi/1` envelope — this adapter keeps the two contracts
 * structurally independent instead of bending either one.
 *
 * Auth: `Authorization: Bearer <token>` on every private route
 * (`/v1/health` stays public, matching the server). The token resolves
 * from `sentinel.token` session storage (set on the API Operations
 * connection card) — it is never logged, never put in a URL, and never
 * persisted beyond the session. `problem+json` failures normalize into
 * `ApiError` carrying the verbatim `sentinel.<code>` so the shared
 * error panel renders the real refusal.
 */
@Injectable({ providedIn: 'root' })
export class SentinelApi {
  private readonly http = inject(HttpClient);

  readonly baseUrl = signal<string>(readStored(SENTINEL_BASE_URL_KEY) ?? SENTINEL_DEFAULT_BASE_URL);
  readonly token = signal<string>(readStored(SENTINEL_TOKEN_KEY) ?? '');

  setBaseUrl(value: string): void {
    const v = value.trim().replace(/\/+$/, '');
    this.baseUrl.set(v || SENTINEL_DEFAULT_BASE_URL);
    writeStored(SENTINEL_BASE_URL_KEY, this.baseUrl());
  }

  setToken(value: string): void {
    this.token.set(value.trim());
    writeStored(SENTINEL_TOKEN_KEY, this.token() || null);
  }

  /** Root of the versioned API — never hand-concatenated elsewhere. */
  private url(path: string): string {
    return `${this.baseUrl()}/v1${path}`;
  }

  private get<T>(path: string): Observable<T> {
    return this.http
      .get<T>(this.url(path), { headers: this.authHeaders() })
      .pipe(catchError((e) => this.fail(e)));
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<T>(this.url(path), body, { headers: this.authHeaders() })
      .pipe(catchError((e) => this.fail(e)));
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  /**
   * `application/problem+json` → `ApiError`. The Sentinel `code`
   * (`sentinel.not_found`, `sentinel.forbidden`, …) is kept verbatim —
   * the UI reasons over real refusal classes, never HTTP status alone.
   */
  private fail(err: unknown): never {
    if (err instanceof ApiError) throw err;
    if (err instanceof HttpErrorResponse) {
      const problem = err.error as SentinelProblemDetails | null;
      if (problem && typeof problem === 'object' && typeof problem.code === 'string') {
        throw new ApiError(err.status, {
          code: problem.code,
          message: problem.detail || problem.title || `request failed (${err.status})`,
          details: problem.details ?? {},
          retryable: err.status === 0 || err.status >= 500,
        });
      }
      throw new ApiError(err.status, {
        code: `sentinel.http_${err.status || 'error'}`,
        message: `request failed (${err.status || 'network'})`,
        retryable: err.status === 0 || err.status >= 500,
      });
    }
    throw new ApiError(0);
  }

  // -- sentinel self-report ------------------------------------------------

  /** Public route — no credential required by the server. */
  health() {
    return this.get<SentinelHealth>('/health');
  }

  capabilities() {
    return this.get<SentinelCapabilitiesResponse>('/capabilities');
  }

  integrations() {
    return this.get<SentinelIntegrationsResponse>('/integrations/status');
  }

  // -- services --------------------------------------------------------------

  services() {
    return this.get<SentinelServiceListResponse>('/services');
  }

  service(serviceId: string) {
    return this.get<SentinelServiceDetailResponse>(
      `/services/${encodeURIComponent(serviceId)}`,
    );
  }

  serviceOperations(serviceId: string) {
    return this.get<SentinelOperationsResponse>(
      `/services/${encodeURIComponent(serviceId)}/operations`,
    );
  }

  serviceMetrics(
    serviceId: string,
    opts: { windowStart?: string; windowEnd?: string; operationId?: string; maxWindows?: number } = {},
  ) {
    const params = new URLSearchParams();
    if (opts.windowStart) params.set('window_start', opts.windowStart);
    if (opts.windowEnd) params.set('window_end', opts.windowEnd);
    if (opts.operationId) params.set('operation_id', opts.operationId);
    if (opts.maxWindows !== undefined) params.set('max_windows', String(opts.maxWindows));
    const q = params.toString();
    return this.get<SentinelMetricsResponse>(
      `/services/${encodeURIComponent(serviceId)}/metrics${q ? `?${q}` : ''}`,
    );
  }

  serviceSlos(serviceId: string) {
    return this.get<SentinelSloPanelResponse>(
      `/services/${encodeURIComponent(serviceId)}/slos`,
    );
  }

  // -- incidents --------------------------------------------------------------

  incidents(opts: { status?: string; serviceId?: string } = {}) {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.serviceId) params.set('service_id', opts.serviceId);
    const q = params.toString();
    return this.get<SentinelIncidentListResponse>(`/incidents${q ? `?${q}` : ''}`);
  }

  incident(incidentId: string) {
    return this.get<SentinelIncidentDetailResponse>(
      `/incidents/${encodeURIComponent(incidentId)}`,
    );
  }

  incidentTimeline(incidentId: string) {
    return this.get<SentinelTimelineResponse>(
      `/incidents/${encodeURIComponent(incidentId)}/timeline`,
    );
  }

  /** Bounded synchronous investigation — the server's `investigate`
   *  scope (operator+). `idempotency_key` makes a double-click a replay,
   *  never a duplicate run. */
  startInvestigation(incidentId: string, input: { idempotencyKey?: string; note?: string } = {}) {
    return this.post<SentinelInvestigationResponse>(
      `/incidents/${encodeURIComponent(incidentId)}/investigations`,
      {
        ...(input.idempotencyKey ? { idempotency_key: input.idempotencyKey } : {}),
        ...(input.note ? { note: input.note } : {}),
      },
    );
  }

  investigation(investigationId: string) {
    return this.get<SentinelInvestigationResponse>(
      `/investigations/${encodeURIComponent(investigationId)}`,
    );
  }

  anomalies(opts: { serviceId?: string; status?: string; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (opts.serviceId) params.set('service_id', opts.serviceId);
    if (opts.status) params.set('status', opts.status);
    if (opts.limit !== undefined) params.set('limit', String(opts.limit));
    const q = params.toString();
    return this.get<SentinelAnomalyListResponse>(`/anomalies${q ? `?${q}` : ''}`);
  }

  /** Evidence metadata only — blob content is never served by the API. */
  evidence(evidenceId: string) {
    return this.get<SentinelEvidenceResponse>(`/evidence/${encodeURIComponent(evidenceId)}`);
  }
}
