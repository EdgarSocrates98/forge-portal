import {
  Component,
  ElementRef,
  Injectable,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';

export interface ConfirmOptions {
  /** i18n key or literal — unknown keys render verbatim. */
  title: string;
  /** i18n key or literal — unknown keys render verbatim. */
  message: string;
  /** i18n key or literal for the accept button (default `state.confirm`). */
  confirmKey?: string;
  /** i18n key or literal for the cancel button (default `state.cancel`). */
  cancelKey?: string;
  /** Danger styling (var(--error)) + initial focus lands on Cancel. */
  danger?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

/**
 * Promise-based confirm — `const ok = await confirm.ask({...})` resolves
 * true (confirm) or false (cancel/Escape/backdrop). `<ui-confirm-host />`
 * must be mounted once in the shell or the promise never settles.
 * A second `ask` while one is open cancels it (resolves false) — dialogs
 * never stack.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private readonly _pending = signal<PendingConfirm | null>(null);
  readonly pending = this._pending.asReadonly();

  ask(opts: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this._pending()?.resolve(false);
      this._pending.set({ ...opts, resolve });
    });
  }

  /** Called by the host once the user decides; no-op when idle. */
  settle(ok: boolean): void {
    const p = this._pending();
    if (!p) return;
    this._pending.set(null);
    p.resolve(ok);
  }
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Confirm host — modal dialog with focus trap, Escape/backdrop cancel and
 * focus restoration to the element focused before the dialog opened.
 */
@Component({
  selector: 'ui-confirm-host',
  standalone: true,
  host: { '(document:keydown.escape)': 'cancel()' },
  template: `
    @if (confirm.pending(); as p) {
      <div class="cd" (click)="cancel()">
        <div
          #panel
          class="cd__panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ui-confirm-title"
          aria-describedby="ui-confirm-desc"
          tabindex="-1"
          (click)="$event.stopPropagation()"
          (keydown)="onKeydown($event)"
        >
          <h2 id="ui-confirm-title" class="cd__title">{{ text(p.title) }}</h2>
          <p id="ui-confirm-desc" class="cd__msg">{{ text(p.message) }}</p>
          <div class="cd__actions">
            <button type="button" class="btn" (click)="cancel()">
              {{ text(p.cancelKey ?? 'state.cancel') }}
            </button>
            <button
              type="button"
              class="btn"
              [class.btn--primary]="!p.danger"
              [class.cd__danger]="!!p.danger"
              (click)="accept()"
            >
              {{ text(p.confirmKey ?? 'state.confirm') }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .cd {
      position: fixed;
      inset: 0;
      z-index: var(--z-dialog, 100);
      display: grid;
      place-items: center;
      padding: var(--space-4);
      background: var(--scrim);
    }
    .cd__panel {
      width: min(26rem, 100%);
      padding: var(--space-5);
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--elev-pop);
      animation: cd-in var(--fg-motion-med) var(--ease-out) both;
    }
    .cd__panel:focus {
      outline: none;
    }
    .cd__title {
      margin: 0 0 var(--space-2);
      font-size: var(--font-lg);
    }
    .cd__msg {
      margin: 0;
      color: var(--fg-muted);
      font-size: var(--font-sm);
      max-width: 60ch;
    }
    .cd__actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
      margin-top: var(--space-5);
    }
    .cd__danger {
      background: var(--error);
      border-color: var(--error);
      color: var(--on-color);
    }
    .cd__danger:hover {
      background: color-mix(in srgb, var(--error) 86%, black);
      border-color: color-mix(in srgb, var(--error) 86%, black);
      box-shadow: 0 2px 10px color-mix(in srgb, var(--error) 40%, transparent);
    }
    @keyframes cd-in {
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
      :host-context(html:not([data-motion='full'])) .cd__panel {
        animation: none;
      }
    }
  `,
})
export class UiConfirmHost {
  protected readonly confirm = inject(ConfirmService);
  private readonly i18n = inject(I18nService);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  private isOpen = false;
  private prevFocus: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const open = this.confirm.pending() !== null;
      if (open && !this.isOpen) {
        this.isOpen = true;
        this.prevFocus = document.activeElement as HTMLElement | null;
        // after the DOM has settled — mirrors the command-palette focus pattern
        setTimeout(() => this.focusInitial());
      } else if (!open && this.isOpen) {
        this.isOpen = false;
        const prev = this.prevFocus;
        this.prevFocus = null;
        setTimeout(() => {
          if (prev?.isConnected) prev.focus();
        });
      }
    });
  }

  /** Keys translate; literals (unknown to i18n) render verbatim. */
  protected text(value: string): string {
    const translated = this.i18n.t(value);
    return translated.startsWith('⟪') ? value : translated;
  }

  protected accept(): void {
    this.confirm.settle(true);
  }

  protected cancel(): void {
    this.confirm.settle(false);
  }

  protected onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      // stop before document-level Escape handlers — settle exactly once
      e.preventDefault();
      e.stopPropagation();
      this.cancel();
      return;
    }
    if (e.key !== 'Tab') return;
    const el = this.panel()?.nativeElement;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (n) => !n.hasAttribute('disabled'),
    );
    if (items.length === 0) {
      e.preventDefault();
      el.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const atBoundary = e.shiftKey
      ? active === first || !el.contains(active)
      : active === last || !el.contains(active);
    if (atBoundary) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  }

  /** Danger dialogs land on Cancel; others on the primary action. */
  private focusInitial(): void {
    const el = this.panel()?.nativeElement;
    if (!el) return;
    const buttons = el.querySelectorAll<HTMLElement>('.cd__actions .btn');
    const target = this.confirm.pending()?.danger ? buttons[0] : buttons[buttons.length - 1];
    (target ?? el).focus();
  }
}
