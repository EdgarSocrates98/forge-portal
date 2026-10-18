import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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

  bootstrap() {
    return this.get<BootstrapPayload>('/bootstrap');
  }
  health() {
    return this.get<PortalHealth>('/health');
  }
  capabilities() {
    return this.get<PortalCapability[]>('/capabilities');
  }
  installationStatus() {
    return this.get<PortalHealth>('/installation/status');
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
    return this.get<FederationSnapshot>('/federation');
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
    return this.get<ProfileDescriptor[]>('/profiles');
  }
  profilesApply(profile: string) {
    return this.post<InstallationReceipt>('/profiles/apply', { profile, confirm: 'apply' });
  }
  hosts() {
    return this.get<HostDetection[]>('/hosts');
  }
  hostsLaunch(host: string) {
    return this.post<{ command: string | null; refusal?: string; detail?: string }>(
      '/hosts/launch',
      { host },
    );
  }
  mcpServers() {
    return this.get<McpServerDescriptor[]>('/mcp/servers');
  }
  mcpVerify() {
    return this.post<InstallationReceipt>('/mcp/verify', { confirm: 'verify' });
  }
  skills() {
    /* wire tolerance: the contract types declare these arrays required, but
     * an adapter may omit them — decode absent lists as [] so the page
     * renders its UNVERIFIED state instead of crashing change detection. */
    return this.get<SkillDescriptor[]>('/skills').pipe(
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
    return this.get<TaskExecution[]>('/tasks');
  }
  metrics() {
    return this.get<MetricsReport>('/metrics');
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
    return this.get<VersionInfo>('/versions');
  }
  lab() {
    return this.get<LabData>('/lab');
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
