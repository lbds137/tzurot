---
id: TASK-160
title: Audit the OUTPUT_CONSTRAINTS scaffolding-ban list for completeness
status: To Do
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 160000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Audit the `OUTPUT_CONSTRAINTS` scaffolding-ban list for completeness

**Why:** The output-constraint ban (`HardcodedConstraints.ts`) names observed-leak tags (`<from_id>/<user>/<message>` — the GLM-4.5-Air fake-user-echo quirk) plus the structural tags PR #1317 touched (`<quote>/<contextual_references>`). `claude-review` on #1317 noted `<instruction>` is also a tag the model sees (in `<participants>`/`<memory_archive>`/`<contextual_references>`) yet isn't banned — but adding it piecemeal is arbitrary (why not `<time>`/`<content>`?). Do one deliberate pass: enumerate every structural tag the assembled prompt exposes, decide which are leak-prone wrappers that belong in the ban vs. which are harmless content tags. Lower urgency now that GLM-4.5-Air is no longer free on OpenRouter (less scaffolding-leak pressure). **Promote when**: next editing `OUTPUT_CONSTRAINTS`, or a new tag-leak quirk is observed. Surfaced 2026-06-23 (dated from git history).

TRIGGER FIRED — `OUTPUT_CONSTRAINTS` was edited by the TASK-804 provenance slice, which added a media-description constraint that NAMES `<image_descriptions>` in prompt prose. Folding the audit into that PR was declined as scope-widening (a provenance fix is not a leak-ban fix), so it lands here as a member instead. Two concrete inputs this pass now has that it did not before: (a) `<image_descriptions>` is a new candidate for the ban list — it is a structural wrapper the model now sees named explicitly, and there is currently no evidence the model emits it, which is exactly the "arbitrary if added piecemeal" judgement this audit exists to make deliberately; (b) `pnpm ops guard:prompt-tags` classifies every structural tag as protected or known-unprotected and is the authoritative enumeration this pass should start from rather than a hand-built grep list - it was green before and after the TASK-804 edit.
<!-- SECTION:DESCRIPTION:END -->
