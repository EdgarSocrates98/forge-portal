import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DiagnosticsBlock } from './diagnostics-block';
import { HealthCheck } from '../../core/api/api.models';

const CHECKS: HealthCheck[] = [
  { id: 'env:vars', state: 'PASS' },
  { id: 'env:home', state: 'PASS' },
  {
    id: 'drift:/etc/x',
    state: 'FAIL',
    detail: 'content changed after install',
    repairable: true,
    guidance: {
      problema: 'drift em /etc/x',
      causa_provavel: 'edição manual fora do install',
      acao: 'theforge repair',
      estado: 'FAIL',
    },
  },
];

describe('DiagnosticsBlock', () => {
  function setup(checks: HealthCheck[] | null, healthLoaded = true) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(DiagnosticsBlock);
    fixture.componentRef.setInput('checks', checks);
    fixture.componentRef.setInput('healthLoaded', healthLoaded);
    return fixture.componentInstance;
  }

  it('expands only failing/guided checks — PASS rows collapse to a count', () => {
    const c = setup(CHECKS);
    expect(c.expanded().length).toBe(1);
    expect(c.expanded()[0].id).toBe('drift:/etc/x');
    expect(c.passCount()).toBe(2);
  });

  it('renders verbatim guidance; estado comes from guidance when present', () => {
    const c = setup(CHECKS);
    const row = c.expanded()[0];
    expect(row.guidance?.causa_provavel).toContain('edição manual');
    expect(c.estado(row)).toBe('FAIL');
    expect(c.repairable(row)).toBe(true);
  });

  it('no checks loaded → empty lists, never an invented problem', () => {
    const c = setup(null);
    expect(c.expanded()).toEqual([]);
    expect(c.passCount()).toBe(0);
  });

  it('an answered-but-empty check list stays empty', () => {
    const c = setup([]);
    expect(c.expanded()).toEqual([]);
    expect(c.passCount()).toBe(0);
  });
});
