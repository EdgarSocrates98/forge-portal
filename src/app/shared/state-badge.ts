import { Component, computed, inject, input } from '@angular/core';
import { I18nService } from '../core/i18n/i18n.service';

type BadgeKind = 'ok' | 'warn' | 'error' | 'info' | 'muted';

const STATE_KIND: Record<string, BadgeKind> = {
  // install states
  VERIFIED: 'ok',
  ACTIVE: 'ok',
  CONFIGURED: 'ok',
  INSTALLED: 'info',
  DEGRADED: 'warn',
  BLOCKED: 'warn',
  NOT_INSTALLED: 'muted',
  FAILED: 'error',
  // mcp states
  INVOCATION_VERIFIED: 'ok',
  HANDSHAKE_VERIFIED: 'ok',
  TOOLS_DISCOVERED: 'ok',
  STARTING: 'info',
  NOT_CONFIGURED: 'muted',
  // capability states
  supported: 'ok',
  unverified: 'warn',
  unsupported: 'error',
  not_applicable: 'muted',
  // generic
  ok: 'ok',
  warn: 'warn',
  error: 'error',
  info: 'info',
  muted: 'muted',
};

const I18N_PREFIX: Record<string, string> = {
  VERIFIED: 'installState.',
  ACTIVE: 'installState.',
  CONFIGURED: 'installState.',
  INSTALLED: 'installState.',
  DEGRADED: 'installState.',
  BLOCKED: 'installState.',
  NOT_INSTALLED: 'installState.',
  FAILED: 'installState.',
  INVOCATION_VERIFIED: 'mcpState.',
  HANDSHAKE_VERIFIED: 'mcpState.',
  TOOLS_DISCOVERED: 'mcpState.',
  STARTING: 'mcpState.',
  NOT_CONFIGURED: 'mcpState.',
  supported: 'state.supported',
  unverified: 'state.unverified',
  unsupported: 'state.unsupported',
  not_applicable: 'state.notApplicable',
};

/** Badge semântico — mapeia qualquer estado do contrato para tom+label i18n. */
@Component({
  selector: 'ui-state-badge',
  standalone: true,
  template: `<span class="badge" [attr.data-kind]="kind()" role="status">{{ label() }}</span>`,
  styles: `
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 2px 10px;
      border-radius: var(--radius-pill);
      font-size: var(--font-xs);
      font-weight: 600;
      letter-spacing: 0.01em;
      border: 1px solid var(--badge-fg, var(--fg-muted));
      color: var(--badge-fg, var(--fg-muted));
      background: var(--badge-bg, transparent);
      white-space: nowrap;
    }
    .badge::before {
      content: '';
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--badge-fg, var(--fg-muted));
    }
    .badge[data-kind='ok'] {
      --badge-fg: var(--ok);
      --badge-bg: var(--ok-bg);
    }
    .badge[data-kind='warn'] {
      --badge-fg: var(--warn);
      --badge-bg: var(--warn-bg);
    }
    .badge[data-kind='error'] {
      --badge-fg: var(--error);
      --badge-bg: var(--error-bg);
    }
    .badge[data-kind='info'] {
      --badge-fg: var(--info);
      --badge-bg: var(--info-bg);
    }
  `,
})
export class StateBadge {
  private readonly i18n = inject(I18nService);
  readonly state = input.required<string>();
  readonly labelOverride = input<string | null>(null);

  readonly kind = computed<BadgeKind>(() => STATE_KIND[this.state()] ?? 'muted');
  readonly label = computed(() => {
    const override = this.labelOverride();
    if (override) return override;
    const state = this.state();
    const i18nKey = I18N_PREFIX[state];
    if (i18nKey === undefined) return state;
    return i18nKey.endsWith('.') ? this.i18n.t(`${i18nKey}${state}`) : this.i18n.t(i18nKey);
  });
}
