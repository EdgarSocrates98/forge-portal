import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { ApiError } from '../../core/api/api.error';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import {
  SENTINEL_DEFAULT_BASE_URL,
  SentinelApi,
} from '../../sentinel/sentinel-api.service';
import { SentinelHealth } from '../../sentinel/sentinel.models';
import { sentinelFailure } from '../../sentinel/sentinel-states';

/**
 * Sentinel connection card — where the local `api-sentinel serve`
 * instance lives and how the browser authenticates. `sentinel.baseUrl`
 * and `sentinel.token` persist to sessionStorage via SentinelApi (same
 * policy as the Product Forge engine connection): the bearer is sent as
 * `Authorization: Bearer …`, never logged, never put in a URL, never
 * written to localStorage.
 */
@Component({
  selector: 'sentinel-connection',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TPipe, UiIcon, UiSkeleton],
  template: `
    <section class="conn card" aria-labelledby="conn-title">
      <div class="conn__head">
        <div>
          <p class="eyebrow">{{ 'sentinel.conn.eyebrow' | t }}</p>
          <h2 id="conn-title">{{ 'sentinel.conn.title' | t }}</h2>
        </div>
        <button
          class="btn btn--icon"
          type="button"
          (click)="toggle.emit()"
          [attr.aria-label]="'sentinel.conn.close' | t"
        >
          <ui-icon name="close" [size]="15" />
        </button>
      </div>

      <form class="stack" (submit)="save($event)">
        <label class="field">
          <span>{{ 'sentinel.conn.baseUrl' | t }}</span>
          <input
            class="input mono"
            [value]="baseUrl()"
            (input)="baseUrl.set($any($event.target).value)"
            [placeholder]="defaultUrl"
            spellcheck="false"
            autocomplete="off"
          />
          <small class="muted">{{ 'sentinel.conn.baseUrlHint' | t }}</small>
        </label>
        <label class="field">
          <span>{{ 'sentinel.conn.token' | t }}</span>
          <input
            class="input mono"
            type="password"
            [value]="token()"
            (input)="token.set($any($event.target).value)"
            placeholder="<workspace>/token"
            autocomplete="off"
            spellcheck="false"
          />
          <small class="muted">{{ 'sentinel.conn.tokenHint' | t }}</small>
        </label>
        <div class="row">
          <button class="btn btn--primary" type="submit">
            {{ 'sentinel.conn.save' | t }}
          </button>
          <button class="btn" type="button" [disabled]="testing()" (click)="test()">
            {{ testing() ? ('sentinel.conn.testing' | t) : ('sentinel.conn.test' | t) }}
          </button>
        </div>
      </form>

      <div class="result" aria-live="polite">
        @if (testing()) {
          <ui-skeleton kind="text" [lines]="1" />
        } @else if (health(); as h) {
          <p class="ok">
            <ui-icon name="check" [size]="14" />
            {{ 'sentinel.conn.ok' | t }}
            <code>api-sentinel {{ h.version }} · {{ h.state }}</code>
          </p>
        } @else if (testError(); as e) {
          <p class="fail" role="alert">
            <ui-icon name="alert" [size]="14" />
            {{ 'sentinel.conn.fail' | t }}
            <code>{{ e.body.code }}</code>
            @if (failure() === 'unreachable') {
              <small class="muted">{{ 'sentinel.conn.unreachable' | t }}</small>
            }
            @if (failure() === 'unauthorized') {
              <small class="muted">{{ 'sentinel.conn.unauthorized' | t }}</small>
            }
          </p>
        }
      </div>
    </section>
  `,
  styles: `
    .conn {
      padding: var(--space-5);
      margin-bottom: var(--space-4);
      border-left: 3px solid var(--accent);
    }
    .conn__head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--space-3);
      margin-bottom: var(--space-4);
    }
    .conn__head h2 {
      margin: 0;
      font-size: var(--font-lg);
    }
    .eyebrow {
      margin: 0 0 4px;
      color: var(--accent-ink);
      font-size: var(--font-xs);
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .stack {
      display: grid;
      gap: var(--space-4);
    }
    .field {
      display: grid;
      gap: 6px;
      font-size: var(--font-sm);
      font-weight: 550;
    }
    .field small {
      font-weight: 400;
      color: var(--fg-muted);
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .row {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .result {
      margin-top: var(--space-3);
      min-height: 1.2rem;
    }
    .ok,
    .fail {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      flex-wrap: wrap;
      margin: 0;
      font-size: var(--font-sm);
    }
    .ok {
      color: var(--ok);
    }
    .fail {
      color: var(--error);
    }
    .muted {
      color: var(--fg-muted);
    }
    .btn--icon {
      padding: 6px;
      line-height: 0;
    }
  `,
})
export class SentinelConnection {
  readonly api = inject(SentinelApi);
  readonly toggle = output<void>();
  readonly saved = output<void>();

  readonly defaultUrl = SENTINEL_DEFAULT_BASE_URL;
  readonly baseUrl = signal(this.api.baseUrl());
  readonly token = signal(this.api.token());
  readonly testing = signal(false);
  readonly health = signal<SentinelHealth | null>(null);
  readonly testError = signal<ApiError | null>(null);
  readonly failure = signal<ReturnType<typeof sentinelFailure>>(null);

  save(ev: Event): void {
    ev.preventDefault();
    this.api.setBaseUrl(this.baseUrl());
    this.api.setToken(this.token());
    this.saved.emit();
  }

  async test(): Promise<void> {
    // Apply the form first — the probe must hit the values on screen.
    this.api.setBaseUrl(this.baseUrl());
    this.api.setToken(this.token());
    this.testing.set(true);
    this.health.set(null);
    this.testError.set(null);
    this.failure.set(null);
    try {
      this.health.set(await firstValueFrom(this.api.health()));
      this.saved.emit();
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0);
      this.testError.set(err);
      this.failure.set(sentinelFailure(err));
    } finally {
      this.testing.set(false);
    }
  }
}
