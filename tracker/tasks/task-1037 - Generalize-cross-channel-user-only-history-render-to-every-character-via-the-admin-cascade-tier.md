---
id: TASK-1037
title: >-
  Generalize cross-channel user-only history render to every character via the
  admin cascade tier
status: To Do
assignee: []
created_date: '2026-09-21 19:48'
updated_date: '2026-09-21 21:39'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 1031000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner report 2026-09-21 - the cross-channel history treatment piloted on Emily in prod since 2026-09-13 (per-personality configDefaults override, packages/common-types/src/schemas/api/configOverrides.ts: crossChannelHistoryEnabled, crossChannelRenderMode both|user-only, crossChannelMaxMessages; cascade order hardcoded -> admin -> personality -> channel -> user-default -> user-personality at lines ~205-208) has mostly resolved voice drift across channels. The owner does not want to hand-list every character. The cascade already has an admin tier above the per-personality one, so one admin-tier setting applies the mode to every character with per-character overrides still honored; no code is needed for that half.
RULED 2026-09-21 (owner question, my first recommendation withdrawn): NOT flipped at the admin tier. The owner asked whether the flip would carry the digests; it would not. The recent-days digest, which is what replaces the character-side cross-channel prose the user-only render drops, is generated only for slugs in the recentDaysDigestPersonalities list (services/ai-worker/src/services/recentDaysDigest/recentDaysDigestSweep.ts, grep getSystemSetting(recentDaysDigestPersonalities)); nothing couples it to crossChannelRenderMode. Emily works because she is in that list. An admin-tier flip would therefore strip every other character of its cross-channel character-side context with no digest to stand in - a real continuity loss, exactly the failure mode the pilot could not show because the pilot character had the digest. Correct generalization: apply user-only PER CHARACTER as part of the same promotion that lists the character for the digest (and the archive split render), so no character ever has the render mode without the digest. That coupling is now TASK-1038's fix shape; this task stays open only as the record of the ruling and closes when 1038 ships.
<!-- SECTION:DESCRIPTION:END -->
