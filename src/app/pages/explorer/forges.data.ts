import { signal } from '@angular/core';
import { Observable, firstValueFrom, map } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  FederationSnapshot,
  FederationSpecialist,
  PortalDescriptor,
  PortalHealth,
} from '../../core/api/api.models';

/** Normalize unknown thrown values into ApiError (transport-safe). */
export function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0);
}

/** 404 / PORTAL-NOT-FOUND — this Forja simply does not expose the op. */
function sourceAbsent(err: ApiError): boolean {
  return err.status === 404 || err.body.code === 'PORTAL-NOT-FOUND';
}

/**
 * Per-source async slice — every panel owns one so a failed endpoint
 * degrades only its own section, never the whole page.
 *
 * - `unavailable`: the op does not exist on this Forja (404 /
 *   PORTAL-NOT-FOUND) → render UNVERIFIED, not a crash.
 * - `error`: any other failure → render the retryable error panel.
 * - `data` stays null until the backend really answered — nothing is
 *   ever rendered from assumption.
 */
export class Source<T> {
  readonly data = signal<T | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly unavailable = signal(false);
  readonly loading = signal(false);
  readonly attempted = signal(false);
  readonly loadedAt = signal<string | null>(null);

  async load(read: () => Observable<T>): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.unavailable.set(false);
    try {
      this.data.set(await firstValueFrom(read()));
      this.loadedAt.set(new Date().toISOString());
    } catch (err) {
      const e = toApiError(err);
      if (sourceAbsent(e)) this.unavailable.set(true);
      else this.error.set(e);
    } finally {
      this.loading.set(false);
      this.attempted.set(true);
    }
  }
}

/** Localized HH:MM stamp from an ISO timestamp; falls back to the raw
 *  value when it cannot be parsed — the raw value is still real data. */
export function stamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString();
}

/** A row in the Forja explorer — the serving Forja or a federation entry. */
export interface ForgeRow {
  /** Identity used in /forges/:id — provider for specialists, forge_id
   *  for the serving Forja, 'self' when even that is unverified. */
  id: string;
  /** The Forja serving this portal (data comes from bootstrap/health). */
  serving: boolean;
  /** Listed only because it sits in `installed_forges` — never observed. */
  registryOnly: boolean;
  name: string | null;
  cli: string | null;
  /** undefined = the backend could not verify → render UNVERIFIED. */
  state: string | undefined;
  version: string | null;
  /** string = path · null = known-absent · undefined = unverified. */
  checkout: string | null | undefined;
  mcp: Record<string, unknown> | null | undefined;
  specialist: FederationSpecialist | null;
}

const VERSION_KEYS = ['version', 'revision', 'ref', 'release'] as const;

/** Free-form specialists may carry a version under different keys. */
export function specialistVersion(s: FederationSpecialist): string | null {
  for (const key of VERSION_KEYS) {
    const v = s[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * All Forjas the workspace can see: the serving Forja (only when the
 * descriptor really identified it), then every specialist in the
 * federation snapshot, then `installed_forges` entries that the live
 * snapshot never observed — kept visible as registry-only rows instead
 * of being silently dropped.
 */
export function buildForgeRows(
  descriptor: PortalDescriptor | null,
  health: PortalHealth | null,
  snapshot: FederationSnapshot | null,
): ForgeRow[] {
  const rows: ForgeRow[] = [];
  const seen = new Set<string>();
  if (descriptor) {
    seen.add(descriptor.forge_id);
    rows.push({
      id: descriptor.forge_id,
      serving: true,
      registryOnly: false,
      name: descriptor.forge_name,
      cli: descriptor.cli,
      state: health?.state, // undefined → UNVERIFIED
      version: descriptor.forge_version,
      checkout: undefined, // PortalApi does not report a checkout → unverified
      mcp: undefined,
      specialist: null,
    });
  }
  for (const s of snapshot?.specialists ?? []) {
    seen.add(s.provider);
    rows.push({
      id: s.provider,
      serving: false,
      registryOnly: false,
      name: null,
      cli: s.cli ?? null,
      state: s.state ?? s.status,
      version: specialistVersion(s),
      checkout: s.checkout,
      mcp: s.mcp,
      specialist: s,
    });
  }
  for (const id of snapshot?.installed_forges ?? []) {
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      serving: false,
      registryOnly: true,
      name: null,
      cli: null,
      state: undefined,
      version: null,
      checkout: undefined,
      mcp: undefined,
      specialist: null,
    });
  }
  return rows;
}

/** Catalog count tile — one Source per endpoint so one failure never
 *  blanks the other tiles. */
export interface CountTile {
  id: 'skills' | 'agents' | 'mcp' | 'hosts';
  icon: string;
  labelKey: string;
  endpoint: string;
  src: Source<number>;
}

export function countTiles(): CountTile[] {
  return [
    {
      id: 'skills',
      icon: 'skills',
      labelKey: 'skills.title',
      endpoint: 'GET /api/v1/skills',
      src: new Source<number>(),
    },
    {
      id: 'agents',
      icon: 'agents',
      labelKey: 'agents.title',
      endpoint: 'GET /api/v1/agents',
      src: new Source<number>(),
    },
    {
      id: 'mcp',
      icon: 'mcp',
      labelKey: 'mcp.title',
      endpoint: 'GET /api/v1/mcp/servers',
      src: new Source<number>(),
    },
    {
      id: 'hosts',
      icon: 'hosts',
      labelKey: 'hosts.title',
      endpoint: 'GET /api/v1/hosts',
      src: new Source<number>(),
    },
  ];
}

export function countLoader(api: PortalApi, id: CountTile['id']): Observable<number> {
  switch (id) {
    case 'skills':
      return api.skills().pipe(map((list) => list.length));
    case 'agents':
      return api.agents().pipe(map((list) => list.length));
    case 'mcp':
      return api.mcpServers().pipe(map((list) => list.length));
    case 'hosts':
      return api.hosts().pipe(map((list) => list.length));
  }
}
