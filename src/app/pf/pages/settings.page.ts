import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { PfApi, PF_DEFAULT_BASE_URL } from '../pf-api.service';
import { ApiError } from '../../core/api/api.error';
import { PfHealth } from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

/**
 * Engine settings — the connection profile for the Product Forge engine.
 * `pf.baseUrl` and `pf.token` persist to localStorage via PfApi; the
 * bearer is sent on every engine call (all routes except /health are
 * private). The test button performs a real GET /health — a 401 on
 * private routes after that means the token, not the URL, is wrong.
 */
@Component({
  selector: 'page-pf-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [RouterLink, PageHeader, StateBadge, UiSkeleton, TPipe],
  template: `
    <ui-page-header
      title="Engine settings"
      subtitle="Where the Product Forge engine lives and how the Studio authenticates."
    />

    <section class="card">
      <h2>{{ 'pf.settings.connection' | t }}</h2>
      <form class="stack" (submit)="save($event)">
        <label class="field">
          <span>{{ 'pf.settings.baseURL' | t }}</span>
          <input
            class="input mono"
            [value]="baseUrl()"
            (input)="baseUrl.set($any($event.target).value)"
            [placeholder]="defaultUrl"
            spellcheck="false"
          />
          <small class="muted"
            >The engine serves <code>/api/v1</code> from this origin — e.g.
            <code>{{ defaultUrl }}</code> (<code>productforge api serve</code>).</small
          >
        </label>
        <label class="field">
          <span>{{ 'pf.settings.apiToken' | t }}</span>
          <input
            class="input mono"
            type="password"
            [value]="token()"
            (input)="token.set($any($event.target).value)"
            placeholder="productforge api token --show"
            autocomplete="off"
            spellcheck="false"
          />
          <small class="muted"
            >Sent as <code>Authorization: Bearer …</code> on every private route. Stored in this
            browser only (<code>pf.token</code>).</small
          >
        </label>
        <div class="fg-row">
          <button class="btn btn--primary" type="submit">{{ 'pf.settings.save' | t }}</button>
          <button class="btn" type="button" [disabled]="testing()" (click)="test()">
            {{ testing() ? 'Testing…' : 'Test connection' }}
          </button>
        </div>
      </form>
    </section>

    <section class="card">
      <h2>{{ 'pf.settings.status' | t }}</h2>
      @if (testing()) {
        <div role="status" aria-label="testing"><ui-skeleton kind="text" [lines]="2" /></div>
      } @else if (health(); as h) {
        <dl class="kv">
          <div>
            <dt>{{ 'pf.settings.health' | t }}</dt>
            <dd>
              <ui-state-badge
                [state]="h.status === 'healthy' ? 'ok' : 'warn'"
                [labelOverride]="h.status"
              />
            </dd>
          </div>
          <div>
            <dt>{{ 'pf.settings.forge' | t }}</dt>
            <dd>
              {{ h.forge_id }} <code>v{{ h.version }}</code>
            </dd>
          </div>
          @if (h.uptime_s !== undefined) {
            <div>
              <dt>{{ 'pf.settings.uptime' | t }}</dt>
              <dd>{{ h.uptime_s }}s</dd>
            </div>
          }
          <div>
            <dt>{{ 'pf.settings.token' | t }}</dt>
            <dd>
              @if (api.token()) {
                <ui-state-badge state="ok" labelOverride="configured" />
              } @else {
                <ui-state-badge state="warn" labelOverride="not set — private routes will 401" />
              }
            </dd>
          </div>
        </dl>
      } @else if (testError(); as e) {
        <div class="fail" role="alert">
          <ui-state-badge
            [state]="e.transport ? 'error' : 'warn'"
            [labelOverride]="e.transport ? 'unreachable' : e.body.code"
          />
          <p>{{ e.body.message }}</p>
          @if (!e.transport && e.status === 0) {
            <p class="muted small">
              A CORS or mixed-content refusal reaches the app as a network failure — check the
              engine's CORS policy for this origin.
            </p>
          }
        </div>
      } @else {
        <p class="muted">{{ 'pf.settings.notTestedYetSaveThen' | t }}</p>
      }
    </section>

    <p class="muted small back">
      <a routerLink="/pf">{{ 'pf.settings.backToProductForgeStudio' | t }}</a>
    </p>
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
      max-width: 44rem;
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
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
    }
    .mono {
      font-family: var(--font-mono);
      font-size: var(--font-sm);
    }
    .kv {
      display: grid;
      gap: var(--space-2);
      margin: 0;
    }
    .kv div {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .kv dt {
      min-width: 6rem;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      flex: none;
    }
    .kv dd {
      margin: 0;
    }
    .fail {
      display: grid;
      gap: var(--space-2);
    }
    .fail p {
      margin: 0;
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .back a {
      text-decoration: none;
    }
  `,
})
export class PfSettingsPage {
  readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);

  readonly defaultUrl = PF_DEFAULT_BASE_URL;
  readonly baseUrl = signal(this.api.baseUrl());
  readonly token = signal(this.api.token());
  readonly testing = signal(false);
  readonly health = signal<PfHealth | null>(null);
  readonly testError = signal<ApiError | null>(null);

  save(ev: Event): void {
    ev.preventDefault();
    this.api.setBaseUrl(this.baseUrl());
    this.api.setToken(this.token());
    this.toast.show('Engine settings saved', 'success');
  }

  async test(): Promise<void> {
    // Apply the form first — testing must hit the values on screen, not
    // whatever was persisted before.
    this.api.setBaseUrl(this.baseUrl());
    this.api.setToken(this.token());
    this.testing.set(true);
    this.health.set(null);
    this.testError.set(null);
    try {
      this.health.set(await firstValueFrom(this.api.health()));
    } catch (e) {
      this.testError.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.testing.set(false);
    }
  }
}
