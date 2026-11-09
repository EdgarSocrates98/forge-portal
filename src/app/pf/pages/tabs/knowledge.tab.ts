import { TPipe } from '../../../core/i18n/i18n.pipe';
import { JsonPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { ApiError } from '../../../core/api/api.error';
import {
  PfDocument,
  PfDocumentDetail,
  PfGraph,
  PfKnowledgeAnswer,
  PfKnowledgeHealth,
  PfKnowledgeSource,
  PfObsidianImport,
  PfObsidianHistory,
  PfObsidianPreview,
  PfObsidianSyncPlan,
  PfObsidianSyncReceipt,
  PfWorkspaceDiscovery,
  PfWorkspaceDocument,
  PfWorkspaceImport,
  PfWorkspacePreview,
  PfUrlImport,
  PfUrlPreview,
} from '../../pf.models';
import { EmptyState } from '../../../shared/empty-state';
import { ErrorState } from '../../../shared/error-state';
import { StateBadge } from '../../../shared/state-badge';
import { UiSkeleton } from '../../../shared/skeleton';
import { ToastService } from '../../../shared/toast';

/**
 * Knowledge tab — document import, FTS query with citations + synthesis
 * status, knowledge health and the entity graph summary. The synthesis
 * string is rendered verbatim (`ok` | `unavailable:*` | `error:*`) —
 * the engine's honest state, never reinterpreted.
 */
@Component({
  selector: 'pf-knowledge-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [EmptyState, ErrorState, StateBadge, UiSkeleton, TPipe, JsonPipe],
  template: `
    @if (error(); as e) {
      <ui-error [error]="e" (retry)="load()" />
    }

    @if (loading()) {
      <div role="status" [attr.aria-label]="'state.loading' | t">
        <ui-skeleton kind="card" [lines]="3" />
      </div>
    } @else {
      <div class="stats">
        <div class="stat">
          <span class="stat__value">{{ health()?.score ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.knowledgeHealth' | t }}</span>
          @if (health()?.warnings?.length) {
            <span class="stat__hint">{{ health()!.warnings![0] }}</span>
          }
        </div>
        <div class="stat">
          <span class="stat__value"
            >{{ health()?.sources?.indexed ?? '—' }}/{{ health()?.sources?.total ?? '—' }}</span
          >
          <span class="stat__label">{{ 'pf.knowledge.sourcesIndexed' | t }}</span>
        </div>
        <div class="stat">
          <span class="stat__value">{{ health()?.entities?.total ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.entities' | t }}</span>
          @if (health()?.entities?.provisional) {
            <span class="stat__hint">{{ health()!.entities!.provisional }} provisional</span>
          }
        </div>
        <div class="stat">
          <span class="stat__value">{{ graph()?.stats?.nodes ?? '—' }}</span>
          <span class="stat__label">{{ 'pf.knowledge.graphNodes' | t }}</span>
          @if (graph()?.stats?.edges !== undefined) {
            <span class="stat__hint">{{ graph()!.stats!.edges }} edges</span>
          }
        </div>
      </div>

      <section class="card capture" data-section="source-capture">
        <div class="capture__head">
          <div>
            <h2>{{ 'pf.knowledge.capture.title' | t }}</h2>
            <p class="muted small">
              {{ 'pf.knowledge.capture.description' | t }}
            </p>
          </div>
          <span class="capture__step" aria-live="polite"
            >{{ 'pf.knowledge.capture.step' | t }} {{ captureStep() }}
            {{ 'pf.knowledge.capture.of' | t }} 4</span
          >
        </div>

        <div class="capture__steps" [attr.aria-label]="'pf.knowledge.capture.steps' | t">
          <span [class.active]="captureStep() === 1"
            >1. {{ 'pf.knowledge.capture.select' | t }}</span
          >
          <span [class.active]="captureStep() === 2"
            >2. {{ 'pf.knowledge.capture.permission' | t }}</span
          >
          <span [class.active]="captureStep() === 3"
            >3. {{ 'pf.knowledge.capture.preview' | t }}</span
          >
          <span [class.active]="captureStep() === 4"
            >4. {{ 'pf.knowledge.capture.confirm' | t }}</span
          >
        </div>

        <div
          class="capture__modes"
          role="group"
          [attr.aria-label]="'pf.knowledge.capture.type' | t"
        >
          <button
            class="btn"
            type="button"
            [class.btn--primary]="captureMode() === 'workspace'"
            (click)="selectCaptureMode('workspace')"
          >
            {{ 'pf.knowledge.capture.workspace' | t }}
          </button>
          <button
            class="btn"
            type="button"
            [class.btn--primary]="captureMode() === 'url'"
            (click)="selectCaptureMode('url')"
          >
            {{ 'pf.knowledge.capture.publicUrl' | t }}
          </button>
          <button
            class="btn"
            type="button"
            [class.btn--primary]="captureMode() === 'obsidian'"
            (click)="selectCaptureMode('obsidian')"
          >
            {{ 'pf.knowledge.capture.obsidian' | t }}
          </button>
        </div>

        @if (captureMode() === 'workspace' && !workspaceDiscovery()) {
          <button
            class="btn btn--primary"
            type="button"
            [disabled]="captureBusy()"
            (click)="discoverWorkspace()"
          >
            {{
              (captureBusy()
                ? 'pf.knowledge.capture.discovering'
                : 'pf.knowledge.capture.selectWorkspace'
              ) | t
            }}
          </button>
        } @else if (captureMode() === 'workspace') {
          <div class="capture__source-row">
            <label class="field">
              <span>{{ 'pf.knowledge.capture.sourceDocument' | t }}</span>
              <select
                class="input"
                [value]="captureSource()?.path ?? ''"
                (change)="selectCaptureSource($any($event.target).value)"
              >
                <option value="">{{ 'pf.knowledge.capture.chooseMarkdown' | t }}</option>
                @for (doc of markdownSources(); track doc.path) {
                  <option [value]="doc.path">{{ doc.title }} · {{ doc.relative_path }}</option>
                }
              </select>
            </label>
            <button class="btn" type="button" [disabled]="captureBusy()" (click)="resetCapture()">
              {{ 'pf.knowledge.capture.startOver' | t }}
            </button>
          </div>

          @if (captureSource(); as source) {
            <div class="capture__review">
              <div class="capture__meta">
                <strong>{{ source.title }}</strong>
                <code>{{ source.relative_path }}</code>
                <span class="muted small">{{ source.size }} bytes · {{ source.repository }}</span>
              </div>
              <label class="check">
                <input
                  type="checkbox"
                  [checked]="capturePermission()"
                  (change)="
                    capturePermission.set($any($event.target).checked); capturePreview.set(null)
                  "
                />
                I authorize reading this selected workspace document for this import.
              </label>
              <button
                class="btn"
                type="button"
                [disabled]="captureBusy() || !capturePermission()"
                (click)="capture()"
              >
                {{
                  (captureBusy()
                    ? 'pf.knowledge.capture.capturing'
                    : 'pf.knowledge.capture.capturePreview'
                  ) | t
                }}
              </button>
            </div>
          }

          @if (capturePreview(); as preview) {
            <div class="capture__preview" data-state="preview">
              <div class="capture__meta">
                <strong>{{ 'pf.knowledge.capture.preview' | t }} · {{ preview.title }}</strong>
                <span class="muted small">{{ preview.size }} bytes · {{ preview.state }}</span>
              </div>
              <pre>{{ preview.preview }}</pre>
              <label class="field">
                <span>{{ 'pf.knowledge.capture.destination' | t }}</span>
                <input
                  class="input"
                  value="Current product"
                  readonly
                  [attr.aria-label]="'pf.knowledge.capture.destinationProduct' | t"
                />
              </label>
              <div class="fg-row">
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="confirmCapture()"
                >
                  {{
                    (captureBusy()
                      ? 'pf.knowledge.capture.importing'
                      : 'pf.knowledge.capture.confirmImport'
                    ) | t
                  }}
                </button>
                <button
                  class="btn"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="capturePreview.set(null)"
                >
                  {{ 'pf.knowledge.capture.editSelection' | t }}
                </button>
              </div>
            </div>
          }

          @if (captureReceipt(); as receipt) {
            <div class="capture__receipt" role="status" data-state="receipt">
              <strong>{{ 'pf.knowledge.capture.receipt' | t }}</strong>
              <span
                >{{ 'pf.knowledge.capture.imported' | t }} <code>{{ receipt.title }}</code>
                {{ 'pf.knowledge.capture.intoProduct' | t }}</span
              >
              <code>{{ receipt.id }}</code>
              @if ($any(receipt).source_path) {
                <span class="muted small"
                  >{{ 'pf.knowledge.capture.source' | t }}: {{ $any(receipt).source_path }}</span
                >
              }
            </div>
          }
        }

        @if (captureMode() === 'obsidian') {
          <div class="capture__review">
            <label class="field capture__path-field">
              <span>{{ 'pf.knowledge.capture.obsidianPath' | t }}</span>
              <input
                class="input"
                type="text"
                autocomplete="off"
                [value]="captureObsidianPath()"
                (input)="captureObsidianPath.set($any($event.target).value); capturePreview.set(null)"
                placeholder="runbooks/spark-diagnosis.md"
                aria-describedby="obsidian-capture-help"
              />
            </label>
            <p id="obsidian-capture-help" class="muted small">
              {{ 'pf.knowledge.capture.obsidianPathHelp' | t }}
            </p>
            <label class="check">
              <input
                type="checkbox"
                [checked]="capturePermission()"
                (change)="
                  capturePermission.set($any($event.target).checked); capturePreview.set(null)
                "
              />
              {{ 'pf.knowledge.capture.obsidianPermission' | t }}
            </label>
            <button
              class="btn"
              type="button"
              [disabled]="captureBusy() || !capturePermission() || !captureObsidianPath().trim()"
              (click)="capture()"
            >
              {{
                (captureBusy()
                  ? 'pf.knowledge.capture.previewing'
                  : 'pf.knowledge.capture.previewObsidian'
                ) | t
              }}
            </button>
          </div>
          @if (capturePreview(); as preview) {
            <div class="capture__preview" data-state="preview">
              <div class="capture__meta">
                <strong>{{ 'pf.knowledge.capture.preview' | t }} · {{ preview.title }}</strong>
                <span class="muted small">{{ preview.size }} bytes · {{ preview.state }}</span>
              </div>
              <pre>{{ preview.preview }}</pre>
              <div class="fg-row">
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="confirmCapture()"
                >
                  {{
                    (captureBusy()
                      ? 'pf.knowledge.capture.importing'
                      : 'pf.knowledge.capture.confirmImport'
                    ) | t
                  }}
                </button>
                <button
                  class="btn"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="capturePreview.set(null)"
                >
                  {{ 'pf.knowledge.capture.editObsidianPath' | t }}
                </button>
              </div>
            </div>
          }
          @if (captureReceipt(); as receipt) {
            <div class="capture__receipt" role="status" data-state="receipt">
              <strong>{{ 'pf.knowledge.capture.receipt' | t }}</strong>
              <span
                >{{ 'pf.knowledge.capture.imported' | t }} <code>{{ receipt.title }}</code>
                {{ 'pf.knowledge.capture.intoProduct' | t }}</span
              >
              <code>{{ receipt.id }}</code>
              @if ($any(receipt).source_path) {
                <span class="muted small"
                  >{{ 'pf.knowledge.capture.source' | t }}: {{ $any(receipt).source_path }}</span
                >
              }
            </div>
          }
        }

        @if (captureMode() === 'url') {
          <div class="capture__review">
            <label class="field">
              <span>{{ 'pf.knowledge.capture.publicDocumentUrl' | t }}</span>
              <input
                class="input"
                type="url"
                inputmode="url"
                autocomplete="url"
                [value]="captureUrl()"
                (input)="captureUrl.set($any($event.target).value); capturePreview.set(null)"
                placeholder="https://docs.example.com/runbook"
                aria-describedby="url-capture-help"
              />
            </label>
            <p id="url-capture-help" class="muted small">
              {{ 'pf.knowledge.capture.publicUrlHelp' | t }}
            </p>
            <label class="field">
              <span>{{ 'pf.knowledge.capture.extractionEngine' | t }}</span>
              <select
                class="input"
                [value]="captureExtractor()"
                (change)="captureExtractor.set($any($event.target).value); capturePreview.set(null)"
                aria-describedby="extractor-help"
              >
                <option value="stdlib">{{ 'pf.knowledge.capture.stdlib' | t }}</option>
                <option value="defuddle">{{ 'pf.knowledge.capture.defuddle' | t }}</option>
              </select>
            </label>
            <p id="extractor-help" class="muted small">
              {{ 'pf.knowledge.capture.extractorHelp' | t }}
            </p>
            <label class="check">
              <input
                type="checkbox"
                [checked]="capturePermission()"
                (change)="
                  capturePermission.set($any($event.target).checked); capturePreview.set(null)
                "
              />
              I authorize fetching and importing this selected public URL.
            </label>
            <button
              class="btn"
              type="button"
              [disabled]="captureBusy() || !capturePermission() || !captureUrl().trim()"
              (click)="capture()"
            >
              {{
                (captureBusy()
                  ? 'pf.knowledge.capture.fetching'
                  : 'pf.knowledge.capture.fetchPreview'
                ) | t
              }}
            </button>
          </div>
          @if (capturePreview(); as preview) {
            <div class="capture__preview" data-state="preview">
              <div class="capture__meta">
                <strong>{{ 'pf.knowledge.capture.preview' | t }} · {{ preview.title }}</strong>
                <span class="muted small">{{ preview.size }} bytes · {{ preview.state }}</span>
              </div>
              <pre>{{ preview.preview }}</pre>
              <label class="field">
                <span>{{ 'pf.knowledge.capture.destination' | t }}</span>
                <input
                  class="input"
                  value="Current product"
                  readonly
                  [attr.aria-label]="'pf.knowledge.capture.destinationProduct' | t"
                />
              </label>
              <div class="fg-row">
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="confirmCapture()"
                >
                  {{
                    (captureBusy()
                      ? 'pf.knowledge.capture.importing'
                      : 'pf.knowledge.capture.confirmImport'
                    ) | t
                  }}
                </button>
                <button
                  class="btn"
                  type="button"
                  [disabled]="captureBusy()"
                  (click)="capturePreview.set(null)"
                >
                  {{ 'pf.knowledge.capture.editUrl' | t }}
                </button>
              </div>
            </div>
          }
          @if (captureReceipt(); as receipt) {
            <div class="capture__receipt" role="status" data-state="receipt">
              <strong>{{ 'pf.knowledge.capture.receipt' | t }}</strong>
              <span
                >{{ 'pf.knowledge.capture.imported' | t }} <code>{{ receipt.title }}</code>
                {{ 'pf.knowledge.capture.intoProduct' | t }}</span
              >
              <code>{{ receipt.id }}</code>
              @if ($any(receipt).source_url) {
                <span class="muted small"
                  >{{ 'pf.knowledge.capture.source' | t }}: {{ $any(receipt).source_url }}</span
                >
              }
            </div>
          }
        }
      </section>

      <div class="cols">
        <section class="card">
          <h2>{{ 'pf.knowledge.importDocument' | t }}</h2>
          <form class="stack" (submit)="importDoc($event)">
            <label class="field">
              <span>{{ 'pf.knowledge.title' | t }}</span>
              <input
                class="input"
                [value]="docTitle()"
                (input)="docTitle.set($any($event.target).value)"
                placeholder="e.g. Q3 discovery notes"
                required
              />
            </label>
            <label class="field">
              <span>{{ 'pf.knowledge.content' | t }}</span>
              <textarea
                class="textarea"
                rows="7"
                [value]="docContent()"
                (input)="docContent.set($any($event.target).value)"
                placeholder="Paste markdown or plain text — it is chunked and indexed for FTS."
                required
              ></textarea>
            </label>
            <div class="fg-row">
              <button
                class="btn btn--primary"
                type="submit"
                [disabled]="busy() || !docTitle().trim() || !docContent().trim()"
              >
                Import
              </button>
              <button
                class="btn"
                type="button"
                [disabled]="busy()"
                (click)="extract()"
                title="Extract entities + relations from indexed chunks"
              >
                Extract entities
              </button>
            </div>
          </form>
          @if (extractResult(); as xr) {
            <p class="ok-note">
              {{ 'pf.knowledge.extractionComplete' | t }} — {{ xr.entities }}
              {{ 'pf.knowledge.entities' | t }}, {{ xr.relations }}
              {{ 'pf.knowledge.relations' | t }}.
            </p>
          }
        </section>

        <section class="card">
          <h2>{{ 'pf.knowledge.askTheKnowledgeBase' | t }}</h2>
          <form class="stack" (submit)="ask($event)">
            <label class="field">
              <span>{{ 'pf.knowledge.question' | t }}</span>
              <textarea
                class="textarea"
                rows="3"
                [value]="question()"
                (input)="question.set($any($event.target).value)"
                [placeholder]="'pf.knowledge.questionPlaceholder' | t"
                required
              ></textarea>
            </label>
            <button
              class="btn btn--primary"
              type="submit"
              [disabled]="asking() || !question().trim()"
            >
              {{ (asking() ? 'pf.knowledge.querying' : 'pf.knowledge.query') | t }}
            </button>
          </form>

          @if (answer(); as a) {
            <div class="answer fg-enter" aria-live="polite">
              <div class="answer__head">
                <ui-state-badge [state]="synthBadge(a.synthesis)" [labelOverride]="a.synthesis" />
                <span class="muted small"
                  >{{ a.citations.length }} {{ 'pf.knowledge.citations' | t }}</span
                >
              </div>
              @if (a.answer) {
                <p class="answer__text">{{ a.answer }}</p>
              }
              @if (a.citations.length) {
                <ul class="cites">
                  @for (c of a.citations; track c.chunk_id) {
                    <li>
                      <p class="cites__snip">“{{ c.snippet }}”</p>
                      <span class="muted small">
                        {{ c.title || c.document_id }} ·
                        <code>{{ c.chunk_id }}</code>
                      </span>
                    </li>
                  }
                </ul>
              } @else {
                <p class="muted small">{{ 'pf.knowledge.noChunksMatchedImportDocuments' | t }}</p>
              }
            </div>
          }
        </section>
      </div>

      <section class="card">
        <h2>{{ 'pf.knowledge.documents' | t }}</h2>
        @if (docs().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.knowledge.title' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.status' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.chunks' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.imported' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (d of docs(); track d.id) {
                <tr>
                  <td>
                    <strong>{{ d.title }}</strong>
                    <code class="muted small"> {{ d.id }}</code>
                    <button
                      class="btn btn--small"
                      type="button"
                      (click)="openDocument(d.id)"
                      [disabled]="documentBusy()"
                      [attr.aria-label]="('pf.knowledge.openDocument' | t) + ' ' + d.title"
                    >
                      {{ 'pf.knowledge.explore' | t }}
                    </button>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="d.status === 'indexed' ? 'ok' : 'unverified'"
                      [labelOverride]="d.status ?? 'unknown'"
                    />
                  </td>
                  <td>{{ d.chunk_count ?? '—' }}</td>
                  <td class="muted small">{{ d.created_at ?? '—' }}</td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="knowledge" [title]="'pf.knowledge.noDocuments' | t" />
        }
      </section>

      @if (selectedDocument(); as detail) {
        <section class="card document-explorer" aria-labelledby="document-explorer-title">
          <div class="capture__head">
            <div>
              <h2 id="document-explorer-title">{{ 'pf.knowledge.documentExplorer' | t }}</h2>
              <p class="muted small">
                {{ detail.document.title }} · {{ detail.document.status ?? 'unknown' }}
              </p>
            </div>
            <button class="btn" type="button" (click)="selectedDocument.set(null)">
              {{ 'state.close' | t }}
            </button>
          </div>
          <dl class="document-explorer__meta">
            <div>
              <dt>{{ 'pf.knowledge.source' | t }}</dt>
              <dd>
                <code>{{ detail.source ?? 'unreported' }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'pf.knowledge.hash' | t }}</dt>
              <dd>
                <code>{{ detail.document.content_hash ?? 'unreported' }}</code>
              </dd>
            </div>
            <div>
              <dt>{{ 'pf.knowledge.chunks' | t }}</dt>
              <dd>{{ detail.content.chunk_count }}</dd>
            </div>
            <div>
              <dt>{{ 'pf.knowledge.versionState' | t }}</dt>
              <dd>{{ detail.versions.state }}</dd>
            </div>
          </dl>
          @if (detail.document.metadata; as metadata) {
            <p class="muted small">
              {{ 'pf.knowledge.provenanceAvailable' | t }}
            </p>
            <pre class="document-explorer__metadata">{{ metadata | json }}</pre>
          }
          <h3>{{ 'pf.knowledge.indexedContent' | t }}</h3>
          <div class="document-explorer__chunks">
            @for (chunk of detail.content.chunks; track chunk.id) {
              <article>
                <span class="muted small">Chunk {{ chunk.seq + 1 }}</span>
                <pre>{{ chunk.text }}</pre>
              </article>
            }
          </div>
          <section class="obsidian-export" aria-labelledby="obsidian-export-title">
            <div>
              <h3 id="obsidian-export-title">{{ 'pf.knowledge.obsidianExport.title' | t }}</h3>
              <p class="muted small">{{ 'pf.knowledge.obsidianExport.description' | t }}</p>
            </div>
            <label class="field">
              <span>{{ 'pf.knowledge.obsidianExport.path' | t }}</span>
              <input
                class="input"
                type="text"
                [value]="obsidianExportPath()"
                (input)="obsidianExportPath.set($any($event.target).value); obsidianPlan.set(null); obsidianBaselineHash.set('')"
                placeholder="exports/spark-runbook.md"
              />
            </label>
            <div class="fg-row">
              <button
                class="btn"
                type="button"
                [disabled]="obsidianExportBusy() || !obsidianExportPath().trim()"
                (click)="loadObsidianBaseline()"
              >
                {{ 'pf.knowledge.obsidianExport.loadBaseline' | t }}
              </button>
              <button
                class="btn"
                type="button"
                [disabled]="obsidianExportBusy() || !obsidianExportPath().trim()"
                (click)="planObsidianExport(detail)"
              >
                {{
                  (obsidianExportBusy()
                    ? 'pf.knowledge.obsidianExport.planning'
                    : 'pf.knowledge.obsidianExport.review'
                  ) | t
                }}
              </button>
            </div>
            @if (obsidianBaselineHash(); as baseline) {
              <p class="muted small obsidian-export__baseline">
                {{ 'pf.knowledge.obsidianExport.baseline' | t }}: <code>{{ baseline }}</code>
              </p>
            }
            @if (obsidianPlan(); as plan) {
              <div class="obsidian-export__plan" [attr.data-outcome]="plan.outcome">
                <div class="obsidian-export__plan-head">
                  <strong>{{ 'pf.knowledge.obsidianExport.plan' | t }}</strong>
                  <ui-state-badge
                    [state]="plan.outcome === 'conflict' ? 'error' : plan.outcome"
                    [labelOverride]="plan.outcome"
                  />
                </div>
                <p class="muted small">{{ plan.path }} · {{ plan.content_hash }}</p>
                @for (warning of plan.warnings ?? []; track warning) {
                  <p class="muted small">{{ warning }}</p>
                }
                @for (unresolved of plan.unresolved ?? []; track unresolved) {
                  <p class="danger small">{{ unresolved }}</p>
                }
                <button
                  class="btn btn--primary"
                  type="button"
                  [disabled]="obsidianExportBusy() || !['created', 'updated'].includes(plan.outcome)"
                  (click)="exportToObsidian(detail, plan)"
                >
                  {{
                    (obsidianExportBusy()
                      ? 'pf.knowledge.obsidianExport.exporting'
                      : 'pf.knowledge.obsidianExport.confirm'
                    ) | t
                  }}
                </button>
              </div>
            }
            @if (obsidianReceipt(); as receipt) {
              <div class="obsidian-export__receipt" role="status">
                <strong>{{ 'pf.knowledge.obsidianExport.receipt' | t }}</strong>
                <span>{{ receipt.path }} · {{ receipt.sync_state ?? receipt.state }}</span>
                <code>{{ receipt.content_hash }}</code>
                @if (receipt.backup_path) {
                  <span class="muted small">{{ receipt.backup_path }}</span>
                }
              </div>
            }
            <div class="fg-row obsidian-export__history-actions">
              <button
                class="btn"
                type="button"
                [disabled]="obsidianExportBusy()"
                (click)="loadObsidianHistory()"
              >
                {{ 'pf.knowledge.obsidianExport.history' | t }}
              </button>
            </div>
            @if (obsidianHistory(); as history) {
              <div class="obsidian-export__history" aria-live="polite">
                <strong>{{ 'pf.knowledge.obsidianExport.history' | t }}</strong>
                @if (history.items.length) {
                  <ul>
                    @for (item of history.items; track item.receipt_path ?? item.path + item.content_hash) {
                      <li>
                        <span>{{ item.path }} · {{ item.sync_state ?? item.state }}</span>
                        <code>{{ item.content_hash }}</code>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="muted small">{{ 'pf.knowledge.obsidianExport.historyEmpty' | t }}</p>
                }
              </div>
            }
          </section>
          <p class="muted small">
            Versions: {{ detail.versions.items.length }} · relations:
            {{ detail.relations?.length ?? 0 }}
          </p>
        </section>
      }

      <section class="card">
        <h2>{{ 'pf.knowledge.knowledgeSources' | t }}</h2>
        @if (sources().length) {
          <table class="table">
            <thead>
              <tr>
                <th scope="col">{{ 'pf.knowledge.name' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.type' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.locator' | t }}</th>
                <th scope="col">{{ 'pf.knowledge.status' | t }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of sources(); track s.id) {
                <tr>
                  <td>
                    <strong>{{ s.name }}</strong>
                  </td>
                  <td>{{ s.type ?? '—' }}</td>
                  <td>
                    <code class="muted small">{{ s.locator || '—' }}</code>
                  </td>
                  <td>
                    <ui-state-badge
                      [state]="s.status === 'indexed' ? 'ok' : 'unverified'"
                      [labelOverride]="s.status ?? 'unverified'"
                    />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        } @else {
          <ui-empty icon="folder" [title]="'pf.knowledge.noSources' | t" />
        }
      </section>
    }
  `,
  styles: `
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
      gap: var(--space-4);
      margin-bottom: var(--space-4);
    }
    .cols {
      display: grid;
      gap: var(--space-4);
      grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
      margin-bottom: var(--space-4);
      align-items: start;
    }
    .card {
      margin-bottom: var(--space-4);
    }
    .cols .card {
      margin-bottom: 0;
    }
    h2 {
      margin: 0 0 var(--space-3);
      font-size: var(--font-lg);
      font-weight: 650;
    }
    .stack {
      display: grid;
      gap: var(--space-3);
    }
    .field {
      display: grid;
      gap: 4px;
      font-size: var(--font-sm);
      font-weight: 550;
    }
    .answer {
      margin-top: var(--space-4);
      padding-top: var(--space-3);
      border-top: 1px solid var(--border);
      display: grid;
      gap: var(--space-3);
    }
    .answer__head {
      display: flex;
      align-items: center;
      gap: var(--space-3);
    }
    .answer__text {
      margin: 0;
      white-space: pre-wrap;
    }
    .cites {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-2);
    }
    .cites li {
      border-left: 3px solid var(--accent);
      padding: var(--space-2) var(--space-3);
      background: var(--bg-hover);
      border-radius: 0 var(--radius-md) var(--radius-md) 0;
    }
    .cites__snip {
      margin: 0 0 2px;
      font-size: var(--font-sm);
    }
    .ok-note {
      margin: var(--space-3) 0 0;
      font-size: var(--font-sm);
      color: var(--ok);
    }
    .muted {
      color: var(--fg-muted);
    }
    .small {
      font-size: var(--font-xs);
    }
    .capture {
      display: grid;
      gap: var(--space-3);
    }
    .capture__head,
    .capture__source-row,
    .capture__review,
    .capture__meta {
      display: flex;
      align-items: center;
      gap: var(--space-3);
      flex-wrap: wrap;
    }
    .capture__head {
      justify-content: space-between;
      align-items: flex-start;
    }
    .capture__head h2 {
      margin-bottom: var(--space-1);
    }
    .capture__step {
      color: var(--fg-muted);
      font-size: var(--font-xs);
      white-space: nowrap;
    }
    .capture__steps {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .capture__steps span {
      padding: 3px 8px;
      border: 1px solid var(--border);
      border-radius: 999px;
    }
    .capture__steps span.active {
      border-color: var(--accent);
      color: var(--fg);
    }
    .capture__source-row .field {
      min-width: min(34rem, 100%);
      flex: 1;
    }
    .capture__modes {
      display: flex;
      gap: var(--space-2);
      flex-wrap: wrap;
    }
    .capture__review,
    .capture__preview,
    .capture__receipt {
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      padding: var(--space-3);
      display: grid;
      gap: var(--space-3);
    }
    .capture__meta {
      align-items: baseline;
    }
    .capture__meta code {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .capture__preview pre {
      max-height: 14rem;
      overflow: auto;
      margin: 0;
      padding: var(--space-3);
      background: var(--bg-hover);
      border-radius: var(--radius-sm);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .capture__receipt {
      border-color: var(--ok);
    }
    .check {
      display: flex;
      align-items: flex-start;
      gap: var(--space-2);
      font-size: var(--font-sm);
    }
    .btn--small {
      margin-left: var(--space-2);
      padding: 2px 7px;
      font-size: var(--font-xs);
    }
    .document-explorer {
      display: grid;
      gap: var(--space-3);
    }
    .document-explorer__meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: var(--space-2);
      margin: 0;
    }
    .document-explorer__meta div {
      padding: var(--space-2);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
    }
    .document-explorer__meta dt {
      color: var(--fg-muted);
      font-size: var(--font-xs);
    }
    .document-explorer__meta dd {
      margin: var(--space-1) 0 0;
      overflow-wrap: anywhere;
    }
    .document-explorer__metadata,
    .document-explorer__chunks pre {
      max-height: 16rem;
      overflow: auto;
      margin: 0;
      padding: var(--space-3);
      background: var(--bg-hover);
      border-radius: var(--radius-sm);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .document-explorer__chunks {
      display: grid;
      gap: var(--space-2);
    }
    .obsidian-export {
      display: grid;
      gap: var(--space-3);
      margin-top: var(--space-4);
      padding: var(--space-4);
      border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
      border-radius: var(--radius-md);
    }
    .obsidian-export__plan,
    .obsidian-export__receipt {
      display: grid;
      gap: var(--space-2);
      padding: var(--space-3);
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg-card);
    }
    .obsidian-export__plan[data-outcome='conflict'] {
      border-color: color-mix(in srgb, var(--error) 55%, var(--border));
    }
    .obsidian-export__plan-head {
      display: flex;
      justify-content: space-between;
      gap: var(--space-2);
      align-items: center;
    }
    .danger {
      color: var(--error);
    }
  `,
})
export class PfKnowledgeTab implements OnInit {
  private readonly api = inject(PfApi);
  private readonly toast = inject(ToastService);
  readonly pid = input.required<string>();

  readonly docs = signal<PfDocument[]>([]);
  readonly sources = signal<PfKnowledgeSource[]>([]);
  readonly health = signal<PfKnowledgeHealth | null>(null);
  readonly graph = signal<PfGraph | null>(null);
  readonly answer = signal<PfKnowledgeAnswer | null>(null);
  readonly extractResult = signal<{ entities: number; relations: number } | null>(null);

  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly asking = signal(false);
  readonly error = signal<ApiError | null>(null);

  readonly docTitle = signal('');
  readonly docContent = signal('');
  readonly question = signal('');

  readonly workspaceDiscovery = signal<PfWorkspaceDiscovery | null>(null);
  readonly captureSource = signal<PfWorkspaceDocument | null>(null);
  readonly capturePermission = signal(false);
  readonly capturePreview = signal<PfWorkspacePreview | PfUrlPreview | PfObsidianPreview | null>(null);
  readonly captureReceipt = signal<PfWorkspaceImport | PfUrlImport | PfObsidianImport | null>(null);
  readonly captureBusy = signal(false);
  readonly captureMode = signal<'workspace' | 'url' | 'obsidian'>('workspace');
  readonly captureUrl = signal('');
  readonly captureObsidianPath = signal('');
  readonly captureExtractor = signal<'stdlib' | 'defuddle'>('stdlib');
  readonly selectedDocument = signal<PfDocumentDetail | null>(null);
  readonly documentBusy = signal(false);
  readonly obsidianExportPath = signal('exports/');
  readonly obsidianPlan = signal<PfObsidianSyncPlan | null>(null);
  readonly obsidianReceipt = signal<PfObsidianSyncReceipt | null>(null);
  readonly obsidianHistory = signal<PfObsidianHistory | null>(null);
  readonly obsidianBaselineHash = signal('');
  readonly obsidianExportBusy = signal(false);

  readonly markdownSources = computed(() =>
    (this.workspaceDiscovery()?.documents ?? []).filter(
      (doc) => doc.extension?.toLowerCase() === '.md' && doc.readable !== false,
    ),
  );

  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.error.set(null);
    this.loading.set(true);
    try {
      const [docs, sources, health, graph] = await Promise.all([
        firstValueFrom(this.api.documents(this.pid())),
        firstValueFrom(this.api.knowledgeSources(this.pid())),
        firstValueFrom(this.api.knowledgeHealth(this.pid())),
        firstValueFrom(this.api.knowledgeGraph(this.pid())),
      ]);
      this.docs.set(docs.items ?? []);
      this.sources.set(sources.items ?? []);
      this.health.set(health);
      this.graph.set(graph);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.loading.set(false);
    }
  }

  captureStep(): number {
    if (this.captureReceipt()) return 4;
    if (this.capturePreview()) return 4;
    if (
      this.capturePermission() &&
      (this.captureSource() || this.captureUrl().trim() || this.captureObsidianPath().trim())
    )
      return 3;
    if (this.captureSource() || this.captureUrl().trim() || this.captureObsidianPath().trim()) return 2;
    return 1;
  }

  selectCaptureMode(mode: 'workspace' | 'url' | 'obsidian'): void {
    this.captureMode.set(mode);
    this.captureSource.set(null);
    this.captureUrl.set('');
    this.captureObsidianPath.set('');
    this.captureExtractor.set('stdlib');
    this.capturePermission.set(false);
    this.capturePreview.set(null);
    this.captureReceipt.set(null);
  }

  async discoverWorkspace(): Promise<void> {
    if (this.captureBusy()) return;
    this.captureBusy.set(true);
    this.error.set(null);
    try {
      this.workspaceDiscovery.set(await firstValueFrom(this.api.workspaceDiscovery()));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.captureBusy.set(false);
    }
  }

  selectCaptureSource(path: string): void {
    const source = this.markdownSources().find((doc) => doc.path === path) ?? null;
    this.captureSource.set(source);
    this.capturePermission.set(false);
    this.capturePreview.set(null);
    this.captureReceipt.set(null);
  }

  async capture(): Promise<void> {
    const source = this.captureSource();
    const url = this.captureUrl().trim();
    const obsidianPath = this.captureObsidianPath().trim();
    if (
      (this.captureMode() === 'workspace' && !source) ||
      (this.captureMode() === 'url' && !url) ||
      (this.captureMode() === 'obsidian' && !obsidianPath) ||
      !this.capturePermission() ||
      this.captureBusy()
    )
      return;
    this.captureBusy.set(true);
    this.error.set(null);
    try {
      this.capturePreview.set(
        this.captureMode() === 'url'
          ? await firstValueFrom(this.api.urlPreview(this.pid(), url, this.captureExtractor()))
          : this.captureMode() === 'obsidian'
            ? await firstValueFrom(this.api.obsidianPreview(this.pid(), obsidianPath))
            : await firstValueFrom(this.api.workspacePreview(source!.path)),
      );
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.captureBusy.set(false);
    }
  }

  async confirmCapture(): Promise<void> {
    const source = this.captureSource();
    const preview = this.capturePreview();
    const url = this.captureUrl().trim();
    const obsidianPath = this.captureObsidianPath().trim();
    if (
      (this.captureMode() === 'workspace' && !source) ||
      (this.captureMode() === 'url' && !url) ||
      (this.captureMode() === 'obsidian' && !obsidianPath) ||
      !preview ||
      !this.capturePermission() ||
      this.captureBusy()
    )
      return;
    this.captureBusy.set(true);
    this.error.set(null);
    try {
      const receipt =
        this.captureMode() === 'url'
          ? await firstValueFrom(
              this.api.importUrlDocument(this.pid(), url, preview.title, this.captureExtractor()),
            )
          : this.captureMode() === 'obsidian'
            ? await firstValueFrom(
                this.api.importObsidianDocument(this.pid(), obsidianPath, preview.title),
              )
            : await firstValueFrom(
                this.api.importWorkspaceDocument(this.pid(), source!.path, preview.title),
              );
      this.captureReceipt.set(receipt);
      this.toast.show(`Document "${receipt.title}" imported`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.captureBusy.set(false);
    }
  }

  resetCapture(): void {
    this.workspaceDiscovery.set(null);
    this.captureSource.set(null);
    this.captureUrl.set('');
    this.captureObsidianPath.set('');
    this.capturePermission.set(false);
    this.capturePreview.set(null);
    this.captureReceipt.set(null);
  }

  async openDocument(did: string): Promise<void> {
    if (this.documentBusy()) return;
    this.documentBusy.set(true);
    this.error.set(null);
    try {
      const detail = await firstValueFrom(this.api.documentDetail(this.pid(), did));
      this.selectedDocument.set(detail);
      this.obsidianExportPath.set(`exports/${this.slug(detail.document.title)}.md`);
      this.obsidianPlan.set(null);
      this.obsidianReceipt.set(null);
      this.obsidianBaselineHash.set('');
      this.obsidianHistory.set(null);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.documentBusy.set(false);
    }
  }

  async planObsidianExport(detail: PfDocumentDetail): Promise<void> {
    const path = this.obsidianExportPath().trim();
    const content = this.markdownFor(detail);
    if (!path || !content || this.obsidianExportBusy()) return;
    this.obsidianExportBusy.set(true);
    this.error.set(null);
    try {
      this.obsidianPlan.set(
        await firstValueFrom(
          this.api.planObsidianSync(this.pid(), {
            path,
            content,
            ...(this.obsidianBaselineHash()
              ? { baseline_hash: this.obsidianBaselineHash() }
              : {}),
          }),
        ),
      );
      this.obsidianReceipt.set(null);
      this.obsidianHistory.set(null);
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.obsidianExportBusy.set(false);
    }
  }

  async exportToObsidian(detail: PfDocumentDetail, plan: PfObsidianSyncPlan): Promise<void> {
    if (!['created', 'updated'].includes(plan.outcome) || this.obsidianExportBusy()) return;
    this.obsidianExportBusy.set(true);
    this.error.set(null);
    try {
      const receipt = await firstValueFrom(
        this.api.exportObsidianDocument(this.pid(), {
          path: plan.path,
          content: this.markdownFor(detail),
          ...(plan.previous_hash ? { baseline_hash: plan.previous_hash } : {}),
        }),
      );
      this.obsidianReceipt.set(receipt);
      this.toast.show(`Obsidian note "${receipt.path}" exported`, 'success');
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.obsidianExportBusy.set(false);
    }
  }

  async loadObsidianBaseline(): Promise<void> {
    const path = this.obsidianExportPath().trim();
    if (!path || this.obsidianExportBusy()) return;
    this.obsidianExportBusy.set(true);
    this.error.set(null);
    try {
      const preview = await firstValueFrom(this.api.obsidianPreview(this.pid(), path));
      if (!preview.content_hash) throw new ApiError(422, { code: 'OBSIDIAN-MISSING-HASH' });
      this.obsidianBaselineHash.set(preview.content_hash);
      this.obsidianPlan.set(null);
      this.obsidianReceipt.set(null);
      this.toast.show(`Obsidian baseline loaded for "${preview.path}"`, 'success');
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.obsidianExportBusy.set(false);
    }
  }

  async loadObsidianHistory(): Promise<void> {
    if (this.obsidianExportBusy()) return;
    this.obsidianExportBusy.set(true);
    this.error.set(null);
    try {
      this.obsidianHistory.set(await firstValueFrom(this.api.obsidianHistory(this.pid())));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.obsidianExportBusy.set(false);
    }
  }

  private markdownFor(detail: PfDocumentDetail): string {
    return [`# ${detail.document.title}`, ...detail.content.chunks.map((chunk) => chunk.text)].join(
      '\n\n',
    );
  }

  private slug(title: string): string {
    return (
      title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'document'
    );
  }

  synthBadge(s: string): string {
    if (s === 'ok') return 'ok';
    if (s.startsWith('unavailable')) return 'unverified';
    if (s.startsWith('error')) return 'error';
    return 'muted';
  }

  async importDoc(ev: Event): Promise<void> {
    ev.preventDefault();
    const title = this.docTitle().trim();
    const content = this.docContent();
    if (!title || !content.trim() || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(this.api.importDocument(this.pid(), { title, content }));
      this.docTitle.set('');
      this.docContent.set('');
      this.toast.show(`Document "${title}" imported`, 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async extract(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.extractResult.set(null);
    try {
      const r = await firstValueFrom(this.api.knowledgeExtract(this.pid()));
      this.extractResult.set(r);
      this.toast.show('Entity extraction complete', 'success');
      await this.load();
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.busy.set(false);
    }
  }

  async ask(ev: Event): Promise<void> {
    ev.preventDefault();
    const q = this.question().trim();
    if (!q || this.asking()) return;
    this.asking.set(true);
    try {
      this.answer.set(await firstValueFrom(this.api.knowledgeQuery(this.pid(), q)));
    } catch (e) {
      this.error.set(e instanceof ApiError ? e : new ApiError(0));
    } finally {
      this.asking.set(false);
    }
  }
}
