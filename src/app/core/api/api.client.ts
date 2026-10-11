import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import {
  AgentDescriptor,
  ApiEnvelope,
  BootstrapPayload,
  DocHit,
  GraphBundle,
  HostDetection,
  InstallationReceipt,
  McpServerDescriptor,
  PortalCapability,
  PortalHealth,
  ProfileDescriptor,
  SkillDescriptor,
  TaskExecution,
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
  installationPlan(input: {
    scope?: string;
    host?: string;
    profile?: string;
    components?: Record<string, boolean>;
  }) {
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
    return this.get<SkillDescriptor[]>('/skills');
  }
  agents() {
    return this.get<AgentDescriptor[]>('/agents');
  }
  tasks() {
    return this.get<TaskExecution[]>('/tasks');
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
