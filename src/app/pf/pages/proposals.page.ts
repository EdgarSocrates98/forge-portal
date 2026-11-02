import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../pf-api.service';
import { PfProduct, PfTaskProposal } from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { ToastService } from '../../shared/toast';

@Component({
  selector: 'page-pf-proposals',
  standalone: true,
  imports: [FormsModule, PageHeader, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header [title]="'pf.proposals.title' | t" [subtitle]="'pf.proposals.subtitle' | t" />
    <section class="toolbar card">
      <label
        >{{ 'pf.proposals.product' | t }}
        <select [ngModel]="productId()" (ngModelChange)="select($event)">
          @for (p of products(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select>
      </label>
      <button class="btn btn--mini" (click)="load()">{{ 'pf.proposals.refresh' | t }}</button>
    </section>
    @if (error()) {
      <p class="bad" role="alert">{{ error() }}</p>
    }
    <div class="list">
      @for (proposal of pending(); track proposal.id) {
        <article class="card proposal">
          <div class="head">
            <div>
              <span class="eyebrow">{{ proposal.source || 'chat' }}</span>
              <h2>{{ proposal.tasks[0]?.title }}</h2>
            </div>
            <span class="state">{{ proposal.state }}</span>
          </div>
          @if (proposal.tasks[0]?.description) {
            <p class="muted">{{ proposal.tasks[0].description }}</p>
          }
          <div class="actions">
            <button class="btn btn--primary" (click)="approve(proposal)">
              {{ 'pf.proposals.approve' | t }}</button
            ><button class="btn btn--danger" (click)="reject(proposal)">
              {{ 'pf.proposals.reject' | t }}
            </button>
          </div>
        </article>
      } @empty {
        <section class="card empty">
          <h2>{{ 'pf.proposals.empty' | t }}</h2>
          <p class="muted">{{ 'pf.proposals.emptyHint' | t }}</p>
        </section>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .toolbar {
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      label {
        display: grid;
        gap: 0.35rem;
      }
      select {
        padding: 0.65rem 0.8rem;
        border: 1px solid var(--border);
        border-radius: 0.55rem;
        background: var(--surface);
        color: inherit;
        min-width: 16rem;
      }
      .list {
        display: grid;
        gap: 1rem;
      }
      .proposal {
        display: grid;
        gap: 0.75rem;
      }
      .head {
        display: flex;
        justify-content: space-between;
        gap: 1rem;
        align-items: start;
      }
      h2 {
        margin: 0.25rem 0 0;
        font-size: 1rem;
      }
      .eyebrow,
      .state {
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        opacity: 0.7;
      }
      .state {
        color: var(--accent, #b7f36b);
      }
      .actions {
        display: flex;
        gap: 0.5rem;
      }
      .empty {
        text-align: center;
        padding: 2rem;
      }
    `,
  ],
})
export class PfProposalsPage implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly products = signal<PfProduct[]>([]);
  readonly productId = signal('');
  readonly proposals = signal<PfTaskProposal[]>([]);
  readonly error = signal('');
  readonly pending = () => this.proposals().filter((p) => p.state === 'proposed');
  ngOnInit(): void {
    this.api.products().subscribe({
      next: (r) => {
        this.products.set(r.items);
        if (r.items[0]) this.select(r.items[0].id);
      },
      error: (e) => this.fail(e),
    });
  }
  select(id: string): void {
    this.productId.set(id);
    if (id) void this.load();
  }
  async load(): Promise<void> {
    if (!this.productId()) return;
    try {
      this.proposals.set((await firstValueFrom(this.api.taskProposals(this.productId()))).items);
      this.error.set('');
    } catch (e) {
      this.fail(e);
    }
  }
  async approve(p: PfTaskProposal): Promise<void> {
    await this.decide(p, true);
  }
  async reject(p: PfTaskProposal): Promise<void> {
    await this.decide(p, false);
  }
  private async decide(p: PfTaskProposal, approved: boolean): Promise<void> {
    try {
      if (approved) await firstValueFrom(this.api.approveTaskProposal(this.productId(), p.id));
      else await firstValueFrom(this.api.rejectTaskProposal(this.productId(), p.id));
      this.toast.show(
        approved ? 'Task created' : 'Proposal rejected',
        approved ? 'success' : 'info',
      );
      await this.load();
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown): void {
    this.error.set(e instanceof Error ? e.message : 'Unable to load proposals.');
  }
}
