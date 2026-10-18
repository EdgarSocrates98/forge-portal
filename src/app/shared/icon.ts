import { Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { PATHS, iconPath } from './icon-paths';

export { iconPath };

/**
 * Inline stroke icon set (24×24, lucide-style). Icons are compile-time
 * constants authored in this file — bypassing the sanitizer is safe
 * because no user input ever reaches the markup.
 *
 * `<ui-icon name="skills" />` inherits `currentColor` and sizes to 1em
 * by default; use the `size` input (px) for explicit control.
 */

@Component({
  selector: 'ui-icon',
  standalone: true,
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    [attr.stroke-width]="strokeWidth()"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    [style.width.px]="size()"
    [style.height.px]="size()"
    [innerHTML]="svg()"
  ></svg>`,
  styles: `
    :host {
      display: inline-flex;
      flex-shrink: 0;
      line-height: 0;
    }
  `,
})
export class UiIcon {
  private readonly sanitizer = inject(DomSanitizer);
  readonly name = input.required<string>();
  readonly size = input(18);
  readonly strokeWidth = input(1.75);

  readonly svg = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(PATHS[this.name()] ?? PATHS['dashboard']),
  );
}
