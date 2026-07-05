# Memory Retrieval Eval Harness

The measurement tool behind the memory-architecture design's phase gates (§3.9).
**Not a CI gate** — run manually before/after each memory phase:

```bash
pnpm eval:memory
```

The script is a bare vitest invocation (same pattern as the component/integration
tiers): `@tzurot/embeddings` and `@tzurot/test-utils` resolve to `dist/`, so on
a fresh clone or after a branch switch run `pnpm build` first.

## What it does

Runs the golden corpus (`services/ai-worker/src/services/eval/retrieval-goldens.json`)
through the REAL production retrieval stack: real local embeddings
(`@tzurot/embeddings`), the real `PgvectorMemoryAdapter` SQL, PGLite+pgvector.
Two assertion kinds per golden:

- **`expectAbsent`** — hard invariants (deleted-memory exclusion, cross-persona
  isolation). These fail the run outright; they are correctness.
- **`expectRecall`** — quality measurement: per-golden recall@K, reported and
  written to `eval-results.json` (gitignored, transient).

Recall is **rank-based** (floor threshold), deliberately independent of the
production similarity cutoff — the eval measures whether the right memory RANKS,
the cutoff is a separately tunable knob. Measured fact from the phase-0 baseline
run: a paraphrase query at the old 0.85 default returns zero rows; real
paraphrase similarity on the 384-dim model lands well below it. Phase 1a's
hybrid (FTS+RRF) retrieval targets exactly this.

## Baselines and phase gates

- `phase0-baseline.json` (committed) is the reference point. When a phase's
  retrieval work lands, run the eval, compare against the previous baseline,
  and commit the new one as `phase<N>-baseline.json` with `generatedForPhase`
  set. The design's gates ("two consecutive phases fail their golden gates
  (>20% failures)") and re-open triggers fire on these numbers.

## Accreting goldens

Add real conversation snapshots to `retrieval-goldens.json` as they surface —
especially owner-reported misses ("the bot should have remembered X"). Shape:
seeds (with optional `visibility` / `persona: "other"` tags), a query, `k`,
`expectRecall` substrings, `expectAbsent` substrings. Synthetic seeds
established the format; real snapshots make the numbers mean something.
Extraction goldens (message → expected facts) join in Phase 2.
