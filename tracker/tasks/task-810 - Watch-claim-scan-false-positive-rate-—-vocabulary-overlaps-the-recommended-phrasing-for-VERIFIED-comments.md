---
id: TASK-810
title: >-
  Watch: claim-scan false-positive rate — vocabulary overlaps the recommended
  phrasing for VERIFIED comments
status: To Do
assignee: []
created_date: '2026-08-29 01:43'
updated_date: '2026-09-04 19:38'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:observable'
dependencies: []
priority: low
ordinal: 810000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the merge-gate added-comment claim scan (pr-merge-review-check.sh, shipped with the mining-operationalizations PR) fires on always/never/cannot/guaranteed — the same vocabulary 02-code-standards § "A Comment That Asserts Behavior Is a Claim" recommends for comments that ARE pinned by tests. Review prediction: the banner may fire on a large fraction of comment-bearing PRs (this repo hooks are full of NEVER/ALWAYS prose), risking cries-wolf skimming. Cost is one banner paragraph, never a block.

What: after a few weeks of real merges, judge whether the scan earns its keep — count roughly how often the banner fired vs how often it surfaced a genuinely unverified claim. If noise dominates: tune (e.g. require the claim vocabulary to co-occur with provenance/count shapes, or exempt lines that name a test), do not remove without owner call. If tuning happens, ALSO add the deferred probe case pinning claim-scan + origin-scan co-rendering in one call (round-4 review, Low) — both blocks in one stderr output.

DATA POINT — PR 2249 (comment/test-only, prose-heavy, the worst case for this scan). Both directions observed in one PR:

FALSE-POSITIVE side, and it is encouraging: the banner fired twice (4 lines, then 3 after edits). Every flagged line was a genuine claim worth checking, and none was noise — one was a real defect (an unhedged negative-existence claim about a tag never being observed echoed back, which the scan caught and nothing else would have). The remaining flags were true claims that simply needed their evidence cited. So on this specimen the scan is NOT crying wolf, which is the outcome this watch was opened to doubt. One flagged line was correctly exempt under 02-code-standards ("design-structure prose"), so the exemption reasoning stays a human judgement the scan cannot make — that is expected, not a defect.

FALSE-NEGATIVE side — a NEW input this watch did not have, and the more actionable half. Round 4 of the same PR caught a claim the scan missed entirely: "GLM-4.5-Air invented those shapes while mimicking our format rather than echoing them back from it", an unhedged assertion about a third-party model's past behaviour sitting in an ADDED comment line, squarely in scope for the scan. It escaped because the vocabulary (grep at pr-merge-review-check.sh, the CLAIM_ALL pipeline) has a certainty limb (always/never/cannot/guaranteed) and a DATA-FLOW provenance limb (comes from / derived from / populated by / read from / written by) but no EXTERNAL-ACTOR BEHAVIOUR limb — invented, mimicked, improvised, hallucinated, echoed. That class is exactly what 00-critical § external-system claims governs, so it is in scope for the rule while out of scope for the instrument enforcing it.

Fix shape if tuning happens: add the external-actor verbs as a limb. CARE, and this is why it belongs on THIS task rather than a separate one — widening trades directly against the false-positive budget above, so the two must be decided together. Verbs like observed and echoed would fire on legitimately-cited observations, which is the phrasing the rule ASKS for; prefer verbs that are assertive with no citing use (invented, mimicked, improvised, hallucinated) and re-measure the FP rate after.

Acceptance: a disposition recorded (earning its keep as-is / tuned with the co-render probe case added / escalated to owner), covering BOTH directions — the FP rate and whether the external-actor-behaviour limb is worth its FP cost.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: digest-pass
created: 2026-09-04 19:38
---
Pass 2026-09-04 (TASK-888 half 1, priority-low digest): KEEP. Explicitly mid-data-collection per the task's own text (one data point from PR 2249 recorded, both a false-positive-side and false-negative-side observation, acceptance criteria not yet met — no disposition recorded). Evidence: Full file read — the task's most recent entry is a data point, not a closing disposition.
---
<!-- COMMENTS:END -->
