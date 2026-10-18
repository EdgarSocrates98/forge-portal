import { Component, Injectable, OnDestroy, inject, signal } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';
import { TPipe } from '../core/i18n/i18n.pipe';

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
}

/** Max stacked toasts — the oldest is evicted beyond this. */
const MAX_TOASTS = 3;
/** Auto-dismiss per kind: errors linger longer so they can be read. */
const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 4500,
  info: 4500,
  error: 7000,
};

/**
 * Toast notifications — `toast.show('key.or.literal', 'success')` from
 * anywhere; `<ui-toast-outlet />` mounted once in the shell renders them.
 * `text` may be an i18n key (translated, interpolating `opts.params`) or
 * a literal: anything the dictionary doesn't know is shown verbatim —
 * `⟪key⟫` markers never leak into a toast.
 */
@Injectable({ providedIn: 'root' })
export class ToastService implements OnDestroy {
  private readonly i18n = inject(I18nService);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly _items = signal<ToastItem[]>([]);

  readonly items = this._items.asReadonly();

  /** Push a toast; returns its id for manual dismissal. */
  show(
    text: string,
    kind: ToastKind = 'info',
    opts?: { params?: Record<string, unknown> },
  ): number {
    const item: ToastItem = { id: this.nextId++, text: this.resolve(text, opts?.params), kind };
    const list = [...this._items(), item];
    while (list.length > MAX_TOASTS) {
      const evicted = list.shift();
      if (evicted) this.clearTimer(evicted.id);
    }
    this._items.set(list);
    this.timers.set(
      item.id,
      setTimeout(() => this.dismiss(item.id), AUTO_DISMISS_MS[kind]),
    );
    return item.id;
  }

  dismiss(id: number): void {
    this.clearTimer(id);
    this._items.update((list) => list.filter((t) => t.id !== id));
  }

  /** TestBed tears down the root injector between specs — no timer leaks. */
  ngOnDestroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private clearTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  /** Keys translate; literals (unknown to i18n) render verbatim. */
  private resolve(text: string, params?: Record<string, unknown>): string {
    const translated = this.i18n.t(text, coerceParams(params));
    return translated.startsWith('⟪') ? text : translated;
  }
}

/** i18n.t only interpolates string|number — drop or coerce the rest. */
function coerceParams(
  params?: Record<string, unknown>,
): Record<string, string | number> | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
    else if (typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/**
 * Toast outlet — mount once in the shell. Polite live region bottom-right;
 * error items additionally carry role="alert" so they announce assertively.
 * Escape drops the newest toast; each item has its own dismiss button.
 */
@Component({
  selector: 'ui-toast-outlet',
  standalone: true,
  imports: [TPipe],
  host: { '(document:keydown.escape)': 'dismissNewest()' },
  template: `
    <div class="toasts" role="region" aria-live="polite" [attr.aria-label]="'notify.region' | t">
      @for (item of toast.items(); track item.id) {
        <div
          class="toast"
          [attr.data-kind]="item.kind"
          [attr.role]="item.kind === 'error' ? 'alert' : null"
        >
          <p class="toast__text">{{ item.text }}</p>
          <button
            type="button"
            class="toast__close"
            [attr.aria-label]="'notify.dismiss' | t"
            (click)="toast.dismiss(item.id)"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      position: fixed;
      right: var(--space-4);
      bottom: var(--space-4);
      z-index: var(--z-toast, 120);
      pointer-events: none;
    }
    .toasts {
      display: grid;
      gap: var(--space-2);
      width: min(360px, calc(100vw - 2 * var(--space-4)));
    }
    .toast {
      display: flex;
      align-items: flex-start;
      gap: var(--space-3);
      padding: var(--space-3);
      padding-left: calc(var(--space-3) + 3px);
      background: color-mix(in srgb, var(--toast-c, var(--info)) 6%, var(--bg-elevated));
      border: 1px solid var(--border-strong);
      border-left: 3px solid var(--toast-c, var(--info));
      border-radius: var(--radius-lg);
      box-shadow: var(--elev-pop);
      color: var(--fg);
      pointer-events: auto;
      animation: toast-in var(--fg-motion-med) var(--ease-out) both;
    }
    .toast::before {
      content: '';
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-top: 6px;
      flex: none;
      background: var(--toast-c, var(--info));
      box-shadow: 0 0 0 3px color-mix(in srgb, var(--toast-c, var(--info)) 20%, transparent);
    }
    .toast[data-kind='success'] {
      --toast-c: var(--ok);
    }
    .toast[data-kind='error'] {
      --toast-c: var(--error);
    }
    .toast__text {
      flex: 1;
      margin: 0;
      font-size: var(--font-sm);
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .toast__close {
      display: grid;
      place-items: center;
      width: 26px;
      height: 26px;
      flex: none;
      padding: 0;
      border: 0;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--fg-muted);
      font-size: 1rem;
      line-height: 1;
      cursor: pointer;
      transition:
        color var(--motion-fast),
        background var(--motion-fast);
    }
    .toast__close:hover {
      color: var(--fg);
      background: var(--bg-hover);
    }
    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(8px) scale(0.98);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      /* data-motion='full' is the user's explicit opt-out (tokens.css) */
      :host-context(html:not([data-motion='full'])) .toast {
        animation: none;
      }
    }
  `,
})
export class UiToastOutlet {
  protected readonly toast = inject(ToastService);

  /** Escape drops the newest toast (bottom of the stack). */
  protected dismissNewest(): void {
    const items = this.toast.items();
    const last = items[items.length - 1];
    if (last) this.toast.dismiss(last.id);
  }
}
