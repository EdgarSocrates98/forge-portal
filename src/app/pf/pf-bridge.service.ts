import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { ApiError } from '../core/api/api.error';

export interface BridgeEvent {
  schema: string;
  id: string;
  seq: number;
  type: string;
  session_id: string;
  turn_id?: string | null;
  payload: Record<string, unknown>;
  provider: string;
}

export interface BridgeSessionMeta {
  title?: string;
  product_id?: string | null;
  workspace_id?: string | null;
  favorite?: boolean;
  archived?: boolean;
  visibility?: string;
  notes?: string;
  provider?: string;
  created_at?: string;
  updated_at?: string;
}

export interface BridgeSession {
  id: string;
  provider: string;
  state: string;
  product_id?: string | null;
  resumable?: boolean;
  provider_session_ref?: string | null;
  meta?: BridgeSessionMeta;
}

export interface BridgeProvider {
  id: string;
  name: string;
  installed?: boolean;
  executable?: string | null;
  auth_state: string;
  capabilities: { name: string; state: string }[];
}

export interface BridgeDevice {
  device_id: string;
  device_name: string;
  scopes: string[];
  created_at: number;
  expires_at: number;
  last_seen: number;
}

export interface ApprovalRequest {
  approval_id: string;
  session_id: string;
  actor: string;
  resource: string;
  action: string;
  scope: string;
  risk: string;
  expires_at: number;
  state: string;
}

export interface ApprovalGrant {
  resolved: boolean;
  granted: boolean;
  approval_id: string;
  approval_token?: string;
  expires_at?: number;
}

/** Result of a mutation that may need a bound approval token (§25.4). */
export type FileOpResult =
  | { kind: 'ok'; body: Record<string, unknown> }
  | { kind: 'approval-required'; request: ApprovalRequest };

const BRIDGE_URL_KEY = 'fab.baseUrl';
const BRIDGE_SESSION_KEY = 'fab.sessionToken';
const BRIDGE_DEVICE_KEY = 'fab.deviceId';

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function nonce(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Client for the Forge Agent Bridge LOCAL service (127.0.0.1, paired).
 *
 * Security model (Cycle 25): the master pair token is used ONCE, at pairing,
 * via POST /pair/exchange — it is never persisted. What lives in storage is
 * a scoped, expiring session token bound to this device; it can be revoked
 * via /pair/devices/{id} and expires server-side.
 */
@Injectable({ providedIn: 'root' })
export class PfBridge {
  private readonly http = inject(HttpClient);
  readonly baseUrl = signal(read(BRIDGE_URL_KEY) ?? 'http://127.0.0.1:8471');
  /** Paired session token (NOT the master pair token). */
  readonly token = signal(read(BRIDGE_SESSION_KEY) ?? '');
  readonly deviceId = signal(read(BRIDGE_DEVICE_KEY) ?? '');

  /**
   * Pair this device: exchange the master pair token for a scoped session
   * token. The master token is held only for this call's duration.
   */
  pair(pairToken: string, baseUrl?: string,
       deviceName = 'forge-portal'): Observable<BridgeDevice> {
    if (baseUrl) this.baseUrl.set(baseUrl.trim().replace(/\/+$/, ''));
    return this.http
      .post<{ session_token: string; device: BridgeDevice }>(
        this.url('/pair/exchange'),
        { pair_token: pairToken, device_name: deviceName,
          scopes: ['agent'] })
      .pipe(
        map((r) => {
          this.token.set(r.session_token);
          this.deviceId.set(r.device.device_id);
          try {
            globalThis.localStorage?.setItem(BRIDGE_SESSION_KEY, r.session_token);
            globalThis.localStorage?.setItem(BRIDGE_DEVICE_KEY, r.device.device_id);
            globalThis.localStorage?.setItem(BRIDGE_URL_KEY, this.baseUrl());
            // legacy master-token key — purge it: masters never persist here
            globalThis.localStorage?.removeItem('fab.pairToken');
          } catch {
            /* storage unavailable */
          }
          return r.device;
        }),
        catchError((e) => this.fail(e)),
      );
  }

  /** Legacy entry point kept for callers passing a session token directly. */
  setPairing(token: string, baseUrl?: string): void {
    this.token.set(token.trim());
    if (baseUrl) this.baseUrl.set(baseUrl.trim().replace(/\/+$/, ''));
    try {
      globalThis.localStorage?.setItem(BRIDGE_SESSION_KEY, this.token());
      globalThis.localStorage?.setItem(BRIDGE_URL_KEY, this.baseUrl());
    } catch {
      /* storage unavailable */
    }
  }

  private url(p: string): string {
    return `${this.baseUrl()}${p}`;
  }
  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token()}`,
             'Content-Type': 'application/json' };
  }
  private mutateHeaders(): Record<string, string> {
    return { ...this.headers(), 'X-FAB-Nonce': nonce() };
  }
  private fail(e: unknown): never {
    if (e instanceof HttpErrorResponse) throw new ApiError(e.status, e.error?.error);
    throw new ApiError(0);
  }
  private post<T>(p: string, body: unknown): Observable<T> {
    return this.http
      .post<T>(this.url(p), body, { headers: this.mutateHeaders() })
      .pipe(catchError((e) => this.fail(e)));
  }
  private get<T>(p: string): Observable<T> {
    return this.http
      .get<T>(this.url(p), { headers: this.headers() })
      .pipe(catchError((e) => this.fail(e)));
  }

  providers() {
    return this.get<{ items: BridgeProvider[] }>('/providers').pipe(map((r) => r.items));
  }
  createSession(provider: string, productId?: string) {
    return this.post<BridgeSession>('/agent-sessions', {
      provider,
      product_id: productId ?? null,
    });
  }
  prompt(sessionId: string, provider: string, text: string) {
    return this.post<{ accepted: boolean }>(`/agent-sessions/${sessionId}/prompt`, {
      text,
      provider,
    });
  }
  events(sessionId: string, provider: string, afterSeq = 0) {
    return this.post<{ items: BridgeEvent[] }>(`/agent-sessions/${sessionId}/events`, {
      provider,
      after_seq: afterSeq,
    });
  }
  cancel(sessionId: string, provider: string) {
    return this.post<{ cancelled: boolean }>(`/agent-sessions/${sessionId}/cancel`, {
      provider,
    });
  }
  listSessions() {
    return this.get<{ items: BridgeSession[] }>('/agent-sessions').pipe(
      map((r) => r.items),
    );
  }
  patchSession(sessionId: string, meta: Partial<BridgeSessionMeta>) {
    return this.http
      .patch<{ meta: BridgeSessionMeta }>(this.url(`/agent-sessions/${sessionId}`), meta, {
        headers: this.mutateHeaders(),
      })
      .pipe(catchError((e) => this.fail(e)));
  }
  deleteSession(sessionId: string) {
    return this.http
      .delete<{ closed: boolean; archived: boolean }>(
        this.url(`/agent-sessions/${sessionId}`),
        { headers: this.mutateHeaders() },
      )
      .pipe(catchError((e) => this.fail(e)));
  }
  resumeSession(sessionRef: string, provider: string) {
    return this.post<BridgeSession>('/agent-sessions/_/resume', {
      session_ref: sessionRef,
      provider,
    });
  }
  approve(sessionId: string, provider: string, approvalId: string, approved: boolean) {
    return this.post<{ resolved: boolean }>(`/agent-sessions/${sessionId}/approve`, {
      provider,
      approval_id: approvalId,
      approved,
    });
  }
  /**
   * True streaming (§26.6/§29.3): fetch+reader SSE — EventSource can't send
   * Authorization headers. Yields ordered, deduped events; resumes from
   * `afterSeq` cursor on reconnect. Aborts via the returned controller.
   */
  streamEvents(sessionId: string, afterSeq = 0): {
    events: Observable<BridgeEvent>; abort: () => void;
  } {
    const ctrl = new AbortController();
    const events = new Observable<BridgeEvent>((sub) => {
      let cursor = afterSeq;
      const seen = new Set<number>();
      const pump = async (): Promise<void> => {
        try {
          const resp = await fetch(
            this.url(`/agent-sessions/${sessionId}/stream?after_seq=${cursor}`),
            { headers: { Authorization: `Bearer ${this.token()}`,
                         Accept: 'text/event-stream' },
              signal: ctrl.signal });
          if (!resp.ok || !resp.body) {
            sub.error(new ApiError(resp.status));
            return;
          }
          const reader = resp.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const frames = buf.split('\n\n');
            buf = frames.pop() ?? '';
            for (const frame of frames) {
              const dataLine = frame.split('\n')
                .find((l) => l.startsWith('data: '));
              if (!dataLine || dataLine.startsWith('data: hb')) continue;
              const ev = JSON.parse(dataLine.slice(6)) as BridgeEvent;
              if (seen.has(ev.seq)) continue;   // §26.6 dedup
              seen.add(ev.seq);
              cursor = Math.max(cursor, ev.seq);
              sub.next(ev);
            }
          }
          sub.complete();   // server closed the bounded stream — caller
                            // re-arms with `cursor` for gap-free reconnect
        } catch (e) {
          if (!ctrl.signal.aborted) sub.error(e instanceof Error ? e : new ApiError(0));
        }
      };
      void pump();
    });
    return { events, abort: () => ctrl.abort() };
  }

  artifacts(sessionId: string, provider: string) {
    return this.post<{ items: BridgeArtifact[] }>(
      `/agent-sessions/${sessionId}/artifacts`, { provider }).pipe(
        map((r) => r.items));
  }

  // -- approval tokens (§25.4) ------------------------------------------
  pendingApprovals(sessionId = '') {
    return this.get<{ items: ApprovalRequest[] }>(
      `/approvals?session_id=${sessionId}`).pipe(map((r) => r.items));
  }
  resolveApproval(approvalId: string, approved: boolean) {
    return this.post<ApprovalGrant>(`/approvals/${approvalId}/resolve`,
      { approved });
  }

  // -- pairing management (§25.6) ----------------------------------------
  devices() {
    return this.get<{ items: BridgeDevice[] }>('/pair/devices').pipe(
      map((r) => r.items));
  }
  revokeDevice(deviceId: string) {
    return this.http
      .delete<{ revoked: boolean }>(this.url(`/pair/devices/${deviceId}`),
        { headers: this.mutateHeaders() })
      .pipe(catchError((e) => this.fail(e)));
  }
  rotatePair(pairToken: string) {
    return this.post<{ rotated: boolean; pair_token: string }>(
      '/pair/rotate', { pair_token: pairToken });
  }

  // -- files --------------------------------------------------------------
  fileList(path = '.') {
    return this.post<{ items: BridgeFileEntry[]; root: string }>(
      '/files/list', { path });
  }
  filePreview(path: string) {
    return this.post<BridgeFilePreview>('/files/preview', { path });
  }
  fileDownload(path: string) {
    return this.post<{ path: string; content_b64: string }>(
      '/files/download', { path });
  }
  fileHistory(path: string) {
    return this.post<{ items: { version: string; size: number }[] }>(
      '/files/history', { path });
  }

  /**
   * Upload with the §25.4 approval protocol:
   * 1st attempt (no token) → approval-required result;
   * caller resolves via resolveApproval() → retries with approval_token.
   */
  fileUpload(path: string, contentB64: string,
             approvalToken = '', sessionId = ''): Observable<FileOpResult> {
    return this.post<Record<string, unknown> & { approval_request?: ApprovalRequest }>(
      '/files/upload',
      { path, content_b64: contentB64,
        approval_token: approvalToken, session_id: sessionId }).pipe(
        map((r) => ({ kind: 'ok' as const, body: r })),
        catchError((e) => {
          const body = (e instanceof HttpErrorResponse ? e.error : null) as
            { approval_request?: ApprovalRequest } | null;
          if (body?.approval_request) {
            return of({ kind: 'approval-required' as const,
                        request: body.approval_request });
          }
          return this.fail(e);
        }),
      );
  }
  fileRestore(path: string, version: string,
              approvalToken = '', sessionId = ''): Observable<FileOpResult> {
    return this.post<Record<string, unknown> & { approval_request?: ApprovalRequest }>(
      '/files/restore',
      { path, version, approval_token: approvalToken,
        session_id: sessionId }).pipe(
        map((r) => ({ kind: 'ok' as const, body: r })),
        catchError((e) => {
          const body = (e instanceof HttpErrorResponse ? e.error : null) as
            { approval_request?: ApprovalRequest } | null;
          if (body?.approval_request) {
            return of({ kind: 'approval-required' as const,
                        request: body.approval_request });
          }
          return this.fail(e);
        }),
      );
  }

  // -- Part IX: deterministic intelligence (§13.x, read-only) ------------
  intelRoute(opts: {
    task_type?: string; required?: string[]; privacy?: string;
    prefer?: string; max_cost_usd?: number;
  }) {
    return this.post<ProviderRouting>('/intel/route', opts);
  }
  intelQuality(sessionId: string) {
    return this.get<SessionQuality>(`/intel/${sessionId}/quality`);
  }
  intelContextHealth(sessionId: string) {
    return this.get<ContextHealth>(`/intel/${sessionId}/context-health`);
  }
  intelReplay(sessionId: string) {
    return this.get<ReplayDossier>(`/intel/${sessionId}/replay`);
  }
  intelDecisions(sessionId: string) {
    return this.get<{ items: DecisionRecord[] }>(
      `/intel/${sessionId}/decisions`).pipe(map((r) => r.items));
  }
  intelFinops() {
    return this.get<AgentFinOps>('/intel/finops');
  }
  intelMode() {
    return this.get<DegradedMode>('/intel/mode');
  }
  intelWorkspace() {
    return this.get<WorkspaceIntelligence>('/intel/workspace');
  }

  // -- backups (§28.6) ----------------------------------------------------
  backup() {
    return this.post<{ backup: string; files: number;
                        excluded: string[] }>('/backup', {});
  }
  restoreBackup(path: string, approvalToken = '') {
    return this.post<Record<string, unknown> & {
      approval_request?: ApprovalRequest;
      restore?: { restored: string[]; refused: string[] } | string }>(
      '/backup/restore', { path, approval_token: approvalToken });
  }
}

export interface ProviderRouting {
  schema: string; task_type: string; required: string[];
  candidates: { provider: string; score: number; eligible: boolean;
                reasons: string[]; auth_state?: string }[];
  selected: string | null; note: string;
}

export interface SessionQuality {
  schema: string;
  axes: Record<string, { score?: number; note?: string;
                         [k: string]: unknown }>;
  overall: number; note: string;
}

export interface ContextHealth {
  schema: string; state: string; issues?: { kind: string; detail: string }[];
  coverage?: Record<string, unknown>; note?: string;
  [k: string]: unknown;
}

export interface ReplayDossier {
  schema: string;
  inputs: BridgeEvent[]; tools: BridgeEvent[];
  approvals: BridgeEvent[]; errors: BridgeEvent[];
  context_version?: number | null; event_count: number;
  replay_mode: string; note: string;
}

export interface DecisionRecord {
  schema: string; session_id: string; product_id: string;
  decision: string; reason?: string; evidence?: string[];
  owner?: string; decided_at?: string; [k: string]: unknown;
}

export interface AgentFinOps {
  schema: string;
  by_scope: { scope: string; value: string; tokens_in: number;
              tokens_out: number; estimated: boolean;
              windows?: Record<string, unknown> }[];
  limits: Record<string, unknown>; note: string;
}

export interface DegradedMode {
  schema: string; degraded: boolean; available_providers: string[];
  allowed_operations: string[]; forbidden_operations: string[];
  note?: string;
}

export interface WorkspaceIntelligence {
  schema: string; sessions?: number; bound_contexts?: number;
  mcp_servers?: number; budget_limits?: number;
  items?: Record<string, unknown>[]; [k: string]: unknown;
}

export interface BridgeArtifact {
  event_id: string;
  type: string;
  seq: number;
  path?: string;
  name?: string;
}

export interface BridgeFileEntry {
  name: string;
  dir: boolean;
  size: number | null;
  kind: string;
}

export interface BridgeFilePreview {
  path: string;
  kind: string;
  size: number;
  preview: string | null;
  truncated?: boolean;
  note?: string;
}
