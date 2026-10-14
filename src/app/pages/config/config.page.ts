import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { AccountEnvironment, AccountEnvironmentVariable } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ErrorState } from '../../shared/error-state';
import { EmptyState } from '../../shared/empty-state';
import { UiIcon } from '../../shared/icon';
import { UiSkeleton } from '../../shared/skeleton';
import { ToastService } from '../../shared/toast';

/**
 * Configuration Center — the account environment exactly as the
 * adapter reports it (forge/InstallEnvironment/v1). The backend has no
 * env-write op, so "apply via portal" is rendered as an explicitly
 * unverified capability: the supported route is the copyable shell
 * command the user runs herself. Values are never shown — the
 * contract only exposes `path`, and only when the variable is set.
 */
@Component({
  selector: 'page-config',
  standalone: true,
  imports: [RouterLink, TPipe, PageHeader, StateBadge, ErrorState, EmptyState, UiIcon, UiSkeleton],
  template: `
    <ui-page-header [title]="'config.title' | t" [subtitle]="'config.subtitle' | t">
      <button class="btn" [disabled]="loading()" (click)="load()">
        <ui-icon name="refresh" [size]="15" />
        {{ 'state.refresh' | t }}
      </button>
    </ui-page-header>

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading() && !env()) {
      <section class="card" role="status" aria-live="polite">
        <ui-skeleton kind="card" [lines]="4" />
      </section>
    }

    @if (env(); as data) {
      <section class="card" aria-labelledby="env-h">
        <div class="card__heading">
          <h2 id="env-h">{{ 'dashboard.accountEnvironment' | t }}</h2>
          <ui-state-badge [state]="data.state" />
        </div>
        <dl class="kv">
          <div>
            <dt>{{ 'config.env.prefix' | t }}</dt>
            <dd>
              <code>{{ data.prefix }}</code>
            </dd>
          </div>
          <div>
            <dt>{{ 'config.env.scope' | t }}</dt>
            <dd>{{ data.scope }}</dd>
          </div>
          <div>
            <dt>{{ 'config.env.aliases' | t }}</dt>
            <dd>{{ (data.windows_aliases ? 'state.yes' : 'state.no') | t }}</dd>
          </div>
        </dl>

        @if (missingRequired().length) {
          <p class="env-alert" role="alert">
            <ui-icon name="alert" [size]="15" />
            {{ 'config.alert.missing' | t: { count: missingRequired().length } }}
          </p>
        }

        @if (data.variables.length) {
          <table class="table env-table">
            <thead>
              <tr>
                <th>{{ 'config.col.name' | t }}</th>
                <th>{{ 'config.col.required' | t }}</th>
                <th>{{ 'config.col.present' | t }}</th>
                <th>{{ 'config.col.valid' | t }}</th>
                <th>{{ 'config.col.kind' | t }}</th>
                <th>{{ 'config.col.path' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (v of data.variables; track v.name) {
                <tr
                  [attr.data-missing]="(v.required && !v.present) || null"
                  [attr.data-invalid]="v.valid === false || null"
                >
                  <td>
                    <code>{{ v.name }}</code>
                  </td>
                  <td>{{ (v.required ? 'state.required' : 'state.optional') | t }}</td>
                  <td>{{ (v.present ? 'state.yes' : 'state.no') | t }}</td>
                  <td>
                    @if (v.valid === null) {
                      <ui-state-badge state="unverified" />
                    } @else if (v.valid) {
                      {{ 'state.yes' | t }}
                    } @else {
                      <ui-state-badge state="INVALID" />
                    }
                  </td>
                  <td>{{ v.kind }}</td>
                  <td>
                    @if (v.path) {
                      <code class="path">{{ v.path }}</code>
                    } @else {
                      <span class="muted">{{ 'environmentState.UNSET' | t }}</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty [title]="'empty.noData' | t" [hint]="'empty.noData.hint' | t" />
        }
      </section>

      <section class="card prepare" aria-labelledby="prepare-h">
        <h2 id="prepare-h">{{ 'config.prepare.title' | t }}</h2>
        <p class="muted">{{ 'config.prepare.hint' | t }}</p>
        @for (v of attention(); track v.name) {
          <div class="prep">
            <code class="prep__name">{{ v.name }}</code>
            <div class="prep__cmds">
              <div class="cmd">
                <span class="cmd__shell">PowerShell</span>
                <code class="cmd__text">{{ psCommand(v.name) }}</code>
                <button
                  class="btn btn--mini"
                  [attr.aria-label]="'state.copy' | t"
                  (click)="copy(psCommand(v.name))"
                >
                  <ui-icon name="copy" [size]="13" />
                  {{ 'state.copy' | t }}
                </button>
              </div>
              <div class="cmd">
                <span class="cmd__shell">bash</span>
                <code class="cmd__text">{{ shCommand(v.name) }}</code>
                <button
                  class="btn btn--mini"
                  [attr.aria-label]="'state.copy' | t"
                  (click)="copy(shCommand(v.name))"
                >
                  <ui-icon name="copy" [size]="13" />
                  {{ 'state.copy' | t }}
                </button>
              </div>
            </div>
          </div>
        } @empty {
          <p class="muted">{{ 'config.prepare.none' | t }}</p>
        }
      </section>

      <section class="card" aria-labelledby="apply-h">
        <h2 id="apply-h">{{ 'config.apply.title' | t }}</h2>
        <ul class="capability">
          <li>
            <ui-state-badge state="unverified" />
            <span class="capability__body">
              <strong>{{ 'config.apply.portal' | t }}</strong>
              <small class="muted">{{ 'config.apply.unsupported' | t }}</small>
            </span>
          </li>
        </ul>
        <a class="btn" routerLink="/profiles">
          <ui-icon name="profiles" [size]="15" />
          {{ 'config.profiles.link' | t }}
        </a>
        <p class="muted">{{ 'config.profiles.hint' | t }}</p>
      </section>
    }
  `,
  styles: `
    .card {
      margin-bottom: var(--space-4);
    }
    .card h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
      letter-spacing: -0.01em;
    }
    .card__heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      margin-bottom: var(--space-3);
    }
    .card__heading h2 {
      margin: 0;
    }
    .kv {
      display: grid;
      gap: 6px;
      margin: 0 0 var(--space-3);
    }
    .kv div {
      display: flex;
      gap: var(--space-2);
    }
    .kv dt {
      color: var(--fg-muted);
      min-width: 140px;
    }
    .kv dd {
      margin: 0;
      font-weight: 550;
    }
    .env-alert {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      margin: 0 0 var(--space-3);
      padding: var(--space-2) var(--space-3);
      border: 1px solid color-mix(in srgb, var(--warn) 45%, transparent);
      border-left-width: 3px;
      border-radius: var(--radius-md);
      background: var(--warn-bg);
      color: var(--warn);
      font-weight: 550;
    }
    .env-table {
      margin-top: var(--space-2);
    }
    .env-table code {
      font-family: var(--font-mono);
      font-size: var(--font-xs);
    }
    .env-table .path {
      overflow-wrap: anywhere;
      word-break: break-all;
    }
    .env-table tr[data-missing] {
      background: color-mix(in srgb, var(--warn) 8%, transparent);
    }
    .env-table tr[data-missing] td:first-child {
      border-left: 3px solid var(--warn);
    }
    .env-table tr[data-invalid] {
      background: color-mix(in srgb, var(--error) 7%, transparent);
    }
    .env-table tr[data-invalid] td:first-child {
      border-left: 3px solid var(--error);
    }
    .prep {
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      margin-bottom: var(--space-2);
      display: grid;
      gap: var(--space-2);
    }
    .prep__name {
      font-weight: 650;
      overflow-wrap: anywhere;
    }
    .prep__cmds {
      display: grid;
      gap: var(--space-2);
    }
    .cmd {
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-2) var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg);
    }
    .cmd__shell {
      flex: none;
      font-size: var(--font-xs);
      font-weight: 700;
      color: var(--fg-muted);
      text-transform: uppercase;
      letter-spacing: 0.04em;
      min-width: 76px;
    }
    .cmd__text {
      flex: 1;
      min-width: 0;
      font-family: var(--font-mono);
      font-size: var(--font-xs);
      overflow-wrap: anywhere;
    }
    .btn--mini {
      padding: 2px var(--space-2);
      font-size: var(--font-xs);
      gap: 4px;
      flex: none;
    }
    .capability {
      list-style: none;
      padding: 0;
      margin: 0 0 var(--space-3);
      display: grid;
      gap: var(--space-2);
    }
    .capability li {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-3);
      border: 1px dashed var(--border);
      border-radius: var(--radius-md);
    }
    .capability__body {
      display: grid;
      gap: 2px;
    }
    .capability__body small {
      color: var(--fg-muted);
    }
    .muted {
      color: var(--fg-muted);
    }
    a.btn {
      display: inline-flex;
      text-decoration: none;
    }
  `,
})
export class ConfigPage {
  private readonly api = inject(PortalApi);
  private readonly toast = inject(ToastService);

  readonly env = signal<AccountEnvironment | null>(null);
  readonly error = signal<ApiError | null>(null);
  readonly loading = signal(true);

  /** Vars needing attention — absent entirely, or present but the path
   *  fails the kind check (directory/file). `valid === null` means the
   *  backend could not verify; it is not counted as invalid here. */
  readonly attention = computed(() =>
    (this.env()?.variables ?? []).filter((v) => !v.present || v.valid === false),
  );
  readonly missingRequired = computed(() =>
    (this.env()?.variables ?? []).filter((v) => v.required && (!v.present || v.valid === false)),
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.env.set(await firstValueFrom(this.api.accountEnvironment()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  psCommand(name: string): string {
    return `[Environment]::SetEnvironmentVariable('${name}', '', 'User')`;
  }

  shCommand(name: string): string {
    return `export ${name}=`;
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show('state.copied', 'success');
    } catch {
      this.toast.show('error.generic', 'error');
    }
  }
}
