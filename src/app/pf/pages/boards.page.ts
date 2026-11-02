import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { PfApi } from '../pf-api.service';
import { PfBoard, PfProduct } from '../pf.models';
import { PageHeader } from '../../shared/page-header';
import { ToastService } from '../../shared/toast';
import { TPipe } from '../../core/i18n/i18n.pipe';

@Component({
  selector: 'page-pf-boards',
  standalone: true,
  imports: [FormsModule, PageHeader, TPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-page-header [title]="'pf.boards.title' | t" [subtitle]="'pf.boards.subtitle' | t" />
    @if (error()) {
      <p class="bad" role="alert">{{ error() }}</p>
    }
    <section class="toolbar card">
      <label
        >{{ 'pf.boards.product' | t }}
        <select [ngModel]="productId()" (ngModelChange)="select($event)">
          @for (p of products(); track p.id) {
            <option [value]="p.id">{{ p.name }}</option>
          }
        </select></label
      >
      <form (submit)="create($event)">
        <input
          name="title"
          [(ngModel)]="newTitle"
          placeholder="Nova tarefa"
          required
        /><button class="btn btn--primary">
          {{ 'pf.boards.add' | t }}
        </button>
      </form>
    </section>
    @if (board(); as b) {
      <div class="board-grid">
        @for (lane of b.board.columns; track lane.id) {
          <section class="card lane">
            <header>
              <h2>{{ lane.name }}</h2>
              <span>{{ tasksIn(lane.id).length }}</span>
            </header>
            @for (task of tasksIn(lane.id); track task.id) {
              <article class="task">
                <strong>{{ task.title }}</strong>
                <small>{{ task.priority || 'medium' }} · {{ task.type || 'task' }}</small>
                <button class="btn btn--mini" (click)="advance(task.id, lane.id)">
                  Mover adiante
                </button>
              </article>
            }
            @if (!tasksIn(lane.id).length) {
              <p class="muted">{{ 'pf.boards.emptyLane' | t }}</p>
            }
          </section>
        }
      </div>
    } @else {
      <p class="muted">{{ error() || ('pf.boards.noProduct' | t) }}</p>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .toolbar {
        display: flex;
        gap: 1rem;
        justify-content: space-between;
        align-items: end;
        margin-bottom: 1rem;
      }
      label {
        display: grid;
        gap: 0.35rem;
      }
      select,
      input {
        padding: 0.65rem 0.8rem;
        border-radius: 0.55rem;
        border: 1px solid var(--border, #334);
        background: var(--surface, #101525);
        color: inherit;
      }
      form {
        display: flex;
        gap: 0.5rem;
      }
      .board-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 1rem;
      }
      .lane {
        min-height: 13rem;
      }
      .lane header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--border, #334);
        margin-bottom: 0.75rem;
      }
      .lane h2 {
        font-size: 0.9rem;
      }
      .lane header span {
        color: var(--accent, #b7f36b);
      }
      article {
        display: grid;
        gap: 0.25rem;
        padding: 0.75rem;
        margin: 0.5rem 0;
        border-radius: 0.6rem;
        background: color-mix(in srgb, var(--surface, #101525) 75%, white 5%);
      }
      .task button {
        justify-self: start;
      }
      small,
      .muted {
        opacity: 0.7;
      }
      @media (max-width: 900px) {
        .board-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
      @media (max-width: 600px) {
        .toolbar {
          display: grid;
        }
        .board-grid {
          grid-template-columns: 1fr;
        }
        form {
          display: grid;
        }
      }
    `,
  ],
})
export class PfBoardsPage implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly products = signal<PfProduct[]>([]);
  readonly productId = signal('');
  readonly board = signal<PfBoard | null>(null);
  readonly error = signal('');
  newTitle = '';

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
    if (id)
      this.api
        .board(id)
        .subscribe({ next: (r) => this.board.set(r), error: (e) => this.fail(e) });
  }
  create(ev: Event): void {
    ev.preventDefault();
    const id = this.productId();
    if (!id || !this.newTitle.trim()) return;
    this.api.createTask(id, { title: this.newTitle.trim() }).subscribe({
      next: () => {
        this.newTitle = '';
        this.select(id);
        this.toast.show('Iniciativa criada', 'success');
      },
      error: (e) => this.fail(e),
    });
  }
  tasksIn(columnId: string) {
    return (this.board()?.tasks || []).filter((task) => task.column_id === columnId);
  }
  advance(taskId: string, currentColumn: string): void {
    const columns = this.board()?.board.columns || [];
    const next = columns[columns.findIndex((column) => column.id === currentColumn) + 1];
    if (!next || !this.productId()) return;
    this.api.moveTask(this.productId(), taskId, next.id).subscribe({
      next: () => this.select(this.productId()),
      error: (e) => this.fail(e),
    });
  }
  private fail(e: unknown): void {
    this.error.set(e instanceof Error ? e.message : 'Não foi possível carregar o board.');
  }
}
