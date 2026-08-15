---
id: TASK-618
title: Participant <about> renders as unattributed first-person prose in the prompt
status: To Do
assignee: []
created_date: '2026-08-15 14:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 618000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: a persona bio is stored and rendered as raw first-person text (I carry X lineage... I am also known as Y). It is emitted inside the <participants> block with nothing at the sentence level tying it to its owner. The only binding is the enclosing <participant> tag. Observed 2026-08-15 in requestId d3c643f0: a 1,998-char first-person bio for a NON-speaking participant rode inside a user turn stamped from Grace the Mace, and the character then answered a third party messages as though the speaker had sent them. Identity bleed, not just token cost.

This is NOT fixed by moving the participants block out of the user message. Wherever the block lives, a character reading it still sees 2,000 chars of I statements whose attribution depends entirely on XML nesting that a smaller model may not track.

Fix shape: render the bio under an explicit attribution rather than bare. Either wrap it (about speaker="Lila") with a lead-in line naming whose words these are, or transform to third person at render time. Storage format stays as-is; this is a render concern in ParticipantFormatter. Prefer the wrapper, since rewriting a users own words to third person loses voice and cannot be done reliably without a model call.

Acceptance: a participant bio can no longer be read as the current speaker words; the attribution is explicit in the rendered text, not only in tag nesting; ParticipantFormatter tests pin the attribution for both the active and non-active participant cases.
<!-- SECTION:DESCRIPTION:END -->
