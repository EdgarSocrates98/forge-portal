import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { BridgeEvent, BridgeSession, PfBridge } from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { UiSkeleton } from '../../shared/skeleton';

interface DiffRow {
  kind: 'same' | 'left-only' | 'right-only' | 'diverged';
  left?: BridgeEvent;
  right?: BridgeEvent;
}

/**
 * Session Compare (Cycle 29) — deterministic side-by-side of two sessions'
 * recorded event streams. Comparison is positional by seq with a
 * type/payload signature match — no inference, differences are reported
 * verbatim so a PM/dev can see *what actually diverged*.
 */
@Component({
  selector: 'page-pf-compare',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, UiSkeleton, EmptyState, ErrorState],
  template: `
    <ui-page-header
      title="Session Compare"
      subtitle="Diff two sessions' recorded event streams — same question, different run."
    />

    <section class="card pickers">
      <label class="field">
        <span>Session A</span>
        <select class="input" [value]="leftId()" (change)="pick($any($event.target).value, 'l')"
          aria-label="Left session">
          <option value="">— choose —</option>
          @for (s of sessions(); track s.id) {
            <option [value]="s.id" [selected]="s.id === leftId()">
              {{ s.meta?.title || s.id }} ({{ s.provider }})
            </option>
          }
        </select>
      </label>
      <label class="field">
        <span>Session B</span>
        <select class="input" [value]="rightId()" (change)="pick($any($event.target).value, 'r')"
          aria-label="Right session">
          <option value="">— choose —</option>
          @for (s of sessions(); track s.id) {
            <option [value]="s.id" [selected]="s.id === rightId()">
              {{ s.meta?.title || s.id }} ({{ s.provider }})
            </option>
          }
        </select>
      </label>
      <button class="btn" (click)="compare()" [disabled]="!leftId() || !rightId()">
        Compare
      </button>
    </section>

    @if (err()) {
      <ui-error [error]="err()!" (retry)="compare()" />
    } @else if (loading()) {
      <ui-skeleton [lines]="6" />
    } @else if (rows().length > 0) {
      <section class="card">
        <h2>
          Timeline diff
          <span class="muted">
            — {{ stats().same }} same · {{ stats().diverged }} diverged ·
            {{ stats().leftOnly }} only in A · {{ stats().rightOnly }} only in B
          </span>
        </h2>
        <div class="diff" role="table" aria-label="Event diff">
          <div class="diff-head" role="row">
            <span role="columnheader">A · {{ leftId() }}</span>
            <span role="columnheader">B · {{ rightId() }}</span>
          </div>
          @for (r of rows(); track $index) {
            <div class="diff-row" [class]="'diff-row diff-' + r.kind" role="row">
              <div class="cell" role="cell">
                @if (r.left) {
                  <span class="seq mono">#{{ r.left.seq }}</span>
                  <strong>{{ r.left.type }}</strong>
                  <small class="muted">{{ brief(r.left) }}</small>
                } @else {
                  <span class="muted">—</span>
                }
              </div>
              <div class="cell" role="cell">
                @if (r.right) {
                  <span class="seq mono">#{{ r.right.seq }}</span>
                  <strong>{{ r.right.type }}</strong>
                  <small class="muted">{{ brief(r.right) }}</small>
                } @else {
                  <span class="muted">—</span>
                }
              </div>
            </div>
          }
        </div>
      </section>
    } @else if (compared()) {
      <ui-empty title="No events to compare"
        hint="Both sessions have empty recorded timelines." />
    }
  `,
  styles: `
    .pickers { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
    .diff { display: grid; }
    .diff-head { display: grid; grid-template-columns: 1fr 1fr;
      font-weight: 600; padding: 6px 8px; border-bottom: 2px solid var(--line,#333); }
    .diff-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0;
      border-bottom: 1px solid var(--line,#2a2a2a); }
    .cell { padding: 6px 8px; display: flex; gap: 8px; align-items: baseline;
      min-width: 0; overflow: hidden; }
    .diff-same { opacity: .65; }
    .diff-diverged { background: color-mix(in srgb, #d69e2e 12%, transparent); }
    .diff-left-only { background: color-mix(in srgb, #3182ce 12%, transparent); }
    .diff-right-only { background: color-mix(in srgb, #38a169 12%, transparent); }
    .seq { min-width: 42px; color: var(--muted); }
  `,
})
export class PfComparePage implements OnInit {
  private readonly bridge = inject(PfBridge);

  readonly sessions = signal<BridgeSession[]>([]);
  readonly leftId = signal('');
  readonly rightId = signal('');
  readonly rows = signal<DiffRow[]>([]);
  readonly compared = signal(false);
  readonly loading = signal(false);
  readonly err = signal<ApiError | null>(null);
  readonly stats = computed(() => ({
    same: this.rows().filter((r) => r.kind === 'same').length,
    diverged: this.rows().filter((r) => r.kind === 'diverged').length,
    leftOnly: this.rows().filter((r) => r.kind === 'left-only').length,
    rightOnly: this.rows().filter((r) => r.kind === 'right-only').length,
  }));

  async ngOnInit(): Promise<void> {
    try {
      this.sessions.set(await firstValueFrom(this.bridge.listSessions()) ?? []);
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }

  pick(id: string, side: 'l' | 'r'): void {
    (side === 'l' ? this.leftId : this.rightId).set(id);
  }

  async compare(): Promise<void> {
    if (!this.leftId() || !this.rightId()) return;
    this.loading.set(true);
    this.err.set(null);
    const provOf = (id: string) =>
      this.sessions().find((s) => s.id === id)?.provider ?? 'fake';
    try {
      const [l, r] = await Promise.all([
        firstValueFrom(this.bridge.events(this.leftId(), provOf(this.leftId()))),
        firstValueFrom(this.bridge.events(this.rightId(), provOf(this.rightId()))),
      ]);
      this.rows.set(this.diff(l?.items ?? [], r?.items ?? []));
      this.compared.set(true);
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  /** Positional diff by seq — a pair diverges when type or payload text differs. */
  private diff(a: BridgeEvent[], b: BridgeEvent[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const l = a[i];
      const r = b[i];
      if (l && r) {
        const same = l.type === r.type &&
          JSON.stringify(l.payload) === JSON.stringify(r.payload);
        rows.push({ kind: same ? 'same' : 'diverged', left: l, right: r });
      } else if (l) {
        rows.push({ kind: 'left-only', left: l });
      } else if (r) {
        rows.push({ kind: 'right-only', right: r });
      }
    }
    return rows;
  }

  brief(e: BridgeEvent): string {
    const p = e.payload as Record<string, unknown>;
    const text = (p['text'] ?? p['message'] ?? p['status'] ?? '') as string;
    return String(text).slice(0, 80);
  }
}
