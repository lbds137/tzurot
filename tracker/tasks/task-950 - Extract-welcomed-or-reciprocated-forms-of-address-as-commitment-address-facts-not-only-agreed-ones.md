---
id: TASK-950
title: >-
  Extract welcomed or reciprocated forms of address as commitment:address facts,
  not only agreed ones
status: To Do
assignee: []
created_date: '2026-09-13 14:52'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 947000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ruling 2026-09-13. A pet name or form of address that emerged organically and the user answered to warmly is relationship development the owner wants preserved, but the extraction prompt (services/ai-worker/src/services/extraction/extractionPrompt.ts, the commitments exception) triggers on agreed only, so such a name never becomes a fact and the Voice Fidelity directive plus the anchor drift note then treat it as history-only drift. The 2026-09-13 prompt-row edit and the anchor carve-out say a form of address recorded in the facts is relationship, not drift, so the facts side has to actually capture it.
Fix shape: widen the commitment:address rule in extractionPrompt.ts to a form of address the user welcomed or reciprocated across turns, with a sentence that a name the user rejected or ignored is NOT one; pin with an extraction prompt test; the undo for a mis-pinned name is /memory facts delete.
Acceptance: the prompt names welcomed/reciprocated forms of address as commitment:address facts, a test pins the wording, and TASK-907 review on prod covers a welcomed-name example when one appears.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
author: owner-ruling
created: 2026-09-13
---
Owner ruling 2026-09-13: WIDENED to relationship facts, three kinds — (1) forms of address the user welcomed or reciprocated (not only agreed), (2) shared references or running jokes the user embraced, (3) the character's standing disposition toward the user (fondness, trust, a grudge), which the current 'facts about the assistant (nature, backstory, model, or feelings)' exclusion in extractionPrompt.ts currently drops. AI-nature facts (model, being an AI, backstory) stay excluded. Each kind gets its own entityTag kind (commitment:address stays; add relationship:reference and relationship:disposition or fold into the commitment namespace — decide at build). Rationale: the Voice Fidelity directive and the anchor now say a form of address or shared reference recorded in the facts is relationship, not drift; the facts side must capture all three or the carve-out is empty.
---
<!-- COMMENTS:END -->
