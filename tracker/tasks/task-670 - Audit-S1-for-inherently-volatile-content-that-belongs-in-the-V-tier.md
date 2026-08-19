---
id: TASK-670
title: Audit S1 for inherently-volatile content that belongs in the V tier
status: To Do
assignee: []
created_date: '2026-08-19 01:58'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 670000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner question 2026-08-19, raised while TASK-651 was being decided -- whether volatile prompt content could sit later in the context so a bit of churn does not burn much cache, "within reason, of course - I do not want to break things by inappropriate reordering either".

The mechanism already exists and is documented: V-tier content renders as a structured prefix INSIDE the current user message, after the whole system prompt and chat_log (docs/proposals/backlog/prompt-assembly-architecture.md section 2.1). Anything in V sits past every cache breakpoint, so its churn costs nothing.

THE TRADE THAT MAKES THIS AN AUDIT RATHER THAN A SWEEP -- and the reason guild_info is NOT the answer here: a stable S1 byte is CACHED, paid once and free on every later turn. A V-tier byte is outside the cached prefix by construction and is paid IN FULL EVERY TURN. So relocation is right only for content that is inherently per-turn and cannot be stabilised; for content that churns merely because it is sourced badly, stabilising it at the source (TASK-651) strictly beats moving it. Getting this backwards converts an occasional prefix loss into a permanent per-turn tax.

What to audit: enumerate what S1 renders today and classify each section as (a) genuinely stable, (b) unstable but stabilisable at the source, or (c) inherently per-turn. Only (c) is a relocation candidate, and (b) is expected to be the common case.

The instrument now exists: pnpm ops cache:prefix-diff --show-divergence names the section AND shows the changed bytes, so the classification is driven by measurement over real prod pairs rather than by reading the assembler.

HARD CONSTRAINTS on any reordering, both from the design doc section 2.1: the S0/S1 internal order encodes the sandwich-method primacy/recency rationale (identity-first, constraints-early, directives-late) and a reorder needs a quality-regression eye. Separately, the participants roster id-to-name binding MUST precede chat_log, or from_id resolves against something the model has not read yet. Neither is negotiable for a cache win.

Acceptance: every S1 section classified a/b/c with its evidence; any (c) relocation proposed with its per-turn token cost measured against the prefix loss it avoids, so the trade is stated in numbers rather than asserted; no reordering that moves the roster binding after chat_log.
<!-- SECTION:DESCRIPTION:END -->
