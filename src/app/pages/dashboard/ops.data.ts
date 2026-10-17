import {
  AccountEnvironment,
  FederationSnapshot,
  GraphBundle,
  HostDetection,
  McpServerDescriptor,
  PortalDescriptor,
  PortalHealth,
  RegistryState,
  TaskExecution,
  VersionInfo,
} from '../../core/api/api.models';
import { specialistVersion } from '../explorer/forges.data';

/**
 * Operational derivations for the dashboard — pure functions over
 * already-fetched payloads. Every alert is actionable: it is emitted
 * only when a real observed signal demands it AND a portal page exists
 * where the operator can resolve it. An unverifiable condition never
 * becomes an alert — the owning section already renders UNVERIFIED.
 */

export type AlertSeverity = 'error' | 'warn' | 'info';

export interface AlertItem {
  /** Stable id — one per (rule, subject) pair, used as track key. */
  id: string;
  severity: AlertSeverity;
  icon: string;
  /** i18n key rendered as the alert text. */
  titleKey: string;
  params?: Record<string, string | number>;
  /** Raw backend detail (check detail, refusal…) — verbatim evidence. */
  detail?: string;
  /** The page where the operator resolves the alert. */
  route: string | unknown[];
  /** i18n key for the link label. */
  linkKey: string;
}

export interface OpsInput {
  health: PortalHealth | null;
  accountEnvironment: AccountEnvironment | null;
  federation: FederationSnapshot | null;
  mcpServers: McpServerDescriptor[] | null;
  hosts: HostDetection[] | null;
  tasks: TaskExecution[] | null;
  registry: RegistryState | null;
  versions: VersionInfo | null;
  graphs: GraphBundle | null;
}

/** Failure = a real terminal failure signal, not an unfinished run. */
export function isFailedTask(t: TaskExecution): boolean {
  const stage = (t.stage || '').toLowerCase();
  if (['failed', 'refused', 'cancelled'].includes(stage)) return true;
  return t.exit_code !== null && t.exit_code !== 0;
}

const SEV_ORDER: Record<AlertSeverity, number> = { error: 0, warn: 1, info: 2 };

function alert(
  severity: AlertSeverity,
  id: string,
  titleKey: string,
  route: string | unknown[],
  linkKey: string,
  extra: Partial<AlertItem> = {},
): AlertItem {
  return { severity, id, titleKey, route, linkKey, icon: 'alert', ...extra };
}

/** Alerts derivados dos sinais observados — nada é inferido além do
 *  que cada endpoint respondeu. */
export function buildAlerts(input: OpsInput): AlertItem[] {
  const out: AlertItem[] = [];
  const {
    health,
    accountEnvironment,
    federation,
    mcpServers,
    hosts,
    tasks,
    registry,
    versions,
    graphs,
  } = input;

  // — serving Forja: install state is the authoritative signal —
  const state = health?.state;
  if (state === 'FAILED' || state === 'BLOCKED') {
    out.push(
      alert('error', 'install-state', 'ops.alert.installState', '/install', 'ops.alert.goInstall', {
        params: { state: state ?? '' },
      }),
    );
  } else if (state === 'DEGRADED') {
    out.push(
      alert('warn', 'install-state', 'ops.alert.installState', '/install', 'ops.alert.goInstall', {
        params: { state: state ?? '' },
      }),
    );
  } else if (state === 'NOT_INSTALLED') {
    out.push(
      alert('warn', 'install-state', 'ops.alert.notInstalled', '/install', 'ops.alert.goInstall'),
    );
  }
  for (const c of health?.checks ?? []) {
    if (c.state === 'FAIL') {
      out.push(
        alert(
          'error',
          `check-${c.id}`,
          'ops.alert.checkFailed',
          '/install',
          'ops.alert.goInstall',
          {
            params: { id: c.id },
            detail: c.detail,
          },
        ),
      );
    }
  }

  // — account environment: missing/invalid required vars → /config —
  const env = accountEnvironment?.state;
  if (env === 'MISSING' || env === 'INVALID') {
    out.push(
      alert('error', 'env', 'ops.alert.env', '/config', 'ops.alert.goConfig', {
        params: { state: env },
      }),
    );
  } else if (env === 'PARTIAL') {
    out.push(
      alert('warn', 'env', 'ops.alert.env', '/config', 'ops.alert.goConfig', {
        params: { state: env },
      }),
    );
  }

  // — federation specialists: terminal states → detail page —
  for (const s of federation?.specialists ?? []) {
    const st = s.state ?? s.status ?? '';
    if (st === 'FAILED' || st === 'BLOCKED') {
      out.push(
        alert(
          'error',
          `spec-${s.provider}`,
          'ops.alert.specialist',
          ['/forges', s.provider],
          'ops.alert.goForge',
          {
            params: { forge: s.provider, state: st },
          },
        ),
      );
    } else if (st === 'NOT_INSTALLED') {
      out.push(
        alert(
          'warn',
          `spec-${s.provider}`,
          'ops.alert.forgeNotInstalled',
          '/federation',
          'ops.alert.goFederation',
          {
            params: { forge: s.provider },
          },
        ),
      );
    }
  }

  // — MCP servers: handshake state → /mcp —
  for (const m of mcpServers ?? []) {
    if (m.state === 'FAILED') {
      out.push(
        alert('error', `mcp-${m.id}`, 'ops.alert.mcpState', '/mcp', 'ops.alert.goMcp', {
          params: { id: m.id, state: m.state },
          detail: m.detail,
        }),
      );
    } else if (m.state === 'DEGRADED') {
      out.push(
        alert('warn', `mcp-${m.id}`, 'ops.alert.mcpState', '/mcp', 'ops.alert.goMcp', {
          params: { id: m.id, state: m.state },
          detail: m.detail,
        }),
      );
    } else if (m.state === 'NOT_CONFIGURED') {
      out.push(
        alert('info', `mcp-${m.id}`, 'ops.alert.mcpNotConfigured', '/mcp', 'ops.alert.goMcp', {
          params: { id: m.id },
        }),
      );
    }
  }

  // — hosts: integration lifecycle → /hosts —
  for (const h of hosts ?? []) {
    if (h.integration === 'FAILED' || h.integration === 'BLOCKED') {
      out.push(
        alert(
          'error',
          `host-${h.host}`,
          'ops.alert.hostIntegration',
          '/hosts',
          'ops.alert.goHosts',
          {
            params: { host: h.host, state: h.integration },
            detail: h.detail,
          },
        ),
      );
    } else if (h.detected && h.integration === 'NOT_DETECTED') {
      out.push(
        alert(
          'info',
          `host-${h.host}`,
          'ops.alert.hostNotIntegrated',
          '/hosts',
          'ops.alert.goHosts',
          {
            params: { host: h.host },
          },
        ),
      );
    }
  }

  // — recent executions: real failures → /tasks —
  const failed = (tasks ?? []).filter(isFailedTask).length;
  if (failed > 0) {
    out.push(
      alert('error', 'tasks-failed', 'ops.alert.tasksFailed', '/tasks', 'ops.alert.goTasks', {
        params: { count: failed },
      }),
    );
  }

  // — forge-cli registry: malformed state file → /versions —
  if (registry?.error === 'malformed') {
    out.push(
      alert(
        'warn',
        'registry-malformed',
        'ops.alert.registryMalformed',
        '/versions',
        'ops.alert.goVersions',
      ),
    );
  }

  // — versions: update only when the backend verifiably reports one —
  const available = versions?.available?.version;
  const installed = versions?.installed?.version;
  if (available && available !== installed) {
    out.push(
      alert(
        'info',
        'update-available',
        'ops.alert.updateAvailable',
        '/versions',
        'ops.alert.goVersions',
        {
          params: { version: available },
        },
      ),
    );
  } else if (versions?.pending) {
    out.push(
      alert(
        'info',
        'pending-updates',
        'ops.alert.pendingUpdates',
        '/versions',
        'ops.alert.goVersions',
      ),
    );
  }

  // — graph: declared availability → /graph —
  if (graphs?.availability?.state === 'no_graph') {
    out.push(alert('info', 'graph-empty', 'ops.alert.noGraph', '/graph', 'ops.alert.goGraph'));
  }

  return out.sort((a, b) => SEV_ORDER[a.severity] - SEV_ORDER[b.severity]);
}

/** Row in the installed-versions table — one real source per row. */
export interface VersionRow {
  id: string;
  /** The Forja serving this portal. */
  serving: boolean;
  /** Installed version — null when the source could not verify it. */
  version: string | null;
  /** Pinned version recorded by forge-cli — null = not pinned/unknown. */
  pinned: string | null;
  /** Install method recorded by the receipt (registry, source…). */
  method: string | null;
  /** Endpoint that supplied this row. */
  source: string;
  /** Verifiably newer version — only when /versions reports one. */
  updateTo: string | null;
}

/**
 * Installed versions, honest per source: forge-cli registry receipts
 * (installed on disk via the CLI), the serving Forja (bootstrap), and
 * federation specialists (declared version keys). A Forja appearing in
 * two sources merges into one row — both values stay real.
 */
export function buildVersionRows(input: {
  registry: RegistryState | null;
  federation: FederationSnapshot | null;
  descriptor: PortalDescriptor | null;
  versions: VersionInfo | null;
}): VersionRow[] {
  const { registry, federation, descriptor, versions } = input;
  const rows = new Map<string, VersionRow>();
  const ensure = (id: string): VersionRow => {
    let row = rows.get(id);
    if (!row) {
      row = {
        id,
        serving: false,
        version: null,
        pinned: null,
        method: null,
        source: '',
        updateTo: null,
      };
      rows.set(id, row);
    }
    return row;
  };

  if (registry?.present) {
    for (const [name, rec] of Object.entries(registry.forges)) {
      const row = ensure(name);
      row.version = rec.version ?? row.version;
      row.pinned = rec.pinned ?? row.pinned;
      row.method = rec.method ?? row.method;
      row.source = 'GET /api/v1/registry/state';
    }
  }
  if (descriptor) {
    const row = ensure(descriptor.forge_id);
    row.serving = true;
    row.version = row.version ?? descriptor.forge_version;
    if (!row.source) row.source = 'bootstrap';
  }
  for (const s of federation?.specialists ?? []) {
    const row = ensure(s.provider);
    row.version = row.version ?? specialistVersion(s);
    if (!row.source) row.source = 'GET /api/v1/federation';
  }

  // "Update available" exists only when /versions reports a concrete
  // newer version for the serving Forja — never a guessed comparison.
  const available = versions?.available?.version;
  if (descriptor && available && available !== versions?.installed?.version) {
    ensure(descriptor.forge_id).updateTo = available;
  }

  return [...rows.values()].sort((a, b) => {
    if (a.serving !== b.serving) return a.serving ? -1 : 1;
    return a.id.localeCompare(b.id);
  });
}

/** Installed-count derivable from registry receipts — 0 only when the
 *  state file was really read and held no forge. */
export function registryInstallCount(registry: RegistryState | null): number | null {
  if (!registry || !registry.present) return null;
  return Object.keys(registry.forges).length;
}
