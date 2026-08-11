---
id: doc-21
title: 'Theme: Synchronous Work & Timeout Budgets'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Synchronous Work & Timeout Budgets

_Focus: stop budgeting long-running work with a client timeout. Operations whose duration scales with data belong on a queue, not on an HTTP request._

Surfaced 2026-07-24 during the follow-ups triage. ~20 rows across the flat table
share one shape: **an operation outgrew the request it rides on, and the recorded
fix was to raise a timeout.** Raising the timeout is the stopgap every one of
these rows names; the durable fix is the same in each case.

**The tell**: the manifest caps `timeoutMs` at 60s, and multiple rows have
already consumed their raise. `db-sync` went 10s → 30s → `LONG_SYNC` (300s) in
three separate deferrals, each filed as its own row. There is no fourth raise.

### Phase 1 — Convert the operations that have exhausted their raises

- [ ] **`db-sync` as an async job.** Duration scales with table size; a
      fact-carrying sync already succeeded server-side AFTER the client aborted
      (false-failure UX). Three rows track this: the original async proposal
      (2026-05-30), the LONG_SYNC raise (2026-07-11), and the measured
      first-post-release overrun — two completions aborted at exactly the
      budget, 29997ms/29995ms, converging only on the third retry (2026-07-06).
      **Promote when**: a run exceeds ~2 min under normal load, or a third route
      wants the LONG_SYNC exemption.
- [ ] **`deleteVoice`/`clearVoices` chain sequential external calls** — delete
      does fetch-then-delete (2 × 30s), clear loops N deletes. Both can exceed
      the manifest's 60s ceiling; genuinely a different shape than the
      single-call routes the timeout contract was scoped to. (2026-06-24)
- [ ] **Account deletion** runs synchronously in one 60s transaction. Atomicity
      was the owner's deliberate choice over a job that could half-delete — so
      this promotes on a measurement, not on principle. **Promote when**: logged
      deletion duration p95 > 10s. (2026-07-15)

### Phase 2 — Cold-start is not synthesis time

- [ ] **Decouple voice-engine cold-start from the TTS synthesis timeout.**
      `TTSStep.runWithTimeout` wraps warmup AND synthesis in one race, so a
      cold start eats the synthesis budget. Observed: ~52s cold-start + 190s
      synthesis blew a 240s budget and the late audio was discarded. Hit
      routinely, not rarely — guardrail-blocked content always falls back to the
      serverless engine. (2026-06-29)
- [ ] **Keep the prod voice-engine warm** so the STT budget is inference, not
      cold start (~23–135s variance). Note the cost constraint: a keep-warm
      toggle was previously overruled on hosting spend, so prefer the
      timeout-decoupling above unless the owner opts into cost. (2026-06-27)

### Phase 3 — Budget hygiene (prevent the next one)

- [ ] **Fetch-detecting guard** so an external-call route can't ship without
      declaring `externalCallBudgetMs`. The manifest invariant only fires for
      routes that already declare one — a new route that forgets slips through.
      This is the structural fix that stops Phase 1 recurring. (2026-06-24)
- [ ] **Monitor the default-timeout (2500ms) allowlist** — `search`
      (pgvector), `batchDelete`, `purge`, `clearHistory` are registered as
      "fast" but unverified. (2026-05-30)
- [ ] **Per-call `timeoutMs` override** for dual-context list routes:
      autocomplete callers share a 10s route budget while Discord expires the
      interaction at 3s. Co-fix candidate with the generated-client
      required-query-param row, same `method-builder.ts` territory. (2026-05-30)

### Phase 4 — Fast-pool residue

Coherent sub-cluster from the fast-pool timeout work; overlaps
Database Performance Audit (`doc-3`) — fold there if that
theme is picked up first.

- [ ] Type the `applyFastPoolDeadConnRetry` `$extends` result (2026-07-01)
- [ ] Self-label read-path fast-pool failures symmetrically with the write path (2026-07-01)
- [ ] Watch the tightened ladder's label rates post-deploy (2026-07-01)
- [ ] Document the "pooler strips `options` → gateway boot fails" caveat (2026-06-25)
- [ ] Fast-pool code-polish nits ×3 (2026-06-25)
- [ ] Re-check the main-pool idle-in-tx GUC if interactive transactions arrive (2026-07-12)

### Phase 5 — Job lifecycle edges

- [ ] `JobTracker` orphan state after `JobFailureListener` cancels — a stale
      "taking longer" notification can sit up to 40 min (2026-05-19)
- [ ] `MultiTagRecovery` background-run race with `startResultsListener` after
      the 30s timeout (2026-05-16)
- [ ] `adoptRehydratedEntry` all-terminal path may leak ordering-service state (2026-05-16)
- [ ] Schema versioning for BullMQ jobs — filed 2026-01-26, the joint-oldest row
      in the table (2026-01-26)

### Notes

The items live in `tracker/tasks/` as the authoritative text; this file is the
scope index. When a phase is picked up, mark its tasks Done per
`06-backlog`'s session-end removal gate rather than duplicating them here.
