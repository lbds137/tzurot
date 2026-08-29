---
id: TASK-160
title: Audit the OUTPUT_CONSTRAINTS scaffolding-ban list for completeness
status: Done
assignee: []
created_date: '2026-06-23 00:00'
updated_date: '2026-08-29 11:16'
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

AUDIT DONE. Enumeration source: `pnpm ops guard:prompt-tags` (bidirectional, green) — the assembled prompt exposes ~61 structural tags, all classified. The pass produced a CRITERION rather than a longer list, now recorded as a doc comment on `OUTPUT_CONSTRAINTS` so the next editor does not add piecemeal:

1. Post-processing is the guarantee, not the ban list. `wrapperTagUnwrap` is vocabulary-agnostic (unwraps by tag SHAPE, excluding only the strip vocabularies it imports) and `responseArtifacts` deletes a mined family — so an unbanned tag is NOT an unhandled tag. This is the fact that makes "enumerate more tags" the wrong answer.
2. Prefer banning what post-processing CANNOT clean up. `responseArtifacts` omits `context` from its orphan-closer list as too collision-prone against prose; a tag in that position has no other lever. `context` is currently in neither list — the one genuine candidate this pass surfaced.
3. Evidence that a model emits a tag lives in the strip vocabularies (`ARTIFACT_TAG_NAMES`, `KNOWN_THINKING_TAGS`), whose entries cite mined request IDs. The ban list carries no such citations.

DECIDED — no tags added. `<image_descriptions>` (the tag that fired this trigger) and `<instruction>` both fail the criterion: emitted by the prompt, never observed echoed back. Pinned by a canaried test in HardcodedConstraints.test.ts ("excludes prompt-structure tags with no observed-emission evidence"), scoped to the ban LINE because `<image_descriptions>` legitimately appears elsewhere in the block. Also corrected: a test comment asserted `<quote>` was "same class as" `<from_id>/<user>/<message>`; it is not — the trio was mined from a cited prod leak, `<quote>` arrived alongside a quoted-reference change with no emission evidence at all.

FINDING, NOT ACTED ON (see the follow-up task): the list fails the criterion in BOTH directions. `chat_log`, `participants`, `protocol`, `memory_archive`, `facts` have mined-echo evidence and are unnamed; `<user>` and the ELEMENT form of `<from_id>` are named although prompt assembly emits neither (`from_id` ships as an attribute at conversationUtils.ts:102; `<user>` appears only inside the constraint's own text). GLM-4.5-Air invented those shapes while mimicking our format rather than echoing them from it, so the constraint's own words — "assembly artifacts from the conversation context" — misdescribe them. Re-deriving the list changes every response, which makes it an owner call rather than a cleanup.

ORIGINAL ENTRY BELOW.

TRIGGER FIRED — `OUTPUT_CONSTRAINTS` was edited by the TASK-804 provenance slice, which added a media-description constraint that NAMES `<image_descriptions>` in prompt prose. Folding the audit into that PR was declined as scope-widening (a provenance fix is not a leak-ban fix), so it lands here as a member instead. Two concrete inputs this pass now has that it did not before: (a) `<image_descriptions>` is a new candidate for the ban list — it is a structural wrapper the model now sees named explicitly, and there is currently no evidence the model emits it, which is exactly the "arbitrary if added piecemeal" judgement this audit exists to make deliberately; (b) `pnpm ops guard:prompt-tags` classifies every structural tag as protected or known-unprotected and is the authoritative enumeration this pass should start from rather than a hand-built grep list - it was green before and after the TASK-804 edit.
<!-- SECTION:DESCRIPTION:END -->
