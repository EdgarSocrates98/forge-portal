import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { ApiEnvelope, ApiErrorBody } from '../core/api/api.models';
import { ApiError } from '../core/api/api.error';
import {
  PfAgent,
  PfAgentRun,
  PfAgentTemplate,
  PfApiImportResult,
  PfApiSpec,
  PfAuditEvent,
  PfCapabilities,
  PfCompileResult,
  PfContextPackage,
  PfDashboard,
  PfDashboardRender,
  PfDataSource,
  PfDecision,
  PfDelegate,
  PfDelegateCallResult,
  PfDocument,
  PfEvalReport,
  PfGraph,
  PfHealth,
  PfImpact,
  PfInitiative,
  PfKnowledgeAnswer,
  PfKnowledgeHealth,
  PfKnowledgeSource,
  PfList,
  PfPrd,
  PfPrioritizeResult,
  PfProduct,
  PfQueryRun,
  PfQueryValidation,
  PfReport,
  PfRoadmap,
  PfSourceSchema,
  PfVerifyResult,
  PfWorkspace,
} from './pf.models';

export const PF_BASE_URL_KEY = 'pf.baseUrl';
export const PF_TOKEN_KEY = 'pf.token';
export const PF_DEFAULT_BASE_URL = 'http://127.0.0.1:8470';

function readStored(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
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
    return this.http
      .get<ApiEnvelope<T>>(this.url(path), { headers: this.authHeaders() })
      .pipe(map((env) => this.unwrap(env)), catchError((e) => this.fail(e)));
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<ApiEnvelope<T>>(this.url(path), body, { headers: this.authHeaders() })
      .pipe(map((env) => this.unwrap(env)), catchError((e) => this.fail(e)));
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

  // -- workspaces / products -----------------------------------------------

  workspaces() {
    return this.get<PfList<PfWorkspace>>('/workspaces');
  }
  createWorkspace(input: { name: string; description?: string }) {
    return this.post<PfWorkspace>('/workspaces', input);
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
    return this.post<PfProduct>('/products', input);
  }
  product(pid: string) {
    return this.get<PfProduct>(`/products/${encodeURIComponent(pid)}`);
  }
  productContext(pid: string) {
    return this.get<PfContextPackage>(`/products/${encodeURIComponent(pid)}/context`);
  }

  // -- knowledge ------------------------------------------------------------

  documents(pid: string) {
    return this.get<PfList<PfDocument>>(`/products/${encodeURIComponent(pid)}/documents`);
  }
  importDocument(pid: string, input: { title: string; content: string }) {
    return this.post<PfDocument>(`/products/${encodeURIComponent(pid)}/documents`, input);
  }
  knowledgeSources(pid: string) {
    return this.get<PfList<PfKnowledgeSource>>(
      `/products/${encodeURIComponent(pid)}/sources`,
    );
  }
  createKnowledgeSource(
    pid: string,
    input: { name: string; type?: string; locator?: string; classification?: string },
  ) {
    return this.post<PfKnowledgeSource>(
      `/products/${encodeURIComponent(pid)}/sources`,
      input,
    );
  }
  knowledgeQuery(pid: string, question: string, limit = 8) {
    return this.post<PfKnowledgeAnswer>(
      `/products/${encodeURIComponent(pid)}/knowledge/query`,
      { question, limit },
    );
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
    return this.post<PfQueryValidation>(
      `/products/${encodeURIComponent(pid)}/queries/validate`,
      { statement, dialect },
    );
  }
  executeQuery(
    pid: string,
    input: { source_id: string; statement: string; row_limit?: number },
  ) {
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
    return this.post<PfInitiative>(`/products/${encodeURIComponent(pid)}/initiatives`, input);
  }
  prioritizeInitiative(pid: string, iid: string, factors: Record<string, unknown>) {
    return this.post<PfPrioritizeResult>(
      `/products/${encodeURIComponent(pid)}/initiatives/${encodeURIComponent(iid)}/prioritize`,
      { factors },
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
  decisions(pid: string) {
    return this.get<PfList<PfDecision>>(`/products/${encodeURIComponent(pid)}/decisions`);
  }
  createDecision(
    pid: string,
    input: { title: string; context?: string; decision?: string; alternatives?: string[] },
  ) {
    return this.post<PfDecision>(`/products/${encodeURIComponent(pid)}/decisions`, input);
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
    return this.post<PfDelegateCallResult>(
      `/delegates/${encodeURIComponent(did)}/call`,
      input,
    );
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
    return this.post<PfApiImportResult>(
      `/products/${encodeURIComponent(pid)}/apis/import`,
      input,
    );
  }
  impact(pid: string, entityId: string) {
    return this.get<PfImpact>(
      `/products/${encodeURIComponent(pid)}/impact/${encodeURIComponent(entityId)}`,
    );
  }
}
