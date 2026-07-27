---
id: TASK-169
title: 'Gateway completes the DB write after the client aborts (wallet/set)'
status: To Do
assignee: []
created_date: '2026-06-24 00:00'
labels:
  - 'area:bot-client'
dependencies: []
ordinal: 169000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Gateway completes the DB write after the client aborts (wallet/set)

**Why:** In `handleSetWalletKey`, when the bot-client aborts the request (transport timeout), the Express handler keeps running and still upserts the key — which is WHY the z.ai user's key saved despite the "failed" message. Benign/helpful today (storing a validated key is the desired outcome), and #1323's timeout fix removes the happy-path abort so it's no longer user-facing. But completing a mutation after the client gave up is a latent correctness smell (no `req.aborted` guard before the write). **Fix shape**: optionally check `req.aborted`/an AbortSignal before the upsert, OR accept it as harmless-by-design and document why. **Promote when**: a post-abort write causes an observable inconsistency, or the wallet-write path is next reworked. Surfaced 2026-06-24 by PR #1323 (Bug B, latent; not user-facing after the timeout fix).
<!-- SECTION:DESCRIPTION:END -->
