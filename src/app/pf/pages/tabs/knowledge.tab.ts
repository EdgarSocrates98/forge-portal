import { TPipe } from '../../../core/i18n/i18n.pipe';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import {
  PfDocument,
  PfGraph,
  PfKnowledgeAnswer,
  PfKnowledgeHealth,
  PfKnowledgeSource,
} from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

/**
 * Knowledge tab — document import, FTS query with citations + synthesis
 * status, knowledge health and the entity graph summary. The synthesis
 * string is rendered verbatim (`ok` | `unavailable:*` | `error:*`) —
 * the engine's honest state, never reinterpreted.
 */
@Component({
  selector: 'pf-knowledge-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiSkeleton, TPipe],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading knowledge">
        <ui-skeleton kind="card" [lines]="3" />
      </div>
    } @else {
      <div class="stats">
        <div class="stat">
          <span class="stat__value">{{ health()?.score ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.knowledgeHealth' | t }}</span>
          @if (health()?.warnings?.length) {
            <span class="stat__hint">{{ health()!.warnings![0] }}</span>
          }
        </div>
        <div class="stat">
          <span class="stat__value"
            >{{ health()?.sources?.indexed ?? '—' }}/{{ health()?.sources?.total ?? '—' }}</span
          >
          <span class="stat__label">{{ 'pf.knowledge.sourcesIndexed' | t }}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ health()?.entities?.total ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.entities' | t }}</span>
          @if (health()?.entities?.provisional) {
            <span class="stat__hint">{{ health()!.entities!.provisional }} provisional</span>
          }
        </div>
        <div class="stat">
          <span class="stat__value">{{ graph()?.stats?.nodes ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.graphNodes' | t }}</span>
          @if (graph()?.stats?.edges !== undefined) {
            <span class="stat__hint">{{ graph()!.stats!.edges }} edges</span>
          }
        </div>
      </div>

      <div class="cols">
        <section class="card">
          <h2>{{ 'pf.knowledge.importDocument' | t }}</h2>
          <form class="stack" (submit)="importDoc($event)">
            <label class="field">
              <span>{{ 'pf.knowledge.title' | t }}</span>
              <input
                class="input"
                [value]="docTitle()"
                (input)="docTitle.set($any($event.target).value)"
                placeholder="e.g. Q3 discovery notes"
                required
              />
            </label>
            <label class="field">
              <span>{{ 'pf.knowledge.content' | t }}</span>
              <textarea
                class="textarea"
                rows="7"
                [value]="docContent()"
                (input)="docContent.set($any($event.target).value)"
                placeholder="Paste markdown or plain text — it is chunked and indexed for FTS."
                required
              ></textarea>
            </label>
            <div class="fg-row">
              <button
                class="btn btn--primary"
                type="submit"
                [disabled]="busy() || !docTitle().trim() || !docContent().trim()"
              >
                Import
              </button>
              <button
                class="btn"
                type="button"
                [disabled]="busy()"
                (click)="extract()"
                title="Extract entities + relations from indexed chunks"
              >
                Extract entities
              </button>
            </div>
          </form>
          @if (extractResult(); as xr) {
            <p class="ok-note">
              Extraction complete — {{ xr.entities }} entities, {{ xr.relations }} relations.
            </p>
          }
        </section>

        <section class="card">
          <h2>{{ 'pf.knowledge.askTheKnowledgeBase' | t }}</h2>
          <form class="stack" (submit)="ask($event)">
            <label class="field">
              <span>{{ 'pf.knowledge.question' | t }}</span>
              <textarea
                class="textarea"
                rows="3"
                [value]="question()"
                (input)="question.set($any($event.target).value)"
                placeholder="e.g. What metrics are tied to churn?"
                required
              ></textarea>
            </label>
            <button
              class="btn btn--primary"
              type="submit"
              [disabled]="asking() || !question().trim()"
            >
              {{ asking() ? 'Querying…' : 'Query' }}
            </button>
          </form>

          @if (answer(); as a) {
            <div class="answer fg-enter" aria-live="polite">
              <div class="answer__head">
                <ui-state-badge [state]="synthBadge(a.synthesis)" [labelOverride]="a.synthesis" />
                <span class="muted small">{{ a.citations.length }} citation(s)</span>
              </div>
              @if (a.answer) {
                <p class="answer__text">{{ a.answer }}</p>
              }
              @if (a.citations.length) {
                <ul class="cites">
                  @for (c of a.citations; track c.chunk_id) {
                    <li>
                      <p class="cites__snip">“{{ c.snippet }}”</p>
                      <span class="muted small">
                        {{ c.title || c.document_id }} ·
                        <code>{{ c.chunk_id }}</code>
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="muted small">{{ 'pf.knowledge.noChunksMatchedImportDocuments' | t }}</p>
              }
            </div>
          }
        </section>
      </div>

      <section class="card">
        <h2>{{ 'pf.knowledge.documents' | t }}</h2>
        @if (docs().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.knowledge.title' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.status' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.chunks' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.imported' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (d of docs(); track d.id) {
                <tr>
                  <td>
                    <strong>{{ d.title }}</strong>
                    <code class="muted small"> {{ d.id }}</code>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="d.status === 'indexed' ? 'ok' : 'unverified'"
                      [labelOverride]="d.status ?? 'unknown'"
                    />
                  </td>
                  <td>{{ d.chunk_count ?? '—' }}</td>
                  <td class="muted small">{{ d.created_at ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="knowledge" title="No documents imported" />
        }
      </section>

      <section class="card">
        <h2>{{ 'pf.knowledge.knowledgeSources' | t }}</h2>
        @if (sources().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.knowledge.name' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.type' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.locator' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.status' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of sources(); track s.id) {
                <tr>
                  <td>
                    <strong>{{ s.name }}</strong>
                  </td>
                  <td>{{ s.type ?? '—' }}</td>
                  <td>
                    <code class="muted small">{{ s.locator || '—' }}</code>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="s.status === 'indexed' ? 'ok' : 'unverified'"
                      [labelOverride]="s.status ?? 'unverified'"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="folder" title="No knowledge sources registered" />
        }
      </section>
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .cols {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      margin-bottom: var(--space-4);
      align-items: start;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .cols .card {
      margin-bottom: 0;
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      font-weight: 550;
    }
    .answer {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      display: grid;
      gap: var(--space-3);
    }
    .answer__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .answer__text {
      margin: 0;
      white-space: pre-wrap;
    }
    .cites {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .cites li {
      border-left: 3px solid var(--accent);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-hover);
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
    }
    .cites__snip {
      margin: 0 0 2px;
      font-size: var(--font-sm);
    }
    .ok-note {
      margin: var(--space-3) 0 0;
      font-size: var(--font-sm);
      color: var(--ok);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
  `,
})
export class PfKnowledgeTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly docs = signal<PfDocument[]>([]);
  readonly sources = signal<PfKnowledgeSource[]>([]);
  readonly health = signal<PfKnowledgeHealth | null>(null);
  readonly graph = signal<PfGraph | null>(null);
  readonly answer = signal<PfKnowledgeAnswer | null>(null);
  readonly extractResult = signal<{ entities: number; relations: number } | null>(null);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly asking = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly docTitle = signal('');
  readonly docContent = signal('');
  readonly question = signal('');

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [docs, sources, health, graph] = await Promise.all([
        firstValueFrom(this.api.documents(this.pid())),
        firstValueFrom(this.api.knowledgeSources(this.pid())),
        firstValueFrom(this.api.knowledgeHealth(this.pid())),
        firstValueFrom(this.api.knowledgeGraph(this.pid())),
      ]);
      this.docs.set(docs.items ?? []);
      this.sources.set(sources.items ?? []);
      this.health.set(health);
      this.graph.set(graph);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  synthBadge(s: string): string {
    if (s === 'ok') return 'ok';
    if (s.startsWith('unavailable')) return 'unverified';
    if (s.startsWith('error')) return 'error';
    return 'muted';
  }

  async importDoc(ev: Event): Promise<void> {
    ev.preventDefault();
    const title = this.docTitle().trim();
    const content = this.docContent();
    if (!title || !content.trim() || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.importDocument(this.pid(), { title, content }));
      this.docTitle.set('');
      this.docContent.set('');
      this.toast.show(`Document "${title}" imported`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async extract(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.extractResult.set(null);
    try {
      const r = await firstValueFrom(this.api.knowledgeExtract(this.pid()));
      this.extractResult.set(r);
      this.toast.show('Entity extraction complete', 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async ask(ev: Event): Promise<void> {
    ev.preventDefault();
    const q = this.question().trim();
    if (!q || this.asking()) return;
    this.asking.set(true);
    try {
      this.answer.set(await firstValueFrom(this.api.knowledgeQuery(this.pid(), q)));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.asking.set(false);
    }
  }
}
