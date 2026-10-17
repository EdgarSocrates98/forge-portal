# §8.3 — Contextual assistant: evaluation (not implemented)

Status: **study only** — Cycle 5 ships structured search + explainable
recommendations, no chat/LLM surface. This document records how each
§8.3 example question is answerable **today** through deterministic,
structured queries over real endpoints — the baseline any future
assistant must beat before RAG/embeddings are justified (§8.4).

## Contract for any future assistant

- Every answer must cite evidence: endpoint → field (the same
  `source` discipline `recommend.data.ts` already enforces).
- Every answer must state its confidence limits: which sources were
  `unverified`/`unavailable` when it ran.
- **Never** silent action execution from natural language — mutations
  remain plan→confirm→execute through the existing receipts, with the
  assistant at most _drafting_ a plan for human review.

## Question → structured answer map

| §8.3 question                                          | Answered today by                                                                                                                                     | Sources (evidence)                                                                                                | Confidence limits                                                                                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Quais agents possuem habilidades para esta tarefa?     | `agentsForSkill(agents, refs)` + `agentsForDomain(agents, domain)` in `recommend.data.ts`; the `/knowledge` inspector lists them for a selected skill | `GET /api/v1/agents → skills[]`, `→ domains[]`                                                                    | Declared associations only. No measure of actual competence — "declared the skill", never "is good at it". Empty when `/agents` is unverified. |
| Que Forjas oferecem capacidades relacionadas a Spark?  | Unified search (`capability` kind) + `/knowledge` entity filter; `declares`/`origin` edges in the FedGraph                                            | `GET /api/v1/capabilities`, `GET /api/v1/skills → domain`, `/graphs` providers                                    | "Related" = same declared domain. Federation specialists not installed appear only via `GET /api/v1/federation`.                               |
| Quais MCPs estão indisponíveis?                        | `buildRecommendations → mcp-unavailable`; `mcp` kind in unified search                                                                                | `GET /api/v1/mcp/servers → state`                                                                                 | Only reported states (NOT_CONFIGURED/FAILED/DEGRADED). A missing endpoint is `unverified`, not "down".                                         |
| Que componentes podem ser afetados por esta alteração? | FedGraph `nodeNeighbors` — the direct-impact list in `/knowledge` inspector (and Graph Studio)                                                        | all `declares`/`origin`/`associated`/`bound_to` edges + per-edge evidence endpoint                                | 1-hop, declared relations only. Transitive/behavioral impact is out of scope and would be a guess.                                             |
| Quais configurações precisam ser verificadas?          | `incomplete-config` recommendations                                                                                                                   | `bootstrap → account_environment.variables[].required/present/valid`, `GET /api/v1/hosts → integration/supported` | Only declared-required variables and host lifecycle states. Unknown what an absent optional var would do.                                      |
| Que documentação explica essa integração?              | `/knowledge` docs section + per-entity docs hits + `doc` kind in the palette                                                                          | `GET /api/v1/docs/search?q=` (server-side match)                                                                  | Only when the Forja exposes the endpoint; 404 renders "not exposed". No full-text ranking guarantee — match semantics live server-side.        |

## Why no embeddings yet (§8.4)

Structured + textual search covers the fleet's actual questions above
with citable evidence and zero infrastructure. A vector store would add
an embedding pipeline, an index lifecycle and a freshness story — none
of which is justified without a benchmark showing structured retrieval
failing on real queries. Revisit only with a measured miss rate.

## Open gaps an assistant could close (candidates, not commitments)

- Cross-endpoint composition ("agents in domain X whose host is
  unavailable") — today needs two manual steps.
- Natural-language intent → verb mapping for `/tasks/plan` — requires a
  plan-drafting UX behind the existing confirm gate, never direct calls.
- Question answering over docs prose (beyond hit listing) — the first
  legitimate candidate for retrieval work, gated by a benchmark.
