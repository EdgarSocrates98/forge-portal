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
import { PfProductHealth } from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { UiSkeleton } from '../../../shared/skeleton';

const DIM_ORDER = [
  'value',
  'adoption',
  'experience',
  'reliability',
  'cost',
  'delivery',
  'knowledge',
  'risk',
];

/**
 * Health tab — Product Health Center surface. The overall score renders as
 * a ring; each of the 8 deterministic dimensions renders as a bar whose
 * evidence list is expandable. Every number carries its provenance — the
 * engine never emits a score without evidence.
 */
@Component({
  selector: 'pf-health-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, UiSkeleton],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" aria-label="loading health"><ui-skeleton kind="card" [lines]="4" /></div>
    } @else if (health(); as h) {
      <section class="hero card">
        <div class="ring" [style.--p]="h.overall" [attr.data-tier]="tier(h.overall)">
          <span class="ring__n">{{ h.overall }}</span>
          <span class="ring__l">/ 100</span>
        </div>
        <div class="hero__meta">
          <h2>Product health</h2>
          <p class="muted">
            Weakest dimension: <strong>{{ h.weakest_dimension }}</strong> — deterministic scoring;
            expand any bar to see the evidence behind it.
          </p>
        </div>
      </section>

      <section class="dims">
        @for (d of dims(); track d.name) {
          <div class="dim card" [attr.data-weakest]="d.name === h.weakest_dimension || null">
            <button
              class="dim__head"
              (click)="toggle(d.name)"
              [attr.aria-expanded]="open() === d.name"
            >
              <span class="dim__name">{{ d.name }}</span>
              <span class="dim__bar" [attr.data-tier]="tier(d.score)">
                <span class="dim__fill" [style.width.%]="d.score"></span>
              </span>
              <span class="dim__score">{{ d.score }}</span>
            </button>
            @if (open() === d.name) {
              <ul class="ev">
                @for (ev of d.evidence; track $index) {
                  <li [attr.data-neg]="(ev.weight ?? 1) < 0 || null">
                    <span class="chip">{{ ev.kind }}</span> {{ ev.detail }}
                  </li>
                }
              </ul>
            }
          </div>
        }
      </section>
    } @else {
      <ui-empty icon="pulse" title="No health data yet" />
    }
  `,
  styles: `
    .card {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-card, var(--bg-hover));
    }
    .hero {
      display: flex;
      gap: var(--space-5);
      align-items: center;
      padding: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .hero__meta h2 {
      margin: 0 0 var(--space-1);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .hero__meta p {
      margin: 0;
    }
    .ring {
      --p: 0;
      width: 7rem;
      height: 7rem;
      flex: 0 0 auto;
      border-radius: 50%;
      display: grid;
      place-items: center;
      position: relative;
      background: conic-gradient(var(--ok) calc(var(--p) * 1%), var(--border) 0);
    }
    .ring::before {
      content: '';
      position: absolute;
      inset: 10px;
      border-radius: 50%;
      background: var(--bg-card, var(--bg-hover));
    }
    .ring__n {
      position: relative;
      font-size: var(--font-xl);
      font-weight: 700;
    }
    .ring__l {
      position: relative;
      font-size: var(--font-xs);
      color: var(--fg-muted);
      margin-top: 2.2rem;
      margin-left: -1.4rem;
    }
    .ring[data-tier='warn'] {
      background: conic-gradient(var(--warn, #d97706) calc(var(--p) * 1%), var(--border) 0);
    }
    .ring[data-tier='error'] {
      background: conic-gradient(var(--error) calc(var(--p) * 1%), var(--border) 0);
    }
    .dims {
      display: grid;
      gap: var(--space-2);
    }
    .dim {
      overflow: hidden;
    }
    .dim[data-weakest] {
      border-color: var(--warn, #d97706);
    }
    .dim__head {
      display: grid;
      grid-template-columns: 8rem 1fr 3rem;
      gap: var(--space-3);
      align-items: center;
      width: 100%;
      padding: var(--space-3) var(--space-4);
      background: none;
      border: 0;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
    }
    .dim__head:hover {
      background: var(--bg-hover);
    }
    .dim__name {
      font-weight: 600;
      text-transform: capitalize;
    }
    .dim__bar {
      height: 8px;
      border-radius: 999px;
      background: var(--border);
      overflow: hidden;
    }
    .dim__fill {
      display: block;
      height: 100%;
      border-radius: 999px;
      background: var(--ok);
      transition: width 0.4s ease;
    }
    .dim__bar[data-tier='warn'] .dim__fill {
      background: var(--warn, #d97706);
    }
    .dim__bar[data-tier='error'] .dim__fill {
      background: var(--error);
    }
    .dim__score {
      font-variant-numeric: tabular-nums;
      font-weight: 650;
      text-align: right;
    }
    .ev {
      margin: 0;
      padding: 0 var(--space-4) var(--space-3);
      list-style: none;
      display: grid;
      gap: var(--space-1);
      font-size: var(--font-sm);
    }
    .ev li[data-neg] {
      color: var(--error);
    }
    .chip {
      font-size: var(--font-xs);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 0 var(--space-2);
      margin-right: var(--space-1);
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
    }
  `,
})
export class PfHealthTab implements OnInit {
  private readonly api = inject(PfApi);
  readonly pid = input.required<string>();

  readonly health = signal<PfProductHealth | null>(null);
  readonly loading = signal(true);
  readonly error = signal<ApiError | null>(null);
  readonly open = signal<string | null>(null);

  readonly dims = computed(() => {
    const h = this.health();
    if (!h) return [];
    return DIM_ORDER.filter((k) => h.dimensions?.[k]).map((k) => ({
      name: k,
      score: h.dimensions[k].score,
      evidence: h.dimensions[k].evidence ?? [],
    }));
  });

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.health.set(await firstValueFrom(this.api.productHealth(this.pid())));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  toggle(name: string): void {
    this.open.set(this.open() === name ? null : name);
  }

  tier(score: number): string {
    if (score >= 70) return 'ok';
    if (score >= 40) return 'warn';
    return 'error';
  }
}
