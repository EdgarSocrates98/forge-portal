import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { PfApi, PF_BASE_URL_KEY, PF_TOKEN_KEY } from './pf-api.service';
import { ApiError } from '../core/api/api.error';
import { PfHealth } from './pf.models';

const BASE = '/api/v1';

function envelope<T>(data: T): Record<string, unknown> {
  return { schema: 'forge/PortalApi/1', correlation_id: 'c-1', data };
}

async function rejected(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ApiError);
    return e as ApiError;
  }
  throw new Error('expected rejection');
}

describe('PfApi', () => {
  let api: PfApi;
  let http: HttpTestingController;

  beforeEach(() => {
    try {
      sessionStorage.removeItem(PF_BASE_URL_KEY);
      sessionStorage.removeItem(PF_TOKEN_KEY);
      localStorage.removeItem(PF_BASE_URL_KEY);
      localStorage.removeItem(PF_TOKEN_KEY);
    } catch {
      // storage unavailable — defaults apply
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(PfApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('unwraps a forge/PortalApi/1 envelope', async () => {
    const p = firstValueFrom(api.health());
    http
      .expectOne(`${BASE}/health`)
      .flush(envelope<PfHealth>({ status: 'ok', forge_id: 'product-forge', version: '1.0' }));
    expect((await p).status).toBe('ok');
  });

  it('throws ApiError with the engine PF-* code on envelope.error', async () => {
    const p = firstValueFrom(api.products());
    http.expectOne(`${BASE}/products`).flush({
      schema: 'forge/PortalApi/1',
      correlation_id: 'c-2',
      error: { code: 'PF-PRODUCT-LIST', message: 'store unavailable' },
    });
    expect((await rejected(p)).body.code).toBe('PF-PRODUCT-LIST');
  });

  it('rejects a foreign schema as PF-BAD-ENVELOPE', async () => {
    const p = firstValueFrom(api.workspaces());
    http.expectOne(`${BASE}/workspaces`).flush({ items: [] });
    expect((await rejected(p)).body.code).toBe('PF-BAD-ENVELOPE');
  });

  it('attaches the bearer token to private routes', async () => {
    api.setToken('secret-token');
    const p = firstValueFrom(api.workspaces());
    const req = http.expectOne(`${BASE}/workspaces`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer secret-token');
    req.flush(envelope({ items: [] }));
    await p;
  });

  it('omits Authorization when no token is configured', async () => {
    const p = firstValueFrom(api.workspaces());
    const req = http.expectOne(`${BASE}/workspaces`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush(envelope({ items: [] }));
    await p;
  });

  it('persists baseUrl/token and trims a trailing slash', async () => {
    api.setBaseUrl('http://engine:9000/');
    api.setToken('t');
    expect(api.baseUrl()).toBe('http://engine:9000');
    expect(sessionStorage.getItem(PF_BASE_URL_KEY)).toBe('http://engine:9000');
    expect(sessionStorage.getItem(PF_TOKEN_KEY)).toBe('t');
    expect(localStorage.getItem(PF_TOKEN_KEY)).toBeNull();
    const p = firstValueFrom(api.health());
    http.expectOne('http://engine:9000/api/v1/health').flush(envelope({ status: 'ok' }));
    await p;
  });

  it('normalizes an HTTP transport failure into a retryable ApiError', async () => {
    const p = firstValueFrom(api.health());
    http.expectOne(`${BASE}/health`).error(new ProgressEvent('error'), { status: 0 });
    expect((await rejected(p)).transport).toBe(true);
  });

  it('encodes URL preview and import routes under the selected product', async () => {
    const preview = firstValueFrom(api.urlPreview('p 1', 'https://example.com/a?x=1'));
    http.expectOne(
      `${BASE}/products/p%201/documents/url/preview?url=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1&extractor=stdlib`,
    ).flush(envelope({ title: 'Docs', preview: 'body', size: 4, url: 'https://example.com/a?x=1', state: 'ready_for_import' }));
    expect((await preview).title).toBe('Docs');
    const imported = firstValueFrom(api.importUrlDocument('p 1', 'https://example.com/a', 'Docs'));
    const req = http.expectOne(`${BASE}/products/p%201/documents/from-url`);
    expect(req.request.body).toEqual({
      confirm: 'import',
      url: 'https://example.com/a',
      title: 'Docs',
      extractor: 'stdlib',
    });
    req.flush(envelope({ id: 'doc-1', title: 'Docs' }));
    expect((await imported).id).toBe('doc-1');
  });

  it('loads a product-scoped document explorer payload', async () => {
    const p = firstValueFrom(api.documentDetail('p 1', 'doc/1'));
    http.expectOne(`${BASE}/products/p%201/documents/doc%2F1`).flush(envelope({
      document: { id: 'doc/1', title: 'Docs' },
      content: { chunks: [], chunk_count: 0 },
      versions: { state: 'current_only', items: [] },
    }));
    expect((await p).document.title).toBe('Docs');
  });
});
