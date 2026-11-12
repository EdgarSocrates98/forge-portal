import { TPipe } from '../../core/i18n/i18n.pipe';
import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  ViewChild,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BridgeEvent,
  BridgeFileEntry,
  BridgeFilePreview,
  BridgeProvider,
  BridgeSession,
  PfBridge,
} from '../pf-bridge.service';
import { PfApi } from '../pf-api.service';
import {
  PfManagedBridge,
  PfProduct,
  PfWorkspaceDiscovery,
  PfWorkspaceDocument,
} from '../pf.models';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { ArtifactViewer } from '../../shared/artifact-viewer';
import { ConfirmService } from '../../shared/confirm-dialog';
import { MdLitePipe } from '../../shared/md-lite.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ToastService } from '../../shared/toast';
import { UiSkeleton } from '../../shared/skeleton';

interface ChatItem {
  kind:
    'user' | 'assistant' | 'tool' | 'approval' | 'system' | 'usage' | 'plan' | 'artifact' | 'error';
  text: string;
  meta?: string;
  approvalId?: string;
  resolved?: boolean;
  seq?: number;
}

const TEMPLATES = [
  'Summarize the product context and list open risks.',
  'Investigate the data source and propose 3 analysis questions.',
  'Draft acceptance criteria for the top initiative.',
  'Review the decision journal for unresolved items.',
];

/** pf-* skill catalog exposed in the slash palette — id + one-line
 *  trigger. Selecting a skill seeds a visible `[skill:id]` prefix the
 *  host agent can read; nothing is hidden from the user. */
const SKILLS: { id: string; hint: string }[] = [
  { id: 'pf-product-strategy', hint: 'vision, context package, decisions' },
  { id: 'pf-analytics', hint: 'explore sources, schemas, metrics' },
  { id: 'pf-sql', hint: 'author and run safe read-only SQL' },
  { id: 'pf-dashboards', hint: 'KPI cards and charts from real runs' },
  { id: 'pf-knowledge', hint: 'import docs, FTS search with citations' },
  { id: 'pf-requirements', hint: 'PRDs and user stories from knowledge' },
  { id: 'pf-prioritization', hint: 'RICE/WSJF deterministic scoring' },
  { id: 'pf-product-discovery', hint: 'opportunities and hypotheses' },
  { id: 'pf-reporting', hint: 'executive and periodic reports' },
  { id: 'pf-apis', hint: 'OpenAPI import, diff, breaking changes' },
  { id: 'pf-data-products', hint: 'contracts, validation, lineage' },
  { id: 'pf-agent-factory', hint: 'create, eval and publish agents' },
  { id: 'pf-aws', hint: 'Athena, Glue, QuickSight states' },
  { id: 'pf-azure', hint: 'Fabric, Power BI, KQL workspaces' },
  { id: 'pf-finops', hint: 'run budgets, cloud cost honesty' },
  { id: 'pf-governance', hint: 'approvals, audit trail, policy gates' },
];

const EFFORTS = ['low', 'medium', 'high'] as const;
type Effort = (typeof EFFORTS)[number];

interface ChatAttachment {
  label: string;
  payload: Record<string, unknown>;
}

/** Chat Studio (Cycle 20) — multi-agent sessions over the local Forge
 *  Agent Bridge: pairing gate, session sidebar w/ metadata, event-driven
 *  timeline, approvals, plan/artifact/usage surfaces, 3 experience modes. */
@Component({
  selector: 'pf-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [
    ArtifactViewer,
    EmptyState,
    ErrorState,
    MdLitePipe,
    PageHeader,
    StateBadge,
    UiSkeleton,
    TPipe,
    DecimalPipe,
  ],
  template: `
    <div class="studio" [attr.data-mode]="mode()">
      <ui-page-header
        title="Chat Studio"
        subtitle="Multi-agent sessions over the paired local Forge Agent Bridge."
      >
        <div class="modes" role="tablist" aria-label="Experience mode">
          @for (m of modes; track m) {
            <button
              class="mode"
              [attr.data-active]="mode() === m || null"
              role="tab"
              [attr.aria-selected]="mode() === m"
              (click)="mode.set(m)"
            >
              {{ m }}
            </button>
          }
        </div>
      </ui-page-header>

      @if (!paired()) {
        <section class="pair card">
          <h2>{{ 'pf.chat.connecting' | t }}</h2>
          <p class="muted">
            {{ 'pf.chat.autoConnectDescription' | t }}
          </p>
          <button class="btn btn--primary" type="button" (click)="autoPair()">
            {{ 'pf.chat.tryAgain' | t }}
          </button>
          @if (pairError(); as pe) {
            <p class="err" role="alert">{{ pe }}</p>
          }
        </section>
      } @else {
        @if (managed(); as mb) {
          @if (mb.state && mb.state !== 'running') {
            <section class="card side__head" role="status" aria-live="polite">
              <ui-state-badge [state]="mb.state" />
              <span class="muted small">{{
                'pf.chat.bridgeManaged' | t: { state: mb.state, restarts: mb.restarts ?? 0 }
              }}</span>
              <button class="btn btn--mini" type="button" (click)="bootstrap()">
                {{ 'pf.chat.retry' | t }}
              </button>
            </section>
          }
        }
        <div class="layout">
          <aside class="side card" aria-label="Sessions">
            <div class="side__head">
              <h3>{{ 'pf.chat.sessions' | t }}</h3>
              <button
                class="btn btn--mini"
                [disabled]="busy()"
                [title]="'pf.chat.cleanupHint' | t"
                (click)="cleanupSessions()"
              >
                {{ 'pf.chat.cleanup' | t }}
              </button>
              <button class="btn btn--mini" (click)="reloadSessions()">↻</button>
            </div>
            <input
              class="input"
              [value]="q()"
              (input)="q.set($any($event.target).value)"
              placeholder="Search…"
              aria-label="Search sessions"
            />
            <div class="side__list">
              @for (s of filteredSessions(); track s.id) {
                <button
                  class="sess"
                  [attr.data-sel]="session()?.id === s.id || null"
                  (click)="selectSession(s)"
                >
                  <span class="sess__t">
                    {{ s.meta?.title || s.id }}
                    @if (s.meta?.favorite) {
                      <span aria-label="favorite">★</span>
                    }
                  </span>
                  <span class="muted small"
                    >{{ s.provider }} · {{ s.model || 'default' }} · {{ s.state
                    }}{{ s.product_name ? ' · ' + s.product_name : '' }}</span
                  >
                </button>
              }
              @if (!filteredSessions().length) {
                <ui-empty icon="agents" title="No sessions yet" />
              }
            </div>
            <details class="new" [open]="!sessions().length">
              <summary>{{ 'pf.chat.newSession' | t }}</summary>
              <label class="lbl"
                >Host de IA
                <select
                  class="input"
                  [value]="provider()"
                  (change)="onProviderChange($any($event.target).value)"
                  aria-describedby="host-help"
                >
                  @for (p of providers(); track p.id) {
                    <option [value]="p.id" [disabled]="!p.executable && p.id !== 'fake'">
                      {{ p.name }} · {{ p.auth_state
                      }}{{ p.executable || p.id === 'fake' ? '' : ' · indisponível' }}
                    </option>
                  }
                </select>
                <span id="host-help" class="field-help">{{ 'pf.chat.hostHelp' | t }}</span>
              </label>
              <label class="lbl"
                >Modelo
                <select
                  class="input"
                  [value]="model()"
                  (change)="model.set($any($event.target).value)"
                  aria-describedby="model-help"
                >
                  <option value="default">{{ 'pf.chat.modelAutomatic' | t }}</option>
                  @for (m of modelOptions(); track m.id) {
                    @if (m.id !== 'default') {
                      <option [value]="m.id">
                        {{ m.label }}{{ m.verified ? '' : ' · não verificado' }}
                      </option>
                    }
                  }
                  <option value="__custom">{{ 'pf.chat.modelCustom' | t }}</option>
                </select>
                <input
                  class="input"
                  [value]="customModel()"
                  (input)="customModel.set($any($event.target).value)"
                  [hidden]="model() !== '__custom'"
                  placeholder="ID do modelo publicado pelo host"
                  [attr.aria-label]="'pf.chat.modelCustom' | t"
                />
                <span id="model-help" class="field-help">
                  {{
                    (modelOptions().length ? 'pf.chat.modelCatalog' : 'pf.chat.modelFallback') | t
                  }}
                </span>
              </label>
              <label class="lbl"
                >Product
                <select
                  class="input"
                  [value]="productId()"
                  (change)="productId.set($any($event.target).value)"
                >
                  <option value="">{{ 'pf.chat.none' | t }}</option>
                  @for (p of products(); track p.id) {
                    <option [value]="p.id">{{ p.name }}</option>
                  }
                </select>
              </label>
              <button class="btn btn--primary" [disabled]="busy()" (click)="startSession()">
                Start session
              </button>
            </details>
          </aside>

          <section class="main card">
            @if (session(); as s) {
              <div class="sessbar">
                <ui-state-badge [state]="s.state" />
                <strong>{{ s.meta?.title || s.id }}</strong>
                <span class="muted small">{{ s.provider }}</span>
                <span class="model-chip" title="Modelo usado na sessão">{{
                  s.model || 'default'
                }}</span>
                <span class="spacer"></span>
                @if (s.resumable && s.provider_session_ref) {
                  <button class="btn btn--mini" (click)="resumeCopy(s)">
                    {{ 'pf.chat.ref' | t }}
                  </button>
                }
                <button class="btn btn--mini" (click)="toggleFav()">
                  {{ s.meta?.favorite ? '★' : '☆' }}
                </button>
                <button class="btn btn--mini" (click)="rename()">{{ 'pf.chat.rename' | t }}</button>
                <button class="btn btn--mini" (click)="cancel()">{{ 'pf.chat.cancel' | t }}</button>
                <button class="btn btn--mini danger" (click)="archive()">
                  {{ 'pf.chat.archive' | t }}
                </button>
              </div>
            }
            @if (loading()) {
              <ui-skeleton kind="text" [lines]="4" />
            }
            <div class="timeline" #tl aria-live="polite">
              @for (it of filteredItems(); track $index) {
                @switch (it.kind) {
                  @case ('approval') {
                    <div class="msg approval">
                      <span class="msg__k">{{ 'pf.chat.approvalRequested' | t }}</span>
                      <p>{{ it.text }}</p>
                      @if (!it.resolved) {
                        <div class="acts">
                          <button class="btn btn--mini" (click)="approve(it, true)">
                            {{ 'pf.chat.approve' | t }}
                          </button>
                          <button class="btn btn--mini danger" (click)="approve(it, false)">
                            Deny
                          </button>
                        </div>
                      } @else {
                        <span class="muted small">{{ 'pf.chat.resolved' | t }}</span>
                      }
                    </div>
                  }
                  @case ('plan') {
                    <div class="msg plan">
                      <span class="msg__k">{{ 'pf.chat.planUpdate' | t }}</span>
                      <div [innerHTML]="it.text | mdLite"></div>
                    </div>
                  }
                  @default {
                    <div class="msg" [attr.data-k]="it.kind">
                      <span class="msg__k">
                        {{ it.kind }}
                        @if (mode() === 'advanced' && it.seq) {
                          <code>#{{ it.seq }}</code>
                        }
                      </span>
                      <div class="msg__b" [innerHTML]="it.text | mdLite"></div>
                      <div class="msg__f">
                        @if (it.meta) {
                          <span class="muted small">{{ it.meta }}</span>
                        }
                        @if (it.kind === 'assistant') {
                          <button class="copy" (click)="copy(it.text)">
                            {{ 'pf.chat.copy' | t }}
                          </button>
                          @if (session()?.product_id) {
                            <button class="copy" (click)="saveToKnowledge(it.text)">
                              +knowledge
                            </button>
                          }
                        }
                      </div>
                    </div>
                  }
                }
              }
              @if (busy()) {
                <div class="msg msg--ghost" data-k="assistant">
                  <span class="msg__k">assistant</span>
                  <span class="dots" aria-label="agent is working"><i></i><i></i><i></i></span>
                </div>
              }
              @if (!items().length) {
                <ui-empty icon="agents" title="Send your first prompt" />
              }
            </div>
            @if (mode() === 'advanced' && lastEvents().length) {
              <details class="raw">
                <summary>raw events ({{ lastEvents().length }})</summary>
                <pre>{{ rawJson() }}</pre>
              </details>
            }
            <div class="tpls">
              @for (t of TEMPLATES; track t) {
                <button class="tpl" (click)="draft.set(t)">{{ t }}</button>
              }
            </div>
            @if (slashItems().length) {
              <div class="slash" role="listbox" aria-label="Skills">
                @for (s of slashItems(); track s.id) {
                  <button
                    class="slash__i"
                    role="option"
                    [attr.aria-selected]="false"
                    (click)="applySkill(s.id)"
                  >
                    <code>/{{ s.id }}</code>
                    <span class="muted small">{{ s.hint }}</span>
                  </button>
                }
              </div>
            }
            @if (attachments().length) {
              <div class="chips" aria-label="Attachments">
                @for (a of attachments(); track a.label) {
                  <span class="chip"
                    >📎 {{ a.label }}
                    <button
                      class="chip__x"
                      type="button"
                      aria-label="remove attachment"
                      (click)="dropAttachment(a.label)"
                    >
                      ×
                    </button></span
                  >
                }
              </div>
            }
            <form class="composer" (submit)="send($event)">
              <div class="composer__box" [attr.data-busy]="busy() || null">
                <textarea
                  class="composer__ta"
                  rows="2"
                  [value]="draft()"
                  (input)="onDraft($any($event.target).value)"
                  (keydown.enter)="enterSend($event)"
                  (keydown.escape)="slash.set(null)"
                  placeholder="Ask the agent…  / for skills · @ not needed, attach below"
                  [disabled]="!session()"
                  aria-label="Prompt"
                ></textarea>
                <div class="composer__bar">
                  <label
                    class="tbtn"
                    title="Attach an image (provider may refuse — surfaced honestly)"
                    >🖼<input type="file" accept="image/*" hidden (change)="attachImage($event)"
                  /></label>
                  <button
                    class="tbtn"
                    type="button"
                    title="Attach workspace file"
                    (click)="pickWorkspaceFile()"
                  >
                    📄
                  </button>
                  <select
                    class="tbtn effort"
                    [value]="effort()"
                    (change)="effort.set($any($event.target).value)"
                    title="Effort preference — sent to the provider; applied when supported"
                    aria-label="Effort"
                  >
                    @for (e of EFFORTS; track e) {
                      <option [value]="e">⚡{{ e }}</option>
                    }
                  </select>
                  <span class="tok mono" title="Session tokens · last turn delta">
                    @if (usage(); as u) {
                      {{ u.in + u.out | number }} tok
                      @if (lastTurn(); as lt) {
                        <em> (+{{ lt }})</em>
                      }
                    } @else {
                      — tok
                    }
                  </span>
                  <span class="spacer"></span>
                  @if (lastError()) {
                    <button class="btn btn--mini" type="button" (click)="retry()">
                      {{ 'pf.chat.retry' | t }}
                    </button>
                  }
                  <button
                    class="btn btn--primary send"
                    type="submit"
                    [disabled]="busy() || !session() || !draft().trim()"
                  >
                    {{ busy() ? 'Running…' : 'Send ⏎' }}
                  </button>
                </div>
              </div>
            </form>
          </section>

          <aside class="ctx card" aria-label="Context">
            <h3>{{ 'pf.chat.context' | t }}</h3>
            @if (usage(); as u) {
              <div class="ctx__blk">
                <h4>{{ 'pf.chat.usage' | t }}</h4>
                <p class="mono small">in {{ u.in }} · out {{ u.out }}</p>
              </div>
            }
            @if (plan(); as pl) {
              <div class="ctx__blk">
                <h4>{{ 'pf.chat.plan' | t }}</h4>
                <div class="small" [innerHTML]="pl | mdLite"></div>
              </div>
            }
            @if (artifacts().length) {
              <div class="ctx__blk">
                <h4>{{ 'pf.chat.artifacts' | t }}</h4>
                @for (a of artifacts(); track a) {
                  <button class="flink mono small" (click)="openFile(a)">{{ a }}</button>
                }
              </div>
            }
            <div class="ctx__blk">
              <h4>
                Workspace files <button class="btn btn--mini" (click)="loadFiles()">↻</button>
              </h4>
              @for (f of files(); track f.name) {
                <button class="flink mono small" (click)="openEntry(f)">
                  {{ f.dir ? '📁' : '📄' }} {{ f.name }}
                </button>
              }
              @if (!files().length) {
                <button class="btn btn--mini" (click)="loadFiles()">
                  {{ 'pf.chat.browseWorkspace' | t }}
                </button>
              }
            </div>
            <div class="ctx__blk discovery" [attr.aria-label]="'pf.chat.workspaceDiscovery' | t">
              <div class="discovery__head">
                <h4>{{ 'pf.chat.workspaceContext' | t }}</h4>
                <button
                  class="btn btn--mini"
                  type="button"
                  [disabled]="discoveryLoading()"
                  (click)="discoverWorkspace()"
                  [attr.title]="'pf.chat.discoverContextTitle' | t"
                >
                  {{ discoveryLoading() ? '…' : ('pf.chat.discover' | t) }}
                </button>
              </div>
              @if (workspaceDiscovery(); as d) {
                <p class="muted small">
                  {{ d.workspace.name }} · {{ d.repositories.length }} repos ·
                  {{ d.documents.length }} context files
                </p>
                <div
                  class="discovery__repos"
                  role="list"
                  [attr.aria-label]="'pf.chat.discoveredRepositories' | t"
                >
                  @for (r of d.repositories; track r.id) {
                    <span class="discovery__repo" role="listitem" [title]="r.path">
                      {{ r.name }}
                    </span>
                  }
                </div>
                @for (doc of d.documents; track doc.id) {
                  <div class="discovery__doc">
                    <button
                      class="flink discovery__open"
                      type="button"
                      (click)="previewWorkspaceDocument(doc)"
                      [title]="doc.path"
                    >
                      <span class="kind" [attr.data-kind]="doc.kind">{{ doc.kind }}</span>
                      <span>{{ doc.title }}</span>
                      <small class="muted mono">{{ doc.repository }}/{{ doc.relative_path }}</small>
                    </button>
                    @if (session()?.product_id; as pid) {
                      <button
                        class="btn btn--mini"
                        type="button"
                        [disabled]="importingPath() === doc.path"
                        (click)="importWorkspaceDocument(doc, pid)"
                      >
                        {{ importingPath() === doc.path ? '…' : ('pf.chat.addContext' | t) }}
                      </button>
                    }
                  </div>
                }
                @if (!d.documents.length) {
                  <p class="muted small">{{ 'pf.chat.noContextFiles' | t }}</p>
                }
              } @else {
                <p class="muted small">
                  {{ 'pf.chat.discoveryHint' | t }}
                </p>
              }
            </div>
            @if (ctxEntities().length) {
              <div class="ctx__blk">
                <h4>{{ 'pf.chat.insertProductContext' | t }}</h4>
                @for (e of ctxEntities(); track e) {
                  <button class="flink small" (click)="insertRef(e)">{{ e }}</button>
                }
              </div>
            }
            @if (session()?.product_id; as pid) {
              <div class="ctx__blk">
                <h4>{{ 'pf.chat.product' | t }}</h4>
                <p class="small mono">{{ pid }}</p>
                <button
                  class="btn btn--mini"
                  [disabled]="!latestAssistant()"
                  (click)="proposeLatestTask(pid)"
                >
                  {{ 'pf.chat.proposeTask' | t }}
                </button>
                @if (proposalState(); as state) {
                  <p class="small muted">{{ state }}</p>
                }
              </div>
            }
            @if (!usage() && !plan() && !artifacts().length && !session()?.product_id) {
              <ui-empty icon="dashboard" title="Context appears as events arrive" />
            }
          </aside>
        </div>
      }
      @if (error(); as e) {
        <ui-error [error]="e" (retry)="bootstrap()" />
      }
      @if (preview(); as pv) {
        <div
          class="ovl"
          role="dialog"
          aria-modal="true"
          aria-label="File preview"
          (keydown.escape)="preview.set(null)"
        >
          <div class="ovl__c">
            <div class="ovl__h">
              <strong class="mono">{{ pv.path }}</strong>
              <span class="muted small">{{ pv.kind }} · {{ pv.size }}B</span>
              <span class="spacer"></span>
              <button class="btn btn--mini" (click)="preview.set(null)">
                {{ 'pf.chat.close' | t }}
              </button>
            </div>
            <ui-artifact
              [kind]="pv.kind === 'text' ? extKind(pv.path) : pv.kind"
              [text]="pv.preview ?? ''"
              [name]="pv.path"
              [truncated]="pv.truncated ?? false"
            />
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .studio {
      display: grid;
      gap: var(--space-4);
    }
    .modes {
      display: flex;
      gap: var(--space-1);
    }
    .mode {
      border: 1px solid var(--border);
      background: none;
      border-radius: 999px;
      padding: 2px var(--space-3);
      font: inherit;
      font-size: var(--font-sm);
      cursor: pointer;
      color: var(--fg-muted);
    }
    .mode[data-active] {
      background: var(--accent, var(--fg));
      color: var(--bg);
    }
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-4);
      background: var(--bg-card, var(--bg-hover));
    }
    .layout {
      display: grid;
      grid-template-columns: 16rem 1fr 14rem;
      gap: var(--space-4);
      align-items: start;
    }
    .side,
    .ctx {
      display: grid;
      gap: var(--space-2);
      align-content: start;
      max-height: 40rem;
      overflow-y: auto;
    }
    .side h3,
    .ctx h3,
    .ctx h4 {
      margin: 0;
      font-size: var(--font-md);
    }
    .side__head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .side__list {
      display: grid;
      gap: var(--space-1);
    }
    .sess {
      display: grid;
      text-align: left;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
      background: none;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .sess:hover {
      background: var(--bg-hover);
    }
    .sess[data-sel] {
      border-color: var(--accent, var(--fg));
    }
    .sess__t {
      font-weight: 600;
      font-size: var(--font-sm);
    }
    .new {
      border-top: 1px solid var(--border);
      padding-top: var(--space-2);
    }
    .new summary {
      cursor: pointer;
      font-size: var(--font-sm);
    }
    .lbl {
      display: grid;
      gap: 2px;
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin: var(--space-2) 0;
    }
    .field-help {
      color: var(--fg-muted);
      font-size: 0.72rem;
      line-height: 1.35;
    }
    .main {
      display: grid;
      gap: var(--space-3);
      min-height: 28rem;
    }
    .sessbar {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      border-bottom: 1px solid var(--border);
      padding-bottom: var(--space-2);
    }
    .model-chip {
      border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--accent-ink, var(--fg));
      font: 0.72rem var(--font-mono);
    }
    .spacer {
      flex: 1;
    }
    .timeline {
      display: grid;
      gap: var(--space-2);
      max-height: 30rem;
      overflow-y: auto;
      padding-right: var(--space-1);
    }
    .msg {
      border-radius: var(--radius-md);
      padding: var(--space-2) var(--space-3);
      max-width: 88%;
      animation: msg-in 0.22s ease-out;
    }
    @keyframes msg-in {
      from {
        opacity: 0;
        transform: translateY(6px);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    .msg--ghost {
      opacity: 0.75;
      border: 1px dashed var(--border);
      background: var(--bg-hover);
    }
    .dots {
      display: inline-flex;
      gap: 4px;
      padding: var(--space-1) 0;
    }
    .dots i {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--fg-muted);
      animation: dot-b 1.2s infinite;
    }
    .dots i:nth-child(2) {
      animation-delay: 0.18s;
    }
    .dots i:nth-child(3) {
      animation-delay: 0.36s;
    }
    @keyframes dot-b {
      0%,
      60%,
      100% {
        transform: none;
        opacity: 0.4;
      }
      30% {
        transform: translateY(-4px);
        opacity: 1;
      }
    }
    .slash {
      display: grid;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-card, var(--bg-hover));
      max-height: 14rem;
      overflow-y: auto;
      box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.25);
    }
    .slash__i {
      display: flex;
      gap: var(--space-3);
      align-items: baseline;
      padding: var(--space-2) var(--space-3);
      border: 0;
      background: none;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
    }
    .slash__i:hover {
      background: var(--bg-hover);
    }
    .slash__i code {
      color: var(--accent, var(--fg));
      font-size: var(--font-xs);
      white-space: nowrap;
    }
    .chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-1);
    }
    .chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .chip__x {
      border: 0;
      background: none;
      color: inherit;
      cursor: pointer;
      font-size: var(--font-sm);
      padding: 0 2px;
    }
    .composer__box {
      display: grid;
      flex: 1;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg);
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .composer__box:focus-within {
      border-color: var(--accent, var(--fg));
    }
    .composer__box[data-busy] {
      border-color: color-mix(in srgb, var(--accent, var(--fg)) 55%, var(--border));
    }
    .composer__ta {
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      padding: var(--space-3);
      resize: vertical;
      min-height: 3.4rem;
    }
    .composer__ta:focus {
      outline: none;
    }
    .composer__bar {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-2);
      border-top: 1px solid var(--border);
      background: var(--bg-hover);
    }
    .tbtn {
      border: 1px solid transparent;
      border-radius: var(--radius-sm, 6px);
      background: none;
      color: var(--fg-muted);
      font: inherit;
      font-size: var(--font-sm);
      padding: 3px var(--space-2);
      cursor: pointer;
    }
    .tbtn:hover {
      border-color: var(--border);
      color: var(--fg);
    }
    .tbtn.effort {
      font-size: var(--font-xs);
    }
    .tok {
      font-size: var(--font-xs);
      color: var(--fg-muted);
      white-space: nowrap;
    }
    .tok em {
      font-style: normal;
      color: var(--accent, var(--fg));
    }
    @media (prefers-reduced-motion: reduce) {
      .msg {
        animation: none;
      }
      .dots i {
        animation: none;
        opacity: 0.6;
      }
    }
    .msg__b {
      font-size: var(--font-sm);
    }
    .msg__b :deep(pre) {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: var(--space-2);
      overflow: auto;
    }
    .msg__k {
      font-size: var(--font-xs);
      text-transform: uppercase;
      color: var(--fg-muted);
      display: block;
      margin-bottom: 2px;
    }
    .msg__f {
      display: flex;
      gap: var(--space-2);
      align-items: center;
    }
    .msg[data-k='user'] {
      background: var(--accent, var(--border));
      justify-self: end;
      margin-left: auto;
    }
    .msg[data-k='assistant'] {
      background: var(--bg-hover);
      border: 1px solid var(--border);
    }
    .msg[data-k='tool'],
    .msg[data-k='plan'],
    .msg.plan {
      background: none;
      border: 1px dashed var(--border);
      font-size: var(--font-xs);
    }
    .msg[data-k='usage'],
    .msg[data-k='system'] {
      background: none;
      font-size: var(--font-xs);
      color: var(--fg-muted);
    }
    .msg[data-k='error'] {
      border: 1px solid var(--error);
      font-size: var(--font-sm);
    }
    .msg.approval {
      border: 1px solid var(--warn, var(--error));
    }
    .msg.approval .acts {
      display: flex;
      gap: var(--space-2);
      margin-top: var(--space-2);
    }
    .composer {
      display: flex;
      gap: var(--space-2);
      align-items: end;
    }
    .send {
      white-space: nowrap;
    }
    .studio[data-mode='simple'] .side,
    .studio[data-mode='simple'] .ctx {
      display: none;
    }
    .studio[data-mode='simple'] .layout {
      grid-template-columns: 1fr;
    }
    .studio[data-mode='visual'] .ctx {
      display: none;
    }
    .studio[data-mode='visual'] .layout {
      grid-template-columns: 16rem 1fr;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr !important;
      }
      .ctx {
        display: none;
      }
    }
    @media (max-width: 640px) {
      .studio {
        gap: var(--space-3);
      }
      .card {
        padding: var(--space-3);
      }
      .sessbar {
        flex-wrap: wrap;
      }
      .sessbar .spacer {
        display: none;
      }
      .sessbar .btn {
        min-height: 2rem;
      }
      .timeline {
        max-height: none;
      }
      .msg {
        max-width: 100%;
      }
      .composer {
        align-items: stretch;
        flex-direction: column;
      }
      .composer__acts {
        display: flex;
        justify-content: flex-end;
      }
    }
  `,
})
export class PfChatPage implements OnInit, OnDestroy {
  private readonly bridge = inject(PfBridge);
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly TEMPLATES = TEMPLATES;
  readonly EFFORTS = EFFORTS;
  readonly effort = signal<Effort>('medium');
  readonly attachments = signal<ChatAttachment[]>([]);
  readonly slash = signal<string | null>(null);
  readonly lastTurn = signal<number | null>(null);
  readonly modes = ['simple', 'visual', 'advanced'] as const;
  readonly mode = signal<'simple' | 'visual' | 'advanced'>('visual');
  readonly paired = signal(false);
  readonly pairError = signal<string | null>(null);
  /** Supervisor view of the managed bridge — null when the portal does not
   *  supervise it (or the health call failed). Never fabricated. */
  readonly managed = signal<PfManagedBridge | null>(null);
  readonly proposalState = signal<string | null>(null);
  readonly providers = signal<BridgeProvider[]>([]);
  // A fake provider is an explicit test double, never an implicit production
  // default.  The first installed provider is selected after discovery.
  readonly provider = signal('');
  readonly model = signal('default');
  readonly customModel = signal('');
  readonly products = signal<PfProduct[]>([]);
  readonly productId = signal('');
  readonly sessions = signal<BridgeSession[]>([]);
  readonly session = signal<BridgeSession | null>(null);
  readonly items = signal<ChatItem[]>([]);
  readonly lastEvents = signal<BridgeEvent[]>([]);
  readonly draft = signal('');
  readonly q = signal('');
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly lastError = signal<string | null>(null);
  readonly rawJson = computed(() => JSON.stringify(this.lastEvents(), null, 2));
  readonly files = signal<BridgeFileEntry[]>([]);
  readonly preview = signal<BridgeFilePreview | null>(null);
  readonly workspaceDiscovery = signal<PfWorkspaceDiscovery | null>(null);
  readonly discoveryLoading = signal(false);
  readonly importingPath = signal<string | null>(null);
  readonly ctxEntities = signal<string[]>([]);
  private readonly seenSeq = new Set<number>();
  private poll: ReturnType<typeof setInterval> | null = null;
  private streamAbort: (() => void) | null = null;
  private streamRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private streamRetries = 0;
  private streamSeq = 0;
  readonly streaming = signal(false);
  readonly selectedProvider = computed(
    () => this.providers().find((p) => p.id === this.provider()) ?? null,
  );
  readonly modelOptions = computed(() => this.selectedProvider()?.models ?? []);
  readonly latestAssistant = computed(
    () => [...this.items()].reverse().find((item) => item.kind === 'assistant')?.text ?? '',
  );
  readonly slashItems = computed(() => {
    const f = this.slash();
    if (f === null) return [];
    const t = f.toLowerCase();
    return SKILLS.filter((s) => !t || s.id.includes(t)).slice(0, 8);
  });
  @ViewChild('tl') private tl?: ElementRef<HTMLElement>;

  readonly filteredSessions = computed(() => {
    const term = this.q().toLowerCase();
    return this.sessions()
      .filter((s) => !s.meta?.archived)
      .filter(
        (s) =>
          !term ||
          s.id.includes(term) ||
          (s.meta?.title ?? '').toLowerCase().includes(term) ||
          s.provider.includes(term),
      )
      .sort((a, b) => Number(b.meta?.favorite ?? false) - Number(a.meta?.favorite ?? false));
  });
  readonly filteredItems = computed(() =>
    this.q() && !this.session() ? this.items() : this.items(),
  );
  readonly usage = computed(() => {
    const evs = this.lastEvents().filter((e) => e.type === 'usage.updated');
    if (!evs.length) return null;
    const p = evs[evs.length - 1].payload;
    return { in: Number(p['tokens_in'] ?? 0), out: Number(p['tokens_out'] ?? 0) };
  });
  readonly plan = computed(() => {
    const evs = this.lastEvents().filter((e) => e.type === 'plan.updated');
    if (!evs.length) return null;
    const entries = (evs[evs.length - 1].payload['entries'] as unknown[]) ?? [];
    return (
      entries.map((e) => `- ${typeof e === 'string' ? e : JSON.stringify(e)}`).join('\n') ||
      'plan updated'
    );
  });
  readonly artifacts = computed(() =>
    this.lastEvents()
      .filter((e) => e.type.startsWith('artifact.'))
      .map((e) => String(e.payload['path'] ?? e.payload['name'] ?? 'artifact')),
  );

  ngOnInit(): void {
    void this.autoPair();
  }

  async autoPair(): Promise<void> {
    try {
      await firstValueFrom(this.bridge.bootstrap());
      this.paired.set(true);
      await this.bootstrap();
    } catch {
      this.pairError.set(
        'Não foi possível conectar ao Bridge local. Verifique se o Product Forge está instalado e tente novamente.',
      );
    }
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
    if (this.streamRetryTimer) clearTimeout(this.streamRetryTimer);
    this.streamAbort?.();
    this.streamAbort = null;
  }

  async bootstrap(): Promise<void> {
    this.error.set(null);
    try {
      this.providers.set(await firstValueFrom(this.bridge.providers()));
      const available =
        this.providers().find((p) => p.installed && p.auth_state !== 'blocked') ??
        this.providers().find((p) => p.id !== 'fake' && p.executable);
      if (!this.provider() || (this.provider() === 'fake' && available)) {
        this.provider.set(available?.id ?? '');
      }
      this.model.set('default');
      this.customModel.set('');
      this.sessions.set(await firstValueFrom(this.api.chatSessions()));
      try {
        const health = await firstValueFrom(this.api.agentHealth());
        this.managed.set(health.managed ?? null);
      } catch {
        this.managed.set(null); // supervisor surface optional — degrade honestly
      }
      try {
        const pl = await firstValueFrom(this.api.products());
        this.products.set(pl.items);
      } catch {
        this.products.set([]); // product context optional — degrade honestly
      }
      void this.discoverWorkspace();
      this.armPoll();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  onProviderChange(id: string): void {
    this.provider.set(id);
    this.model.set('default');
    this.customModel.set('');
  }

  private selectedModel(): string | undefined {
    if (this.model() === '__custom') return this.customModel().trim() || undefined;
    return this.model() || 'default';
  }

  async proposeLatestTask(pid: string): Promise<void> {
    const title = this.latestAssistant().replace(/\s+/g, ' ').trim().slice(0, 120);
    if (!title) return;
    try {
      await firstValueFrom(
        this.api.createTaskProposal(pid, {
          source: 'chat',
          session_id: this.session()?.id,
          tasks: [{ title, description: this.latestAssistant() }],
        }),
      );
      this.proposalState.set('Proposta criada — aguardando aprovação.');
      this.toast.show('Proposta de tarefa criada para revisão', 'success');
    } catch {
      this.proposalState.set('Não foi possível criar a proposta.');
    }
  }

  async reloadSessions(): Promise<void> {
    this.sessions.set(await firstValueFrom(this.api.chatSessions()));
  }

  /** Archive bridge sessions left over from dead portals — the typed op
   *  closes inactive entries and reports the real closed/kept split. */
  async cleanupSessions(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.api.cleanupChatSessions());
      this.sessions.set(await firstValueFrom(this.api.chatSessions()));
      if (this.session() && r.closed.includes(this.session()!.id)) {
        this.session.set(null);
      }
      this.toast.show(`${r.closed.length} session(s) archived`, 'info');
      if (r.errors.length) {
        this.toast.show(`${r.errors.length} session(s) failed to archive`, 'error');
      }
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async startSession(): Promise<void> {
    this.busy.set(true);
    try {
      const s = await firstValueFrom(
        this.api.chatCreate({
          provider: this.provider(),
          product_id: this.productId() || undefined,
          model: this.selectedModel(),
        }),
      );
      this.session.set(s);
      this.items.set([{ kind: 'system', text: `session ${s.id} started (${s.provider})` }]);
      this.seenSeq.clear();
      this.startStream(s.id); // §29.3 SSE primary, poll fallback
      await this.reloadSessions();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async selectSession(s: BridgeSession): Promise<void> {
    this.session.set(s);
    this.items.set([]);
    this.seenSeq.clear();
    if (s.product_id) void this.loadCtxEntities(s.product_id);
    if (s.state === 'closed') {
      this.items.set([{ kind: 'system', text: 'session closed — metadata only' }]);
      return;
    }
    await this.pullEvents(s);
  }

  async toggleFav(): Promise<void> {
    const s = this.session();
    if (!s) return;
    const fav = !s.meta?.favorite;
    await firstValueFrom(this.bridge.patchSession(s.id, { favorite: fav }));
    this.session.set({ ...s, meta: { ...s.meta, favorite: fav } });
    await this.reloadSessions();
  }

  async rename(): Promise<void> {
    const s = this.session();
    if (!s) return;
    const title = globalThis.prompt?.('Session title', s.meta?.title ?? '');
    if (title == null) return;
    await firstValueFrom(this.bridge.patchSession(s.id, { title }));
    this.session.set({ ...s, meta: { ...s.meta, title } });
    await this.reloadSessions();
  }

  async archive(): Promise<void> {
    const s = this.session();
    if (!s) return;
    const ok = await this.confirm.ask({
      title: 'Archive session',
      message: `Archive ${s.meta?.title || s.id}?`,
      danger: true,
    });
    if (!ok) return;
    await firstValueFrom(this.api.chatClose(s.id));
    this.session.set(null);
    this.items.set([]);
    await this.reloadSessions();
  }

  resumeCopy(s: BridgeSession): void {
    void navigator.clipboard?.writeText(s.provider_session_ref ?? s.id);
    this.toast.show('provider session ref copied', 'info');
  }

  async send(ev: Event): Promise<void> {
    ev.preventDefault();
    const s = this.session();
    const text = this.draft().trim();
    if (!s || !text || this.busy()) return;
    this.busy.set(true);
    this.lastError.set(null);
    this.draft.set('');
    this.slash.set(null);
    const atts = this.attachments();
    this.attachments.set([]);
    const beforeIn = Number(this.usage()?.in ?? 0);
    const beforeOut = Number(this.usage()?.out ?? 0);
    this.items.update((l) => [
      ...l,
      {
        kind: 'user',
        text,
        meta: atts.length ? `📎 ${atts.map((a) => a.label).join(', ')}` : undefined,
      },
    ]);
    this.scrollEnd();
    try {
      await firstValueFrom(
        this.api.chatPrompt(s.id, text, s.provider, {
          attachments: atts.map((a) => a.payload),
          effort: this.effort(),
        }),
      );
      await this.pullEvents(s);
      const u = this.usage();
      if (u) this.lastTurn.set(Number(u.in) + Number(u.out) - beforeIn - beforeOut);
    } catch (e) {
      const st = e instanceof ApiError ? String(e.status) : 'transport';
      this.lastError.set(st);
      this.items.update((l) => [
        ...l,
        { kind: 'error', text: `send failed (${st}) — retry available` },
      ]);
    } finally {
      this.busy.set(false);
    }
  }

  onDraft(v: string): void {
    this.draft.set(v);
    const m = /^\/(\S*)$/.exec(v.trimStart());
    this.slash.set(m ? m[1] : null);
  }

  applySkill(id: string): void {
    this.slash.set(null);
    this.draft.set(`[skill:${id}] `);
  }

  dropAttachment(label: string): void {
    this.attachments.update((l) => l.filter((a) => a.label !== label));
  }

  attachImage(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0];
    (ev.target as HTMLInputElement).value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      this.toast.show('image too large (5MB max)', 'error');
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const b64 = String(r.result).split(',')[1] ?? '';
      this.attachments.update((l) => [
        ...l,
        {
          label: file.name,
          payload: {
            type: 'image',
            data: { type: 'base64', media_type: file.type, data: b64 },
          },
        },
      ]);
    };
    r.readAsDataURL(file);
  }

  pickWorkspaceFile(): void {
    const list = this.files().length ? this.files() : null;
    if (!list) {
      void this.loadFiles().then(() => this.pickWorkspaceFile());
      return;
    }
    const name = globalThis.prompt?.(
      `Workspace file to attach:\n${list
        .filter((f) => !f.dir)
        .map((f) => f.name)
        .join('\n')}`,
    );
    if (!name) return;
    this.attachments.update((l) => [...l, { label: name, payload: { path: name } }]);
  }

  private scrollEnd(): void {
    setTimeout(() => {
      const el = this.tl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  async retry(): Promise<void> {
    const s = this.session();
    if (!s) return;
    try {
      await this.pullEvents(s);
      this.lastError.set(null);
    } catch {
      /* stays flagged */
    }
  }

  async cancel(): Promise<void> {
    const s = this.session();
    if (!s) return;
    await firstValueFrom(this.api.chatCancel(s.id));
    this.items.update((l) => [...l, { kind: 'system', text: 'turn cancelled' }]);
  }

  async approve(it: ChatItem, approved: boolean): Promise<void> {
    const s = this.session();
    if (!s || !it.approvalId) return;
    try {
      await firstValueFrom(this.api.chatApprove(s.id, it.approvalId, approved));
      it.resolved = true;
      this.items.update((l) => [
        ...l,
        { kind: 'system', text: `approval ${approved ? 'granted' : 'denied'}` },
      ]);
    } catch {
      this.toast.show('approval not supported by provider', 'error');
    }
  }

  async loadFiles(): Promise<void> {
    try {
      const r = await firstValueFrom(this.bridge.fileList('.'));
      this.files.set(r.items);
    } catch {
      this.toast.show('file listing unavailable', 'error');
    }
  }

  async discoverWorkspace(): Promise<void> {
    this.discoveryLoading.set(true);
    try {
      this.workspaceDiscovery.set(await firstValueFrom(this.api.workspaceDiscovery()));
    } catch {
      this.workspaceDiscovery.set(null);
      this.toast.show('workspace discovery unavailable', 'error');
    } finally {
      this.discoveryLoading.set(false);
    }
  }

  async previewWorkspaceDocument(doc: PfWorkspaceDocument): Promise<void> {
    try {
      const preview = await firstValueFrom(this.api.workspacePreview(doc.path));
      this.preview.set(preview);
    } catch {
      this.toast.show(`cannot preview ${doc.path}`, 'error');
    }
  }

  async importWorkspaceDocument(doc: PfWorkspaceDocument, pid: string): Promise<void> {
    if (this.importingPath()) return;
    this.importingPath.set(doc.path);
    try {
      const result = await firstValueFrom(this.api.importWorkspaceDocument(pid, doc.path));
      this.toast.show(
        result.state === 'already_imported'
          ? 'context already linked to this product'
          : 'context added for review',
        'success',
      );
      await this.loadCtxEntities(pid);
    } catch {
      this.toast.show('context import refused', 'error');
    } finally {
      this.importingPath.set(null);
    }
  }

  async openEntry(f: BridgeFileEntry): Promise<void> {
    if (f.dir) return;
    await this.openFile(f.name);
  }

  async openFile(path: string): Promise<void> {
    try {
      this.preview.set(await firstValueFrom(this.bridge.filePreview(path)));
    } catch {
      this.toast.show(`cannot preview ${path}`, 'error');
    }
  }

  extKind(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    const map: Record<string, string> = {
      md: 'markdown',
      json: 'json',
      yaml: 'yaml',
      yml: 'yaml',
      csv: 'csv',
      sql: 'sql',
      py: 'python',
      diff: 'diff',
      patch: 'diff',
      html: 'html',
    };
    return map[ext] ?? 'text';
  }

  insertRef(e: string): void {
    this.draft.update((d) => `${d}${d && !d.endsWith(' ') ? ' ' : ''}${e} `);
  }

  async saveToKnowledge(text: string): Promise<void> {
    const s = this.session();
    const pid = s?.product_id;
    if (!s || !pid) return;
    const title = globalThis.prompt?.('Knowledge capture title', 'Chat discovery');
    if (title == null) return;
    try {
      await firstValueFrom(
        this.api.importDocument(pid, {
          title,
          content: `<!-- captured-from: chat-session:${s.id} review:required -->\n\n${text}`,
        }),
      );
      this.toast.show('saved to product knowledge (review required)', 'success');
    } catch {
      this.toast.show('knowledge capture failed', 'error');
    }
  }

  private async loadCtxEntities(pid: string): Promise<void> {
    try {
      const [docs, mets] = await Promise.all([
        firstValueFrom(this.api.documents(pid)).catch(() => ({ items: [] })),
        firstValueFrom(this.api.metrics(pid)).catch(() => ({ items: [] })),
      ]);
      this.ctxEntities.set([
        ...docs.items.map((d) => `@doc:${d.title}`),
        ...mets.items.map((m) => `@metric:${m.name}`),
      ]);
    } catch {
      this.ctxEntities.set([]);
    }
  }

  async copy(text: string): Promise<void> {
    await navigator.clipboard?.writeText(text);
    this.toast.show('copied', 'info');
  }

  enterSend(ev: Event): void {
    const ke = ev as KeyboardEvent;
    if (!ke.shiftKey) {
      ke.preventDefault();
      void this.send(ev);
    }
  }

  /** §29.3 — SSE is primary; a bounded stream close re-arms with the seq
   *  cursor (gap-free). Polling remains as fallback while no stream. */
  private startStream(sessionId: string): void {
    this.streamAbort?.();
    const { events, abort } = this.bridge.streamEvents(sessionId, this.streamSeq);
    this.streamAbort = abort;
    this.streaming.set(true);
    events.subscribe({
      next: (e) => {
        this.streamRetries = 0;
        this.streamSeq = Math.max(this.streamSeq, e.seq);
        if (!this.seenSeq.has(e.seq)) {
          this.seenSeq.add(e.seq);
          this.renderEvents([e]);
        }
      },
      error: () => {
        this.streaming.set(false);
        this.streamAbort = null;
        // Bounded backoff retry (cursor-resumed) before the poll fallback
        // takes over — transient drops shouldn't silently degrade to 2.5s
        // polling for the rest of the session.
        const s = this.session();
        if (s && s.state !== 'closed' && this.streamRetries < 3) {
          this.streamRetries += 1;
          this.streamRetryTimer = setTimeout(
            () => {
              this.streamRetryTimer = null;
              if (this.session()?.id === s.id && s.state !== 'closed') {
                this.startStream(s.id);
              }
            },
            1000 * 2 ** this.streamRetries,
          );
        }
      },
      complete: () => {
        this.streaming.set(false);
        this.streamRetries = 0;
        const s = this.session();
        if (s && s.state !== 'closed') this.startStream(s.id); // re-arm cursor
      },
    });
  }

  private armPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = setInterval(() => {
      const s = this.session();
      // poll only while the SSE path is down (fallback, not primary)
      if (s && !this.busy() && s.state !== 'closed' && !this.streaming()) {
        void this.pullEvents(s);
      }
    }, 2500);
  }

  private async pullEvents(s: BridgeSession): Promise<void> {
    const evs = (await firstValueFrom(this.api.chatEvents(s.id, s.provider, this.streamSeq))).items;
    this.lastEvents.set(evs);
    const fresh = evs.filter((e) => !this.seenSeq.has(e.seq));
    fresh.forEach((e) => this.seenSeq.add(e.seq));
    if (fresh.length) this.renderEvents(fresh);
  }

  private renderEvents(evs: BridgeEvent[]): void {
    const out: ChatItem[] = [];
    for (const e of evs) {
      const p = e.payload ?? {};
      switch (e.type) {
        case 'message.delta':
          out.push({ kind: 'assistant', text: String(p['text'] ?? ''), seq: e.seq });
          break;
        case 'message.completed':
          out.push({ kind: 'assistant', text: String(p['text'] ?? ''), seq: e.seq });
          break;
        case 'tool.started':
          out.push({ kind: 'tool', text: `⚙ ${String(p['name'] ?? 'tool')}`, seq: e.seq });
          break;
        case 'tool.completed':
          out.push({
            kind: 'tool',
            text: `✓ ${String(p['name'] ?? 'tool')} ${p['status'] ?? 'done'}`,
            meta: p['detail'] ? String(p['detail']) : undefined,
            seq: e.seq,
          });
          break;
        case 'plan.updated': {
          const entries = (p['entries'] as unknown[]) ?? [];
          out.push({
            kind: 'plan',
            text: entries
              .map((en) => `- ${typeof en === 'string' ? en : JSON.stringify(en)}`)
              .join('\n'),
            seq: e.seq,
          });
          break;
        }
        case 'artifact.created':
        case 'artifact.updated':
          out.push({
            kind: 'artifact',
            text: String(p['path'] ?? p['name'] ?? 'artifact'),
            seq: e.seq,
          });
          break;
        case 'approval.requested':
          out.push({
            kind: 'approval',
            text: String(p['detail'] ?? 'action requires approval'),
            approvalId: String(p['approval_id'] ?? ''),
            seq: e.seq,
          });
          break;
        case 'usage.updated':
          out.push({
            kind: 'usage',
            text: `tokens in ${p['tokens_in'] ?? 0} · out ${p['tokens_out'] ?? 0}`,
            seq: e.seq,
          });
          break;
        case 'runtime.error':
          out.push({
            kind: 'error',
            text: String(p['message'] ?? p['reason'] ?? 'runtime error'),
            seq: e.seq,
          });
          break;
        default:
          if (this.mode() === 'advanced' && e.type !== 'turn.started') {
            out.push({ kind: 'system', text: e.type, seq: e.seq });
          }
      }
    }
    if (out.length) {
      this.items.update((l) => [...l, ...out]);
      this.scrollEnd();
    }
  }
}
