import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { PortalSpecialistsReport, SpecialistRow } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Specialist Explorer (lf-0032) — read-only projection of GET /specialists:
 * provider, version, declared capabilities, lifecycle state, compatibility,
 * declared relations and the honest last-check timestamp of the discovery
 * report. Nothing is inferred: absent capabilities render as an explicit
 * "none declared" row, and `probed: false` is surfaced as a limitation.
 */
@Component({
  selector: 'page-specialists',
  standalone: true,
  imports: [TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'specialists.title' | t" [subtitle]="'specialists.subtitle' | t">
      <button class="btn" (click)="load()"><ui-icon name="refresh" [size]="15" /> {{ 'state.refresh' | t }}</button>
    </ui-page-header>

    @if (loading()) {
      <section class="card" role="status"><ui-skeleton kind="text" [lines]="2" /><ui-skeleton kind="card" /></section>
    } @else if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    } @else if (report(); as r) {
      @if (r.limitations?.length || !r.probed) {
        <section class="card note" role="note">
          <ui-icon name="alert" [size]="14" />
          <div>
            @if (!r.probed) { <p>{{ 'specialists.notProbed' | t }}</p> }
            @for (l of r.limitations ?? []; track l) { <p class="muted">{{ l }}</p> }
          </div>
        </section>
      }
      <section class="stats" [attr.aria-label]="'specialists.title' | t">
        <div class="stat"><span class="stat__value">{{ r.specialists.length }}</span><span class="stat__label">{{ 'specialists.catalog' | t }}</span></div>
        <div class="stat"><span class="stat__value">{{ countOf('VERIFIED') }}</span><span class="stat__label">VERIFIED</span></div>
        <div class="stat"><span class="stat__value">{{ countOf('DISCOVERED') }}</span><span class="stat__label">DISCOVERED</span></div>
        <div class="stat"><span class="stat__value">{{ absentCount() }}</span><span class="stat__label">{{ 'specialists.absent' | t }}</span></div>
        <div class="stat"><span class="stat__value small">{{ r.generated_at || '—' }}</span><span class="stat__label">{{ 'specialists.lastCheck' | t }}</span></div>
      </section>

      <section class="rows">
        @for (s of r.specialists; track s.provider) {
          <article class="card spec" [class.open]="open() === s.provider">
            <button type="button" class="spec__head" (click)="toggle(s.provider)" [attr.aria-expanded]="open() === s.provider">
              <ui-state-badge [state]="s.state" />
              <span class="spec__name">{{ s.provider }}</span>
              <span class="muted">{{ s.version || '—' }}</span>
              <span class="chip">{{ 'specialists.capabilities' | t }}: {{ s.capability_count ?? (s.capabilities?.length ?? 0) }}</span>
              <span class="chip" [class.bad]="s.compatibility?.state === 'incompatible'">{{ s.compatibility?.state || 'unverified' }}</span>
              <ui-icon name="chevron-right" [size]="14" />
            </button>
            @if (open() === s.provider) {
              <div class="spec__body">
                <dl class="kv">
                  <dt>{{ 'specialists.lastCheck' | t }}</dt><dd>{{ s.last_check || '—' }}</dd>
                  <dt>{{ 'specialists.family' | t }}</dt><dd>{{ s.relations?.declared?.family || ('specialists.none' | t) }}</dd>
                  <dt>{{ 'specialists.composes' | t }}</dt><dd>{{ joinList(s.relations?.declared?.composes_with) }}</dd>
                  <dt>{{ 'specialists.verifiers' | t }}</dt><dd>{{ joinList(s.relations?.declared?.preferred_verifiers) }}</dd>
                  <dt>{{ 'specialists.fallback' | t }}</dt><dd>{{ joinList(s.relations?.declared?.fallback) }}</dd>
                </dl>
                @if (s.checks && keys(s.checks).length) {
                  <h4>{{ 'specialists.checks' | t }}</h4>
                  <ul class="plain">@for (k of keys(s.checks); track k) { <li><code>{{ k }}</code> — {{ s.checks![k] }}</li> }</ul>
                }
                <h4>{{ 'specialists.capabilities' | t }}</h4>
                @if (s.capabilities?.length) {
                  <table class="tbl">
                    <thead><tr><th scope="col">id</th><th scope="col">class</th><th scope="col">mode</th><th scope="col">risk</th><th scope="col">requires</th><th scope="col">cost</th></tr></thead>
                    <tbody>
                      @for (c of s.capabilities; track c.id) {
                        <tr><td><code>{{ c.id }}</code></td><td>{{ c.finding_class || '—' }}</td><td>{{ c.execution_mode || '—' }}</td><td>{{ c.risk || '—' }}</td><td>{{ (c.requires || []).join(', ') || '—' }}</td><td>{{ c.external_cost || '—' }}</td></tr>
                      }
                    </tbody>
                  </table>
                } @else {
                  <p class="muted">{{ 'specialists.noCapabilities' | t }}</p>
                }
                @if (s.limitations?.length) {
                  <h4>{{ 'specialists.limitations' | t }}</h4>
                  <ul class="plain">@for (l of s.limitations; track l) { <li>{{ l }}</li> }</ul>
                }
                @if (s.notes?.length) {
                  <h4>{{ 'specialists.notes' | t }}</h4>
                  <ul class="plain">@for (n of s.notes; track n) { <li>{{ n }}</li> }</ul>
                }
              </div>
            }
          </article>
        }
      </section>
      @if (!r.specialists.length) {
        <ui-empty icon="gem" [title]="'specialists.empty' | t" [hint]="'specialists.emptyDetail' | t" />
      }
    }
  `,
  styles: `
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.6rem;margin:.8rem 0}
    .stat{border:1px solid var(--line);border-radius:10px;padding:.55rem .7rem;display:flex;flex-direction:column;gap:.15rem}
    .stat__value{font-size:1.25rem;font-weight:700}.stat__value.small{font-size:.8rem;font-weight:600}
    .stat__label{font-size:.72rem;color:var(--fg-muted);text-transform:uppercase;letter-spacing:.04em}
    .rows{display:flex;flex-direction:column;gap:.5rem}
    .spec{padding:0}.spec__head{width:100%;display:flex;align-items:center;gap:.7rem;padding:.7rem .9rem;background:none;border:0;cursor:pointer;text-align:left;font:inherit;color:inherit}
    .spec__name{font-weight:600}.spec__head .chip{margin-left:auto}.spec__head .chip+.chip{margin-left:0}
    .chip{font-size:.72rem;border:1px solid var(--line);border-radius:999px;padding:.1rem .5rem;color:var(--fg-muted);white-space:nowrap}
    .chip.bad{border-color:var(--danger,#c33);color:var(--danger,#c33)}
    .spec__body{border-top:1px solid var(--line);padding:.7rem .9rem}
    .kv{display:grid;grid-template-columns:160px 1fr;gap:.2rem .8rem;margin:0 0 .6rem;font-size:.85rem}
    .kv dt{color:var(--fg-muted)}.kv dd{margin:0}
    h4{font-size:.8rem;margin:.7rem 0 .3rem;text-transform:uppercase;letter-spacing:.04em;color:var(--fg-muted)}
    .plain{margin:0;padding-left:1.1rem;font-size:.85rem}
    .tbl{width:100%;border-collapse:collapse;font-size:.82rem}
    .tbl th,.tbl td{border-bottom:1px solid var(--line);text-align:left;padding:.3rem .45rem}
    .tbl th{color:var(--fg-muted);font-weight:600}
    .note{display:flex;gap:.6rem;padding:.6rem .8rem;align-items:flex-start;border-color:var(--warn,#a80)}
    .muted{color:var(--fg-muted)}
  `,
})
export class SpecialistsPage implements OnInit {
  private readonly api = inject(PortalApi);
  readonly loading = signal(true);
  readonly report = signal<PortalSpecialistsReport | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly open = signal<string | null>(null);

  readonly absentCount = computed(
    () => (this.report()?.specialists ?? []).filter((s) => s.state !== 'VERIFIED' && s.state !== 'DISCOVERED').length,
  );

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.report.set(await firstValueFrom(this.api.specialists()));
    } catch (e) {
      this.error.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  toggle(provider: string): void {
    this.open.set(this.open() === provider ? null : provider);
  }

  countOf(state: string): number {
    return (this.report()?.specialists ?? []).filter((s) => s.state === state).length;
  }

  keys(record: Record<string, string> | undefined): string[] {
    return Object.keys(record ?? {});
  }

  joinList(list?: string[]): string {
    return list?.length ? list.join(', ') : '—';
  }

  trackRow(_i: number, s: SpecialistRow): string {
    return s.provider;
  }
}
