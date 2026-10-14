/**
 * Catalog duplicate detection (spec §4.5) — deterministic, pure, and
 * deliberately conservative.
 *
 * Two catalog entries sharing a normalized name are only ever flagged —
 * never merged. The flag carries one of two warning classes:
 *
 *  - `possible-duplicate`: positive evidence the rows may describe the
 *    same entity. Emitted ONLY when the name matches AND
 *      · every known origin agrees AND no pair of known versions
 *        contradicts ("same origin + same version where known"), OR
 *      · the description token Jaccard similarity is ≥ `threshold`
 *        (default 0.8) — e.g. the same skill vendored into two Forjas.
 *  - `same-name-different-entity`: the name collides but the evidence
 *    says the entities differ (distinct known origins, contradicting
 *    known versions, dissimilar descriptions) — or is simply
 *    insufficient to confirm identity. This is a warning that we could
 *    NOT verify sameness, not an assertion of difference.
 *
 * Absent data (`undefined`/`null` origin, version or description) never
 * counts as evidence for OR against — it is reported as unknown.
 */
export interface DedupEntry {
  /** Catalog row id — reported back in findings. */
  id: string;
  /** Display name; normalized with `normalizeName` for grouping. */
  name: string;
  /** Origin Forja / catalog source — `null`/`undefined` = unverified. */
  origin?: string | null;
  /** Version — `null`/`undefined` = unverified. */
  version?: string | null;
  /** Description text used for token-Jaccard similarity. */
  description?: string | null;
}

export type DedupKind = 'possible-duplicate' | 'same-name-different-entity';

/** Pairwise verdict used inside a finding's evidence trail. */
export interface DedupPairEvidence {
  a: string;
  b: string;
  verdict: DedupKind;
  /** Deterministic reasons, e.g. 'same origin (api-forge)',
   *  'description similarity 0.83', 'different known origins'. */
  reasons: string[];
  /** Jaccard score in [0,1] — `null` when either side had no tokens. */
  similarity: number | null;
}

export interface DedupFinding<T extends DedupEntry = DedupEntry> {
  /** The normalized name every entry collides on. */
  key: string;
  /** Entries sharing the name, in input order — never merged. */
  entries: T[];
  /** 'possible-duplicate' when at least one pair carries positive
   *  evidence; otherwise 'same-name-different-entity'. */
  kind: DedupKind;
  /** Pairwise evidence for every compared pair — the audit trail a
   *  human reviews before doing anything about the collision. */
  pairs: DedupPairEvidence[];
}

/** Default token-Jaccard threshold from spec §4.5. */
export const DEDUP_SIMILARITY_THRESHOLD = 0.8;

/**
 * Name normalization for collision grouping — diacritics folded, case
 * and punctuation neutralized ('Glue ETL' ≡ 'glue-etl' ≡ 'glue_etl'):
 * names differing only in casing or separators collide, which is the
 * classic near-duplicate the reviewer cares about.
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Word-ish tokens of a normalized string — deterministic, stable order. */
export function tokensOf(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const tok of normalizeName(s).split(/[^a-z0-9]+/)) {
    if (tok) out.add(tok);
  }
  return out;
}

/**
 * Token Jaccard similarity in [0,1]. Returns `null` when either side has
 * no tokens — "not measurable" is distinct from "dissimilar" so callers
 * never treat missing text as evidence.
 */
export function tokenSimilarity(a: Set<string>, b: Set<string>): number | null {
  if (a.size === 0 || b.size === 0) return null;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? null : inter / union;
}

interface Prepared<T extends DedupEntry> {
  entry: T;
  key: string;
  origin: string | null;
  version: string | null;
  desc: Set<string>;
}

function prepare<T extends DedupEntry>(e: T): Prepared<T> {
  return {
    entry: e,
    key: normalizeName(e.name || e.id),
    origin: e.origin ? normalizeName(e.origin) : null,
    version: e.version ? normalizeName(e.version) : null,
    desc: tokensOf(e.description),
  };
}

function comparePair<T extends DedupEntry>(
  a: Prepared<T>,
  b: Prepared<T>,
  threshold: number,
): DedupPairEvidence {
  const reasons: string[] = [];
  const similarity = tokenSimilarity(a.desc, b.desc);
  const sameOrigin = a.origin !== null && b.origin !== null && a.origin === b.origin;
  const differentOrigin = a.origin !== null && b.origin !== null && a.origin !== b.origin;
  const versionClash = a.version !== null && b.version !== null && a.version !== b.version;
  const descSimilar = similarity !== null && similarity >= threshold;

  let verdict: DedupKind;
  if ((sameOrigin && !versionClash) || descSimilar) {
    verdict = 'possible-duplicate';
    if (sameOrigin) reasons.push(`same origin (${a.origin})`);
    if (a.version !== null && b.version !== null && a.version === b.version) {
      reasons.push(`same version (${a.version})`);
    }
    if (a.version === null || b.version === null) reasons.push('version unverified');
    if (descSimilar) {
      reasons.push(`description similarity ${similarity!.toFixed(2)} >= ${threshold}`);
    }
    // contradictions stay visible — the human reviewing the flag sees them
    if (differentOrigin) reasons.push(`origins differ (${a.origin} vs ${b.origin})`);
    if (versionClash) reasons.push(`versions differ (${a.version} vs ${b.version})`);
  } else {
    verdict = 'same-name-different-entity';
    if (differentOrigin) reasons.push(`different origins (${a.origin} vs ${b.origin})`);
    if (versionClash) reasons.push(`different versions (${a.version} vs ${b.version})`);
    if (similarity !== null) {
      reasons.push(`description similarity ${similarity.toFixed(2)} < ${threshold}`);
    } else {
      reasons.push('description unverified — similarity not measurable');
    }
    if (!sameOrigin && !differentOrigin) reasons.push('origin unverified');
  }
  return { a: a.entry.id, b: b.entry.id, verdict, reasons, similarity };
}

/**
 * Group `entries` by normalized name and classify every collision.
 * Deterministic: groups come out in first-seen name order, pairs in
 * input order. Single-entry names produce no finding — a unique name is
 * never a duplicate concern.
 */
export function findDuplicateGroups<T extends DedupEntry>(
  entries: readonly T[],
  threshold = DEDUP_SIMILARITY_THRESHOLD,
): DedupFinding<T>[] {
  const byName = new Map<string, Prepared<T>[]>();
  for (const e of entries) {
    const p = prepare(e);
    const key = p.key;
    if (!key) continue; // nameless rows can't collide by name
    const list = byName.get(key);
    if (list) list.push(p);
    else byName.set(key, [p]);
  }

  const findings: DedupFinding<T>[] = [];
  for (const [key, group] of byName) {
    if (group.length < 2) continue;
    const pairs: DedupPairEvidence[] = [];
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        pairs.push(comparePair(group[i], group[j], threshold));
      }
    }
    const kind: DedupKind = pairs.some((p) => p.verdict === 'possible-duplicate')
      ? 'possible-duplicate'
      : 'same-name-different-entity';
    findings.push({ key, entries: group.map((g) => g.entry), kind, pairs });
  }
  return findings;
}
