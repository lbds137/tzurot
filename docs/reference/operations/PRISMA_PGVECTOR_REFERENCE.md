# Prisma + pgvector Operations Reference

pgvector-specific reference material — the parts of running Prisma against this
database that pgvector makes unusual.

**The migration workflow itself lives elsewhere and is not repeated here:**

- `.claude/rules/03-database.md` — connection/pool rules, protected indexes, the
  drift-ignore two-tier structure, and the deployment timing rule (migrations
  are **operator-driven**: `pnpm ops release:premigrate` before merging a
  release PR, `pnpm ops db:migrate --env dev` after a push to develop). No
  Dockerfile runs `prisma migrate deploy`, and nothing applies migrations
  automatically on deploy.
- `/tzurot-db-vector` skill — the step-by-step procedure: `db:safe-migrate` →
  review SQL → `db:migrate` → regenerate the PGLite schema, plus drift
  detection, inspection, and protected-index recovery.

---

## The vector indexes

Two IVFFlat indexes exist, both on 384-dimension BGE-small-en-v1.5 embeddings,
both managed **outside** Prisma because `Unsupported("vector")` columns can't
declare `VectorCosineOps`:

| Index                        | Table          | Definition                                       |
| ---------------------------- | -------------- | ------------------------------------------------ |
| `idx_memories_embedding`     | `memories`     | `ivfflat (embedding vector_cosine_ops) lists=50` |
| `idx_memory_facts_embedding` | `memory_facts` | `ivfflat (embedding vector_cosine_ops) lists=50` |

Both are registered in `prisma/drift-ignore.json`'s `protectedIndexes` array,
so the DROP statements Prisma generates for them are stripped from new
migrations — and both carry `recreateSQL` there for recovery.

## Why `lists = 50`

The `lists` parameter trades recall against build memory and query speed. More
lists means better accuracy but a larger build; fewer means a cheaper build and
faster queries at some recall cost.

`lists = 50` is not a tuning preference — it is a memory ceiling. The build for
`lists = 100` exceeded Railway's `maintenance_work_mem` (64 MB) and failed with
"No space left on device"; the migration that resized the index down
(`20251117155350_update_memories_index_to_lists_50`) records that constraint.
If a future index build hits the same error, reduce `lists` rather than
retrying — for HNSW the equivalent knobs are `m` and `ef_construction`.

## Query-time probes

Every `<=>` query runs through `queryRawWithExactVectorSearch`
(`packages/common-types/src/services/vectorSearch.ts`), which sets
`ivfflat.probes` to `PGVECTOR_SEARCH.IVFFLAT_PROBES` (32768, the GUC maximum)
transaction-locally. At the default `probes = 1` a persona/personality-filtered
query scanned one of 50 lists and post-filtered, missing most true neighbours
(dev, 2026-10-05: 57/200 of the exact top-20 across 10 queries). With the
setting: 200/200, ~30 ms execution on a 6.6k-row persona/personality pair and
~95 ms for a 22k-row persona-only search. A new vector query must use the helper.

## Creating a vector index by hand

Always idempotent:

```sql
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
```

`CONCURRENTLY` avoids the write lock on a populated table, but **cannot run
inside a transaction block** — so it will not work through
`npx prisma db execute`, which wraps its input. Run it via `psql` against the
target database instead.

## Similarity queries

Vector search goes through `prisma.$queryRaw`, never the ORM — the canonical
query is `services/ai-worker/src/services/PgvectorQueryBuilder.ts` (cosine
distance `<=>`, a max-distance bound, `LIMIT`); the rule is
`.claude/rules/03-database.md` § pgvector Operations.

---

## References

- [pgvector](https://github.com/pgvector/pgvector)
- [`PRISMA_DRIFT_ISSUES.md`](../database/PRISMA_DRIFT_ISSUES.md) — the intentional schema/Prisma divergences, including these indexes
- [Railway Operations Guide](../deployment/RAILWAY_OPERATIONS.md)
