---
id: TASK-394
title: >-
  A future transformers.js upgrade could silently stop the embedding overflow
  warn
status: To Do
assignee: []
created_date: '2026-08-01 19:11'
labels:
  - 'size:S'
  - 'area:embeddings'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 394000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Surfaced by #1893 review round 3 (non-blocking, explicitly not a change request).

`countInputTokens` in `packages/embeddings/src/embeddingWorker.ts` calls `tokenizer(text)` synchronously and reads `encoded.input_ids.dims`. Verified correct against the vendored model today: an over-long input returns dims `[1, 602]`.

**The risk**: if `@huggingface/transformers` ever makes the tokenizer async, `tokenizer(text)` returns a Promise, `input_ids` is `undefined`, and the function degrades to `undefined` — which is the SAFE direction (no crash, embedding unaffected) but means the overflow warn silently stops firing with nothing surfaced.

**Why no test was added instead.** A test that mocks an async tokenizer would assert it degrades to `undefined` — which is the current behaviour AND the broken behaviour. It would pass either way, so it is vacuous coverage rather than a regression net. Adding one would look like protection while providing none, which is the exact trap two other findings on this same PR were about.

**Why no defensive code either.** Detecting a thenable and reporting it distinctly is speculative hardening for a library change that has not happened, and the whole counting path is deliberately fail-soft.

**Fix shape when the trigger fires**: at the next `@huggingface/transformers` MAJOR upgrade, re-run the tokenizer shape probe (call `p.tokenizer(text)` on a deliberately over-long input and confirm `input_ids.dims` is still `[1, N]` with N past 512). If it went async, await it. The probe takes about a minute.

**Promote when**: a `@huggingface/transformers` major version bump lands (Dependabot will PR it), OR prod stops emitting `Input exceeded the model window` entirely despite long queries still being assembled.

**Cost of missing it**: the warn goes quiet, which reads as "no overflow" — the same silence this PR existed to remove. Low severity while nothing upgrades; the whole point is that the trigger is external and dated.
<!-- SECTION:DESCRIPTION:END -->
