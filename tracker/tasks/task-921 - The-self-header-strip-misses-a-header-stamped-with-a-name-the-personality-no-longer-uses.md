---
id: TASK-921
title: >-
  The self-header strip misses a header stamped with a name the personality no
  longer uses
status: To Do
assignee: []
created_date: '2026-09-09 15:51'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 919000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: TASK-920 shipped leadingSelfHeaderLineMatcher, which strips a compound leading line only when the header name field BEGINS WITH the responding personality name as ResponsePostProcessor receives it (the current roster name, from effectivePersonality.name). The name rendered into a HISTORICAL header is msg.personalityName, stored on the history row when it was written, per the assistant branch of resolveSpeakerInfo in services/ai-worker/src/jobs/utils/participantUtils.ts. A rename between the row and the current turn makes those two diverge, and a compound self-header stamped with the OLD name will not strip.

Scope of the gap, stated honestly. It is narrow rather than theoretical-only. The webhook display-name half of the same divergence is already covered, because TASK-920 matches the name as a PREFIX, so a bot-suffixed display name still strips. A header regurgitated verbatim at position 0 is also already covered by the name-agnostic leadingHeaderLineMatcher, whatever name it carries. What is left uncovered is the intersection: a DECORATED compound line whose header carries a name that is not a prefix of the current roster name. It fails to the pre-TASK-920 behaviour, not to a regression, and it is pinned by a deliberately-named keep-case test so the boundary is visible rather than accidental.

Not yet measured: how often a personality is actually renamed while history rows survive the retention window, and whether any compound leak has ever carried a stale name. Both are cheap to check before building anything. The prod signal is the headerLinesStripped counter that TASK-920 made cover the compound shape.

Fix shape if it earns the work: source the candidate names from the same place the header render does rather than from the post-processor context, which means threading the history rows names into ResponsePostProcessor, or capturing the set of names that appeared in this turns rendered headers alongside realMessagesEnabled and matching against that set. Do NOT solve it by dropping the name scoping. That was considered and rejected in TASK-920 on an asymmetry that has not changed: a missed strip leaks cosmetic scaffolding, a false strip deletes character dialogue, so a shape-only matcher is the worse failure in a roleplay product.

Acceptance: a measurement first, either the rename frequency against the history retention window or a prod sweep of the compound-strip counter for a stale-name case; then either an archive with the numbers as the reason, or a matcher whose candidate names come from the rendered headers, with a canary proving a stale-name compound line strips and the existing keep-cases stay byte-identical.
<!-- SECTION:DESCRIPTION:END -->
