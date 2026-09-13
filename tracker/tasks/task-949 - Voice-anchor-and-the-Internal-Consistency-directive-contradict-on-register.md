---
id: TASK-949
title: Voice anchor and the Internal Consistency directive contradict on register
status: To Do
assignee: []
created_date: '2026-09-13 01:19'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 946000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a debug payload from a long-running conversation shows the model re-litigating one rule five separate times in a single reasoning trace, and losing on the axis that matters. The trace names both rules against each other explicitly, quoting the drift instruction and then overriding it by citing the internal consistency directive.

The conflict: the voice anchor (injected into the final user turn) says that pet names, running metaphors, sign-offs and habitual structure appearing in history but not in the anchor fields are drift and must not be carried forward. Protocol directive 17 (Internal Consistency, in system_prompts.content) says to track details established within a conversation and not contradict them without narrative justification. A running metaphor built up over a day satisfies both descriptions, and nothing arbitrates.

The precedence lattice has a hole. Directive 20 (System Prompt Primacy) orders system directives above conversational history. The anchor claims it outranks every earlier TURN. Neither states how the anchor relates to the system directives, which is exactly where the conflict sits.

Observed outcome: the anchor won on the cheap signals and lost on the expensive one. The model dropped the habitual emoji sign-off and the pet names, then preserved the entire drifted ledger-and-archive metaphor system by reclassifying it as earned continuity. The shipped reply opened with that register and carried it throughout, while the anchor fields describe the character as warm, bubbly and enthusiastic. The model never compared its draft against the anchor examples because it spent its budget adjudicating the drift rule.

Second defect, independent of the first: the anchor instructs the model to match the reply length these fields describe, but no anchor field describes length (personality_tone is five adjectives). The instruction cannot be followed as written, and the trace visibly flounders before picking an arbitrary word count. Directive 14 already owns length calibration.

Fix shape, part 1: scope the internal consistency directive to FACTS. Something like - Internal Consistency governs facts: names, relationships, events, physical descriptions, promises made. It does not govern voice. Register, metaphor systems, pet names and sign-offs are governed by the voice anchor. That single scoping removes the five-way litigation.

Fix shape, part 2: drop the reply-length clause from the anchor and let directive 14 own length, or give the anchor a real length field to point at.

IMPORTANT - this is a DATA edit, not a code change. Directive 17 lives in system_prompts.content, not in source. Per TASK-159 (verified by query 2026-09-04) the shared Default row is id 39e0f96c-c59c-58df-9aa8-c9ee0bd54136, is_default, used by 205 of 208 personalities and identical on dev and prod, so this is a one-row edit applied to both environments. system_prompts is sync-tracked, so LWW on updated_at applies - see 03-database.md. The anchor half (part 2) is assembled in code and is a normal PR.

This PROMOTES TASK-159, whose stated trigger is the next edit of the Default prompt. Fold its directive renames into the same one-row edit rather than touching the row twice.

Evidence is a local debug payload containing personal conversation content - do not attach it to any tracked surface. The finding above is the extractable part.

Acceptance: the two rules no longer conflict on register, verified by a fresh debug payload from a conversation carrying an established metaphor system, in which the reasoning trace resolves the drift question once rather than repeatedly and the reply register matches the anchor fields. If the register still fails to shift, the anchor is being outweighed by history volume rather than by instruction conflict, and that is a separate finding worth recording.
<!-- SECTION:DESCRIPTION:END -->
