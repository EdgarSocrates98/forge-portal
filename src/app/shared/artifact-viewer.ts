import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MdLitePipe } from './md-lite.pipe';
import { UiIcon } from './icon';

/**
 * Artifact viewer (Cycle 22.1) — type-aware, script-free rendering.
 * markdown→rendered · json/yaml→pretty mono · csv→table · sql/py→mono ·
 * diff→colored lines · html→escaped source · image→img · binary→download.
 * Never injects agent HTML — the honesty rule is structural.
 */
@Component({
  selector: 'ui-artifact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [MdLitePipe, UiIcon],
  template: `
    <div class="av" [attr.data-kind]="kind()">
      @switch (kind()) {
        @case ('markdown') { <div class="md" [innerHTML]="text() | mdLite"></div> }
        @case ('csv') {
          <table>
            @for (row of csvRows(); track $index) {
              <tr>
                @for (c of row; track $index) {
                  @if ($first) { <th scope="col">{{ c }}</th> }
                  @else { <td>{{ c }}</td> }
                }
              </tr>
            }
          </table>
        }
        @case ('diff') {
          <pre class="diff"><code>@for (l of diffLines(); track $index) {
            <span [attr.data-s]="l.s">{{ l.t }}</span>
          }</code></pre>
        }
        @case ('image') {
          @if (src()) { <img [src]="src()" [alt]="name()" /> }
          @else { <p class="muted">image — download to view</p> }
        }
        @case ('binary') {
          <div class="bin">
            <ui-icon name="folder" />
            <p>{{ name() || 'binary artifact' }}</p>
            <p class="muted">preview not rendered — use download</p>
            @if (downloadHref()) {
              <a class="btn btn--mini" [href]="downloadHref()" [download]="name()">download</a>
            }
          </div>
        }
        @default {
          <pre class="code" [attr.data-lang]="kind()"><code>{{ text() }}</code></pre>
        }
      }
      @if (truncated()) { <p class="muted small">preview truncated</p> }
    </div>
  `,
  styles: `
    .av { display: block; }
    .code, .diff { font-family: var(--font-mono); font-size: var(--font-xs);
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 6px; padding: var(--space-2); overflow-x: auto;
      white-space: pre; margin: 0; }
    .diff span { display: block; }
    .diff span[data-s='+'] { color: var(--ok, #22c55e); }
    .diff span[data-s='-'] { color: var(--error); }
    .diff span[data-s='@'] { color: var(--fg-muted); }
    table { border-collapse: collapse; font-size: var(--font-xs); width: 100%; }
    th, td { border: 1px solid var(--border); padding: 2px var(--space-2);
      text-align: left; }
    th { background: var(--bg-hover); font-weight: 600; }
    img { max-width: 100%; border-radius: 6px; }
    .bin { display: grid; gap: var(--space-2); justify-items: center;
      padding: var(--space-4); }
    .bin p { margin: 0; }
    .muted { color: var(--fg-muted); }
    .small { font-size: var(--font-xs); }
  `,
})
export class ArtifactViewer {
  /** Renderer kind (text|markdown|json|yaml|csv|sql|python|diff|html|image|binary). */
  readonly kind = input.required<string>();
  readonly text = input<string>('');
  readonly name = input<string>('');
  readonly truncated = input(false);
  readonly src = input<string | null>(null);        // data-URL for images
  readonly downloadHref = input<string | null>(null);

  readonly csvRows = computed(() =>
    this.text()
      .split('\n')
      .filter((l) => l.trim())
      .slice(0, 200)
      .map((l) => l.split(',').map((c) => c.trim())),
  );
  readonly diffLines = computed(() =>
    this.text()
      .split('\n')
      .map((t) => ({
        t,
        s: t.startsWith('+') ? '+' : t.startsWith('-') ? '-'
          : t.startsWith('@') ? '@' : ' ',
      })),
  );
}
