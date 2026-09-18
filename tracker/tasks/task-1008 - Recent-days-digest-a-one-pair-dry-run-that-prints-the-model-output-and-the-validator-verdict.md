---
id: TASK-1008
title: >-
  Recent-days digest: a one-pair dry run that prints the model output and the
  validator verdict
status: To Do
assignee: []
created_date: '2026-09-18 01:59'
labels:
  - 'area:ai-worker'
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1004000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: slice 1 gate on dev (2026-09-18, ticks 01:36/01:46/01:56Z): the owner pair (409 rows, the input at the 40k-token cap) failed three cycles of two billed passes each — final classes first_person, first_person, parse_failure; output sizes 344-553 tokens, so not truncation — while a 4-row pair produced a good digest. Nothing records the generator output (the no-content logging rule is right for prod), so whether this is a validator false positive, a prompt that does not hold on a 40k input, or malformed JSON from GLM 5.3 with thinking off cannot be told from any surface. This blocks the doc-97 Phase 4 slice 1 acceptance clause (a digest exists on dev for the owner pair) and therefore the slice 2 feed flip.
Fix shape: an operator-run dry run for ONE (persona, personality) pair that runs the real selection + input builder + prompt + invoker + validators and prints to the TERMINAL (never a log): the input window stats, the first-pass raw output, the validator verdict with the matched token, the regeneration raw output and its verdict; no DB write, no usage row (or a usage row flagged dry-run — decide). Placement is the open call: the generator modules live in services/ai-worker and tooling cannot import ai-worker (the 1b constraint that put the selection SQL in common-types), so either (a) an ai-worker-local entry (services/ai-worker/src/scripts/ or a dev-only job) invoked via pnpm ops run --env dev -- tsx ... with ZAI_CODING_API_KEY injected alongside DATABASE_URL (ops run injects only the DB URL today — verify), or (b) move the pure kernel (prompt, input builder, validators) to common-types and give tooling a digest:dry-run command that borrows the invoker route resolution. Prefer (a) unless (b) is small; the owner rules on parameter experiments (none without data, memory-epic rule), and this tool IS the data.
Acceptance: pnpm ops <cmd> --env dev --persona <uuid> --personality emily-tzudad-seraph-ditza prints both raw outputs and both verdicts for the owner pair without writing the digest row, and the first run answers which of the three hypotheses holds.
<!-- SECTION:DESCRIPTION:END -->
