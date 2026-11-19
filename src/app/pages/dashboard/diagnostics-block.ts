import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { HealthCheck } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { StateBadge } from '../../shared/state-badge';

/**
 * Diagnostics surface (cycle 16.1 §11.6 / spec §diagnóstico) — mirrors
 * the doctor render structure PROBLEMA / CAUSA PROVÁVEL / AÇÃO /
 * ESTADO. Each slot is filled only from the check row the adapter
 * returned:
 *
 *   ESTADO    ← check.state (badge; the doctor's own verdict)
 *   PROBLEMA  ← check.id + check.detail verbatim
 *   CAUSA     ← check.guidance.causa_provavel when the adapter emits
 *               structured guidance; otherwise an honest em-dash —
 *               the portal never invents a cause
 *   AÇÃO      ← check.guidance.acao when present; for a failed
 *               `repairable` check without guidance the action is the
 *               real route that owns repair (/install → repair), never
 *               an auto-fix button
 *
 * A PASS check collapses to one row (state + id); only failing or
 * non-PASS checks expand to the full diagnosis block — matching the
 * doctor CLI which only expands problems.
 */
@Component({
  selector: 'diag-block',
  standalone: true,
  imports: [RouterLink, TPipe, StateBadge],
  template: `
    @if (checks() === null) {
      <div class="diag__unv">
        <ui-state-badge state="UNVERIFIED" />
        <span class="muted">
          {{ healthLoaded() ? ('diag.noChecks' | t) : ('diag.statusUnreachable' | t) }}
        </span>
      </div>
    } @else if (!checks()!.length) {
      <p class="muted">{{ 'diag.empty' | t }}</p>
    } @else {
      @if (passCount()) {
        <p class="diag__summary muted">
          {{ 'diag.passCount' | t: { count: passCount() } }}
        </p>
      }
      @for (c of expanded(); track c.id) {
        <div class="diag" [attr.data-check]="c.id">
          <div class="diag__row">
            <span class="diag__label">{{ 'diag.estado' | t }}</span>
            <ui-state-badge [state]="estado(c)" />
          </div>
          <div class="diag__row">
            <span class="diag__label">{{ 'diag.problema' | t }}</span>
            <span>
              <code>{{ c.id }}</code>
              @if (c.detail) {
                <span class="muted"> — {{ c.detail }}</span>
              }
            </span>
          </div>
          <div class="diag__row">
            <span class="diag__label">{{ 'diag.causa' | t }}</span>
            <span>{{ c.guidance?.causa_provavel ?? '—' }}</span>
          </div>
          <div class="diag__row">
            <span class="diag__label">{{ 'diag.acao' | t }}</span>
            <span>
              @if (c.guidance?.acao; as acao) {
                {{ acao }}
              } @else if (repairable(c)) {
                <a class="linklike" routerLink="/install">{{ 'diag.repairLink' | t }}</a>
              } @else {
                —
              }
            </span>
          </div>
        </div>
      }
    }
  `,
  styles: `
    .diag__unv {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3) 0;
    }
    .muted {
      color: var(--fg-muted);
    }
    .diag__summary {
      margin: 0 0 var(--space-2);
      font-size: var(--font-sm);
    }
    .diag {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-left: 3px solid var(--warn);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-2);
      background: color-mix(in srgb, var(--bg-hover) 40%, transparent);
    }
    .diag__row {
      display: grid;
      grid-template-columns: 9.5rem 1fr;
      gap: var(--space-2);
      font-size: var(--font-sm);
      align-items: baseline;
    }
    .diag__label {
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    @media (max-width: 520px) {
      .diag__row {
        grid-template-columns: 1fr;
        gap: 2px;
      }
    }
  `,
})
export class DiagnosticsBlock {
  readonly checks = input<HealthCheck[] | null>(null);
  /** True when /installation/status answered (checks may still be
   *  empty — an empty doctor list is real data, not UNVERIFIED). */
  readonly healthLoaded = input(false);

  /** Checks that failed or carry guidance — the rows the doctor would
   *  expand. PASS rows collapse into the summary count. */
  readonly expanded = computed(() =>
    (this.checks() ?? []).filter((c) => this.estado(c) !== 'PASS' || !!c.guidance),
  );
  readonly passCount = computed(
    () => (this.checks() ?? []).filter((c) => this.estado(c) === 'PASS' && !c.guidance).length,
  );

  estado(c: HealthCheck): string {
    return c.guidance?.estado ?? c.state;
  }
  repairable(c: HealthCheck): boolean {
    return c.repairable === true && this.estado(c) !== 'PASS';
  }
}
