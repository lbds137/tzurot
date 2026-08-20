---
id: TASK-670
title: Audit S1 for inherently-volatile content that belongs in the V tier
status: Done
assignee: []
created_date: '2026-08-19 01:58'
updated_date: '2026-08-20 15:03'
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

## AUDIT EXECUTED 2026-08-20 (the pre-cut gate) — verdict: NO S1 section belongs in V

Data: prod channel 498827782219104266 (owner-designated), 6 diagnostic rows / 5 consecutive pairs spanning 03:17-14:53Z via `cache:prefix-diff --show-divergence`, plus the full section map from a same-day dev debug payload (the develop assembler is what beta.205 ships).

Section inventory (dev payload sizes; prod offsets differ by persona size, order is fixed): S0 platform_constraints (851) · S0 output_constraints (1069) · S1 system_identity (8479) · S1 identity_constraints (414) · S1 protocol (9688) · S1 location (188) · S1 participants (2856) · H chat_log. The V tier renders inside the current user message — confirmed in the same payload, datetime is already there.

Classification:
- system_identity, identity_constraints, protocol, location — **(a) genuinely stable**. They change only on persona/config/channel edits (legitimate one-time invalidation). Evidence: the single within-stream prod pair was byte-identical through 83,438 chars — the entire S1 block held.
- participants — **(b) unstable-but-stabilizable, and the stabilizers are already in the train**: count-cap hysteresis (beta.204, live in prod) + guild_info persistence (TASK-651 / #2152, in the beta.205 range). Remaining churn is roster MEMBERSHIP change — a legitimate one-time content change per new speaker. Relocation is barred anyway by the hard constraint (the id-to-name binding must precede chat_log).
- **(c) inherently-per-turn: NONE found in S1.** The only inherently per-turn content (datetime) already lives in V. No relocation proposed, so no per-turn-cost math is owed; no reordering proposed either.

MEASUREMENT ARTIFACT, worth more than the classification: 4/5 pairs "cut at S1 participants offset 27,338" — but the windows show an A/B/A/B alternation (roster orderings flip; prompt totals alternate ~160K/~106K; models alternate) = TWO INTERLEAVED REQUEST STREAMS from different personalities in one channel. The tool diffs consecutive rows across streams, and a cross-stream pair is not a real cache miss (provider caches key per model+stream). Honest S1-churn reads need --personality; earlier mixed-channel fractions (2/5, 2/8) may carry the same artifact. Tool fix filed as TASK-698; TASK-685's re-measure carries the caution.

Bonus (H-tier, outside scope, recorded for the cache picture): the within-stream pair diverged at chat_log 83,438/110,361 (76%) because vision heal-on-read replaced an old image's couldnt-process placeholder with its full description — a one-time-per-image mid-history mutation, inherent to the design, no action.
<!-- SECTION:DESCRIPTION:END -->
