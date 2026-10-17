# Search benchmark — structured search vs. embeddings (§8.4 gate)

Date: 2026-10-17 · Branch: `fix/nextgen-gaps` · axe 4.14.0 / Angular 22.2

This is the measured baseline `assistant-eval.md` requires before any
embedding/RAG work can be justified: real latency and real hit quality
of the **current** structured search over the **actual** portal corpus.

## Method (reproducible)

1. **Ranking path** — `src/app/core/search/search.data.ts` compiled with
   esbuild and run directly (no browser, no DI — the pure scorer is the
   shipped code path). Index = the corpus the e2e `PortalAdapter` really
   serves: 18 page entries, 10 capabilities, 1 forge specialist, 1 skill,
   1 agent, 1 MCP server, 3 hosts → **35 entries**. 1,000 iterations per
   query after warmup.
2. **Docs path** — live `PortalServer` (real HTTP loopback),
   `GET /api/v1/docs/search?q=…&limit=8`, 30 samples per query.
3. **Scaling probe** — same worst query re-run with 535 / 1,035 / 5,035 /
   20,035 entries (synthetic `operation` rows appended) to find where
   linear scoring stops being free.

## Results — in-process ranking (µs)

| query              | top hits (kind:label)                                   | mean | p50 | p95 | p99 |
| ------------------ | ------------------------------------------------------- | ---- | --- | --- | --- |
| install            | capability:install                                      | 11.8 | 6.7 | 16.3 | 29.0 |
| instalação         | page:Instalação (diacritic folded)                      | 8.4 | 7.1 | 8.3 | 25.9 |
| graph              | capability:graph, page:Graph Studio                     | 7.0 | 6.5 | 7.3 | 18.6 |
| agents             | capability:agents                                       | 2.6 | 2.4 | 2.4 | 3.0 |
| mcp                | page:MCP, capability:mcp, mcp:e2e-forge-mcp             | 7.7 | 6.6 | 7.2 | 22.5 |
| hosts              | capability:hosts, page:Hosts de IA                      | 5.6 | 5.7 | 6.4 | 18.8 |
| tasks              | capability:tasks                                        | 2.3 | 2.2 | 2.3 | 2.4 |
| claude             | host:claude                                             | 2.3 | 2.2 | 2.3 | 2.7 |
| devin              | host:devin, mcp:e2e-forge-mcp                           | 2.8 | 2.6 | 2.9 | 3.2 |
| analyze            | skill:Analyze                                           | 2.3 | 2.2 | 2.3 | 3.3 |
| reviewer           | agent:Reviewer                                          | 2.3 | 2.0 | 2.0 | 2.6 |
| federation         | capability:federation                                   | 2.2 | 2.0 | 2.0 | 2.4 |
| install plan       | — (local index miss; docs path answers, below)          | 2.1 | 2.0 | 2.1 | 2.6 |
| E2E_FORGE_HOME     | — (local miss; docs path answers, below)                | 1.7 | 1.7 | 1.7 | 2.0 |
| nonexistent-xyz-q  | — (honest zero, no invented hit)                        | 1.5 | 1.5 | 1.5 | 1.8 |

## Results — `GET /docs/search` (ms, live server)

| query                     | hits | mean | p95 | top result       |
| ------------------------- | ---- | ---- | --- | ---------------- |
| install                   | 1    | 2.91 | 2.07 | docs/install.md |
| graph                     | 0    | 1.83 | 2.44 | —               |
| plan review confirm apply | 1    | 1.88 | 2.31 | docs/install.md |
| E2E_FORGE_HOME            | 1    | 1.92 | 2.53 | docs/env.md     |
| environment               | 1    | 1.92 | 2.30 | docs/env.md     |
| guide                     | 1    | 1.63 | 2.08 | docs/install.md |
| setup                     | 1    | 1.66 | 1.98 | docs/env.md     |
| apply                     | 1    | 1.60 | 1.94 | docs/install.md |
| nonexistent-xyz-q         | 0    | 1.85 | 2.17 | —               |
| docs                      | 0    | 1.66 | 2.00 | —               |

## Hit-quality verdict (manual, per query)

- **12/15 queries return the expected entity in tier 0–2**: pages for
  nav terms, exact entity for `claude`/`devin`/`analyze`/`reviewer`,
  diacritic folding works (`instalação` → Instalação).
- **3 queries that miss locally are answered by the server docs path**
  (`install plan`, `E2E_FORGE_HOME`, `environment`) or honestly return
  zero (`nonexistent-xyz-q`) — no fabricated hits.
- `install` ranks `capability:install` above `page:Instalação` because
  capability labels are normalized ids while page labels are translated;
  acceptable ordering, noted for future label tuning.
- No semantic paraphrase wins exist in the current corpus small enough to
  enumerate — this is exactly the regime structured ranking is for.

## Scaling probe (worst query p95)

| index entries | worst p95 |
| ------------- | --------- |
| 35 (actual)   | ≤ 16.3 µs |
| 535           | 49.1 µs |
| 1,035         | 99.4 µs |
| 5,035         | 434.8 µs |
| 20,035        | 1,942.2 µs |

Linear scoring stays under ~2 ms worst-case even at 20k entries — two
orders of magnitude beyond any plausible portal corpus.

## Embeddings cost analysis (honest)

Adding vector retrieval would require: an embedding model/pipeline
(dependency + model download — incompatible with offline-first core), a
vector index with its own lifecycle and freshness story, storage growth,
score-fusion rules vs. the deterministic tiers, and a new class of
"unexplained rank" bugs. **Expected benefit on this corpus: ~zero** —
the miss surface is either (a) absent entities (no model helps) or
(b) doc prose retrieval, which the server endpoint already covers and
which is the only candidate worth revisiting (assistant-eval §8.4).

**Conclusion: structured search is sufficient on the current corpus.**
No embedding work is justified by this measurement.

## Reevaluation criteria (re-open only if ANY hold)

- Local index > ~5,000 entries AND measured p95 > 150 ms on the slowest
  representative query set (re-run this harness).
- Manual relevance review shows >20% of a fixed 50-query real-user log
  missing the intended entity from top-5.
- A docs corpus > ~500 documents appears, making the server's
  substring `docs/search` recall insufficient (measure miss rate first).
- A concrete semantic paraphrase case lands where a user query shares no
  token with the target label (record the query, don't speculate).
