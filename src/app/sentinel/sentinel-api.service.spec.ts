import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { firstValueFrom } from 'rxjs';
import {
  SENTINEL_BASE_URL_KEY,
  SENTINEL_DEFAULT_BASE_URL,
  SENTINEL_TOKEN_KEY,
  SentinelApi,
} from './sentinel-api.service';
import { ApiError } from '../core/api/api.error';
import { SentinelServiceListResponse } from './sentinel.models';

const BASE = SENTINEL_DEFAULT_BASE_URL;

function problem(status: number, code: string, detail = 'refused'): Record<string, unknown> {
  return {
    type: `urn:api-sentinel:${code.split('.').pop()}`,
    title: code,
    status,
    detail,
    code,
    details: {},
  };
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

describe('SentinelApi', () => {
  let api: SentinelApi;
  let http: HttpTestingController;

  beforeEach(() => {
    try {
      sessionStorage.removeItem(SENTINEL_BASE_URL_KEY);
      sessionStorage.removeItem(SENTINEL_TOKEN_KEY);
      localStorage.removeItem(SENTINEL_BASE_URL_KEY);
      localStorage.removeItem(SENTINEL_TOKEN_KEY);
    } catch {
      // storage unavailable — defaults apply
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(SentinelApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('defaults to the documented loopback base URL', () => {
    expect(api.baseUrl()).toBe('http://127.0.0.1:8317');
  });

  it('hits {baseUrl}/v1/* — never the forge/PortalApi/1 surface', async () => {
    const body: SentinelServiceListResponse = {
      services: [],
      unknowns: [],
      evidence_refs: [],
    };
    const p = firstValueFrom(api.services());
    const req = http.expectOne(`${BASE}/v1/services`);
    expect(req.request.url).toBe(`${BASE}/v1/services`);
    req.flush(body);
    expect((await p).services).toEqual([]);
  });

  it('keeps unknowns + evidence_refs verbatim (honest-read envelope)', async () => {
    const p = firstValueFrom(api.services());
    http.expectOne(`${BASE}/v1/services`).flush({
      services: [],
      unknowns: ['coverage incomplete: source src_x unregistered'],
      evidence_refs: ['ev_01'],
    });
    const res = await p;
    expect(res.unknowns).toEqual(['coverage incomplete: source src_x unregistered']);
    expect(res.evidence_refs).toEqual(['ev_01']);
  });

  it('attaches the bearer token when configured', async () => {
    api.setToken('tok-abc');
    const p = firstValueFrom(api.health());
    const req = http.expectOne(`${BASE}/v1/health`);
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok-abc');
    req.flush({});
    await p;
  });

  it('omits Authorization without a token', async () => {
    const p = firstValueFrom(api.capabilities());
    const req = http.expectOne(`${BASE}/v1/capabilities`);
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({ capabilities: [], unknowns: [], evidence_refs: [] });
    await p;
  });

  it('maps application/problem+json verbatim to ApiError', async () => {
    const p = firstValueFrom(api.services());
    http
      .expectOne(`${BASE}/v1/services`)
      .flush(problem(401, 'sentinel.unauthorized', 'missing_credentials'), {
        status: 401,
        statusText: 'Unauthorized',
      });
    const err = await rejected(p);
    expect(err.status).toBe(401);
    expect(err.body.code).toBe('sentinel.unauthorized');
    expect(err.body.message).toBe('missing_credentials');
  });

  it('maps a 403 scope denial to its real code', async () => {
    const p = firstValueFrom(api.startInvestigation('inc_1'));
    http
      .expectOne(`${BASE}/v1/incidents/inc_1/investigations`)
      .flush(problem(403, 'sentinel.forbidden', 'scope investigate required'), {
        status: 403,
        statusText: 'Forbidden',
      });
    const err = await rejected(p);
    expect(err.body.code).toBe('sentinel.forbidden');
  });

  it('maps transport failure to a retryable ApiError', async () => {
    const p = firstValueFrom(api.services());
    http.expectOne(`${BASE}/v1/services`).error(new ProgressEvent('error'));
    const err = await rejected(p);
    expect(err.status).toBe(0);
    expect(err.body.retryable).toBe(true);
  });

  it('encodes ids and query params in the URL, never the token', async () => {
    api.setToken('tok-secret');
    const p = firstValueFrom(api.serviceMetrics('svc x/y', { windowStart: 'a', maxWindows: 5 }));
    const req = http.expectOne((r) => r.url.startsWith(`${BASE}/v1/services/`));
    expect(req.request.url).toContain('/v1/services/svc%20x%2Fy/metrics');
    expect(req.request.url).toContain('window_start=a');
    expect(req.request.url).toContain('max_windows=5');
    expect(req.request.url).not.toContain('tok-secret');
    req.flush({ metrics: { windows: [] } });
    await p;
  });

  it('posts investigations with idempotency key', async () => {
    const p = firstValueFrom(api.startInvestigation('inc_9', { idempotencyKey: 'k1', note: 'n' }));
    const req = http.expectOne(`${BASE}/v1/incidents/inc_9/investigations`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ idempotency_key: 'k1', note: 'n' });
    req.flush({ investigation: { investigation_id: 'inv_1' }, unknowns: [], evidence_refs: [] });
    await p;
  });

  it('persists baseUrl/token to session storage only', () => {
    api.setBaseUrl('http://127.0.0.1:9000/');
    api.setToken('tok');
    expect(api.baseUrl()).toBe('http://127.0.0.1:9000');
    expect(sessionStorage.getItem(SENTINEL_BASE_URL_KEY)).toBe('http://127.0.0.1:9000');
    expect(sessionStorage.getItem(SENTINEL_TOKEN_KEY)).toBe('tok');
    expect(localStorage.getItem(SENTINEL_TOKEN_KEY)).toBeNull();
  });
});
