---
id: TASK-684
title: >-
  Roster-blurb staleness keys only on the card, so a prompt or cap change never
  regenerates
status: To Do
assignee: []
created_date: '2026-08-19 17:13'
labels:
  - 'area:ai-worker'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 684000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised as an Info item on the #2150 review, and it is a real gap rather than a defect in that PR. The sweep selects work with roster_blurb_source_hash IS DISTINCT FROM card_source_hash — a comparison over the CHARACTER CARD alone. Nothing in that predicate mentions the prompt text, the length cap, or the model.

Consequence: every input to a blurb OTHER than the card is frozen at generation time. Tighten ROSTER_BLURB_MAX_LENGTH and previously-generated blurbs stay over the new cap forever, because the sweep has no reason to look at them again and the renderer does not re-validate length. Revise the summarizer prompt and existing blurbs keep the old prompt behaviour. Change the extraction model and the corpus stays a mix of two models output. Each of those is silent.

This is NOT an argument for re-validating at render time. Truncating a blurb mid-sentence in the prompt is worse than a slightly long one, and the cap is a spend and prefix-size bound rather than a safety bound. The fix belongs on the staleness side.

Fix shape: fold a GENERATOR version into the stored hash so the existing IS DISTINCT FROM comparison covers it — either stamp roster_blurb_source_hash as a digest over (card hash + generator version), or add a small integer column compared alongside. The version is bumped by hand whenever the prompt, the cap, or the deliberate model choice changes, exactly like TEST_AUDIT_IMPL_VERSION and FILTER_IMPL_VERSION already work in this repo. Beware the corpus-wide spend event: bumping it invalidates every blurb at once, so the sweep LIMIT is what keeps that bounded, and that bound should be checked before the first bump rather than after.

Also correct the PR #2150 body claim while doing this if it is still reachable: it says nothing over-cap can reach the renderer, which is true only for blurbs generated under the current cap value.

Acceptance: changing the summarizer prompt or the length cap makes existing blurbs stale by the same mechanism a card edit does; the invalidation is bounded by the sweep per-tick limit rather than firing as one unbounded batch; a test pins that a version bump alone selects a row whose card never changed.
<!-- SECTION:DESCRIPTION:END -->
