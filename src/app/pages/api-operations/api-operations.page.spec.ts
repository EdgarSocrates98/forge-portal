import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api/api.error';
import { I18nService } from '../../core/i18n/i18n.service';
import { PfApi } from '../../pf/pf-api.service';
import { PfApiSpec, PfProduct, PfProductHealth } from '../../pf/pf.models';
import { ApiOperationsPage } from './api-operations.page';

const PRODUCT: PfProduct = {
  id: 'payments',
  workspace_id: 'platform',
  name: 'Payments API',
  description: 'Public payment contract',
  domain: 'payments.example.test',
};

const SPEC: PfApiSpec = {
  id: 'payments-v1',
  product_id: PRODUCT.id,
  name: 'Payments OpenAPI',
  kind: 'openapi',
  version: '1.2.0',
  surface: {
    operations: [
      {
        path: '/payments/{id}',
        method: 'get',
        summary: 'Read a payment',
        params: [{ name: 'id', in: 'path', required: true }],
      },
    ],
  },
};

const HEALTH: PfProductHealth = {
  schema: 'productforge/ProductHealth/v1',
  product_id: PRODUCT.id,
  overall: 84,
  weakest_dimension: 'contract coverage',
  dimensions: {},
};

const text = (el: Element | null | undefined) => el?.textContent ?? '';

function fakeApi(overrides: Partial<Record<keyof PfApi, unknown>> = {}): PfApi {
  return {
    products: vi.fn(() => of({ items: [PRODUCT] })),
    apis: vi.fn(() => of({ items: [SPEC] })),
    productHealth: vi.fn(() => of(HEALTH)),
    ...overrides,
  } as unknown as PfApi;
}

describe('ApiOperationsPage', () => {
  async function setup(overrides: Partial<Record<keyof PfApi, unknown>> = {}) {
    const api = fakeApi(overrides);
    await TestBed.configureTestingModule({
      imports: [ApiOperationsPage],
      providers: [provideRouter([]), { provide: PfApi, useValue: api }],
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

  it('renders only the live Product Forge product, contract and endpoint evidence', async () => {
    const { api, component, el } = await setup();

    expect(api.products).toHaveBeenCalledTimes(1);
    expect(api.apis).toHaveBeenCalledWith(PRODUCT.id);
    expect(api.productHealth).toHaveBeenCalledWith(PRODUCT.id);
    expect(component.surfaceState()).toBe('AVAILABLE');
    expect(text(el.querySelector('.service-panel'))).toContain('Payments API');
    expect(text(el.querySelector('.service-header'))).toContain('Public payment contract');
    expect(text(el.querySelector('.metrics'))).toContain('84%');
    expect(text(el.querySelector('.contract-section'))).toContain('Payments OpenAPI');
    expect(text(el.querySelector('.endpoint-section'))).toContain('/payments/{id}');
    expect(text(el.querySelector('.endpoint-section'))).toContain('Read a payment');
  });

  it('shows UNAVAILABLE and no invented service when Product Forge cannot be reached', async () => {
    const { api, component, el } = await setup({
      products: vi.fn(() => throwError(() => new ApiError(0))),
    });

    expect(api.products).toHaveBeenCalledTimes(1);
    expect(component.surfaceState()).toBe('UNAVAILABLE');
    expect(el.querySelector('ui-error')).toBeTruthy();
    expect(el.querySelector('.service-row')).toBeNull();
    expect(text(el)).not.toContain('Payments API');
  });

  it('keeps the empty state honest when a product has no imported contracts', async () => {
    const { component, el } = await setup({
      apis: vi.fn(() => of({ items: [] })),
    });

    expect(component.specs()).toEqual([]);
    expect(component.selectedSpec()).toBeNull();
    expect(text(el.querySelector('.contract-section'))).toContain('No API contracts');
    expect(text(el.querySelector('.endpoint-section'))).not.toContain('/payments/{id}');
  });
});
