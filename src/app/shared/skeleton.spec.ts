import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { SkeletonKind, UiSkeleton } from './skeleton';

describe('UiSkeleton', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [UiSkeleton] }).compileComponents();
  });

  function create(kind?: SkeletonKind, lines?: number): ComponentFixture<UiSkeleton> {
    const fixture = TestBed.createComponent(UiSkeleton);
    if (kind) fixture.componentRef.setInput('kind', kind);
    if (lines !== undefined) fixture.componentRef.setInput('lines', lines);
    fixture.detectChanges();
    return fixture;
  }

  it('renders one text line by default, hidden from assistive tech', () => {
    const fixture = create();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('data-kind')).toBe('text');
    expect(host.querySelectorAll('.s--line').length).toBe(1);
  });

  it('renders N text lines with only the last one short', () => {
    const fixture = create('text', 4);
    const lines = fixture.nativeElement.querySelectorAll('.s--line');
    expect(lines.length).toBe(4);
    expect(lines[0].classList.contains('s--short')).toBe(false);
    expect(lines[3].classList.contains('s--short')).toBe(true);
  });

  it('renders card blocks', () => {
    const fixture = create('card', 3);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelectorAll('.s--card').length).toBe(3);
    expect(host.querySelectorAll('.s--line').length).toBe(0);
  });

  it('renders rows as avatar + two text lines each', () => {
    const fixture = create('row', 2);
    const rows = fixture.nativeElement.querySelectorAll('.s-row');
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.s--avatar')).toBeTruthy();
    expect(rows[0].querySelectorAll('.s--line').length).toBe(2);
  });

  it('renders avatar placeholders', () => {
    const fixture = create('avatar', 3);
    const host = fixture.nativeElement as HTMLElement;
    expect(host.getAttribute('data-kind')).toBe('avatar');
    expect(host.querySelectorAll('.s--avatar').length).toBe(3);
  });

  it('clamps lines to at least 1', () => {
    const fixture = create('text', 0);
    expect(fixture.nativeElement.querySelectorAll('.s--line').length).toBe(1);
  });
});
