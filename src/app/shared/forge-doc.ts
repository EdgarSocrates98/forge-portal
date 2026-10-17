import { Component, input, signal } from '@angular/core';
import { TPipe } from '../core/i18n/i18n.pipe';
import { StateBadge } from './state-badge';
import { UiIcon } from './icon';

/** forge/* lifecycle document — the portable contract the CLIs render. */
export interface ForgeDoc {
  schema?: string;
  forge_id?: string;
  operation?: string;
  status?: string;
  scope?: string;
  target_root?: string;
  version?: string;
  state_dir?: string;
  ledger_entries?: number;
  profile?: string;
  context?: { profile?: string; managed_entries?: number };
  checks?: ForgeCheck[];
  drift?: { ok?: number; modified?: ForgeFile[]; missing?: ForgeFile[] };
  managed_files?: ForgeFile[];
  planned_files?: ForgeFile[];
  forge_portal?: { state?: string; install_root?: string | null; manifest?: string | null };
  workspace?: {
    members?: { path?: string }[];
    conflicts?: { member?: string; forge_id?: string; decision?: string }[];
    unknown_members?: string[];
    member_results?: { member?: string; status?: string }[];
  };
  verification?: { status?: string };
  error?: { kind?: string; detail?: string; unlock?: string };
  repair_hint?: string;
}

export interface ForgeCheck {
  id?: string;
  status?: string;
  detail?: string;
  repairable?: boolean;
}

export interface ForgeFile {
  path?: string;
  status?: string;
}

/**
 * Renders a forge/* document as a readable card — same sections and
 * state vocabulary as the CLI/TUI kit renderer, so what the user sees
 * in the portal matches what the terminal shows. Raw JSON stays one
 * click away in advanced mode.
 */
@Component({
  selector: 'ui-forge-doc',
  standalone: true,
  imports: [TPipe, StateBadge, UiIcon],
  template: `
    @if (doc(); as d) {
      <div class="fdoc">
        <div class="fdoc__head">
          <span class="fdoc__title">{{ d.forge_id ?? 'forge' }}</span>
          @if (d.operation) {
            <span class="fdoc__op">· {{ d.operation }}</span>
          }
          <ui-state-badge [state]="d.status ?? 'unverified'" />
        </div>

        <dl class="fdoc__meta">
          @for (kv of meta(d); track kv[0]) {
            <div class="kv">
              <dt>{{ kv[0] | t }}</dt>
              <dd>{{ kv[1] }}</dd>
            </div>
          }
        </dl>

        @if (d.checks?.length) {
          <h3>{{ 'fdoc.checks' | t }}</h3>
          <ul class="fdoc__checks">
            @for (c of d.checks; track c.id) {
              <li>
                <ui-state-badge
                  [state]="c.status ?? 'unverified'"
                  [labelOverride]="c.status ?? null"
                />
                <code class="cid">{{ c.id }}</code>
                @if (c.detail) {
                  <span class="detail">{{ c.detail }}</span>
                }
                @if (c.repairable) {
                  <span class="repairable">{{ 'fdoc.repairable' | t }}</span>
                }
              </li>
            }
          </ul>
        }

        @if (d.drift; as drift) {
          @if (drift.ok !== undefined) {
            <h3>{{ 'fdoc.drift' | t }}</h3>
            <p class="fdoc__drift">
              <span class="ok">ok {{ drift.ok }}</span>
              <span class="warn">{{ 'fdoc.modified' | t }} {{ drift.modified?.length ?? 0 }}</span>
              <span class="bad">{{ 'fdoc.missing' | t }} {{ drift.missing?.length ?? 0 }}</span>
            </p>
            @for (f of driftFiles(drift); track f.path) {
              <div class="fdoc__file">
                <ui-state-badge
                  [state]="f.status ?? 'modified'"
                  [labelOverride]="f.status ?? null"
                />
                <code>{{ f.path }}</code>
              </div>
            }
          }
        }

        @if (files(d); as fs) {
          @if (fs.list.length) {
            <h3>{{ fs.label | t }}</h3>
            <p class="fdoc__count">{{ fs.list.length }}</p>
            @for (f of fs.list.slice(0, 8); track f.path ?? f) {
              <div class="fdoc__file">
                <code>{{ f.path ?? f }}</code>
              </div>
            }
            @if (fs.list.length > 8) {
              <p class="muted">… {{ fs.list.length - 8 }} {{ 'fdoc.more' | t }}</p>
            }
          }
        }

        @if (d.forge_portal; as portal) {
          <h3>{{ 'fdoc.portal' | t }}</h3>
          <p class="fdoc__portal">
            <ui-state-badge
              [state]="portal.state ?? 'unverified'"
              [labelOverride]="portal.state ?? null"
            />
            @if (portal.install_root || portal.manifest) {
              <code>{{ portal.install_root ?? portal.manifest }}</code>
            } @else if (portal.state === 'vendored') {
              <span class="muted">{{ 'fdoc.portal.vendored' | t }}</span>
            }
          </p>
        }

        @if (d.workspace; as ws) {
          <h3>{{ 'fdoc.workspace' | t }}</h3>
          @for (m of ws.members ?? []; track m.path) {
            <div class="fdoc__file">
              <code>{{ m.path }}</code>
            </div>
          }
          @for (c of ws.conflicts ?? []; track c.member) {
            <div class="fdoc__file">
              <ui-state-badge state="degraded" [labelOverride]="'conflict'" />
              <code>{{ c.member }}</code> {{ c.forge_id }}: {{ c.decision }}
            </div>
          }
          @for (u of ws.unknown_members ?? []; track u) {
            <div class="fdoc__file">
              <ui-state-badge state="unverified" [labelOverride]="'unknown'" />
              <code>{{ u }}</code>
            </div>
          }
          @for (r of ws.member_results ?? []; track r.member) {
            <div class="fdoc__file">
              <ui-state-badge
                [state]="r.status ?? 'unverified'"
                [labelOverride]="r.status ?? null"
              />
              <code>{{ r.member }}</code>
            </div>
          }
        }

        @if (d.verification?.status) {
          <p class="fdoc__verif">
            {{ 'fdoc.verification' | t }}
            <ui-state-badge [state]="d.verification!.status" />
          </p>
        }

        @if (d.error && (d.error.kind || d.error.detail)) {
          <div class="fdoc__refusal">
            <p>
              <code>{{ d.error.kind }}</code>
            </p>
            @if (d.error.detail) {
              <p>{{ d.error.detail }}</p>
            }
            @if (d.error.unlock) {
              <p class="unlock">{{ 'fdoc.unlock' | t }} {{ d.error.unlock }}</p>
            }
          </div>
        }

        @if (d.repair_hint) {
          <p class="fdoc__repair">
            <ui-icon name="refresh" [size]="13" /> {{ 'fdoc.repair' | t }}
            <code>{{ d.repair_hint }}</code>
          </p>
        }

        <details class="fdoc__raw">
          <summary>{{ 'fdoc.raw' | t }}</summary>
          <pre>{{ raw() }}</pre>
        </details>
      </div>
    }
  `,
  styles: `
    .fdoc {
      font-size: var(--font-sm);
    }
    .fdoc__head {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      margin-bottom: var(--space-3);
    }
    .fdoc__title {
      font-weight: 700;
      font-size: var(--font-lg);
      letter-spacing: -0.01em;
    }
    .fdoc__op {
      color: var(--fg-muted);
      font-weight: 600;
    }
    .fdoc__meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--space-2) var(--space-4);
      margin: 0 0 var(--space-3);
    }
    .kv dt {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .kv dd {
      margin: 0;
      font-weight: 550;
      word-break: break-all;
    }
    h3 {
      margin: var(--space-3) 0 var(--space-2);
      font-size: var(--font-xs);
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--fg-muted);
    }
    .fdoc__checks {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .fdoc__checks li {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .cid {
      font-weight: 650;
    }
    .detail {
      color: var(--fg-muted);
    }
    .repairable {
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 650;
    }
    .fdoc__drift {
      display: flex;
      gap: var(--space-3);
      font-weight: 650;
    }
    .ok {
      color: var(--ok);
    }
    .warn {
      color: var(--warn);
    }
    .bad {
      color: var(--bad);
    }
    .fdoc__file {
      display: flex;
      align-items: baseline;
      gap: var(--space-2);
      padding: 2px 0;
    }
    .fdoc__count {
      font-weight: 650;
      margin: 0;
    }
    .fdoc__portal,
    .fdoc__verif {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .fdoc__refusal {
      border-left: 3px solid var(--bad);
      padding: var(--space-1) var(--space-3);
      margin: var(--space-3) 0;
      color: var(--bad);
    }
    .fdoc__refusal .unlock {
      color: var(--accent-ink);
    }
    .fdoc__repair {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      color: var(--accent-ink);
    }
    .fdoc__raw {
      margin-top: var(--space-4);
    }
    .fdoc__raw pre {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      overflow-x: auto;
      font-size: var(--font-xs);
    }
    .muted {
      color: var(--fg-muted);
    }
  `,
})
export class UiForgeDoc {
  readonly doc = input.required<ForgeDoc | null>();
  readonly raw = signal('');

  ngOnChanges(): void {
    this.raw.set(JSON.stringify(this.doc(), null, 2));
  }

  meta(d: ForgeDoc): Array<[string, string]> {
    const out: Array<[string, string]> = [];
    if (d.target_root) out.push(['doc.target', d.target_root]);
    if (d.scope) out.push(['doc.scope', d.scope]);
    if (d.version) out.push(['doc.version', d.version]);
    const profile = d.context?.profile ?? d.profile;
    if (profile) out.push(['doc.profile', profile]);
    if (d.state_dir) out.push(['doc.state_dir', d.state_dir]);
    if (d.ledger_entries !== undefined) out.push(['doc.managed', `${d.ledger_entries}`]);
    return out;
  }

  driftFiles(drift: NonNullable<ForgeDoc['drift']>): ForgeFile[] {
    return [...(drift.modified ?? []), ...(drift.missing ?? [])].slice(0, 8);
  }

  files(d: ForgeDoc): { label: string; list: ForgeFile[] } | null {
    if (d.managed_files) return { label: 'fdoc.managed_files', list: d.managed_files };
    if (d.planned_files) return { label: 'fdoc.planned_files', list: d.planned_files };
    return null;
  }
}
