import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PageHeader } from '../../shared/page-header';
import { StateBadge } from '../../shared/state-badge';
import { ToastService } from '../../shared/toast';

interface AgentTemplate {
  id: string;
  name: string;
  persona: string;
  goal: string;
  tools: string[];
  risk: 'low' | 'medium' | 'high';
  capabilities: string[];
  evalThreshold: number;
  boundary: string; // the "## Não faz" contract — what it refuses
}

/**
 * Agent Templates (Cycle 29) — curated starting points for
 * `productforge agent create`. Templates carry the risk tier and the
 * matching publish-gate threshold (0.50 / 0.65 / 0.80) so users see the
 * gate BEFORE authoring — creating an agent still goes through the real
 * engine gates; nothing here bypasses them.
 */
const TEMPLATES: AgentTemplate[] = [
  {
    id: 'knowledge-curator', name: 'Knowledge Curator',
    persona: 'pf-knowledge',
    goal: 'Import, dedupe and keep product knowledge cited and fresh.',
    tools: ['pf_knowledge_import', 'pf_knowledge_query'],
    risk: 'low', capabilities: ['chat', 'files'], evalThreshold: 0.50,
    boundary: 'Never answers without a chunk citation; never mutates sources.',
  },
  {
    id: 'data-investigator', name: 'Data Investigator',
    persona: 'pf-sql + pf-analytics',
    goal: 'Read-only SQL investigation against registered sources.',
    tools: ['pf_sql_run', 'pf_source_describe'],
    risk: 'medium', capabilities: ['chat', 'tools', 'files'],
    evalThreshold: 0.65,
    boundary: 'Read-only queries only; writes are refused before execution.',
  },
  {
    id: 'release-sentinel', name: 'Release Sentinel',
    persona: 'pf-governance',
    goal: 'Watch audit trail + approvals; flag unsigned changes.',
    tools: ['pf_audit_query', 'pf_approval_list'],
    risk: 'medium', capabilities: ['chat', 'approvals'], evalThreshold: 0.65,
    boundary: 'Reports anomalies; cannot approve or mutate anything.',
  },
  {
    id: 'publish-pipeline', name: 'Publish Pipeline',
    persona: 'pf-agent-factory',
    goal: 'Create → eval → publish agents through the gated pipeline.',
    tools: ['pf_agent_create', 'pf_agent_eval', 'pf_agent_publish'],
    risk: 'high', capabilities: ['chat', 'tools', 'approvals'],
    evalThreshold: 0.80,
    boundary: 'High-risk tier: needs eval ≥ 0.80 AND owner approval.',
  },
];

@Component({
  selector: 'page-pf-templates',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, StateBadge],
  template: `
    <ui-page-header
      title="Agent Templates"
      subtitle="Curated agent starting points — risk tier and eval gate shown up front."
    />

    <div class="cards" role="list">
      @for (t of templates; track t.id) {
        <article class="card tpl" role="listitem">
          <header>
            <h2>{{ t.name }}</h2>
            <ui-state-badge [state]="t.risk" [labelOverride]="t.risk + ' risk'" />
          </header>
          <p class="goal">{{ t.goal }}</p>
          <dl class="kv">
            <dt>Persona</dt><dd class="mono">{{ t.persona }}</dd>
            <dt>Tools</dt><dd class="mono">{{ t.tools.join(', ') }}</dd>
            <dt>Eval gate</dt><dd class="mono">≥ {{ t.evalThreshold.toFixed(2) }}</dd>
            <dt>Capabilities</dt><dd>{{ t.capabilities.join(' · ') }}</dd>
          </dl>
          <p class="boundary"><strong>Boundary:</strong> {{ t.boundary }}</p>
          <div class="actions">
            <button class="btn btn--mini" (click)="copy(t)">Copy spec</button>
          </div>
        </article>
      }
    </div>
  `,
  styles: `
    .cards { display: grid; grid-template-columns: repeat(auto-fill,minmax(320px,1fr));
      gap: 16px; }
    .tpl header { display: flex; justify-content: space-between;
      align-items: baseline; }
    .goal { min-height: 2.5em; }
    .kv { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px;
      font-size: 13px; }
    .kv dt { font-weight: 600; } .kv dd { margin: 0; }
    .boundary { font-size: 12px; color: var(--fg-muted); }
    .actions { margin-top: 8px; }
  `,
})
export class PfTemplatesPage {
  private readonly toast = inject(ToastService);
  readonly templates = TEMPLATES;

  async copy(t: AgentTemplate): Promise<void> {
    const spec = {
      schema: 'forge/AgentTemplate/v1',
      ...t,
      note: 'Author via productforge agent create — eval gate applies at publish.',
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 1));
      this.toast.show(`"${t.name}" spec copied`, 'success');
    } catch {
      this.toast.show('Clipboard unavailable', 'error');
    }
  }
}
