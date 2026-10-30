import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import { PfApi, PF_BASE_URL_KEY, PF_TOKEN_KEY } from './pf-api.service';
import { ApiError } from '../core/api/api.error';
import { PfHealth } from './pf.models';

const BASE = 'http://127.0.0.1:8470/api/v1';

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
    http.expectOne(`${BASE}/health`).flush(
      envelope<PfHealth>({ status: 'ok', forge_id: 'product-forge', version: '1.0' }),
    );
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
    expect(localStorage.getItem(PF_BASE_URL_KEY)).toBe('http://engine:9000');
    expect(localStorage.getItem(PF_TOKEN_KEY)).toBe('t');
    const p = firstValueFrom(api.health());
    http.expectOne('http://engine:9000/api/v1/health').flush(envelope({ status: 'ok' }));
    await p;
  });

  it('normalizes an HTTP transport failure into a retryable ApiError', async () => {
    const p = firstValueFrom(api.health());
    http.expectOne(`${BASE}/health`).error(new ProgressEvent('error'), { status: 0 });
    expect((await rejected(p)).transport).toBe(true);
  });
});
