import { TPipe } from '../../core/i18n/i18n.pipe';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import {
  BridgeArtifact,
  BridgeFileEntry,
  BridgeFilePreview,
  BridgeSession,
  PfBridge,
} from '../pf-bridge.service';
import { ApiError } from '../../core/api/api.error';
import { ArtifactViewer } from '../../shared/artifact-viewer';
import { EmptyState } from '../../shared/empty-state';
import { ErrorState } from '../../shared/error-state';
import { PageHeader } from '../../shared/page-header';
import { UiSkeleton } from '../../shared/skeleton';

/**
 * Artifact Studio (Cycle 29) — the file/artifact surface. Two panes:
 * artifacts emitted by a session's events, and the bridge-managed file
 * browser with safe preview (server-side kind/size gating).
 */
@Component({
  selector: 'page-pf-artifact-studio',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [PageHeader, UiSkeleton, EmptyState, ErrorState, ArtifactViewer, TPipe],
  template: `
    <ui-page-header
      title="Artifact Studio"
      subtitle="Artifacts produced by sessions and the bridge-managed workspace files."
    />

    <div class="grid">
      <section class="card" aria-labelledby="as-artifacts">
        <h2 id="as-artifacts">{{ 'pf.artifactStudio.sessionArtifacts' | t }}</h2>
        <select
          class="input"
          [value]="sid()"
          (change)="pick($any($event.target).value)"
          aria-label="Session for artifacts"
        >
          <option value="">{{ 'pf.artifactStudio.chooseSession' | t }}</option>
          @for (s of sessions(); track s.id) {
            <option [value]="s.id">{{ s.meta?.title || s.id }}</option>
          }
        </select>
        @if (artifacts().length) {
          <ul class="list">
            @for (a of artifacts(); track a.event_id) {
              <li>
                <span class="mono muted">#{{ a.seq }}</span>
                <strong>{{ a.type }}</strong>
                <span class="mono">{{ a.path || a.name || '—' }}</span>
              </li>
            }
          </ul>
        } @else if (sid()) {
          <ui-empty title="No artifacts" hint="This session emitted no artifact events." />
        }
      </section>

      <section class="card" aria-labelledby="as-files">
        <h2 id="as-files">{{ 'pf.artifactStudio.workspaceFiles' | t }}</h2>
        <div class="crumbs mono" aria-label="Breadcrumb">
          <button
            class="btn btn--mini"
            (click)="up()"
            [disabled]="path() === '.'"
            aria-label="Parent directory"
          >
            ..
          </button>
          <span>{{ path() }}</span>
        </div>
        @if (files().length) {
          <ul class="list" role="listbox" aria-label="Files">
            @for (f of files(); track f.name) {
              <li
                role="option"
                tabindex="0"
                (click)="open(f)"
                (keydown.enter)="open(f)"
                [class.sel]="preview()?.path === join(f.name)"
              >
                <span>{{ f.dir ? '📁' : '📄' }}</span>
                <span class="mono">{{ f.name }}</span>
                <small class="muted">{{ f.size ?? '' }}{{ f.dir ? '' : ' B' }}</small>
              </li>
            }
          </ul>
        } @else {
          <ui-empty title="Empty directory" hint="Nothing here." />
        }
        @if (preview(); as pv) {
          <div class="preview">
            <h3 class="mono">{{ pv.path }}</h3>
            <ui-artifact
              [kind]="pv.kind"
              [text]="pv.preview ?? ''"
              [name]="pv.path"
              [truncated]="pv.truncated ?? false"
            />
          </div>
        }
      </section>
    </div>

    @if (err()) {
      <ui-error [error]="err()!" (retry)="browse()" />
    } @else if (loading()) {
      <ui-skeleton [lines]="6" />
    }
  `,
  styles: `
    .grid {
      display: grid;
      grid-template-columns: 2fr 3fr;
      gap: 16px;
    }
    @media (max-width: 960px) {
      .grid {
        grid-template-columns: 1fr;
      }
    }
    .list {
      list-style: none;
      margin: 12px 0 0;
      padding: 0;
      display: grid;
      gap: 4px;
    }
    .list li {
      display: flex;
      gap: 10px;
      align-items: baseline;
      padding: 6px 8px;
      border-radius: 6px;
      cursor: pointer;
    }
    .list li:hover,
    .list li:focus-visible,
    .list li.sel {
      background: var(--hover, #1f1f1f);
      outline: none;
    }
    .crumbs {
      display: flex;
      gap: 8px;
      align-items: center;
      margin: 10px 0;
    }
    .preview {
      margin-top: 14px;
      border-top: 1px solid var(--line, #333);
      padding-top: 10px;
    }
  `,
})
export class PfArtifactStudioPage implements OnInit {
  private readonly bridge = inject(PfBridge);

  readonly sessions = signal<BridgeSession[]>([]);
  readonly sid = signal('');
  readonly artifacts = signal<BridgeArtifact[]>([]);
  readonly path = signal('.');
  readonly files = signal<BridgeFileEntry[]>([]);
  readonly preview = signal<BridgeFilePreview | null>(null);
  readonly loading = signal(true);
  readonly err = signal<ApiError | null>(null);

  async ngOnInit(): Promise<void> {
    try {
      this.sessions.set((await firstValueFrom(this.bridge.listSessions())) ?? []);
      await this.browse();
    } catch (e) {
      this.err.set(e as ApiError);
    } finally {
      this.loading.set(false);
    }
  }

  async pick(id: string): Promise<void> {
    this.sid.set(id);
    this.artifacts.set([]);
    if (!id) return;
    try {
      const s = this.sessions().find((x) => x.id === id);
      this.artifacts.set(
        (await firstValueFrom(this.bridge.artifacts(id, s?.provider ?? 'fake'))) ?? [],
      );
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }

  join(name: string): string {
    return this.path() === '.' ? name : `${this.path()}/${name}`;
  }

  async open(f: BridgeFileEntry): Promise<void> {
    const p = this.join(f.name);
    if (f.dir) {
      this.path.set(p);
      this.preview.set(null);
      await this.browse();
      return;
    }
    try {
      this.preview.set((await firstValueFrom(this.bridge.filePreview(p))) ?? null);
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }

  async up(): Promise<void> {
    const p = this.path();
    const idx = p.lastIndexOf('/');
    this.path.set(idx < 0 ? '.' : p.slice(0, idx));
    this.preview.set(null);
    await this.browse();
  }

  async browse(): Promise<void> {
    try {
      const r = await firstValueFrom(this.bridge.fileList(this.path()));
      this.files.set(r?.items ?? []);
    } catch (e) {
      this.err.set(e as ApiError);
    }
  }
}
