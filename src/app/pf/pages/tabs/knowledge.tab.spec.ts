import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PfApi } from '../../pf-api.service';
import { PfKnowledgeTab } from './knowledge.tab';

describe('PfKnowledgeTab — source capture', () => {
  it('requires explicit permission before preview and emits the real import receipt', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      workspaceDiscovery: vi.fn(() =>
        of({
          schema: 'productforge/WorkspaceDiscovery/v1',
          generated_at: 'now',
          workspace: { name: 'ws', path: 'C:/ws', source: 'local' },
          repositories: [],
          documents: [
            {
              id: 'd1',
              path: 'C:/ws/README.md',
              relative_path: 'README.md',
              repository: 'repo',
              kind: 'knowledge',
              title: 'README',
              extension: '.md',
              size: 12,
              readable: true,
            },
          ],
          state: 'discovered',
        }),
      ),
      workspacePreview: vi.fn(() =>
        of({
          path: 'C:/ws/README.md',
          kind: 'knowledge',
          title: 'README',
          size: 12,
          preview: '# Hello',
          state: 'previewed',
        }),
      ),
      importWorkspaceDocument: vi.fn(() =>
        of({
          id: 'doc-1',
          title: 'README',
          product_id: 'p1',
          source_path: 'C:/ws/README.md',
          state: 'imported',
        }),
      ),
    };

    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();

    const c = fixture.componentInstance;
    await c.discoverWorkspace();
    c.selectCaptureSource('C:/ws/README.md');
    await c.capture();
    expect(api.workspacePreview).not.toHaveBeenCalled();

    c.capturePermission.set(true);
    await c.capture();
    expect(api.workspacePreview).toHaveBeenCalledWith('C:/ws/README.md');
    await c.confirmCapture();

    expect(api.importWorkspaceDocument).toHaveBeenCalledWith('p1', 'C:/ws/README.md', 'README');
    expect(c.captureReceipt()?.id).toBe('doc-1');
  });

  it('supports a public URL with the same permission, preview and receipt gate', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      urlPreview: vi.fn(() =>
        of({
          url: 'https://example.com/docs',
          title: 'Docs',
          preview: '# Docs',
          size: 7,
          state: 'ready_for_import',
        }),
      ),
      importUrlDocument: vi.fn(() =>
        of({
          id: 'doc-url-1',
          title: 'Docs',
          product_id: 'p1',
          source_url: 'https://example.com/docs',
          state: 'imported',
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.selectCaptureMode('url');
    c.captureUrl.set('https://example.com/docs');
    c.captureExtractor.set('defuddle');
    await c.capture();
    expect(api.urlPreview).not.toHaveBeenCalled();
    c.capturePermission.set(true);
    await c.capture();
    expect(api.urlPreview).toHaveBeenCalledWith('p1', 'https://example.com/docs', 'defuddle');
    await c.confirmCapture();
    expect(api.importUrlDocument).toHaveBeenCalledWith(
      'p1',
      'https://example.com/docs',
      'Docs',
      'defuddle',
    );
    expect(c.captureReceipt()?.id).toBe('doc-url-1');
  });

  it('supports an Obsidian vault path with the same permission, preview and receipt gate', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      obsidianPreview: vi.fn(() =>
        of({
          schema: 'productforge/ObsidianDocument/v1',
          path: 'runbooks/spark.md',
          title: 'Spark runbook',
          preview: '# Spark',
          size: 7,
          state: 'ready_for_import',
        }),
      ),
      importObsidianDocument: vi.fn(() =>
        of({
          id: 'doc-obsidian-1',
          title: 'Spark runbook',
          product_id: 'p1',
          source_path: 'runbooks/spark.md',
          state: 'imported',
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.selectCaptureMode('obsidian');
    c.captureObsidianPath.set('runbooks/spark.md');
    await c.capture();
    expect(api.obsidianPreview).not.toHaveBeenCalled();
    c.capturePermission.set(true);
    await c.capture();
    expect(api.obsidianPreview).toHaveBeenCalledWith('p1', 'runbooks/spark.md');
    await c.confirmCapture();
    expect(api.importObsidianDocument).toHaveBeenCalledWith(
      'p1',
      'runbooks/spark.md',
      'Spark runbook',
    );
    expect(c.captureReceipt()?.id).toBe('doc-obsidian-1');
    c.obsidianVault.set({
      workspace: 'ws-1',
      vault_id: 'vault-123',
      label: 'Engineering',
      path: '.',
      source: 'product-forge',
      detected: true,
      capabilities: ['preview'],
    });
    expect(c.obsidianOpenUri('runbooks/spark.md')).toBe(
      'obsidian://open?vault=Engineering&file=runbooks%2Fspark.md',
    );
  });

  it('requires a real sync plan before exporting indexed content to Obsidian', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      planObsidianSync: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianSyncPlan/v1',
          path: 'exports/runbook.md',
          content_hash: 'hash-new',
          outcome: 'created',
          warnings: ['confirmation required for mutation'],
        }),
      ),
      exportObsidianDocument: vi.fn(() =>
        of({
          receipt_schema: 'theforge/ObsidianSyncReceipt/v1',
          path: 'exports/runbook.md',
          content_hash: 'hash-new',
          sync_state: 'created',
          outcome: 'exported',
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.obsidianExportPath.set('exports/runbook.md');
    const detail = {
      document: { id: 'd1', title: 'Runbook' },
      content: { chunks: [{ id: 'c1', document_id: 'd1', seq: 0, text: 'Use Spark.' }], chunk_count: 1 },
    } as any;
    await c.planObsidianExport(detail);
    expect(api.planObsidianSync).toHaveBeenCalledWith('p1', {
      path: 'exports/runbook.md',
      content: '# Runbook\n\nUse Spark.',
    });
    const plan = c.obsidianPlan();
    expect(plan?.outcome).toBe('created');
    await c.exportToObsidian(detail, plan!);
    expect(api.exportObsidianDocument).toHaveBeenCalledWith('p1', {
      path: 'exports/runbook.md',
      content: '# Runbook\n\nUse Spark.',
    });
    expect(c.obsidianReceipt()?.sync_state).toBe('created');
  });

  it('loads an existing baseline and permits an explicit reviewed update', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      obsidianPreview: vi.fn(() =>
        of({ path: 'exports/runbook.md', title: 'Runbook', content_hash: 'hash-old', size: 10, state: 'ready' }),
      ),
      planObsidianSync: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianSyncPlan/v1',
          path: 'exports/runbook.md',
          content_hash: 'hash-new',
          previous_hash: 'hash-old',
          baseline_hash: 'hash-old',
          outcome: 'updated',
        }),
      ),
      exportObsidianDocument: vi.fn(() =>
        of({
          receipt_schema: 'theforge/ObsidianSyncReceipt/v1',
          path: 'exports/runbook.md',
          content_hash: 'hash-new',
          previous_hash: 'hash-old',
          sync_state: 'updated',
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    c.obsidianExportPath.set('exports/runbook.md');
    await c.loadObsidianBaseline();
    expect(c.obsidianBaselineHash()).toBe('hash-old');
    const detail = {
      document: { id: 'd1', title: 'Runbook' },
      content: { chunks: [{ id: 'c1', document_id: 'd1', seq: 0, text: 'Use Spark.' }], chunk_count: 1 },
    } as any;
    await c.planObsidianExport(detail);
    expect(api.planObsidianSync).toHaveBeenCalledWith('p1', {
      path: 'exports/runbook.md',
      content: '# Runbook\n\nUse Spark.',
      baseline_hash: 'hash-old',
    });
    await c.exportToObsidian(detail, c.obsidianPlan()!);
    expect(api.exportObsidianDocument).toHaveBeenCalledWith('p1', {
      path: 'exports/runbook.md',
      content: '# Runbook\n\nUse Spark.',
      baseline_hash: 'hash-old',
    });
  });

  it('checks the authorized vault and renders only safe capability metadata', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      obsidianStatus: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianVaultDescriptor/v1',
          workspace: 'ws-1',
          vault_id: 'vault-123',
          path: '.',
          source: 'product-forge',
          detected: true,
          capabilities: ['preview', 'import_read_only', 'reviewed_sync'],
          provenance: { path_hash: 'a'.repeat(64) },
        }),
      ),
      obsidianFiles: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianVaultFileIndex/v1',
          items: [{ path: 'runbooks/spark.md', title: 'Spark', size: 42 }],
          count: 1,
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;
    await c.loadObsidianStatus();
    expect(api.obsidianStatus).toHaveBeenCalledWith('p1');
    expect(c.obsidianVault()?.detected).toBe(true);
    expect(c.obsidianVault()?.capabilities).toContain('reviewed_sync');
    expect(c.obsidianVault()?.provenance?.['path_hash']).toHaveLength(64);
    expect(api.obsidianFiles).toHaveBeenCalledWith('p1');
    expect(c.obsidianFiles()?.items[0].path).toBe('runbooks/spark.md');
  });

  it('connects and disconnects a scoped vault without exposing its host path', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      obsidianStatus: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianVaultDescriptor/v1',
          workspace: 'ws-1',
          vault_id: 'unconfigured',
          path: '.',
          source: 'product-forge',
          detected: false,
          capabilities: [],
          warnings: ['No vault assigned'],
        }),
      ),
      connectObsidianVault: vi.fn(() =>
        of({
          schema: 'theforge/ObsidianVaultDescriptor/v1',
          workspace: 'ws-1',
          vault_id: 'vault-123',
          vault_record_id: 'vault-record-1',
          label: 'Engineering',
          path: '.',
          source: 'product-forge',
          detected: true,
          capabilities: ['preview'],
        }),
      ),
      revokeObsidianVault: vi.fn(() => of({ revoked: true, vault_record_id: 'vault-record-1' })),
    };
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;

    await c.loadObsidianStatus();
    c.obsidianConnectPath.set('C:/service-host/vaults/engineering');
    c.obsidianConnectLabel.set('Engineering');
    await c.connectObsidianVault();
    expect(api.connectObsidianVault).toHaveBeenCalledWith({
      workspace_id: 'ws-1',
      path: 'C:/service-host/vaults/engineering',
      label: 'Engineering',
    });
    expect(c.obsidianVault()?.vault_record_id).toBe('vault-record-1');
    expect(c.obsidianVault()?.path).toBe('.');

    await c.revokeObsidianVault('vault-record-1');
    expect(api.revokeObsidianVault).toHaveBeenCalledWith('vault-record-1');
    expect(c.obsidianVault()?.detected).toBe(false);
  });

  it('offers guarded rollback only for receipts with a backup', async () => {
    const api = {
      documents: vi.fn(() => of({ items: [] })),
      knowledgeSources: vi.fn(() => of({ items: [] })),
      knowledgeHealth: vi.fn(() => of({ score: 1 })),
      knowledgeGraph: vi.fn(() => of({ stats: { nodes: 0, edges: 0 } })),
      rollbackObsidianDocument: vi.fn(() =>
        of({
          receipt_schema: 'theforge/ObsidianSyncReceipt/v1',
          path: 'exports/runbook.md',
          content_hash: 'hash-old',
          sync_state: 'rolled_back',
          backup_path: '.forge/obsidian-backups/hash-old.md',
          receipt_path: '.forge/obsidian-receipts/hash-old.rollback.json',
        }),
      ),
      obsidianHistory: vi.fn(() => of({ items: [], count: 0 })),
    };
    vi.spyOn(globalThis, 'confirm').mockReturnValue(true);
    TestBed.configureTestingModule({
      imports: [PfKnowledgeTab],
      providers: [{ provide: PfApi, useValue: api }],
    });
    const fixture = TestBed.createComponent(PfKnowledgeTab);
    fixture.componentRef.setInput('pid', 'p1');
    fixture.detectChanges();
    await fixture.whenStable();
    const c = fixture.componentInstance;

    await c.rollbackObsidian({
      path: 'exports/runbook.md',
      content_hash: 'hash-new',
      backup_path: '.forge/obsidian-backups/hash-old.md',
      receipt_path: '.forge/obsidian-receipts/hash-new.json',
    });

    expect(api.rollbackObsidianDocument).toHaveBeenCalledWith('p1', {
      path: 'exports/runbook.md',
      receipt_path: '.forge/obsidian-receipts/hash-new.json',
    });
    expect(c.obsidianReceipt()?.sync_state).toBe('rolled_back');
  });
});
