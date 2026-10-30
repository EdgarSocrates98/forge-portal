import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfBridge, BridgeEvent, BridgeProvider, BridgeSession } from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

interface ChatItem {
  kind: 'user' | 'assistant' | 'tool' | 'approval' | 'system' | 'usage';
  text: string;
  meta?: string;
}

/**
 * Chat Studio — multi-agent visual chat over the Forge Agent Bridge.
 * Pairs with the LOCAL bridge (127.0.0.1, bearer token), picks a provider,
 * opens a real session, streams normalized v1 events into a timeline.
 * Advanced mode exposes raw event envelopes for diagnosis.
 */
@Component({
  selector: 'pf-chat-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, PageHeader, UiSkeleton],
  template: `
    <div class="studio" [attr.data-mode]="mode()">
      <ui-page-header title="Chat Studio"
        subtitle="Multi-agent sessions over the Forge Agent Bridge — localhost paired.">
        <div class="modes" role="tablist" aria-label="Experience mode">
          @for (m of modes; track m) {
            <button class="mode" [attr.data-active]="mode() === m || null" (click)="mode.set(m)">
              {{ m }}
            </button>
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
          @if (pairError()) { <p class="err">{{ pairError() }}</p> }
        </section>
      } @else {
        <div class="layout">
          <aside class="side card">
            <h3>Providers</h3>
            @for (p of providers(); track p.id) {
              <button class="prov" [attr.data-sel]="provider() === p.id || null"
                      [attr.data-off]="!p.executable && p.id !== 'fake' || null"
                      (click)="provider.set(p.id)">
                <span class="prov__n">{{ p.name }}</span>
                <span class="muted small">{{ p.id }}</span>
              </button>
            }
            <button class="btn btn--primary new" [disabled]="busy()"
                    (click)="startSession()">
              {{ session() ? 'New session' : 'Start session' }}
            </button>
            @if (session(); as s) {
              <p class="muted small sid"><code>{{ s.id }}</code> · {{ s.state }}</p>
              <button class="btn btn--mini" (click)="cancel()">Cancel turn</button>
            }
          </aside>

          <section class="main card">
            @if (loading()) { <ui-skeleton kind="text" [lines]="4" /> }
            <div class="timeline" aria-live="polite">
              @for (it of items(); track $index) {
                <div class="msg" [attr.data-k]="it.kind">
                  <span class="msg__k">{{ it.kind }}</span>
                  <p>{{ it.text }}</p>
                  @if (it.meta) { <span class="muted small">{{ it.meta }}</span> }
                </div>
              }
              @if (!items().length) {
                <ui-empty icon="agents" title="Start a session and send your first prompt" />
              }
            </div>
            @if (mode() === 'advanced' && lastEvents().length) {
              <details class="raw"><summary>raw events ({{ lastEvents().length }})</summary>
                <pre>{{ rawJson() }}</pre>
              </details>
            }
            <form class="composer" (submit)="send($event)">
              <input class="input" [value]="draft()" (input)="draft.set($any($event.target).value)"
                     placeholder="Ask the agent…" [disabled]="!session()"
                     aria-label="Prompt" />
              <button class="btn btn--primary" type="submit"
                      [disabled]="busy() || !session() || !draft().trim()">
                {{ busy() ? 'Running…' : 'Send' }}
              </button>
            </form>
          </section>
        </div>
      }
      @if (error(); as e) { <ui-error [error]="e" (retry)="loadProviders()" /> }
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
    .layout { display: grid; grid-template-columns: 15rem 1fr; gap: var(--space-4);
      align-items: start; }
    .side { display: grid; gap: var(--space-2); }
    .side h3 { margin: 0 0 var(--space-1); font-size: var(--font-md); }
    .prov { display: grid; text-align: left; border: 1px solid var(--border);
      border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
      background: none; font: inherit; color: inherit; cursor: pointer; }
    .prov:hover { background: var(--bg-hover); }
    .prov[data-sel] { border-color: var(--accent, var(--fg)); }
    .prov[data-off] { opacity: 0.45; }
    .prov__n { font-weight: 600; font-size: var(--font-sm); }
    .new { margin-top: var(--space-2); }
    .sid { word-break: break-all; }
    .main { display: grid; gap: var(--space-3); min-height: 24rem; }
    .timeline { display: grid; gap: var(--space-2); max-height: 26rem;
      overflow-y: auto; padding-right: var(--space-1); }
    .msg { border-radius: var(--radius-md); padding: var(--space-2) var(--space-3);
      max-width: 85%; }
    .msg p { margin: 0; font-size: var(--font-sm); white-space: pre-wrap; }
    .msg__k { font-size: var(--font-xs); text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--fg-muted); display: block; margin-bottom: 2px; }
    .msg[data-k='user'] { background: var(--accent, var(--border)); justify-self: end;
      margin-left: auto; }
    .msg[data-k='assistant'] { background: var(--bg-hover); border: 1px solid var(--border); }
    .msg[data-k='tool'] { background: none; border: 1px dashed var(--border);
      font-size: var(--font-xs); }
    .msg[data-k='usage'] { background: none; font-size: var(--font-xs);
      color: var(--fg-muted); }
    .composer { display: flex; gap: var(--space-2); }
    .composer .input { flex: 1; }
    .raw pre { font-family: var(--font-mono); font-size: var(--font-xs);
      max-height: 12rem; overflow: auto; }
    .muted { color: var(--fg-muted); }
    .small { font-size: var(--font-xs); }
    .err { color: var(--error); font-size: var(--font-sm); margin: var(--space-2) 0 0; }
    .studio[data-mode='simple'] .side { display: none; }
    .studio[data-mode='simple'] .layout { grid-template-columns: 1fr; }
  `,
})
export class PfChatPage implements OnInit {
  private readonly bridge = inject(PfBridge);
  private readonly toast = inject(ToastService);

  readonly modes = ['simple', 'visual', 'advanced'] as const;
  readonly mode = signal<'simple' | 'visual' | 'advanced'>('visual');
  readonly paired = signal(false);
  readonly pairTok = signal('');
  readonly pairUrl = signal('http://127.0.0.1:8471');
  readonly pairError = signal<string | null>(null);
  readonly providers = signal<BridgeProvider[]>([]);
  readonly provider = signal('fake');
  readonly session = signal<BridgeSession | null>(null);
  readonly items = signal<ChatItem[]>([]);
  readonly lastEvents = signal<BridgeEvent[]>([]);
  readonly draft = signal('');
  readonly busy = signal(false);
  readonly loading = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly rawJson = computed(() => JSON.stringify(this.lastEvents(), null, 2));

  ngOnInit(): void {
    this.paired.set(!!this.bridge.token());
    if (this.paired()) void this.loadProviders();
  }

  async pair(ev: Event): Promise<void> {
    ev.preventDefault();
    this.pairError.set(null);
    this.bridge.setPairing(this.pairTok(), this.pairUrl());
    try {
      await this.loadProviders();
      this.paired.set(true);
      this.toast.show('Bridge paired', 'success');
    } catch (e) {
      this.pairError.set(e instanceof ApiError ? `pair failed (${e.status})` : 'pair failed');
    }
  }

  async loadProviders(): Promise<void> {
    this.error.set(null);
    try {
      this.providers.set(await firstValueFrom(this.bridge.providers()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    }
  }

  async startSession(): Promise<void> {
    this.busy.set(true);
    try {
      const s = await firstValueFrom(
        this.bridge.createSession(this.provider()),
      );
      this.session.set(s);
      this.items.set([{ kind: 'system', text: `session ${s.id} started (${s.provider})` }]);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async send(ev: Event): Promise<void> {
    ev.preventDefault();
    const s = this.session();
    const text = this.draft().trim();
    if (!s || !text || this.busy()) return;
    this.busy.set(true);
    this.draft.set('');
    this.items.update((l) => [...l, { kind: 'user', text }]);
    try {
      await firstValueFrom(this.bridge.prompt(s.id, s.provider, text));
      const evs = (await firstValueFrom(this.bridge.events(s.id, s.provider))).items;
      this.lastEvents.set(evs);
      this.renderEvents(evs);
    } catch (e) {
      this.items.update((l) => [
        ...l,
        { kind: 'system', text: `error: ${e instanceof ApiError ? e.status : 'transport'}` },
      ]);
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(): Promise<void> {
    const s = this.session();
    if (!s) return;
    await firstValueFrom(this.bridge.cancel(s.id, s.provider));
    this.items.update((l) => [...l, { kind: 'system', text: 'turn cancelled' }]);
  }

  private renderEvents(evs: BridgeEvent[]): void {
    const out: ChatItem[] = [];
    for (const e of evs) {
      const p = e.payload ?? {};
      switch (e.type) {
        case 'message.delta':
        case 'message.completed':
          out.push({ kind: 'assistant', text: String(p['text'] ?? '') });
          break;
        case 'tool.started':
          out.push({ kind: 'tool', text: `⚙ ${String(p['name'] ?? 'tool')}` });
          break;
        case 'tool.completed':
          out.push({ kind: 'tool', text: `✓ ${String(p['name'] ?? 'tool')} done` });
          break;
        case 'approval.requested':
          out.push({ kind: 'approval', text: `approval: ${String(p['detail'] ?? '')}` });
          break;
        case 'usage.updated':
          out.push({
            kind: 'usage',
            text: `tokens in ${p['tokens_in'] ?? 0} · out ${p['tokens_out'] ?? 0}`,
          });
          break;
        default:
          if (e.type.startsWith('session.') || e.type.startsWith('turn.')) {
            out.push({ kind: 'system', text: e.type });
          }
      }
    }
    this.items.update((l) => [...l, ...out]);
  }
}
