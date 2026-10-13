import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { PortalApi } from '../../core/api/api.client';
import { ApiError } from '../../core/api/api.error';
import { SkillDescriptor } from '../../core/api/api.models';
import { TPipe } from '../../core/i18n/i18n.pipe';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { UiIcon } from '../../shared/icon';

@Component({
  selector: 'page-skills',
  standalone: true,
  imports: [FormsModule, TPipe, PageHeader, StateBadge, EmptyState, ErrorState, UiIcon],
  template: `
    <ui-page-header [title]="'skills.title' | t" [subtitle]="'skills.subtitle' | t" />

    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div class="skeleton skeleton--block"></div>
    }

    @if (skills().length) {
      <div class="search-field">
        <ui-icon name="search" [size]="15" />
        <input
          class="input"
          type="search"
          [placeholder]="'skills.search' | t"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          [attr.aria-label]="'skills.search' | t"
        />
      </div>
      <div class="card card--table">
        <table class="table">
          <thead>
            <tr>
              <th>{{ 'table.id' | t }}</th>
              <th>{{ 'skills.domain' | t }}</th>
              <th>{{ 'skills.state' | t }}</th>
              <th>{{ 'skills.hosts' | t }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of filtered(); track s.id) {
              <tr>
                <td>
                  <strong>{{ s.id }}</strong>
                  <p class="muted">{{ s.description }}</p>
                </td>
                <td>{{ s.domain ?? '—' }}</td>
                <td><ui-state-badge [state]="mapState(s.state)" [labelOverride]="s.state" /></td>
                <td>{{ s.hosts.join(', ') || '—' }}</td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr>
                  <td colspan="4"><ui-empty icon="skills" [title]="'skills.empty' | t" /></td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
    } @else if (!error() && !loading()) {
      <ui-empty icon="skills" [title]="'skills.none' | t" />
    }
  `,
  styles: `
    .muted {
      color: var(--fg-muted);
      margin: 4px 0 0;
      font-size: var(--font-sm);
    }
    .card--table {
      padding: var(--space-3);
      overflow-x: auto;
    }
    .card--table .table {
      min-width: 560px;
    }
  `,
})
export class SkillsPage {
  private readonly api = inject(PortalApi);
  readonly skills = signal<SkillDescriptor[]>([]);
  readonly error = signal<ApiError | null>(null);
  readonly query = signal('');
  readonly loading = signal(true);

  readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.skills();
    return this.skills().filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        (s.domain ?? '').toLowerCase().includes(q),
    );
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      this.skills.set(await firstValueFrom(this.api.skills()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  mapState(state: string): string {
    return ['invoked', 'available', 'installed', 'registered'].includes(state)
      ? 'supported'
      : state === 'unverified'
        ? 'unverified'
        : 'not_applicable';
  }
}
