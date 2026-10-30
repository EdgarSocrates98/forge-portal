import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
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
import { PfProduct } from '../pf.models';
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
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system' | 'usage' | 'plan' | 'artifact' | 'error';
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

/** Chat Studio (Cycle 20) — multi-agent sessions over the local Forge
 *  Agent Bridge: pairing gate, session sidebar w/ metadata, event-driven
 *  timeline, approvals, plan/artifact/usage surfaces, 3 experience modes. */
@Component({
  selector: 'pf-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [ArtifactViewer, EmptyState, ErrorState, MdLitePipe, PageHeader, StateBadge, UiSkeleton],
  template: `
    <div class="studio" [attr.data-mode]="mode()">
      <ui-page-header title="Chat Studio"
        subtitle="Multi-agent sessions over the paired local Forge Agent Bridge.">
        <div class="modes" role="tablist" aria-label="Experience mode">
          @for (m of modes; track m) {
            <button class="mode" [attr.data-active]="mode() === m || null"
                    role="tab" [attr.aria-selected]="mode() === m"
                    (click)="mode.set(m)">{{ m }}</button>
          }
        </div>
      </ui-page-header>

      @if (!paired()) {
        <section class="pair card">
          <h2>Pair with your local bridge</h2>
          <p class="muted">
            Run <code>forge-bridge serve</code>, then paste the pairing token from
            <code>~/.forge-bridge/pair.token</code>. Localhost only — never a public URL.
          </p>
          <form class="fg-row" (submit)="pair($event)">
            <input class="input" [value]="pairTok()" (input)="pairTok.set($any($event.target).value)"
                   placeholder="pair token" aria-label="Bridge pairing token" />
            <input class="input url" [value]="pairUrl()" (input)="pairUrl.set($any($event.target).value)"
                   placeholder="http://127.0.0.1:8471" aria-label="Bridge URL" />
            <button class="btn btn--primary" type="submit">Pair</button>
          </form>
          @if (pairError(); as pe) { <p class="err" role="alert">{{ pe }}</p> }
        </section>
      } @else {
        <div class="layout">
          <aside class="side card" aria-label="Sessions">
            <div class="side__head">
              <h3>Sessions</h3>
              <button class="btn btn--mini" (click)="reloadSessions()">↻</button>
            </div>
            <input class="input" [value]="q()" (input)="q.set($any($event.target).value)"
                   placeholder="Search…" aria-label="Search sessions" />
            <div class="side__list">
              @for (s of filteredSessions(); track s.id) {
                <button class="sess" [attr.data-sel]="session()?.id === s.id || null"
                        (click)="selectSession(s)">
                  <span class="sess__t">
                    {{ s.meta?.title || s.id }}
                    @if (s.meta?.favorite) { <span aria-label="favorite">★</span> }
                  </span>
                  <span class="muted small">{{ s.provider }} · {{ s.state }}</span>
                </button>
              }
              @if (!filteredSessions().length) {
                <ui-empty icon="agents" title="No sessions yet" />
              }
            </div>
            <details class="new" [open]="!sessions().length">
              <summary>New session</summary>
              <label class="lbl">Provider
                <select class="input" [value]="provider()"
                        (change)="provider.set($any($event.target).value)">
                  @for (p of providers(); track p.id) {
                    <option [value]="p.id" [disabled]="!p.executable && p.id !== 'fake'">
                      {{ p.name }}{{ p.executable || p.id === 'fake' ? '' : ' (unavailable)' }}
                    </option>
                  }
                </select>
              </label>
              <label class="lbl">Product
                <select class="input" [value]="productId()"
                        (change)="productId.set($any($event.target).value)">
                  <option value="">— none —</option>
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
                <span class="spacer"></span>
                @if (s.resumable && s.provider_session_ref) {
                  <button class="btn btn--mini" (click)="resumeCopy(s)">ref</button>
                }
                <button class="btn btn--mini" (click)="toggleFav()">
                  {{ s.meta?.favorite ? '★' : '☆' }}
                </button>
                <button class="btn btn--mini" (click)="rename()">rename</button>
                <button class="btn btn--mini" (click)="cancel()">cancel</button>
                <button class="btn btn--mini danger" (click)="archive()">archive</button>
              </div>
            }
            @if (loading()) { <ui-skeleton kind="text" [lines]="4" /> }
            <div class="timeline" #tl aria-live="polite">
              @for (it of filteredItems(); track $index) {
                @switch (it.kind) {
                  @case ('approval') {
                    <div class="msg approval">
                      <span class="msg__k">approval requested</span>
                      <p>{{ it.text }}</p>
                      @if (!it.resolved) {
                        <div class="acts">
                          <button class="btn btn--mini" (click)="approve(it, true)">Approve</button>
                          <button class="btn btn--mini danger" (click)="approve(it, false)">Deny</button>
                        </div>
                      } @else {
                        <span class="muted small">resolved</span>
                      }
                    </div>
                  }
                  @case ('plan') {
                    <div class="msg plan">
                      <span class="msg__k">plan update</span>
                      <div [innerHTML]="it.text | mdLite"></div>
                    </div>
                  }
                  @default {
                    <div class="msg" [attr.data-k]="it.kind">
                      <span class="msg__k">
                        {{ it.kind }}
                        @if (mode() === 'advanced' && it.seq) { <code>#{{ it.seq }}</code> }
                      </span>
                      <div class="msg__b" [innerHTML]="it.text | mdLite"></div>
                      <div class="msg__f">
                        @if (it.meta) { <span class="muted small">{{ it.meta }}</span> }
                        @if (it.kind === 'assistant') {
                          <button class="copy" (click)="copy(it.text)">copy</button>
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
            <form class="composer" (submit)="send($event)">
              <textarea class="input" rows="2"
                        [value]="draft()" (input)="draft.set($any($event.target).value)"
                        (keydown.enter)="enterSend($event)"
                        placeholder="Ask the agent… (Enter sends, Shift+Enter new line)"
                        [disabled]="!session()" aria-label="Prompt"></textarea>
              <div class="composer__acts">
                <button class="btn btn--primary" type="submit"
                        [disabled]="busy() || !session() || !draft().trim()">
                  {{ busy() ? 'Running…' : 'Send' }}
                </button>
                @if (lastError()) {
                  <button class="btn btn--mini" type="button" (click)="retry()">retry</button>
                }
              </div>
            </form>
          </section>

          <aside class="ctx card" aria-label="Context">
            <h3>Context</h3>
            @if (usage(); as u) {
              <div class="ctx__blk">
                <h4>Usage</h4>
                <p class="mono small">in {{ u.in }} · out {{ u.out }}</p>
              </div>
            }
            @if (plan(); as pl) {
              <div class="ctx__blk">
                <h4>Plan</h4>
                <div class="small" [innerHTML]="pl | mdLite"></div>
              </div>
            }
            @if (artifacts().length) {
              <div class="ctx__blk">
                <h4>Artifacts</h4>
                @for (a of artifacts(); track a) {
                  <button class="flink mono small" (click)="openFile(a)">{{ a }}</button>
                }
              </div>
            }
            <div class="ctx__blk">
              <h4>Workspace files <button class="btn btn--mini" (click)="loadFiles()">↻</button></h4>
              @for (f of files(); track f.name) {
                <button class="flink mono small" (click)="openEntry(f)">
                  {{ f.dir ? '📁' : '📄' }} {{ f.name }}
                </button>
              }
              @if (!files().length) {
                <button class="btn btn--mini" (click)="loadFiles()">browse workspace</button>
              }
            </div>
            @if (ctxEntities().length) {
              <div class="ctx__blk">
                <h4>Insert product context</h4>
                @for (e of ctxEntities(); track e) {
                  <button class="flink small" (click)="insertRef(e)">{{ e }}</button>
                }
              </div>
            }
            @if (session()?.product_id; as pid) {
              <div class="ctx__blk">
                <h4>Product</h4>
                <p class="small mono">{{ pid }}</p>
              </div>
            }
            @if (!usage() && !plan() && !artifacts().length && !session()?.product_id) {
              <ui-empty icon="dashboard" title="Context appears as events arrive" />
            }
          </aside>
        </div>
      }
      @if (error(); as e) { <ui-error [error]="e" (retry)="bootstrap()" /> }
      @if (preview(); as pv) {
        <div class="ovl" role="dialog" aria-modal="true"
             aria-label="File preview" (keydown.escape)="preview.set(null)">
          <div class="ovl__c">
            <div class="ovl__h">
              <strong class="mono">{{ pv.path }}</strong>
              <span class="muted small">{{ pv.kind }} · {{ pv.size }}B</span>
              <span class="spacer"></span>
              <button class="btn btn--mini" (click)="preview.set(null)">close</button>
            </div>
            <ui-artifact [kind]="pv.kind === 'text' ? extKind(pv.path) : pv.kind"
                         [text]="pv.preview ?? ''" [name]="pv.path"
                         [truncated]="pv.truncated ?? false" />
          </div>
        </div>
      }
    </div>
  `,
  styles: `
    .studio { display: grid; gap: var(--space-4); }
    .modes { display: flex; gap: var(--space-1); }
    .mode { border: 1px solid var(--border); background: none; border-radius: 999px;
      padding: 2px var(--space-3); font: inherit; font-size: var(--font-sm); cursor: pointer;
      color: var(--fg-muted); }
    .mode[data-active] { background: var(--accent, var(--fg)); color: var(--bg); }
    .card { border: 1px solid var(--border); border-radius: var(--radius-md);
      padding: var(--space-4); background: var(--bg-card, var(--bg-hover)); }
    .layout { display: grid; grid-template-columns: 16rem 1fr 14rem;
      gap: var(--space-4); align-items: start; }
    .side, .ctx { display: grid; gap: var(--space-2); align-content: start;
      max-height: 40rem; overflow-y: auto; }
    .side h3, .ctx h3, .ctx h4 { margin: 0; font-size: var(--font-md); }
    .side__head { display: flex; justify-content: space-between; align-items: center; }
    .side__list { display: grid; gap: var(--space-1); }
    .sess { display: grid; text-align: left; border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
      background: none; font: inherit; color: inherit; cursor: pointer; }
    .sess:hover { background: var(--bg-hover); }
    .sess[data-sel] { border-color: var(--accent, var(--fg)); }
    .sess__t { font-weight: 600; font-size: var(--font-sm); }
    .new { border-top: 1px solid var(--border); padding-top: var(--space-2); }
    .new summary { cursor: pointer; font-size: var(--font-sm); }
    .lbl { display: grid; gap: 2px; font-size: var(--font-xs); color: var(--fg-muted);
      margin: var(--space-2) 0; }
    .main { display: grid; gap: var(--space-3); min-height: 28rem; }
    .sessbar { display: flex; align-items: center; gap: var(--space-2);
      border-bottom: 1px solid var(--border); padding-bottom: var(--space-2); }
    .spacer { flex: 1; }
    .timeline { display: grid; gap: var(--space-2); max-height: 30rem;
      overflow-y: auto; padding-right: var(--space-1); }
    .msg { border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
      max-width: 88%; }
    .msg__b { font-size: var(--font-sm); }
    .msg__b :deep(pre) { font-family: var(--font-mono); font-size: var(--font-xs);
      background: var(--bg); border: 1px solid var(--border); border-radius: 6px;
      padding: var(--space-2); overflow: auto; }
    .msg__k { font-size: var(--font-xs); text-transform: uppercase;
      color: var(--fg-muted); display: block; margin-bottom: 2px; }
    .msg__f { display: flex; gap: var(--space-2); align-items: center; }
    .msg[data-k='user'] { background: var(--accent, var(--border)); justify-self: end;
      margin-left: auto; }
    .msg[data-k='assistant'] { background: var(--bg-hover); border: 1px solid var(--border); }
    .msg[data-k='tool'], .msg[data-k='plan'], .msg.plan { background: none;
      border: 1px dashed var(--border); font-size: var(--font-xs); }
    .msg[data-k='usage'], .msg[data-k='system'] { background: none;
      font-size: var(--font-xs); color: var(--fg-muted); }
    .msg[data-k='error'] { border: 1px solid var(--error); font-size: var(--font-sm); }
    .msg.approval { border: 1px solid var(--warn, var(--error)); }
    .msg.approval .acts { display: flex; gap: var(--space-2); margin-top: var(--space-2); }
    .copy { border: none; background: none; color: var(--fg-muted);
      font-size: var(--font-xs); cursor: pointer; }
    .copy:hover { color: var(--fg); }
    .tpls { display: flex; flex-wrap: wrap; gap: var(--space-1); }
    .tpl { border: 1px solid var(--border); background: none; border-radius: 999px;
      padding: 2px var(--space-2); font: inherit; font-size: var(--font-xs);
      color: var(--fg-muted); cursor: pointer; }
    .tpl:hover { border-color: var(--accent, var(--fg)); color: var(--fg); }
    .composer { display: flex; gap: var(--space-2); align-items: end; }
    .composer .input { flex: 1; resize: vertical; font: inherit; }
    .composer__acts { display: grid; gap: var(--space-1); }
    .raw pre, .mono { font-family: var(--font-mono); }
    .raw pre { font-size: var(--font-xs); max-height: 12rem; overflow: auto; }
    .ctx__blk { border-top: 1px solid var(--border); padding-top: var(--space-2); }
    .muted { color: var(--fg-muted); }
    .small { font-size: var(--font-xs); }
    .err, .danger { color: var(--error); }
    .err { font-size: var(--font-sm); margin: var(--space-2) 0 0; }
    .studio[data-mode='simple'] .side, .studio[data-mode='simple'] .ctx { display: none; }
    .studio[data-mode='simple'] .layout { grid-template-columns: 1fr; }
    .studio[data-mode='visual'] .ctx { display: none; }
    .studio[data-mode='visual'] .layout { grid-template-columns: 16rem 1fr; }
    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr !important; } .ctx { display: none; }
    }
  `,
})
export class PfChatPage implements OnInit, OnDestroy {
  private readonly bridge = inject(PfBridge);
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly TEMPLATES = TEMPLATES;
  readonly modes = ['simple', 'visual', 'advanced'] as const;
  readonly mode = signal<'simple' | 'visual' | 'advanced'>('visual');
  readonly paired = signal(false);
  readonly pairTok = signal('');
  readonly pairUrl = signal('http://127.0.0.1:8471');
  readonly pairError = signal<string | null>(null);
  readonly providers = signal<BridgeProvider[]>([]);
  readonly provider = signal('fake');
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
  readonly ctxEntities = signal<string[]>([]);
  private readonly seenSeq = new Set<number>();
  private poll: ReturnType<typeof setInterval> | null = null;

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
    this.q() && !this.session()
      ? this.items()
      : this.items(),
  );
  readonly usage = computed(() => {
    const evs = this.lastEvents().filter((e) => e.type === 'usage.updated');
    if (!evs.length) return null;
    const p = evs[evs.length - 1].payload;
    return { in: p['tokens_in'] ?? 0, out: p['tokens_out'] ?? 0 };
  });
  readonly plan = computed(() => {
    const evs = this.lastEvents().filter((e) => e.type === 'plan.updated');
    if (!evs.length) return null;
    const entries = (evs[evs.length - 1].payload['entries'] as unknown[]) ?? [];
    return entries
      .map((e) => `- ${typeof e === 'string' ? e : JSON.stringify(e)}`)
      .join('\n') || 'plan updated';
  });
  readonly artifacts = computed(() =>
    this.lastEvents()
      .filter((e) => e.type.startsWith('artifact.'))
      .map((e) => String(e.payload['path'] ?? e.payload['name'] ?? 'artifact')),
  );

  ngOnInit(): void {
    this.paired.set(!!this.bridge.token());
    if (this.paired()) void this.bootstrap();
  }

  ngOnDestroy(): void {
    if (this.poll) clearInterval(this.poll);
  }

  async bootstrap(): Promise<void> {
    this.error.set(null);
    try {
      this.providers.set(await firstValueFrom(this.bridge.providers()));
      this.sessions.set(await firstValueFrom(this.bridge.listSessions()));
      try {
        const pl = await firstValueFrom(this.api.products());
        this.products.set(pl.items);
      } catch {
        this.products.set([]); // product context optional — degrade honestly
      }
      this.armPoll();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async pair(ev: Event): Promise<void> {
    ev.preventDefault();
    this.pairError.set(null);
    this.bridge.setPairing(this.pairTok(), this.pairUrl());
    try {
      await this.bootstrap();
      this.paired.set(true);
      this.toast.show('Bridge paired', 'success');
    } catch {
      this.pairError.set('pairing failed — check token and that the bridge is running');
    }
  }

  async reloadSessions(): Promise<void> {
    this.sessions.set(await firstValueFrom(this.bridge.listSessions()));
  }

  async startSession(): Promise<void> {
    this.busy.set(true);
    try {
      const s = await firstValueFrom(
        this.bridge.createSession(this.provider(), this.productId() || undefined),
      );
      this.session.set(s);
      this.items.set([{ kind: 'system', text: `session ${s.id} started (${s.provider})` }]);
      this.seenSeq.clear();
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
      this.items.set([
        { kind: 'system', text: 'session closed — metadata only' },
      ]);
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
    await firstValueFrom(this.bridge.deleteSession(s.id));
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
    this.items.update((l) => [...l, { kind: 'user', text }]);
    try {
      await firstValueFrom(this.bridge.prompt(s.id, s.provider, text));
      await this.pullEvents(s);
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
    await firstValueFrom(this.bridge.cancel(s.id, s.provider));
    this.items.update((l) => [...l, { kind: 'system', text: 'turn cancelled' }]);
  }

  async approve(it: ChatItem, approved: boolean): Promise<void> {
    const s = this.session();
    if (!s || !it.approvalId) return;
    try {
      await firstValueFrom(
        this.bridge.approve(s.id, s.provider, it.approvalId, approved),
      );
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
      md: 'markdown', json: 'json', yaml: 'yaml', yml: 'yaml', csv: 'csv',
      sql: 'sql', py: 'python', diff: 'diff', patch: 'diff', html: 'html',
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

  private armPoll(): void {
    if (this.poll) clearInterval(this.poll);
    this.poll = setInterval(() => {
      const s = this.session();
      if (s && !this.busy() && s.state !== 'closed') void this.pullEvents(s);
    }, 1500);
  }

  private async pullEvents(s: BridgeSession): Promise<void> {
    const evs = (await firstValueFrom(this.bridge.events(s.id, s.provider))).items;
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
    if (out.length) this.items.update((l) => [...l, ...out]);
  }
}
