---
id: TASK-1235
title: Skip or label the excerpt when no personality name resolves (MEM-ARCH-038)
status: To Do
assignee: []
created_date: '2026-10-16 06:22'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: low
ordinal: 1223000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: PR #2622 review round 6 (Low). When no personality name resolves, appendAssistantExcerpt renders the excerpt as a bare line directly under the labeled user turn - and the excerpt is the character's FIRST-PERSON verbatim prose, so the model most naturally reads it as a second line of the user's turn (speaker confusion, the exact failure the archive design prevents). Rare in prod: personality_name is stamped from the query and names.personalityName is a fallback. The test 'trims leading and trailing whitespace from the assistant excerpt' pins the current unlabeled output.

Fix options: skip the excerpt when no speaker resolves (matches the foreign-note exclusion philosophy), or use a neutral fallback label, or keep it and document why acceptable in the MEM-ARCH-038 clause. If kept, the spec's 'unlabeled otherwise' clause must say why.
<!-- SECTION:DESCRIPTION:END -->
