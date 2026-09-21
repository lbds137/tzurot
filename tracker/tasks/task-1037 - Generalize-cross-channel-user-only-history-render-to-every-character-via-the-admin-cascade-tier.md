---
id: TASK-1037
title: >-
  Generalize cross-channel user-only history render to every character via the
  admin cascade tier
status: To Do
assignee: []
created_date: '2026-09-21 19:48'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: medium
ordinal: 1031000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-21 - the cross-channel history treatment piloted on Emily in prod since 2026-09-13 (per-personality configDefaults override, packages/common-types/src/schemas/api/configOverrides.ts: crossChannelHistoryEnabled, crossChannelRenderMode both|user-only, crossChannelMaxMessages; cascade order hardcoded -> admin -> personality -> channel -> user-default -> user-personality at lines ~205-208) has mostly resolved voice drift across channels. The owner does not want to hand-list every character. The cascade already has an admin tier above the per-personality one, so one admin-tier setting applies the mode to every character with per-character overrides still honored; no code is needed for that half.
Owner question: flip crossChannelRenderMode to user-only at the admin tier now (eight days of Emily pilot in prod, no continuity regression reported), or keep piloting on Emily?
Recommendation: flip it now - the pilot has shown the benefit and the failure mode (lost cross-channel continuity for the character) has not appeared; per-character overrides remain for any character that reads worse. Record the flip date on doc-97 so Phase 4 measurements can split before and after.
<!-- SECTION:DESCRIPTION:END -->
