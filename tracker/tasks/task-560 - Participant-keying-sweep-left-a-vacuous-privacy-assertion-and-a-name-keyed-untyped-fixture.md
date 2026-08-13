---
id: TASK-560
title: >-
  Participant-keying sweep left a vacuous privacy assertion and a name-keyed
  untyped fixture
status: Done
assignee: []
created_date: '2026-08-12 22:33'
updated_date: '2026-08-13 12:14'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 560000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: #2067 re-keyed participants by personaId, but the privacy-regression test primary assertion (ConversationalRAGService.test.ts:630) still checks expect(participants.has("Foreign")).toBe(false) - a display-name key the map no longer uses, so it passes in BOTH the passing and failing world (Core Principle 9 violation). Prod is still guarded by the secondary content-scan assertion. Also: personaReferenceLoader.test.ts:68 feeds an untyped name-keyed Map fixture missing the new personaName field (the 02-code-standards s8 untyped-mockResolvedValue class), and the MemoryRetriever.ts:413 dedup docblock claims "never which entry survives" while the replace path swaps content/guildInfo wholesale (unpinned behavior claim).

Fix shape: assert on the persona-foreign key (or personaId values), satisfies-type and re-key the loader fixture, correct the docblock or pin the replacement arm.

Acceptance: canary proves the privacy assertion can fail. Source: 2026-08-12 review (ai-worker reviewer MED-1/LOW-1/LOW-2, all CONFIRMED).
<!-- SECTION:DESCRIPTION:END -->
