import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { SentinelApi } from '../../sentinel/sentinel-api.service';
import {
  SentinelHealth,
  SentinelIncidentListResponse,
  SentinelServiceListResponse,
} from '../../sentinel/sentinel.models';
import { ApiOperationsPage } from './api-operations.page';

const HEALTH: SentinelHealth = {
  state: 'AVAILABLE',
  version: '0.10.0-test',
  workspace_initialized: true,
  database: 'present',
  capabilities: { implemented: 4, tested: 3 },
  sentinel: {},
  unknowns: [],
  evidence_refs: [],
};

const SERVICES: SentinelServiceListResponse = {
  services: [
    {
      service: {
        service_id: 'svc_pay',
        service_name: 'payments-api',
        environment_id: 'lab',
        namespace: null,
        display_name: 'Payments API',
        external_refs: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      health: {
        service_id: 'svc_pay',
        state: 'AVAILABLE',
        condition: 'observed',
        evaluated_at: '2026-01-01T00:12:00Z',
        latest_window_start: '2026-01-01T00:07:00Z',
        latest_window_end: '2026-01-01T00:08:00Z',
        latest_indicators: null,
        absent_indicators: ['latency_p99_ms'],
        quality: 'COMPLETE',
        sources: [],
        unknowns: [],
        limitations: [],
      },
      coverage: {
        sources_registered: 1,
        sources_observed: 1,
        observations: 8,
        latest_window_end: '2026-01-01T00:08:00Z',
      },
      open_incidents: 1,
      slo_definitions: 1,
    },
  ],
  unknowns: [],
  evidence_refs: [],
};

const INCIDENTS: SentinelIncidentListResponse = {
  incidents: [
    {
      incident_id: 'inc_1',
      title: 'checkout-api error ratio elevated',
      severity: 'SEV2',
      status: 'DETECTED',
      service_id: 'svc_co',
      operation_id: null,
      operation_ref: null,
      group_key: 'error_ratio',
      first_observed_at: '2026-01-01T00:05:00Z',
      detected_at: '2026-01-01T00:06:00Z',
      acknowledged_at: null,
      resolved_at: null,
      owner: null,
      revision: 1,
      service_refs: [],
      operation_refs: [],
      rule_refs: [],
      anomaly_ids: [],
      evidence_refs: [],
      hypotheses: [],
      verifications: [],
      change_refs: [],
      actions: [],
      limitations: [],
      dedup: null,
    },
  ],
  unknowns: [],
  evidence_refs: [],
};

const text = (el: Element | null | undefined) => el?.textContent ?? '';

function fakeApi(overrides: Partial<Record<keyof SentinelApi, unknown>> = {}): SentinelApi {
  return {
    baseUrl: signal('http://127.0.0.1:8317'),
    token: signal(''),
    health: vi.fn(() => of(HEALTH)),
    services: vi.fn(() => of(SERVICES)),
    incidents: vi.fn(() => of(INCIDENTS)),
    capabilities: vi.fn(() => of({ capabilities: [], unknowns: [], evidence_refs: [] })),
    integrations: vi.fn(() => of({ integrations: [], unknowns: [], evidence_refs: [] })),
    ...overrides,
  } as unknown as SentinelApi;
}

describe('ApiOperationsPage (sentinel)', () => {
  async function setup(overrides: Partial<Record<keyof SentinelApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [ApiOperationsPage],
      providers: [provideRouter([]), { provide: SentinelApi, useValue: api }],
    }).compileComponents();
    await TestBed.inject(I18nService).applyPreference('en');
    const fixture = TestBed.createComponent(ApiOperationsPage);
    await fixture.whenStable();
    fixture.detectChanges();
    return {
      fixture,
      api,
      component: fixture.componentInstance,
      el: fixture.nativeElement as HTMLElement,
    };
  }

  it('renders the Sentinel health badge and tab nav', async () => {
    const { api, el } = await setup();
    expect(api.health).toHaveBeenCalledTimes(1);
    expect(text(el.querySelector('.head__meta'))).toContain('api-sentinel 0.10.0-test');
    expect(el.querySelectorAll('.tab').length).toBe(3);
  });

  it('renders the real service inventory row with health state', async () => {
    const { api, el } = await setup();
    expect(api.services).toHaveBeenCalledTimes(1);
    const body = text(el);
    expect(body).toContain('Payments API');
    expect(body).toContain('svc_pay');
    expect(body).toContain('Available');
  });

  it('shows the connection hint when Sentinel is unreachable', async () => {
    const { el } = await setup({
      health: vi.fn(() => throwError(() => new ApiError(0))),
      services: vi.fn(() => throwError(() => new ApiError(0))),
    });
    expect(text(el.querySelector('.hint'))).toContain('unreachable');
    // the honest error panel — never a fabricated inventory
    expect(el.querySelector('ui-error')).toBeTruthy();
  });

  it('opens the connection card on demand', async () => {
    const { fixture, el } = await setup();
    const btn = [...el.querySelectorAll('.head__meta .btn')].find((b) =>
      text(b).includes('Sentinel connection'),
    ) as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    expect(el.querySelector('sentinel-connection')).toBeTruthy();
    expect(text(el.querySelector('sentinel-connection'))).toContain('Base URL');
  });
});
