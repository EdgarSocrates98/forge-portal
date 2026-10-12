import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../api/api.client';
import { ApiError } from '../api/api.error';
import {
  AccountEnvironment,
  BootstrapPayload,
  PortalDescriptor,
  PortalHealth,
} from '../api/api.models';
import { ThemeStore } from '../theme/theme.store';

export type PortalStatus = 'booting' | 'ready' | 'degraded' | 'offline';

/**
 * Estado central do portal — carregado uma vez no bootstrap e
 * invalidado por ação explícita (sem polling). `descriptor`/`health`
 * vêm do servidor; quando o servidor está fora o portal mostra estado
 * `offline` honesto em vez de inventar dados.
 */
@Injectable({ providedIn: 'root' })
export class PortalStore {
  private readonly api = inject(PortalApi);
  private readonly theme = inject(ThemeStore);

  readonly status = signal<PortalStatus>('booting');
  readonly descriptor = signal<PortalDescriptor | null>(null);
  readonly health = signal<PortalHealth | null>(null);
  readonly accountEnvironment = signal<AccountEnvironment | null>(null);
  readonly lastError = signal<ApiError | null>(null);
  readonly refreshedAt = signal<string | null>(null);

  readonly forgeId = computed(() => this.descriptor()?.forge_id ?? 'the-forge');
  readonly forgeName = computed(() => this.descriptor()?.forge_name ?? 'Forge Portal');
  readonly federated = computed(() => this.descriptor()?.federated ?? false);
  readonly capabilities = computed(() => this.descriptor()?.capabilities ?? []);
  readonly nav = computed(() => this.descriptor()?.nav ?? []);
  readonly workspace = computed(() => this.descriptor()?.workspace ?? null);

  hasCapability(id: string): boolean {
    const cap = this.capabilities().find((c) => c.id === id);
    return cap?.state === 'supported';
  }

  async bootstrap(): Promise<void> {
    this.status.set('booting');
    try {
      const payload = await firstValueFrom(this.api.bootstrap());
      this.applyBootstrap(payload);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0);
      this.lastError.set(apiErr);
      this.status.set('offline');
    }
  }

  async refreshHealth(): Promise<void> {
    try {
      const health = await firstValueFrom(this.api.installationStatus());
      this.health.set(health);
      this.accountEnvironment.set(health.account_environment ?? this.accountEnvironment());
      this.refreshedAt.set(new Date().toISOString());
      this.lastError.set(null);
    } catch (err) {
      const apiErr = err instanceof ApiError ? err : new ApiError(0);
      this.lastError.set(apiErr);
      if (apiErr.transport) this.status.set('offline');
    }
  }

  private applyBootstrap(payload: BootstrapPayload): void {
    this.descriptor.set(payload.descriptor);
    this.health.set(payload.health);
    this.accountEnvironment.set(
      payload.account_environment ?? payload.health.account_environment ?? null,
    );
    this.lastError.set(null);
    this.refreshedAt.set(new Date().toISOString());
    this.theme.setForge(payload.descriptor.theme ?? payload.descriptor.forge_id);
    this.status.set(payload.health.state === 'DEGRADED' ? 'degraded' : 'ready');
  }
}
