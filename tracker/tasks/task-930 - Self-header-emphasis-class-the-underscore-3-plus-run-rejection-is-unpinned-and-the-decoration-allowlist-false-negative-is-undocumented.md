---
id: TASK-930
title: >-
  Self-header emphasis class: the underscore 3-plus-run rejection is unpinned,
  and the decoration allowlist false-negative is undocumented
status: Done
assignee: []
created_date: '2026-09-10 01:15'
updated_date: '2026-09-12 12:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 928000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: two Low findings from the #2384 review, filed rather than fixed because that PR reached the six-cycle review cap with green CI and a no-blockers verdict; spending another round there risked the self-fed loop the cap exists to stop.

(1) UNPINNED BRANCH. `asteriskDelim` and `underscoreDelim` in RealMessagesBuilder.ts are separately constructed strings — `\*(?:\*)?(?!\*)` and `_(?:_)?(?!_)` — not one shared helper. The `emphasis delimiter count shapes` describe block pins the three-or-more rejection for asterisks only. A typo or wrong lookahead character in the underscore delimiter alone would regress the `___` rejection with no red test, even though every neighbouring case in that block and in `emphasis run interior cap` tests both branches in parallel. This is the same vacuity shape the PR itself fixed twice (the letter-built cap fixtures, and the quoted other-speaker keep-case whose lookahead deletion reddened nothing). Fix: mirror the asterisk case with a `___` plus incomplete-header fixture.

(2) UNDOCUMENTED TRADEOFF. decorChar is a curated allowlist, deliberately not the complement of a word character, because that complement is ASCII-only and would readmit non-Latin narration. The consequence is a false-negative surface: real scaffolding decorated with punctuation OUTSIDE the allowlist — a bullet, fullwidth punctuation, an emoji, a Unicode dash not in the curated set — makes the whole preamble parse fail at that character, so a genuine leak decorated that way survives unstripped. That is almost certainly the intended direction, since the file prefers surviving over deleting. But the PR documents the short-action-beat residual explicitly as known and accepted, and this is the same shape of tradeoff with no such callout, so a future reader could mistake a widen-the-allowlist change for a bug fix.

Fix shape: one test mirroring the asterisk three-run rejection for underscores, and one or two sentences at decorChar (or in the matcher docstring) naming the false-negative direction as deliberate. No behaviour change intended by either.

Acceptance: a `___`-prefixed fixture is pinned and reddens when only the underscore delimiter is mutated while the asterisk case stays green; the decorChar comment names the allowlist false-negative as an accepted direction and says why the complement form was rejected; the ai-worker suite, lint, typecheck and typecheck:spec stay green.
<!-- SECTION:DESCRIPTION:END -->
