import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MonoTypeOperatorFunction, Observable, catchError, map, of, throwError } from 'rxjs';
import {
  AgentDescriptor,
  AccountEnvironment,
  ApiEnvelope,
  BootstrapPayload,
  DocHit,
  FederationPlanResponse,
  FederationSelection,
  FederationSnapshot,
  GraphBundle,
  HostDetection,
  InstallationReceipt,
  InstallSelection,
  McpServerDescriptor,
  MetricsReport,
  PortalCapability,
  PortalEventReport,
  PortalHealth,
  ProfileDescriptor,
  RegistryAction,
  RegistryExecuteResponse,
  RegistryPlanResponse,
  RegistryState,
  SkillDescriptor,
  TaskEventReport,
  TaskExecution,
  VersionInfo,
  LabData,
} from './api.models';
import { ApiError } from './api.error';

/**
 * Typed client for forge/PortalApi/1. Each method unwraps the envelope's
 * `data`; an envelope `error` already surfaced as `ApiError` upstream.
 * GETs are read-only by contract — mutations go through `post` with the
 * server's `confirm` + plan-token requirements.
 */
@Injectable({ providedIn: 'root' })
export class PortalApi {
  private readonly http = inject(HttpClient);

  private get<T>(path: string): Observable<T> {
    return this.http.get<ApiEnvelope<T>>(`/api/v1${path}`).pipe(map((env) => this.unwrap(env)));
  }

  private post<T>(path: string, body: unknown): Observable<T> {
    return this.http
      .post<ApiEnvelope<T>>(`/api/v1${path}`, body)
      .pipe(map((env) => this.unwrap(env)));
  }

  private unwrap<T>(env: ApiEnvelope<T>): T {
    if (env.schema !== 'forge/PortalApi/1') {
      throw new ApiError(0, { code: 'PORTAL-BAD-ENVELOPE', message: 'unexpected response schema' });
    }
    if (env.error) {
      throw new ApiError(200, env.error);
    }
    if (env.data === undefined) {
      throw new ApiError(0, { code: 'PORTAL-EMPTY-DATA', message: 'envelope carried no data' });
    }
    return env.data;
  }

  /** A specialist may expose only its domain surface. Shared portal pages
   * must render an explicit unverified/empty state instead of crashing on a
   * 404 or assuming every forge implements every catalog. */
  private unavailable<T>(fallback: T): MonoTypeOperatorFunction<T> {
    return catchError((err: unknown) =>
      err instanceof ApiError && err.status === 404 ? of(fallback) : throwError(() => err),
    );
  }

  private normalizeHealth(raw: Record<string, unknown>): PortalHealth {
    const rawState = String(raw['state'] ?? raw['status'] ?? 'UNVERIFIED').toUpperCase();
    const state = (rawState === 'HEALTHY' ? 'ACTIVE' : rawState) as PortalHealth['state'];
    return {
      ...raw,
      state,
      checks: Array.isArray(raw['checks']) ? raw['checks'] : [],
      workspace: typeof raw['workspace'] === 'string' ? raw['workspace'] : null,
      profile: typeof raw['profile'] === 'string' ? raw['profile'] : null,
      updated_at: typeof raw['updated_at'] === 'string' ? raw['updated_at'] : null,
    };
  }

  bootstrap() {
    return this.get<BootstrapPayload>('/bootstrap').pipe(
      map((payload) => ({ ...payload, health: this.normalizeHealth(payload.health as unknown as Record<string, unknown>) })),
    );
  }
  health() {
    return this.get<PortalHealth>('/health').pipe(
      map((health) => this.normalizeHealth(health as unknown as Record<string, unknown>)),
    );
  }
  capabilities() {
    return this.get<PortalCapability[]>('/capabilities');
  }
  installationStatus() {
    return this.get<PortalHealth>('/installation/status').pipe(
      map((health) => this.normalizeHealth(health as unknown as Record<string, unknown>)),
    );
  }
  accountEnvironment() {
    return this.get<AccountEnvironment>('/environment');
  }
  installationPlan(
    input: Partial<InstallSelection> & {
      scope?: string;
      host?: string;
      profile?: string;
      components?: Record<string, boolean>;
    },
  ) {
    return this.post<InstallationReceipt>('/installation/plan', input);
  }
  installationApply(plan: Record<string, unknown>, planToken: string, confirm = 'apply') {
    return this.post<InstallationReceipt>('/installation/apply', {
      plan,
      plan_token: planToken,
      confirm,
    });
  }
  installationRepair() {
    return this.post<InstallationReceipt>('/installation/repair', { confirm: 'repair' });
  }
  installationUninstall() {
    return this.post<InstallationReceipt>('/installation/uninstall', { confirm: 'uninstall' });
  }
  federation() {
    return this.get<FederationSnapshot>('/federation').pipe(
      this.unavailable<FederationSnapshot>({
        specialists: [], installed_forges: [],
        registry: { count: 0, path: '' },
        summary: { catalog: 0, installed: 0, with_mcp: 0, with_checkout: 0 },
      }),
    );
  }
  registryState() {
    return this.get<RegistryState>('/registry/state');
  }
  registryPlan(input: { action: RegistryAction; forge: string }) {
    return this.post<RegistryPlanResponse>('/registry/plan', input);
  }
  registryExecute(input: {
    action: RegistryAction;
    forge: string;
    plan: Record<string, unknown>;
    planToken: string;
  }) {
    return this.post<RegistryExecuteResponse>('/registry/execute', {
      action: input.action,
      forge: input.forge,
      plan: input.plan,
      plan_token: input.planToken,
      confirm: 'execute',
    });
  }
  federationPlan(input: FederationSelection) {
    return this.post<FederationPlanResponse>('/federation/plan', input);
  }
  federationInstallAuto(plan: Record<string, unknown>, planToken: string) {
    return this.post<InstallationReceipt>('/federation/install-auto', {
      plan,
      plan_token: planToken,
      confirm: 'install',
    });
  }
  profiles() {
    return this.get<ProfileDescriptor[]>('/profiles').pipe(this.unavailable<ProfileDescriptor[]>([]));
  }
  profilesApply(profile: string) {
    return this.post<InstallationReceipt>('/profiles/apply', { profile, confirm: 'apply' });
  }
  hosts() {
    return this.get<HostDetection[]>('/hosts').pipe(this.unavailable<HostDetection[]>([]));
  }
  hostsLaunch(host: string) {
    return this.post<{ command: string | null; refusal?: string; detail?: string }>(
      '/hosts/launch',
      { host },
    );
  }
  mcpServers() {
    return this.get<McpServerDescriptor[]>('/mcp/servers').pipe(this.unavailable<McpServerDescriptor[]>([]));
  }
  mcpVerify() {
    return this.post<InstallationReceipt>('/mcp/verify', { confirm: 'verify' });
  }
  skills() {
    /* wire tolerance: the contract types declare these arrays required, but
     * an adapter may omit them — decode absent lists as [] so the page
     * renders its UNVERIFIED state instead of crashing change detection. */
    return this.get<SkillDescriptor[]>('/skills').pipe(
      this.unavailable<SkillDescriptor[]>([]),
      map((xs) => xs.map((s) => ({ ...s, hosts: s.hosts ?? [] }))),
    );
  }
  agents() {
    return this.get<AgentDescriptor[]>('/agents').pipe(
      map((xs) =>
        xs.map((a) => ({
          ...a,
          domains: a.domains ?? [],
          skills: a.skills ?? [],
          hosts: a.hosts ?? [],
        })),
      ),
    );
  }
  tasks() {
    return this.get<TaskExecution[]>('/tasks').pipe(this.unavailable<TaskExecution[]>([]));
  }
  metrics() {
    return this.get<MetricsReport>('/metrics').pipe(
      this.unavailable<MetricsReport>({ generated_at: '', counters: {}, events: [], truncated: false }),
    );
  }
  /** forge/PortalEvent/1 window — read-only over the recorded buffer.
   *  Filters stay server-side so `count`/`truncated` describe the REAL
   *  remaining window, not a client-side projection of it. */
  events(filter?: { correlationId?: string; type?: string; status?: string; limit?: number }) {
    const q = new URLSearchParams();
    if (filter?.correlationId) q.set('correlation_id', filter.correlationId);
    if (filter?.type) q.set('type', filter.type);
    if (filter?.status) q.set('status', filter.status);
    if (filter?.limit && filter.limit > 0) q.set('limit', String(filter.limit));
    const suffix = q.size ? `?${q.toString()}` : '';
    return this.get<PortalEventReport>(`/events${suffix}`);
  }
  taskEvents(taskId: string) {
    return this.get<TaskEventReport>(`/tasks/${encodeURIComponent(taskId)}/events`);
  }
  versions() {
    return this.get<VersionInfo>('/versions').pipe(
      this.unavailable<VersionInfo>({
        installed: { version: null, origin: null, channel: null },
        available: { version: null, source: 'unavailable' }, compat: 'unverified',
        changelog: null, history: [], rollback: { supported: false },
      }),
    );
  }
  lab() {
    return this.get<LabData>('/lab').pipe(
      this.unavailable<LabData>({ dir: null, runs: [], reports: [], notes: [] }),
    );
  }
  tasksPlan(input: { intent?: string; verb?: string; args?: Record<string, unknown> }) {
    return this.post<{ plan_token: string; plan: Record<string, unknown> }>('/tasks/plan', input);
  }
  tasksExecute(plan: Record<string, unknown>, planToken: string) {
    return this.post<InstallationReceipt>('/tasks/execute', {
      plan,
      plan_token: planToken,
      confirm: 'execute',
    });
  }
  graphs() {
    return this.get<GraphBundle>('/graphs');
  }
  docsSearch(query: string, limit = 20) {
    return this.get<DocHit[]>(`/docs/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }
}
