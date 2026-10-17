import {
  MAX_SEARCH_RESULTS,
  SEARCH_KIND_LABEL,
  SEARCH_KIND_ORDER,
  SearchKind,
  makeSearchEntry,
  normalizeSearchText,
  rankSearchEntries,
  scoreEntry,
} from './search.data';

const entry = (id: string, kind: SearchKind, label: string, sublabel?: string) =>
  makeSearchEntry({ id, kind, label, sublabel, icon: 'x' });

describe('search.data — normalization', () => {
  it('folds diacritics, case and whitespace', () => {
    expect(normalizeSearchText('  Instalação   Completa ')).toBe('instalacao completa');
    expect(normalizeSearchText('SÃO Paulo')).toBe('sao paulo');
  });
});

describe('search.data — scoring', () => {
  it('exact > prefix > substring > doc-tier', () => {
    const exact = entry('a', 'skill', 'abc');
    const prefix = entry('b', 'skill', 'abc-x');
    const sub = entry('c', 'skill', 'zabc');
    const doc = entry('d', 'doc', 'zzz unrelated');
    expect(scoreEntry(exact, 'abc')).toBe(0);
    expect(scoreEntry(prefix, 'abc')).toBe(1);
    expect(scoreEntry(sub, 'abc')).toBe(2);
    // server-side docs hits stay even when the title does not match
    expect(scoreEntry(doc, 'qqq')).toBe(2);
    expect(scoreEntry(exact, 'qqq')).toBe(-1);
  });

  it('substring also scans the sublabel', () => {
    const e = entry('p', 'page', 'Hosts', '/hosts');
    expect(scoreEntry(e, 'hosts')).toBe(0); // label match wins
    const e2 = entry('q', 'skill', 'glue', 'spark domain');
    expect(scoreEntry(e2, 'spark')).toBe(2);
  });
});

describe('search.data — ranking', () => {
  it('is deterministic — same input, same output, input order irrelevant', () => {
    const entries = [
      entry('skill:b', 'skill', 'beta'),
      entry('page:/x', 'page', 'Beta'),
      entry('forge:f', 'forge', 'beta'),
      entry('skill:a', 'skill', 'alpha-beta'),
    ];
    const a = rankSearchEntries('beta', entries).map((r) => r.id);
    const b = rankSearchEntries('beta', entries.slice().reverse()).map((r) => r.id);
    expect(a).toEqual(b);
    // exact score ties → kind boost: page > forge > skill
    expect(a).toEqual(['page:/x', 'forge:f', 'skill:b', 'skill:a']);
  });

  it('blank query returns the whole index in kind/label/id order', () => {
    const entries = [
      entry('skill:1', 'skill', 'zed'),
      entry('page:/a', 'page', 'zed'),
      entry('agent:1', 'agent', 'abc'),
      entry('forge:x', 'forge', 'mmm'),
    ];
    const ids = rankSearchEntries('', entries).map((r) => r.id);
    expect(ids).toEqual(['page:/a', 'forge:x', 'agent:1', 'skill:1']);
  });

  it('tie-breaks by normalized label then id inside a kind', () => {
    const entries = [
      entry('skill:2', 'skill', 'bbb'),
      entry('skill:1', 'skill', 'aaa'),
      entry('skill:3', 'skill', 'aaa'),
    ];
    const ids = rankSearchEntries('', entries).map((r) => r.id);
    expect(ids).toEqual(['skill:1', 'skill:3', 'skill:2']);
  });

  it('caps results at MAX_SEARCH_RESULTS', () => {
    const entries = Array.from({ length: MAX_SEARCH_RESULTS + 10 }, (_, i) =>
      entry(`skill:${String(i).padStart(3, '0')}`, 'skill', `s${i}`),
    );
    expect(rankSearchEntries('', entries).length).toBe(MAX_SEARCH_RESULTS);
  });

  it('drops the scorable fields from emitted results', () => {
    const [r] = rankSearchEntries('x', [entry('k', 'host', 'x')]);
    expect(r).not.toHaveProperty('norm');
    expect(r).not.toHaveProperty('normLabel');
    expect(r.kind).toBe('host');
  });
});

describe('search.data — kind contract', () => {
  it('keeps a label key and an order entry for every kind', () => {
    for (const k of SEARCH_KIND_ORDER) {
      expect(SEARCH_KIND_LABEL[k]).toMatch(/^command\.kind\./);
    }
    // operations (tasks) are a §8.1 first-class entity
    expect(SEARCH_KIND_ORDER).toContain('operation');
  });
});
