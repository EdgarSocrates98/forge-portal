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
});
