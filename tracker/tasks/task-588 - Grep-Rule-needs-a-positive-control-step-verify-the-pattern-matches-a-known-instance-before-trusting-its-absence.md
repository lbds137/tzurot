---
id: TASK-588
title: >-
  Grep Rule needs a positive-control step: verify the pattern matches a known
  instance before trusting its absence
status: Done
assignee: []
created_date: '2026-08-13 13:32'
updated_date: '2026-08-14 00:17'
labels:
  - 'area:rules'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 588000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: three over-narrow greps in a single session (2026-08-13), two of which shipped into a PR body as "the deterministic enumeration" and were caught by review rather than by me.

1. PR 2087: `\bpersonalit(y|ies)\b` inside a string literal cannot match `personality_name` -- `_` is a word character, so there is no boundary. Missed NSFW_VERIFICATION_MESSAGE, which is what an unverified new user actually sees FIRST.
2. PR 2088: a consistency sweep for `preferred trio|the trio` could not match `full trio`. Missed the whole of tzurot-design-boulder SKILL.md section 3, which hardcoded a three-model council.
3. Same session: `.user.login=="claude"` returned zero comments because the login is `claude[bot]`.

Every one produced an EMPTY or SHORT result that read as "clean" rather than as "my pattern is wrong". 00-critical.md section Mandatory Global Discovery already says to search 3+ vocabulary variants, and 10-working-posture.md section Lossy steps already says an empty result indicts your own invocation first. Neither closes this: both are about vocabulary and about reading results, while the failure is in the PATTERN SYNTAX matching a form you did not anticipate. Variant count does not help when all three variants share the same broken boundary assumption.

Fix shape: add a positive-control clause to the Grep Rule. Before trusting a sweep as exhaustive, run the pattern against at least one instance you KNOW is present and confirm it matches; if you cannot name a known-present instance, the sweep has no floor and its emptiness means nothing. Cheap, mechanical, and it would have caught all three above. Consider whether it belongs in 00-critical.md alongside the existing Grep Rule or in 10-working-posture.md next to the lossy-steps read-side check -- the former is where the sweep obligation lives.

Acceptance: the rule states the positive-control step with its trigger moment (before writing "the enumeration is X sites" into any PR body, commit message, or backlog entry). Source: 2026-08-13 drain session, self-reported after review caught 2 of the 3.
<!-- SECTION:DESCRIPTION:END -->
