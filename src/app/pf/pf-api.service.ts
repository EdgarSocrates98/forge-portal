import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { ApiEnvelope, ApiErrorBody } from '../core/api/api.models';
import { ApiError } from '../core/api/api.error';
import type { BridgeEvent, BridgeSession } from './pf-bridge.service';
import {
  PfAgent,
  PfAgentHealth,
  PfBoard,
  PfAgentRun,
  PfAgentTemplate,
  PfApiImportResult,
  PfApiSpec,
  PfAuditEvent,
  PfCapabilities,
  PfChatCleanup,
  PfCompileResult,
  PfContextPackage,
  PfDashboard,
  PfDashboardRender,
  PfDataSource,
  PfDecision,
  PfDocumentDetail,
  PfKnowledgeSearchHit,
  PfDelegate,
  PfDelegateCallResult,
  PfDocument,
  PfEvalReport,
  PfExperiment,
  PfGraph,
  PfHealth,
  PfImpact,
  PfInitiative,
  PfKnowledgeAnswer,
  PfKnowledgeHealth,
  PfKnowledgeSource,
  PfList,
  PfObsidianImport,
  PfObsidianHistory,
  PfObsidianPreview,
  PfObsidianVaultDescriptor,
  PfObsidianSyncPlan,
  PfObsidianSyncReceipt,
  PfMeeting,
  PfMetric,
  PfNlQueryResult,
  PfPrd,
  PfPrioritizeResult,
  PfProduct,
  PfProductHealth,
  PfQueryRun,
  PfQueryValidation,
  PfReport,
  PfRoadmap,
  PfTask,
  PfTaskProposal,
  PfSourceSchema,
  PfVerifyResult,
  PfWorkspace,
  PfWorkspaceDiscovery,
  PfWorkspaceImport,
  PfWorkspacePreview,
  PfUrlImport,
  PfUrlPreview,
} from './pf.models';

export const PF_BASE_URL_KEY = 'pf.baseUrl';
export const PF_TOKEN_KEY = 'pf.token';
/** Empty means the installed gateway's own origin. A URL is an advanced
 * developer override only; production should not expose API bearer tokens or
 * service ports to the browser. */
export const PF_DEFAULT_BASE_URL = '';

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
    // Remove tokens written by pre-gateway builds. They must not survive a
    // browser restart or remain available under the old persistent key.
    globalThis.localStorage?.removeItem(key);
  } catch {
    // storage unavailable — in-memory value still applies for the session
  }
}

/**
 * Typed client for the Product Forge ENGINE — a separate server exposing
 * `forge/PortalApi/1` at `${baseUrl}/api/v1`. Every private route requires
 * `Authorization: Bearer <token>` (only `/health` is public); the bearer is
 * persisted under `pf.token`, the base URL under `pf.baseUrl`.
 *
 * Calls bypass the portal's `/api/*` interceptor (absolute URL), so this
 * service normalizes transport + envelope failures into `ApiError` itself.
 * Route paths follow the engine verbatim (`src/product_forge/api/app.py`).
 */
@Injectable({ providedIn: 'root' })
export class PfApi {
  private readonly http = inject(HttpClient);

  readonly baseUrl = signal<string>(readStored(PF_BASE_URL_KEY) ?? PF_DEFAULT_BASE_URL);
  readonly token = signal<string>(readStored(PF_TOKEN_KEY) ?? '');

  setBaseUrl(value: string): void {
    const v = value.trim().replace(/\/+$/, '');
    this.baseUrl.set(v || PF_DEFAULT_BASE_URL);
    writeStored(PF_BASE_URL_KEY, this.baseUrl());
  }

  setToken(value: string): void {
    this.token.set(value.trim());
    writeStored(PF_TOKEN_KEY, this.token() || null);
  }

  /** Root of the versioned API — never hand-concatenated elsewhere. */
  private url(path: string): string {
    return `${this.baseUrl()}${'/api/v1'}${path}`;
  }

  private get<T>(path: string): Observable<T> {
    return this.http.get<ApiEnvelope<T>>(this.url(path), { headers: this.authHeaders() }).pipe(
      map((env) => this.unwrap(env)),
      catchError((e) => this.fail(e)),
    );
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<ApiEnvelope<T>>(this.url(path), body, { headers: this.authHeaders() })
      .pipe(
        map((env) => this.unwrap(env)),
        catchError((e) => this.fail(e)),
      );
  }

  private delete<T>(path: string): Observable<T> {
    return this.http.delete<ApiEnvelope<T>>(this.url(path), { headers: this.authHeaders() }).pipe(
      map((env) => this.unwrap(env)),
      catchError((e) => this.fail(e)),
    );
  }

  private authHeaders(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    const token = this.token();
    if (token) h['Authorization'] = `Bearer ${token}`;
    return h;
  }

  private unwrap<T>(env: ApiEnvelope<T>): T {
    if (env?.schema !== 'forge/PortalApi/1') {
      throw new ApiError(0, { code: 'PF-BAD-ENVELOPE', message: 'unexpected response schema' });
    }
    if (env.error) throw new ApiError(200, env.error);
    if (env.data === undefined) {
      throw new ApiError(0, { code: 'PF-EMPTY-DATA', message: 'envelope carried no data' });
    }
    return env.data;
  }

  private fail(err: unknown): never {
    if (err instanceof ApiError) throw err;
    if (err instanceof HttpErrorResponse) {
      const body = err.error as ApiEnvelope<unknown> | null;
      const errBody: Partial<ApiErrorBody> | undefined = body?.error ?? undefined;
      throw new ApiError(err.status, errBody);
    }
    throw new ApiError(0);
  }

  // -- platform -----------------------------------------------------------

  health() {
    return this.get<PfHealth>('/health');
  }
  capabilities() {
    return this.get<PfCapabilities>('/capabilities');
  }
  agentHealth() {
    return this.get<PfAgentHealth>('/agent/health');
  }

  // -- chat (typed portal ops; the bridge path stays in PfBridge) ------------

  /** Same session listing as the bridge proxy, enriched with product_name. */
  chatSessions() {
    return this.get<{ items: BridgeSession[] }>('/chat/sessions').pipe(map((r) => r.items));
  }
  cleanupChatSessions() {
    return this.post<PfChatCleanup>('/chat/sessions/cleanup', { confirm: 'cleanup' });
  }
  chatCreate(input: { provider: string; product_id?: string; model?: string }) {
    return this.post<BridgeSession>('/chat/sessions', { confirm: 'create', ...input });
  }
  chatPrompt(sid: string, text: string, provider?: string) {
    return this.post<{ accepted: boolean }>(`/chat/sessions/${encodeURIComponent(sid)}/prompt`, {
      confirm: 'send',
      text,
      provider,
    });
  }
  chatEvents(sid: string, provider?: string, after_seq = 0) {
    return this.post<{ items: BridgeEvent[] }>(`/chat/sessions/${encodeURIComponent(sid)}/events`, {
      provider,
      after_seq,
    });
  }
  chatCancel(sid: string) {
    return this.post<{ cancelled: boolean }>(`/chat/sessions/${encodeURIComponent(sid)}/cancel`, {
      confirm: 'cancel',
    });
  }
  chatApprove(sid: string, approval_id: string, approved: boolean) {
    return this.post<{ resolved: boolean }>(`/chat/sessions/${encodeURIComponent(sid)}/approve`, {
      confirm: 'approve',
      approval_id,
      approved,
    });
  }
  chatResume(sid: string, session_ref: string, provider?: string) {
    return this.post<BridgeSession>(`/chat/sessions/${encodeURIComponent(sid)}/resume`, {
      confirm: 'resume',
      session_ref,
      provider,
    });
  }
  chatClose(sid: string) {
    return this.post<{ closed: boolean; archived: boolean }>(
      `/chat/sessions/${encodeURIComponent(sid)}/close`,
      { confirm: 'close' },
    );
  }

  // -- workspaces / products -----------------------------------------------

  workspaces() {
    return this.get<PfList<PfWorkspace>>('/workspaces');
  }
  createWorkspace(input: { name: string; description?: string }) {
    return this.post<PfWorkspace>('/workspaces', { ...input, confirm: 'create' });
  }

  products(workspaceId?: string) {
    const q = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    return this.get<PfList<PfProduct>>(`/products${q}`);
  }
  createProduct(input: {
    workspace_id: string;
    name: string;
    description?: string;
    domain?: string;
    tags?: string[];
  }) {
    return this.post<PfProduct>('/products', { ...input, confirm: 'create' });
  }
  product(pid: string) {
    return this.get<PfProduct>(`/products/${encodeURIComponent(pid)}`);
  }
  productContext(pid: string) {
    return this.get<PfContextPackage>(`/products/${encodeURIComponent(pid)}/context`);
  }

  // -- local workspace context discovery ----------------------------------

  /** Metadata-only discovery; content is never returned by this call. */
  workspaceDiscovery() {
    return this.get<PfWorkspaceDiscovery>('/workspace/discovery');
  }
  workspacePreview(path: string) {
    return this.get<PfWorkspacePreview>(
      `/workspace/discovery/preview?path=${encodeURIComponent(path)}`,
    );
  }
  importWorkspaceDocument(pid: string, path: string, title?: string) {
    return this.post<PfWorkspaceImport>(
      `/products/${encodeURIComponent(pid)}/documents/from-workspace`,
      { confirm: 'import', path, ...(title ? { title } : {}) },
    );
  }
  obsidianPreview(pid: string, path: string) {
    return this.get<PfObsidianPreview>(
      `/products/${encodeURIComponent(pid)}/documents/obsidian/preview?path=${encodeURIComponent(path)}`,
    );
  }
  obsidianStatus(pid: string) {
    return this.get<PfObsidianVaultDescriptor>(
      `/products/${encodeURIComponent(pid)}/documents/obsidian/status`,
    );
  }
  obsidianVaults(workspaceId?: string) {
    const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
    return this.get<{ schema?: string; items: PfObsidianVaultDescriptor[] }>(
      `/obsidian/vaults${query}`,
    );
  }
  connectObsidianVault(input: { workspace_id: string; path: string; label?: string }) {
    return this.post<PfObsidianVaultDescriptor>('/obsidian/vaults', {
      ...input,
      confirm: 'connect',
    });
  }
  revokeObsidianVault(vaultRecordId: string) {
    return this.delete<{ revoked: boolean; vault_record_id: string }>(
      `/obsidian/vaults/${encodeURIComponent(vaultRecordId)}`,
    );
  }
  obsidianHistory(pid: string, limit = 50) {
    return this.get<PfObsidianHistory>(
      `/products/${encodeURIComponent(pid)}/documents/obsidian/history?limit=${limit}`,
    );
  }
  importObsidianDocument(pid: string, path: string, title?: string) {
    return this.post<PfObsidianImport>(
      `/products/${encodeURIComponent(pid)}/documents/from-obsidian`,
      { confirm: 'import', path, ...(title ? { title } : {}) },
    );
  }
  planObsidianSync(pid: string, input: { path: string; content: string; baseline_hash?: string }) {
    return this.post<PfObsidianSyncPlan>(
      `/products/${encodeURIComponent(pid)}/documents/obsidian/sync-plan`,
      input,
    );
  }
  exportObsidianDocument(
    pid: string,
    input: { path: string; content: string; baseline_hash?: string; classification?: string },
  ) {
    return this.post<PfObsidianSyncReceipt>(
      `/products/${encodeURIComponent(pid)}/documents/to-obsidian`,
      { ...input, confirm: 'export' },
    );
  }
  rollbackObsidianDocument(
    pid: string,
    input: { path: string; receipt_path: string; source?: string },
  ) {
    return this.post<PfObsidianSyncReceipt>(
      `/products/${encodeURIComponent(pid)}/documents/obsidian/rollback`,
      { ...input, confirm: 'rollback' },
    );
  }
  urlPreview(pid: string, url: string, extractor: 'stdlib' | 'defuddle' = 'stdlib') {
    return this.get<PfUrlPreview>(
      `/products/${encodeURIComponent(pid)}/documents/url/preview?url=${encodeURIComponent(url)}&extractor=${extractor}`,
    );
  }
  importUrlDocument(
    pid: string,
    url: string,
    title?: string,
    extractor: 'stdlib' | 'defuddle' = 'stdlib',
  ) {
    return this.post<PfUrlImport>(`/products/${encodeURIComponent(pid)}/documents/from-url`, {
      confirm: 'import',
      url,
      extractor,
      ...(title ? { title } : {}),
    });
  }

  // -- knowledge ------------------------------------------------------------

  documents(pid: string) {
    return this.get<PfList<PfDocument>>(`/products/${encodeURIComponent(pid)}/documents`);
  }
  documentDetail(pid: string, did: string) {
    return this.get<PfDocumentDetail>(
      `/products/${encodeURIComponent(pid)}/documents/${encodeURIComponent(did)}`,
    );
  }
  documentSearch(pid: string, query: string, limit = 20) {
    return this.get<{ schema?: string; items: PfKnowledgeSearchHit[] }>(
      `/products/${encodeURIComponent(pid)}/documents/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }
  knowledgeSearch(pid: string, query: string, limit = 20) {
    return this.get<{ schema?: string; items: PfKnowledgeSearchHit[] }>(
      `/products/${encodeURIComponent(pid)}/knowledge/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
  }
  importDocument(pid: string, input: { title: string; content: string }) {
    return this.post<PfDocument>(`/products/${encodeURIComponent(pid)}/documents`, input);
  }
  knowledgeSources(pid: string) {
    return this.get<PfList<PfKnowledgeSource>>(`/products/${encodeURIComponent(pid)}/sources`);
  }
  createKnowledgeSource(
    pid: string,
    input: { name: string; type?: string; locator?: string; classification?: string },
  ) {
    return this.post<PfKnowledgeSource>(`/products/${encodeURIComponent(pid)}/sources`, input);
  }
  knowledgeQuery(pid: string, question: string, limit = 8) {
    return this.post<PfKnowledgeAnswer>(`/products/${encodeURIComponent(pid)}/knowledge/query`, {
      question,
      limit,
    });
  }
  knowledgeExtract(pid: string) {
    return this.post<{ entities: number; relations: number; kinds?: Record<string, number> }>(
      `/products/${encodeURIComponent(pid)}/knowledge/extract`,
      {},
    );
  }
  knowledgeGraph(pid: string) {
    return this.get<PfGraph>(`/products/${encodeURIComponent(pid)}/graph`);
  }
  knowledgeHealth(pid: string) {
    return this.get<PfKnowledgeHealth>(`/products/${encodeURIComponent(pid)}/knowledge-health`);
  }

  // -- agents ----------------------------------------------------------------

  agentTemplates() {
    return this.get<PfList<PfAgentTemplate>>('/agent-templates');
  }
  agents(pid: string) {
    return this.get<PfList<PfAgent>>(`/products/${encodeURIComponent(pid)}/agents`);
  }
  createAgent(
    pid: string,
    input: {
      name: string;
      mission?: string;
      template?: string;
      knowledge_scope?: string[];
      tools_allowed?: string[];
      policies?: Record<string, unknown>;
    },
  ) {
    return this.post<PfAgent>(`/products/${encodeURIComponent(pid)}/agents`, input);
  }
  runAgent(pid: string, aid: string, input: string) {
    return this.post<PfAgentRun>(
      `/products/${encodeURIComponent(pid)}/agents/${encodeURIComponent(aid)}/run`,
      { input },
    );
  }
  agentRuns(pid: string, aid: string) {
    return this.get<PfList<PfAgentRun>>(
      `/products/${encodeURIComponent(pid)}/agents/${encodeURIComponent(aid)}/runs`,
    );
  }
  evalAgent(pid: string, aid: string) {
    return this.post<PfEvalReport>(
      `/products/${encodeURIComponent(pid)}/agents/${encodeURIComponent(aid)}/eval`,
      {},
    );
  }
  publishAgent(pid: string, aid: string) {
    return this.post<PfAgent>(
      `/products/${encodeURIComponent(pid)}/agents/${encodeURIComponent(aid)}/publish`,
      {},
    );
  }

  // -- analytics --------------------------------------------------------------

  dataSources(pid: string) {
    return this.get<PfList<PfDataSource>>(`/products/${encodeURIComponent(pid)}/data-sources`);
  }
  createDataSource(
    pid: string,
    input: {
      name: string;
      connector: string;
      locator?: string;
      dialect?: string;
      catalog_allowlist?: string[];
    },
  ) {
    return this.post<PfDataSource>(`/products/${encodeURIComponent(pid)}/data-sources`, input);
  }
  dataSourceSchema(pid: string, sid: string) {
    return this.get<PfSourceSchema>(
      `/products/${encodeURIComponent(pid)}/data-sources/${encodeURIComponent(sid)}/schema`,
    );
  }
  verifyDataSource(pid: string, sid: string) {
    return this.post<PfVerifyResult>(
      `/products/${encodeURIComponent(pid)}/data-sources/${encodeURIComponent(sid)}/verify`,
      {},
    );
  }
  validateQuery(pid: string, statement: string, dialect = 'sql') {
    return this.post<PfQueryValidation>(`/products/${encodeURIComponent(pid)}/queries/validate`, {
      statement,
      dialect,
    });
  }
  executeQuery(pid: string, input: { source_id: string; statement: string; row_limit?: number }) {
    return this.post<PfQueryRun>(`/products/${encodeURIComponent(pid)}/queries/execute`, {
      row_limit: 200,
      ...input,
    });
  }
  compileQuery(pid: string, spec: Record<string, unknown>) {
    return this.post<PfCompileResult>(`/products/${encodeURIComponent(pid)}/queries/compile`, {
      spec,
    });
  }

  // -- dashboards ---------------------------------------------------------------

  dashboards(pid: string) {
    return this.get<PfList<PfDashboard>>(`/products/${encodeURIComponent(pid)}/dashboards`);
  }
  createDashboard(
    pid: string,
    input: { name: string; description?: string; widgets?: PfDashboard['widgets'] },
  ) {
    return this.post<PfDashboard>(`/products/${encodeURIComponent(pid)}/dashboards`, input);
  }
  renderDashboard(pid: string, did: string) {
    return this.post<PfDashboardRender>(
      `/products/${encodeURIComponent(pid)}/dashboards/${encodeURIComponent(did)}/render`,
      {},
    );
  }

  // -- planning ------------------------------------------------------------------

  initiatives(pid: string) {
    return this.get<PfList<PfInitiative>>(`/products/${encodeURIComponent(pid)}/initiatives`);
  }
  createInitiative(pid: string, input: { title: string; hypothesis?: string }) {
    return this.post<PfInitiative>(`/products/${encodeURIComponent(pid)}/initiatives`, {
      ...input,
      confirm: 'create',
    });
  }
  prioritizeInitiative(pid: string, iid: string, factors: Record<string, unknown>) {
    return this.post<PfPrioritizeResult>(
      `/products/${encodeURIComponent(pid)}/initiatives/${encodeURIComponent(iid)}/prioritize`,
      { factors, confirm: 'prioritize' },
    );
  }
  generatePrd(pid: string, iid: string) {
    return this.post<PfPrd>(
      `/products/${encodeURIComponent(pid)}/initiatives/${encodeURIComponent(iid)}/prd`,
      {},
    );
  }
  roadmap(pid: string) {
    return this.get<PfRoadmap>(`/products/${encodeURIComponent(pid)}/roadmap`);
  }
  board(pid: string) {
    return this.get<PfBoard>(`/products/${encodeURIComponent(pid)}/board`);
  }
  createTask(pid: string, input: { title: string; description?: string; priority?: string }) {
    return this.post<PfTask>(`/products/${encodeURIComponent(pid)}/tasks`, {
      ...input,
      confirm: 'create',
    });
  }
  moveTask(pid: string, taskId: string, columnId: string, position = 0, expectedVersion?: number) {
    return this.post<PfTask>(
      `/products/${encodeURIComponent(pid)}/tasks/${encodeURIComponent(taskId)}/move`,
      { column_id: columnId, position, expected_version: expectedVersion, confirm: 'move' },
    );
  }
  createTaskProposal(
    pid: string,
    input: { source?: string; session_id?: string; tasks: Record<string, unknown>[] },
  ) {
    return this.post<PfTaskProposal>(`/products/${encodeURIComponent(pid)}/task-proposals`, {
      ...input,
      confirm: 'create',
    });
  }
  taskProposals(pid: string) {
    return this.get<{ items: PfTaskProposal[] }>(
      `/products/${encodeURIComponent(pid)}/task-proposals`,
    );
  }
  approveTaskProposal(pid: string, proposalId: string, tasks?: PfTaskProposal['tasks']) {
    return this.post<PfTaskProposal>(
      `/products/${encodeURIComponent(pid)}/task-proposals/${encodeURIComponent(proposalId)}/approve`,
      { approved: true, confirm: 'decide', ...(tasks ? { tasks } : {}) },
    );
  }
  rejectTaskProposal(pid: string, proposalId: string) {
    return this.post<PfTaskProposal>(
      `/products/${encodeURIComponent(pid)}/task-proposals/${encodeURIComponent(proposalId)}/approve`,
      { approved: false, confirm: 'decide' },
    );
  }
  decisions(pid: string) {
    return this.get<PfList<PfDecision>>(`/products/${encodeURIComponent(pid)}/decisions`);
  }
  createDecision(
    pid: string,
    input: { title: string; context?: string; decision?: string; alternatives?: string[] },
  ) {
    return this.post<PfDecision>(`/products/${encodeURIComponent(pid)}/decisions`, input);
  }
  // -- product intelligence (Cycle 17) -----------------------------------------

  productHealth(pid: string) {
    return this.get<PfProductHealth>(`/products/${encodeURIComponent(pid)}/health`);
  }
  metrics(pid: string) {
    return this.get<PfList<PfMetric>>(`/products/${encodeURIComponent(pid)}/metrics`);
  }
  createMetric(
    pid: string,
    input: { name: string; formula: string; source_id?: string; dimensions?: string[] },
  ) {
    return this.post<PfMetric>(`/products/${encodeURIComponent(pid)}/metrics`, input);
  }
  nlQuery(pid: string, input: { question: string; source_id?: string }) {
    return this.post<PfNlQueryResult>(`/products/${encodeURIComponent(pid)}/queries/nl`, input);
  }
  experiments(pid: string) {
    return this.get<PfList<PfExperiment>>(`/products/${encodeURIComponent(pid)}/experiments`);
  }
  createExperiment(pid: string, input: { title: string; hypothesis?: string; design?: string }) {
    return this.post<PfExperiment>(`/products/${encodeURIComponent(pid)}/experiments`, input);
  }
  concludeExperiment(
    pid: string,
    eid: string,
    input: { results: Record<string, number>; record_decision?: boolean },
  ) {
    return this.post<{ outcome: string; status: string; decision_refs: string[] }>(
      `/products/${encodeURIComponent(pid)}/experiments/${encodeURIComponent(eid)}/conclude`,
      input,
    );
  }
  meetings(pid: string) {
    return this.get<PfList<PfMeeting>>(`/products/${encodeURIComponent(pid)}/meetings`);
  }
  createMeeting(pid: string, input: { title: string; transcript: string }) {
    return this.post<PfMeeting>(`/products/${encodeURIComponent(pid)}/meetings`, input);
  }
  extractMeeting(pid: string, mid: string) {
    return this.post<{ draft_items: PfMeeting['draft_items']; status: string }>(
      `/products/${encodeURIComponent(pid)}/meetings/${encodeURIComponent(mid)}/extract`,
      {},
    );
  }
  publishMeeting(pid: string, mid: string) {
    return this.post<{ published_refs: string[]; status: string }>(
      `/products/${encodeURIComponent(pid)}/meetings/${encodeURIComponent(mid)}/publish`,
      { reviewed: true },
    );
  }

  audit(productId?: string, limit = 100) {
    const q = new URLSearchParams();
    if (productId) q.set('product_id', productId);
    q.set('limit', String(limit));
    return this.get<PfList<PfAuditEvent>>(`/audit?${q.toString()}`);
  }

  // -- delegates -----------------------------------------------------------------

  delegates() {
    return this.get<{ delegates: PfDelegate[] }>('/delegates');
  }
  callDelegate(did: string, input: { workflow: string; args?: string[]; product_id?: string }) {
    return this.post<PfDelegateCallResult>(`/delegates/${encodeURIComponent(did)}/call`, input);
  }

  // -- reports ---------------------------------------------------------------------

  reports(pid: string) {
    return this.get<PfList<PfReport>>(`/products/${encodeURIComponent(pid)}/reports`);
  }
  generateExecutiveReport(pid: string) {
    return this.post<PfReport>(`/products/${encodeURIComponent(pid)}/reports/executive`, {});
  }

  // -- api intelligence ---------------------------------------------------------------

  apis(pid: string) {
    return this.get<PfList<PfApiSpec>>(`/products/${encodeURIComponent(pid)}/apis`);
  }
  importApi(pid: string, input: { name?: string; spec: string }) {
    return this.post<PfApiImportResult>(`/products/${encodeURIComponent(pid)}/apis/import`, input);
  }
  impact(pid: string, entityId: string) {
    return this.get<PfImpact>(
      `/products/${encodeURIComponent(pid)}/impact/${encodeURIComponent(entityId)}`,
    );
  }
}
