import { Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import {
  ComponentId,
  FederationPlanResponse,
  FederationSelection,
  FederationSnapshot,
  ExecutionProfile,
  InstallationReceipt,
} from '../../core/api/api.models';
import { PortalStore } from '../../core/portal/portal.store';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { I18nService } from '../../core/i18n/i18n.service';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { UiSkeleton } from '../../shared/skeleton';
import { UiIcon } from '../../shared/icon';

type Phase = 'idle' | 'loading' | 'planning' | 'review' | 'running' | 'done' | 'error';
type Scope = FederationSelection['scope'];
type HostChoice = FederationSelection['host'];
type InstallProfile = FederationSelection['profile'];
type GatewayProfile = NonNullable<FederationSelection['gateway_profile']>;

@Component({
  selector: 'page-federation',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, ErrorState, UiSkeleton, UiIcon],
  template: `
    <ui-page-header [title]="'federation.title' | t" [subtitle]="'federation.subtitle' | t">
      <button class="btn" [disabled]="busy()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (phase() === 'loading' && !snapshot()) {
      <section class="card loading" role="status" aria-live="polite">
        <ui-skeleton kind="text" [lines]="2" />
        <ui-skeleton kind="card" />
      </section>
    } @else if (snapshot(); as data) {
      <section class="stats" aria-label="{{ 'federation.summary' | t }}">
        <div class="stat" [style.--stat-rail]="'var(--accent)'">
          <span class="stat__value">{{ data.summary.catalog }}</span>
          <span class="stat__label">{{ 'federation.catalog' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--ok)'">
          <span class="stat__value">{{ data.summary.installed }}</span>
          <span class="stat__label">{{ 'federation.installed' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--info)'">
          <span class="stat__value">{{ data.summary.with_mcp }}</span>
          <span class="stat__label">{{ 'federation.mcp' | t }}</span>
        </div>
        <div class="stat" [style.--stat-rail]="'var(--fg-muted)'">
          <span class="stat__value">{{ data.summary.with_checkout }}</span>
          <span class="stat__label">{{ 'federation.checkouts' | t }}</span>
        </div>
      </section>

      <div class="layout">
        <section class="card setup-card">
          <div class="card__heading">
            <div>
              <h2>{{ 'federation.setup.title' | t }}</h2>
              <p class="muted">{{ 'federation.setup.hint' | t }}</p>
            </div>
            <span class="eyebrow">{{ 'federation.governed' | t }}</span>
          </div>

          <h3>{{ 'install.scope' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'install.scope' | t">
            @for (item of scopes; track item.id) {
              <label class="choice" [attr.data-active]="scope() === item.id || null">
                <input
                  type="radio"
                  name="federation-scope"
                  [value]="item.id"
                  [checked]="scope() === item.id"
                  (change)="scope.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.host' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'federation.host' | t">
            @for (item of hosts; track item.id) {
              <label class="choice" [attr.data-active]="host() === item.id || null">
                <input
                  type="radio"
                  name="federation-host"
                  [value]="item.id"
                  [checked]="host() === item.id"
                  (change)="host.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.forges' | t }}</h3>
          <p class="muted">{{ 'federation.forgesHint' | t }}</p>
          @if (data.installed_forges.length) {
            <div class="component-grid" role="group" [attr.aria-label]="'federation.forges' | t">
              @for (fid of data.installed_forges; track fid) {
                <label class="component" [attr.data-active]="forgeSelected().has(fid) || null">
                  <input
                    type="checkbox"
                    name="federation-forge"
                    [value]="fid"
                    [checked]="forgeSelected().has(fid)"
                    (change)="toggleForge(fid)"
                  />
                  <span
                    ><strong>{{ fid }}</strong
                    ><small>{{ 'federation.forge.registered' | t }}</small></span
                  >
                </label>
              }
            </div>
            @if (!forgeSelected().size) {
              <p class="muted" role="note">{{ 'federation.forgesEmpty' | t }}</p>
            }
          } @else {
            <p class="muted" role="note">{{ 'federation.forgesNone' | t }}</p>
          }

          <h3>{{ 'federation.profile' | t }}</h3>
          <div class="choices" role="radiogroup" [attr.aria-label]="'federation.profile' | t">
            @for (item of profiles; track item.id) {
              <label class="choice" [attr.data-active]="profile() === item.id || null">
                <input
                  type="radio"
                  name="federation-profile"
                  [value]="item.id"
                  [checked]="profile() === item.id"
                  (change)="profile.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.executionProfile' | t }}</h3>
          <div
            class="choices"
            role="radiogroup"
            [attr.aria-label]="'federation.executionProfile' | t"
          >
            @for (item of gatewayProfiles; track item.id) {
              <label class="choice" [attr.data-active]="gatewayProfile() === item.id || null">
                <input
                  type="radio"
                  name="federation-execution-profile"
                  [value]="item.id"
                  [checked]="gatewayProfile() === item.id"
                  (change)="gatewayProfile.set(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>

          <h3>{{ 'federation.components' | t }}</h3>
          <div class="component-grid">
            @for (item of componentOptions; track item.id) {
              <label class="component" [attr.data-active]="selected().has(item.id) || null">
                <input
                  type="checkbox"
                  [checked]="selected().has(item.id)"
                  (change)="toggle(item.id)"
                />
                <span
                  ><strong>{{ item.label | t }}</strong
                  ><small>{{ item.hint | t }}</small></span
                >
              </label>
            }
          </div>
          <div class="actions-row">
            <button class="btn btn--primary" [disabled]="busy()" (click)="plan()">
              <ui-icon name="install" [size]="15" />
              {{ 'federation.plan' | t }}
            </button>
            <span class="muted">{{ 'federation.planHint' | t }}</span>
          </div>
        </section>

        <aside class="card specialist-card" [attr.aria-label]="'federation.specialists' | t">
          <div class="card__heading">
            <div>
              <h2>{{ 'federation.specialists' | t }}</h2>
              <p class="muted">{{ 'federation.specialistsHint' | t }}</p>
            </div>
          </div>
          @if (data.specialists.length) {
            <ul class="specialists">
              @for (item of data.specialists; track item.provider) {
                <li class="specialist">
                  <div class="specialist__main">
                    <span class="specialist__mark" aria-hidden="true"
                      ><ui-icon name="check" [size]="13"
                    /></span>
                    <div>
                      <strong>{{ item.provider }}</strong
                      ><small>{{ item.cli || item.checkout || ('state.unknown' | t) }}</small>
                    </div>
                  </div>
                  <ui-state-badge [state]="item.state || item.status || 'unknown'" />
                  <div class="specialist__meta">
                    <span [attr.data-present]="item.mcp ? 'true' : null">{{
                      item.mcp ? ('federation.mcpReady' | t) : ('federation.mcpAbsent' | t)
                    }}</span>
                    @if (item.notes?.length) {
                      <small>{{ item.notes![0] }}</small>
                    }
                  </div>
                </li>
              }
            </ul>
          } @else {
            <p class="empty">{{ 'federation.empty' | t }}</p>
          }
          <p class="registry mono">{{ data.registry.path }}</p>
        </aside>
      </div>
    }

    @if (phase() === 'review' && planResult(); as planned) {
      <section class="card plan" data-lift>
        <div class="card__heading">
          <div>
            <h2>{{ 'federation.review' | t }}</h2>
            <p class="muted">{{ 'federation.reviewHint' | t }}</p>
          </div>
          <ui-state-badge [state]="planned.status" />
        </div>
        <dl class="review-grid">
          <div>
            <dt>{{ 'install.scope' | t }}</dt>
            <dd>{{ planned.plan['scope'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.host' | t }}</dt>
            <dd>{{ planned.plan['host'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.forges' | t }}</dt>
            <dd>{{ forgeEcho(planned.plan['forge']) }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.profile' | t }}</dt>
            <dd>{{ planned.plan['profile'] }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.executionProfile' | t }}</dt>
            <dd>{{ planned.plan['gateway_profile'] || ('state.unknown' | t) }}</dd>
          </div>
          <div>
            <dt>{{ 'federation.actions' | t }}</dt>
            <dd>{{ planned.actions.length }}</dd>
          </div>
        </dl>
        <!-- §4.4 — the engine's named selection state, verbatim. -->
        @if (planned.receipt?.selection; as sel) {
          <div class="selection-note" role="note">
            <ui-state-badge
              [state]="sel.state ?? 'unverified'"
              [labelOverride]="sel.state ?? null"
              [kindOverride]="selectionKind(sel.state)"
            />
            <div>
              @if (sel.detail) {
                <p>{{ sel.detail }}</p>
              }
              @if (sel.next_action) {
                <p class="muted">{{ sel.next_action }}</p>
              }
            </div>
          </div>
        }
        @if (planned.receipt?.forges?.length) {
          <h3>{{ 'federation.forgeResults' | t }}</h3>
          <ul class="checks">
            @for (f of planned.receipt!.forges!; track f.forge_id) {
              <li>
                <ui-state-badge
                  [state]="f.status ?? 'unverified'"
                  [labelOverride]="f.status ?? null"
                />
                <code>{{ f.forge_id }}</code>
                @if (f.detail) {
                  <small class="muted">{{ f.detail }}</small>
                }
                @if (f.cmd?.length) {
                  <small class="muted mono">{{ f.cmd!.join(' ') }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (planned.receipt?.checks?.length) {
          <h3>{{ 'federation.planChecks' | t }}</h3>
          <ul class="checks">
            @for (c of planned.receipt!.checks!; track $index) {
              <li>
                <ui-state-badge
                  [state]="c.status ?? 'UNVERIFIED'"
                  [labelOverride]="c.status ?? null"
                />
                <code>{{ c.id ?? '—' }}</code>
                @if (c.detail) {
                  <small class="muted">{{ c.detail }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (planned.actions.length) {
          <ul class="actions">
            @for (item of planned.actions; track $index) {
              <li>
                <code>{{ item.status }}</code
                ><span>{{ item.path }}</span>
              </li>
            }
          </ul>
        }
        @if (planned.receipt?.workspace_detection; as det) {
          <details class="evidence">
            <summary>{{ 'federation.detection' | t }}</summary>
            @if (det.workspace_techs?.length) {
              <p>
                <strong>{{ 'federation.detection.techs' | t }}</strong>
                {{ det.workspace_techs!.join(', ') }}
              </p>
            }
            @if (det.members?.length) {
              <p class="muted">
                {{ 'federation.detection.members' | t: { count: det.members!.length } }}
              </p>
            }
            @for (lim of det.limitations ?? []; track lim) {
              <p class="muted">
                <small>{{ lim }}</small>
              </p>
            }
          </details>
        }
        @if (planned.receipt?.recommendation; as rec) {
          <details class="evidence">
            <summary>{{ 'federation.recommendation' | t }}</summary>
            @if (rec.note) {
              <p class="muted">
                <small>{{ rec.note }}</small>
              </p>
            }
            @for (s of rec.suggested ?? []; track s.forge_id) {
              <p>
                <code>{{ s.forge_id }}</code>
                <span class="muted"
                  >{{ s.role ?? 'candidate' }} · {{ s.confidence ?? '—' }} ·
                  {{
                    (s.installed ? 'federation.rec.installed' : 'federation.rec.notInstalled') | t
                  }}</span
                >
                @if (s.reason) {
                  <small class="muted">{{ s.reason }}</small>
                }
              </p>
            }
            @for (a of rec.alternatives ?? []; track a.forge_id) {
              <p>
                <code>{{ a.forge_id }}</code>
                <span class="muted"
                  >{{ 'federation.rec.alternative' | t }} · {{ a.confidence ?? '—' }}</span
                >
                @if (a.reason) {
                  <small class="muted">{{ a.reason }}</small>
                }
              </p>
            }
            @for (lim of rec.limitations ?? []; track lim) {
              <p class="muted">
                <small>{{ lim }}</small>
              </p>
            }
          </details>
        }
        @if (planned.receipt?.refusal) {
          <p class="refusal" role="alert">
            <code>{{ planned.receipt!.refusal }}</code>
            @if (planned.receipt!.unlock) {
              — {{ planned.receipt!.unlock }}
            }
          </p>
        }
        <div class="actions-row">
          <button
            class="btn btn--primary"
            [disabled]="busy() || !planExecutable(planned)"
            (click)="apply(planned)"
          >
            <ui-icon name="check" [size]="15" />{{ 'federation.apply' | t }}
          </button>
          <button class="btn" [disabled]="busy()" (click)="reset()">
            {{ 'state.cancel' | t }}
          </button>
          @if (!planExecutable(planned)) {
            <span class="muted">{{ 'federation.applyBlocked' | t }}</span>
          }
        </div>
      </section>
    }

    @if (phase() === 'running') {
      <section class="card running" role="status" aria-live="polite">
        <div class="running__spinner" aria-hidden="true"></div>
        {{ 'federation.running' | t }}
      </section>
    }
    @if (phase() === 'done' && result(); as receipt) {
      <section class="card receipt" data-lift>
        <div class="card__heading">
          <h2>{{ 'federation.receipt' | t }}</h2>
          <ui-state-badge [state]="receipt.status" />
          @if (receipt.lifecycle; as lc) {
            <ui-state-badge [state]="lc.state" [attr.title]="lc.detail ?? null" />
          }
        </div>
        <p>
          <span>{{ receipt.detail || ('federation.receiptHint' | t) }}</span>
        </p>
        @if (receipt.verification?.status) {
          <p class="receipt__verify">
            {{ 'install.verify' | t }}:
            <ui-state-badge [state]="receipt.verification!.status!" />
          </p>
        }
        <!-- §4.4 — named post-apply selection state, verbatim. -->
        @if (receipt.selection; as sel) {
          <div class="selection-note" role="note">
            <ui-state-badge
              [state]="sel.state ?? 'unverified'"
              [labelOverride]="sel.state ?? null"
              [kindOverride]="selectionKind(sel.state)"
            />
            <div>
              @if (sel.detail) {
                <p>{{ sel.detail }}</p>
              }
              @if (sel.next_action) {
                <p class="muted">{{ sel.next_action }}</p>
              }
            </div>
          </div>
        }
        @if (receipt.forges?.length) {
          <h3>{{ 'federation.forgeResults' | t }}</h3>
          <ul class="checks">
            @for (f of receipt.forges!; track f.forge_id) {
              <li>
                <ui-state-badge
                  [state]="f.status ?? 'unverified'"
                  [labelOverride]="f.status ?? null"
                />
                <code>{{ f.forge_id }}</code>
                @if (f.via) {
                  <small class="muted">{{ f.via }}</small>
                }
                @if (f.verification?.status) {
                  <ui-state-badge [state]="f.verification!.status!" />
                }
                @if (f.detail) {
                  <small class="muted">{{ f.detail }}</small>
                }
                @if (f.receipt_id) {
                  <small class="muted mono">{{ f.receipt_id }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (receipt.checks?.length) {
          <h3>{{ 'federation.planChecks' | t }}</h3>
          <ul class="checks">
            @for (c of receipt.checks!; track $index) {
              <li>
                <ui-state-badge
                  [state]="c.status ?? 'UNVERIFIED'"
                  [labelOverride]="c.status ?? null"
                />
                <code>{{ c.id ?? '—' }}</code>
                @if (c.detail) {
                  <small class="muted">{{ c.detail }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (receipt.installation?.conflicts?.length) {
          <h3>{{ 'federation.conflicts' | t }}</h3>
          <ul class="checks">
            @for (c of receipt.installation!.conflicts!; track c.path) {
              <li>
                <code>{{ c.path }}</code>
                <small class="muted">
                  {{ c.winner }} ✓ / {{ c.loser }}
                  @if (c.resolution) {
                    — {{ c.resolution }}
                  }
                  @if (c.detail) {
                    · {{ c.detail }}
                  }
                </small>
              </li>
            }
          </ul>
        }
        @if (receipt.onboarding?.hosts?.length) {
          <h3>{{ 'federation.onboarding' | t }}</h3>
          <ul class="checks">
            @for (h of receipt.onboarding!.hosts!; track h.host) {
              <li>
                <ui-state-badge
                  [state]="h.state ?? 'unverified'"
                  [labelOverride]="h.state ?? null"
                  [kindOverride]="onboardKind(h.state)"
                />
                <code>{{ h.host }}</code>
                @if (h.detail) {
                  <small class="muted">{{ h.detail }}</small>
                }
              </li>
            }
          </ul>
          @for (lim of receipt.onboarding!.limitations ?? []; track lim) {
            <p class="muted">
              <small>{{ lim }}</small>
            </p>
          }
        }
        @if (receipt.workspace?.members?.length) {
          <h3>{{ 'install.members' | t }}</h3>
          <ul class="checks">
            @for (m of receipt.workspace!.members!; track m.path) {
              <li>
                <code>{{ m.path }}</code>
                @if (m.state) {
                  <ui-state-badge [state]="m.state!" [labelOverride]="m.state" />
                }
                @if (m.detail) {
                  <small class="muted">{{ m.detail }}</small>
                }
              </li>
            }
          </ul>
        }
        @if (receipt.recommendation || receipt.workspace_detection || receipt.setup) {
          <details class="evidence">
            <summary>{{ 'federation.evidence' | t }}</summary>
            @if (receipt.workspace_detection; as det) {
              @if (det.workspace_techs?.length) {
                <p>
                  <strong>{{ 'federation.detection.techs' | t }}</strong>
                  {{ det.workspace_techs!.join(', ') }}
                </p>
              }
              @for (lim of det.limitations ?? []; track lim) {
                <p class="muted">
                  <small>{{ lim }}</small>
                </p>
              }
            }
            @if (receipt.recommendation; as rec) {
              @for (s of rec.suggested ?? []; track s.forge_id) {
                <p>
                  <code>{{ s.forge_id }}</code>
                  <span class="muted">{{ s.role ?? 'candidate' }} · {{ s.confidence ?? '—' }}</span>
                  @if (s.reason) {
                    <small class="muted">{{ s.reason }}</small>
                  }
                </p>
              }
              @for (a of rec.alternatives ?? []; track a.forge_id) {
                <p>
                  <code>{{ a.forge_id }}</code>
                  <span class="muted">{{ 'federation.rec.alternative' | t }}</span>
                  @if (a.reason) {
                    <small class="muted">{{ a.reason }}</small>
                  }
                </p>
              }
            }
            @if (receipt.setup) {
              <pre>{{ planJson(receipt.setup) }}</pre>
            }
          </details>
        }
        @if (receipt.refusal) {
          <p class="refusal" role="alert">
            <code>{{ receipt.refusal }}</code>
            @if (receipt.unlock) {
              — {{ receipt.unlock }}
            }
          </p>
        }
      </section>
    }
    @if (phase() === 'error') {
      <ui-error [error]="error()" (retry)="load()" />
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-5);
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(300px, 0.75fr);
      gap: var(--space-4);
      align-items: start;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .card__heading {
      display: flex;
      justify-content: space-between;
      gap: var(--space-4);
      align-items: flex-start;
    }
    .card h2 {
      margin: 0 0 var(--space-2);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .card h3 {
      margin: var(--space-5) 0 var(--space-2);
      font-size: var(--font-sm);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .card h3:first-of-type {
      margin-top: var(--space-4);
    }
    .muted {
      color: var(--fg-muted);
    }
    .eyebrow {
      color: var(--accent-ink);
      background: var(--accent-bg);
      border-radius: var(--radius-pill);
      padding: 4px 9px;
      font-size: var(--font-xs);
      font-weight: 700;
      white-space: nowrap;
    }
    .choices {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: var(--space-2);
    }
    .choice,
    .component {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      cursor: pointer;
      transition:
        border-color var(--motion-fast),
        background var(--motion-fast);
    }
    .choice:hover,
    .component:hover,
    .choice[data-active],
    .component[data-active] {
      border-color: var(--accent-ink);
      background: var(--accent-bg);
    }
    .choice input,
    .component input {
      margin-top: 3px;
      accent-color: var(--accent-ink);
      flex: none;
    }
    .choice span,
    .component span {
      display: grid;
      gap: 3px;
    }
    .choice small,
    .component small {
      color: var(--fg-muted);
      line-height: 1.35;
    }
    .component-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: var(--space-2);
    }
    .actions-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-3);
      align-items: center;
      margin-top: var(--space-5);
    }
    .specialists {
      list-style: none;
      padding: 0;
      margin: var(--space-4) 0;
      display: grid;
      gap: var(--space-2);
    }
    .specialist {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 5px var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
    }
    .specialist__main {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      min-width: 0;
    }
    .specialist__main div {
      display: grid;
      min-width: 0;
    }
    .specialist__main small {
      color: var(--fg-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .specialist__mark {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      color: var(--ok);
      background: var(--ok-bg);
      flex: none;
    }
    .specialist__meta {
      grid-column: 1/-1;
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .specialist__meta [data-present] {
      color: var(--ok);
    }
    .specialist__meta small {
      width: 100%;
      overflow-wrap: anywhere;
    }
    .registry {
      border-top: 1px solid var(--border);
      padding-top: var(--space-3);
      color: var(--fg-muted);
      overflow-wrap: anywhere;
      font-size: var(--font-xs);
    }
    .review-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: var(--space-3);
      margin: var(--space-4) 0;
    }
    .review-grid div {
      display: grid;
      gap: 4px;
      padding: var(--space-3);
      background: var(--bg-sunken);
      border-radius: var(--radius-md);
    }
    .review-grid dt {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .review-grid dd {
      margin: 0;
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .actions {
      display: grid;
      gap: 6px;
      list-style: none;
      padding: 0;
      max-height: 240px;
      overflow: auto;
    }
    .actions li {
      display: flex;
      gap: var(--space-2);
      padding: 7px 0;
      border-bottom: 1px solid var(--border);
      overflow-wrap: anywhere;
    }
    .actions code {
      color: var(--accent-ink);
      flex: none;
    }
    .running,
    .loading {
      display: grid;
      gap: var(--space-3);
    }
    .running {
      place-items: center;
      min-height: 100px;
    }
    .receipt p {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .empty {
      color: var(--fg-muted);
      padding: var(--space-5) 0;
    }
    .checks {
      list-style: none;
      padding: 0;
      margin: var(--space-2) 0 var(--space-3);
      display: grid;
      gap: 6px;
    }
    .checks li {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .selection-note {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
      padding: var(--space-3);
      border: 1px solid var(--warn);
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      margin: var(--space-3) 0;
    }
    .selection-note p {
      margin: 0 0 4px;
    }
    .evidence {
      margin: var(--space-3) 0;
    }
    .evidence summary {
      cursor: pointer;
      font-weight: 650;
      color: var(--fg-muted);
    }
    .evidence pre {
      overflow: auto;
      font-size: var(--font-xs);
      background: var(--bg-sunken);
      padding: var(--space-2);
      border-radius: var(--radius-md);
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      overflow-wrap: anywhere;
    }
    .receipt__verify {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .receipt h3 {
      margin: var(--space-4) 0 var(--space-2);
      font-size: var(--font-sm);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .plan h3 {
      margin: var(--space-4) 0 var(--space-2);
      font-size: var(--font-sm);
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .refusal {
      color: var(--error);
    }
    @media (max-width: 820px) {
      .layout {
        grid-template-columns: 1fr;
      }
    }
    @media (max-width: 520px) {
      .choices,
      .component-grid {
        grid-template-columns: 1fr;
      }
      .card__heading {
        display: block;
      }
      .eyebrow {
        display: inline-block;
        margin-top: var(--space-3);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      /* data-motion='full' is the user's explicit opt-out (tokens.css) */
      :host-context(html:not([data-motion='full'])) .choice,
      :host-context(html:not([data-motion='full'])) .component {
        transition: none;
      }
    }
  `,
})
export class FederationPage {
  private readonly api = inject(PortalApi);
  private readonly i18n = inject(I18nService);
  readonly store = inject(PortalStore);
  readonly snapshot = signal<FederationSnapshot | null>(null);
  readonly planResult = signal<FederationPlanResponse | null>(null);
  readonly result = signal<InstallationReceipt | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly phase = signal<Phase>('loading');
  readonly busy = signal(true);
  readonly scope = signal<Scope>('project');
  readonly host = signal<HostChoice>('all');
  readonly profile = signal<InstallProfile>('recommended');
  readonly gatewayProfile = signal<GatewayProfile>('balanced');
  readonly selected = signal<Set<ComponentId>>(
    new Set(['skills', 'agents', 'mcp', 'tui', 'graph-studio']),
  );
  /** Explicit specialist selection — populated from the real registry
   *  snapshot. An emptied set is sent as `forge: []` so the engine
   *  answers with the named `empty_manual_selection` blocked state;
   *  it is never silently widened to "every registered forge". */
  readonly forgeSelected = signal<Set<string>>(new Set());

  readonly scopes = [
    { id: 'project' as const, label: 'install.scope.project', hint: 'install.scope.project.hint' },
    {
      id: 'workspace' as const,
      label: 'install.scope.workspace',
      hint: 'install.scope.workspace.hint',
    },
    { id: 'user' as const, label: 'install.scope.user', hint: 'install.scope.user.hint' },
  ];
  readonly hosts: { id: HostChoice; label: string; hint: string }[] = [
    { id: 'all', label: 'federation.host.all', hint: 'federation.host.allHint' },
    { id: 'none', label: 'federation.host.none', hint: 'federation.host.noneHint' },
    { id: 'claude', label: 'federation.host.claude', hint: 'federation.host.detected' },
    { id: 'devin', label: 'federation.host.devin', hint: 'federation.host.detected' },
    { id: 'codex', label: 'federation.host.codex', hint: 'federation.host.detected' },
    { id: 'copilot', label: 'federation.host.copilot', hint: 'federation.host.detected' },
  ];
  readonly profiles = [
    {
      id: 'minimal' as const,
      label: 'federation.profile.minimal',
      hint: 'federation.profile.minimalHint',
    },
    {
      id: 'recommended' as const,
      label: 'federation.profile.recommended',
      hint: 'federation.profile.recommendedHint',
    },
    { id: 'full' as const, label: 'federation.profile.full', hint: 'federation.profile.fullHint' },
  ];
  readonly gatewayProfiles: { id: GatewayProfile; label: string; hint: string }[] = [
    {
      id: 'economy',
      label: 'federation.execution.economy',
      hint: 'federation.execution.economyHint',
    },
    {
      id: 'balanced',
      label: 'federation.execution.balanced',
      hint: 'federation.execution.balancedHint',
    },
    { id: 'deep', label: 'federation.execution.deep', hint: 'federation.execution.deepHint' },
  ];
  readonly componentOptions: { id: ComponentId; label: string; hint: string }[] = [
    { id: 'skills', label: 'federation.component.skills', hint: 'federation.component.skillsHint' },
    { id: 'agents', label: 'federation.component.agents', hint: 'federation.component.agentsHint' },
    { id: 'mcp', label: 'federation.component.mcp', hint: 'federation.component.mcpHint' },
    { id: 'tui', label: 'federation.component.tui', hint: 'federation.component.tuiHint' },
    {
      id: 'graph-studio',
      label: 'federation.component.graph',
      hint: 'federation.component.graphHint',
    },
  ];

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.phase.set('loading');
    this.busy.set(true);
    this.error.set(null);
    try {
      const snap = await firstValueFrom(this.api.federation());
      this.snapshot.set(snap);
      // Default = every registered forge checked — the same delegation
      // scope `install_auto` runs with no filter, but explicit so the
      // reviewed set is what the plan token signs.
      if (!this.forgeSelected().size) {
        this.forgeSelected.set(new Set(snap.installed_forges ?? []));
      }
      this.phase.set('idle');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  toggle(id: ComponentId): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selected.set(next);
  }

  toggleForge(id: string): void {
    const next = new Set(this.forgeSelected());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.forgeSelected.set(next);
  }

  /** What the signed plan echoes for the forge filter — a list is the
   *  reviewed selection; null/absent means "no filter" (all registered). */
  forgeEcho(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value))
      return value.length ? (value as unknown[]).join(', ') : this.i18n.t('federation.forge.none');
    return String(value);
  }

  /** §4.4 selection states — `all_already_active` is a benign outcome;
   *  every other named state accompanies a blocked/failed receipt. */
  selectionKind(state: string | undefined): 'ok' | 'warn' | 'info' | 'muted' {
    if (state === 'all_already_active') return 'info';
    return state ? 'warn' : 'muted';
  }

  /** forge/HostOnboarding/v1 — honest tones: only `integration_written`,
   *  `mcp_verified` and `validated` are green; `configurable` stays
   *  muted (presence is not readiness). */
  onboardKind(state: string | undefined): 'ok' | 'warn' | 'info' | 'muted' {
    switch (state) {
      case 'integration_written':
      case 'mcp_verified':
        return 'ok';
      case 'restart_needed':
        return 'warn';
      case 'installed':
      case 'in_path':
        return 'info';
      default:
        return 'muted';
    }
  }

  /** Only a plan the engine marked executable may be applied — a
   *  blocked/failed/refused plan has nothing to approve. */
  planExecutable(planned: FederationPlanResponse): boolean {
    const s = (planned.status ?? '').toLowerCase();
    return !['failed', 'blocked', 'refused', 'error'].includes(s);
  }

  planJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
  }

  async plan(): Promise<void> {
    this.phase.set('planning');
    this.busy.set(true);
    this.error.set(null);
    try {
      const input: FederationSelection = {
        scope: this.scope(),
        host: this.host(),
        profile: this.profile(),
        gateway_profile: this.gatewayProfile(),
        components: Object.fromEntries([...this.selected()].map((id) => [id, true])),
        // Explicit reviewed list — `[]` is the operator's explicit empty
        // selection; the engine names it `empty_manual_selection`.
        forge: [...this.forgeSelected()].sort(),
      };
      this.planResult.set(await firstValueFrom(this.api.federationPlan(input)));
      this.phase.set('review');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  async apply(planned: FederationPlanResponse): Promise<void> {
    // Defense in depth — a blocked/failed plan is never executable, even
    // if this method is reached without the (disabled) button's gate.
    if (!this.planExecutable(planned)) return;
    this.phase.set('running');
    this.busy.set(true);
    this.error.set(null);
    try {
      this.result.set(
        await firstValueFrom(this.api.federationInstallAuto(planned.plan, planned.plan_token)),
      );
      await Promise.all([this.load(), this.store.refreshHealth()]);
      this.phase.set('done');
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy.set(false);
    }
  }

  reset(): void {
    this.phase.set('idle');
    this.planResult.set(null);
    this.result.set(null);
    this.error.set(null);
  }

  private fail(e: unknown): void {
    this.error.set(e instanceof ApiError ? e : new ApiError(0));
    this.phase.set('error');
  }
}
