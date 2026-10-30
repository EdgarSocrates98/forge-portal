import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PageHeader } from '../../shared/page-header';
import { ToastService } from '../../shared/toast';

interface WorkflowNode {
  id: string;
  kind: 'trigger' | 'prompt' | 'tool' | 'approval' | 'decision' | 'output';
  label: string;
  config: Record<string, string>;
}

const NODE_KINDS: WorkflowNode['kind'][] = [
  'trigger', 'prompt', 'tool', 'approval', 'decision', 'output'];

const TEMPLATES: { name: string; nodes: Omit<WorkflowNode, 'id'>[] }[] = [
  {
    name: 'Ask → Answer',
    nodes: [
      { kind: 'trigger', label: 'User prompt', config: {} },
      { kind: 'prompt', label: 'Send to provider', config: { provider: 'auto' } },
      { kind: 'output', label: 'Render response', config: {} },
    ],
  },
  {
    name: 'Data investigation (gated)',
    nodes: [
      { kind: 'trigger', label: 'Question', config: {} },
      { kind: 'tool', label: 'pf-sql (read-only)', config: { tool: 'pf-sql' } },
      { kind: 'approval', label: 'PM reviews evidence', config: { risk: 'medium' } },
      { kind: 'output', label: 'Cited answer', config: {} },
    ],
  },
  {
    name: 'Publish agent (high-risk)',
    nodes: [
      { kind: 'trigger', label: 'Publish request', config: {} },
      { kind: 'tool', label: 'Agent eval', config: { tool: 'pf-agent-eval' } },
      { kind: 'decision', label: 'Score ≥ 0.80?', config: { threshold: '0.80' } },
      { kind: 'approval', label: 'Owner approval', config: { risk: 'high' } },
      { kind: 'output', label: 'Published agent', config: {} },
    ],
  },
];

let nextId = 1;

/**
 * Visual Workflow Builder (Cycle 29) — composes an agent pipeline as an
 * ordered node list with typed stages and a JSON preview. Design-time
 * only: it produces a workflow document for review; nothing executes —
 * execution stays on the bridge with its own approvals.
 */
@Component({
  selector: 'page-pf-workflow',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader],
  template: `
    <ui-page-header
      title="Workflow Builder"
      subtitle="Compose an agent pipeline visually — design-time only; the bridge executes with its own gates."
    />

    <section class="card">
      <h2>Start from a template</h2>
      <div class="tpls" role="list">
        @for (t of templates; track t.name) {
          <button class="btn" role="listitem" (click)="apply(t.name)">
            {{ t.name }}
          </button>
        }
        <button class="btn btn--mini" (click)="clear()">Blank</button>
      </div>
    </section>

    <div class="grid">
      <section class="card" aria-labelledby="wf-canvas">
        <h2 id="wf-canvas">Canvas</h2>
        <ol class="canvas" aria-label="Workflow nodes">
          @for (n of nodes(); track n.id; let i = $index) {
            <li class="node node-{{ n.kind }}" tabindex="0"
              [attr.aria-label]="n.kind + ': ' + n.label">
              <header>
                <span class="kind">{{ n.kind }}</span>
                <input class="label-input" [value]="n.label"
                  (input)="rename(n.id, $any($event.target).value)"
                  [attr.aria-label]="'Rename ' + n.kind + ' node'" />
              </header>
              <div class="node-actions">
                <button class="btn btn--mini" (click)="move(i, -1)"
                  [disabled]="i === 0" aria-label="Move up">↑</button>
                <button class="btn btn--mini" (click)="move(i, 1)"
                  [disabled]="i === nodes().length - 1" aria-label="Move down">↓</button>
                <button class="btn btn--mini btn--danger" (click)="remove(n.id)"
                  aria-label="Remove node">✕</button>
              </div>
            </li>
          }
        </ol>
        <form class="add" (submit)="add($event)">
          <select class="input" [value]="newKind()"
            (change)="newKind.set($any($event.target).value)" aria-label="Node kind">
            @for (k of kinds; track k) {
              <option [value]="k">{{ k }}</option>
            }
          </select>
          <button class="btn" type="submit">Add stage</button>
        </form>
      </section>

      <section class="card" aria-labelledby="wf-json">
        <h2 id="wf-json">Workflow document</h2>
        <pre class="mono doc" aria-label="Workflow JSON">{{ doc() }}</pre>
        <button class="btn btn--mini" (click)="copy()">Copy JSON</button>
      </section>
    </div>
  `,
  styles: `
    .tpls { display: flex; gap: 8px; flex-wrap: wrap; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 960px) { .grid { grid-template-columns: 1fr; } }
    .canvas { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .node { border: 1px solid var(--line,#333); border-left-width: 4px;
      border-radius: 8px; padding: 8px 10px; }
    .node header { display: flex; gap: 8px; align-items: center; }
    .kind { font-size: 11px; text-transform: uppercase; letter-spacing: .05em;
      padding: 2px 8px; border-radius: 999px; background: var(--chip-bg,#2a2a2a); }
    .node-approval { border-left-color: #d69e2e; }
    .node-decision { border-left-color: #805ad5; }
    .node-tool { border-left-color: #3182ce; }
    .node-output { border-left-color: #38a169; }
    .node-trigger { border-left-color: #e53e3e; }
    .label-input { flex: 1; background: transparent; border: none;
      color: inherit; font: inherit; }
    .node-actions { display: flex; gap: 6px; margin-top: 6px; }
    .add { display: flex; gap: 8px; margin-top: 12px; }
    .doc { white-space: pre-wrap; max-height: 420px; overflow: auto;
      padding: 10px; background: var(--code-bg,#161616); border-radius: 6px; }
  `,
})
export class PfWorkflowPage {
  private readonly toast = inject(ToastService);
  readonly kinds = NODE_KINDS;
  readonly templates = TEMPLATES;
  readonly nodes = signal<WorkflowNode[]>([]);
  readonly newKind = signal<WorkflowNode['kind']>('prompt');

  readonly doc = computed(() => JSON.stringify(
    {
      schema: 'forge/AgentWorkflow/v1',
      stages: this.nodes().map((n, i) => ({
        order: i + 1, kind: n.kind, label: n.label, config: n.config,
      })),
    },
    null,
    1,
  ));

  apply(name: string): void {
    const t = TEMPLATES.find((x) => x.name === name);
    if (!t) return;
    this.nodes.set(t.nodes.map((n) => ({ ...n, id: `n${nextId++}` })));
    this.toast.show(`Template "${name}" applied`, 'success');
  }

  clear(): void {
    this.nodes.set([]);
  }

  add(ev: Event): void {
    ev.preventDefault();
    this.nodes.update((xs) => [...xs, {
      id: `n${nextId++}`, kind: this.newKind(),
      label: `${this.newKind()} stage`, config: {},
    }]);
  }

  rename(id: string, label: string): void {
    this.nodes.update((xs) =>
      xs.map((n) => (n.id === id ? { ...n, label } : n)));
  }

  move(i: number, dir: number): void {
    this.nodes.update((xs) => {
      const j = i + dir;
      if (j < 0 || j >= xs.length) return xs;
      const ys = [...xs];
      [ys[i], ys[j]] = [ys[j], ys[i]];
      return ys;
    });
  }

  remove(id: string): void {
    this.nodes.update((xs) => xs.filter((n) => n.id !== id));
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.doc());
      this.toast.show('Workflow JSON copied', 'success');
    } catch {
      this.toast.show('Clipboard unavailable', 'error');
    }
  }
}
