---
id: TASK-919
title: >-
  Five bot-client character test files each define their own createTestCharacter
  fixture
status: To Do
assignee: []
created_date: '2026-09-09 13:32'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 917000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: config.test.ts, sections.test.ts, view.test.ts, viewV2.test.ts and viewPages.test.ts each carry a private ~40-line createTestCharacter over CharacterData. The fifth arrived with the viewPages extraction, which had no shared fixture to import. Adding a CharacterData field means five separate edits, and only the copies the compiler can see get flagged.

Fix shape: one shared fixture module under services/bot-client/src/test/ exporting createTestCharacter, imported by all five; delete the local copies. packages/test-factories is the alternative home, but only if a second service turns out to need it.

Acceptance: grep -rn "function createTestCharacter" services/bot-client/src matches exactly one definition; the bot-client suite stays green at its current count.
<!-- SECTION:DESCRIPTION:END -->
