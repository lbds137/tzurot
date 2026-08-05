---
id: TASK-229
title: >-
  /character command option-access idiom drift (avatar.ts raw vs import.ts typed
  accessor)
status: Done
assignee: []
created_date: '2026-07-07 00:00'
updated_date: '2026-08-05 23:47'
labels:
  - 'origin:review'
  - 'area:bot-client'
  - 'size:S'
  - 'state:unreachable'
dependencies: []
priority: low
ordinal: 229000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

/character command option-access idiom drift (avatar.ts raw vs import.ts typed accessor) — avatar.ts/voice.ts read options via raw `interaction.options.getString/getAttachment`; import.ts uses the generated typed `characterImportOptions` accessor. Leaves `characterAvatarOptions`/`characterAvatarClearOptions` generated-but-unused (knip ignores generated/). Cosmetic consistency. **Fix shape**: pick one idiom across the command group. **Promote when**: the beta.154 view/browse unification consistency pass touches these files. Surfaced 2026-07-07 (#1541 review).

**Why:** One option-access idiom across the /character handlers.
<!-- SECTION:DESCRIPTION:END -->
