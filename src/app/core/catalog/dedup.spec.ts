import {
  DEDUP_SIMILARITY_THRESHOLD,
  DedupEntry,
  findDuplicateGroups,
  normalizeName,
  tokenSimilarity,
  tokensOf,
} from './dedup';

const entry = (e: Partial<DedupEntry> & { id: string }): DedupEntry => ({
  name: e.id,
  ...e,
});

describe('normalizeName / tokensOf', () => {
  it('folds diacritics, case and whitespace', () => {
    expect(normalizeName('  Instalação  Glue ')).toBe('instalacao glue');
  });

  it('tokenizes on non-alphanumeric boundaries into a set', () => {
    expect([...tokensOf('Glue ETL, glue!')].sort()).toEqual(['etl', 'glue']);
  });
});

describe('tokenSimilarity', () => {
  it('is 1 for identical token sets and 0 for disjoint ones', () => {
    expect(tokenSimilarity(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(tokenSimilarity(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('returns null when either side has no tokens — unmeasurable, not dissimilar', () => {
    expect(tokenSimilarity(new Set(), new Set(['a']))).toBeNull();
    expect(tokenSimilarity(new Set(), new Set())).toBeNull();
  });
});

describe('findDuplicateGroups', () => {
  it('ignores unique names entirely', () => {
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: 'alpha', origin: 'api-forge' }),
      entry({ id: 'b', name: 'beta', origin: 'api-forge' }),
    ]);
    expect(findings).toEqual([]);
  });

  it('flags same name + same origin (version unknown) as a possible duplicate', () => {
    const findings = findDuplicateGroups([
      entry({ id: 'a1', name: 'kiro-review', origin: 'the-forge' }),
      entry({ id: 'a2', name: 'Kiro Review', origin: 'the-forge' }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].kind).toBe('possible-duplicate');
    expect(findings[0].entries.map((e) => e.id)).toEqual(['a1', 'a2']);
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('same origin');
  });

  it('flags same name + similar descriptions even across origins', () => {
    const desc = 'run an adversarial review of the current spec and report findings';
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: 'kiro-review', origin: 'the-forge', description: desc }),
      entry({ id: 'b', name: 'kiro-review', origin: 'api-forge', description: desc }),
    ]);
    expect(findings[0].kind).toBe('possible-duplicate');
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('description similarity');
    // the origin contradiction stays visible for the reviewer
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('origins differ');
  });

  it('never auto-merges same-name entries from different origins with different content', () => {
    const findings = findDuplicateGroups([
      entry({
        id: 'a',
        name: 'deploy',
        origin: 'the-forge',
        description: 'orchestrate forge specialists',
      }),
      entry({
        id: 'b',
        name: 'deploy',
        origin: 'spark-forge-aws',
        description: 'emr cluster bootstrap glue',
      }),
    ]);
    expect(findings[0].kind).toBe('same-name-different-entity');
    // both rows survive — nothing is collapsed
    expect(findings[0].entries.length).toBe(2);
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('different origins');
  });

  it('flags same origin + different known versions as different entities', () => {
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: 'x', origin: 'api-forge', version: '1.0', description: 'aa bb' }),
      entry({ id: 'b', name: 'x', origin: 'api-forge', version: '2.0', description: 'cc dd' }),
    ]);
    expect(findings[0].kind).toBe('same-name-different-entity');
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('different versions');
  });

  it('treats unverifiable evidence as different-entity, not as a dup', () => {
    // same name, no origin/version, dissimilar descriptions — we cannot
    // confirm sameness, so the warning class is different-entity.
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: 'x', description: 'alpha beta gamma' }),
      entry({ id: 'b', name: 'x', description: 'delta epsilon zeta' }),
    ]);
    expect(findings[0].kind).toBe('same-name-different-entity');
    expect(findings[0].pairs[0].reasons.join(' ')).toContain('origin unverified');
  });

  it('honors the configured similarity threshold', () => {
    const a = entry({ id: 'a', name: 'x', description: 'one two three four' });
    const b = entry({ id: 'b', name: 'x', description: 'one two three five' });
    // jaccard = 3/5 = 0.6 < 0.8 default → different entity; ≥ 0.5 → dup
    expect(findDuplicateGroups([a, b])[0].kind).toBe('same-name-different-entity');
    expect(findDuplicateGroups([a, b], 0.5)[0].kind).toBe('possible-duplicate');
    expect(DEDUP_SIMILARITY_THRESHOLD).toBe(0.8);
  });

  it('groups three colliding names into one finding with all pairs evidenced', () => {
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: 'x', origin: 'f1' }),
      entry({ id: 'b', name: 'x', origin: 'f1' }),
      entry({ id: 'c', name: 'x', origin: 'f2', description: 'totally other words here' }),
    ]);
    expect(findings.length).toBe(1);
    expect(findings[0].entries.length).toBe(3);
    expect(findings[0].pairs.length).toBe(3);
    // at least one pair is a possible-duplicate → group kind promotes it
    expect(findings[0].kind).toBe('possible-duplicate');
    // …while the f2 pair evidence still says different entity
    const f2pairs = findings[0].pairs.filter((p) => p.b === 'c');
    expect(f2pairs.every((p) => p.verdict === 'same-name-different-entity')).toBe(true);
  });

  it('does not let a nameless row collide', () => {
    const findings = findDuplicateGroups([
      entry({ id: 'a', name: '' }),
      entry({ id: 'b', name: '' }),
    ]);
    // both normalize to their ids ('a'/'b') — distinct, no group
    expect(findings).toEqual([]);
  });
});
