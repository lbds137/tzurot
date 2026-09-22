---
id: TASK-1038
title: >-
  Auto-promote a character into the archive render lists when its
  summary-coverage gate reads READY
status: Done
assignee: []
created_date: '2026-09-21 19:48'
updated_date: '2026-09-22 13:50'
labels:
  - 'area:ai-worker'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1032000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner direction 2026-09-21 - applying the memory-archive treatment to more characters currently means hand-listing each slug in archiveSplitRenderPersonalities (and recentDaysDigestPersonalities) after checking the 95 percent gate with pnpm memory:summarize --dry-run (packages/tooling/src/commands/memory.ts ~line 309; the per-character list settings are in packages/common-types/src/schemas/api/systemSettingsRegistryOperations.ts ~lines 28-42 and 151-162). The owner does not want to maintain that list by hand for every character they talk to. The gate is already computed per personality by the pre-warm sweep, so promotion can be automatic.
Fix shape: in the archive-summary sweep (or a daily tick beside it), when a personality with the enqueue switch on reaches the 95 percent summary-coverage gate, append its slug to archiveSplitRenderPersonalities if absent, log the promotion at info with the personality id and coverage, and post the same line to the owner log channel so the flip is visible. Keep a per-character opt-out (a list of slugs never to promote) for characters the owner wants verbatim; demotion stays manual. Decide with the owner whether recentDaysDigestPersonalities promotes on the same signal or stays manual, since that list carries spend.
COUPLING (owner ruling 2026-09-21 on TASK-1037): the cross-channel user-only render must never be applied to a character that has no recent-days digest, because the digest is what replaces the character-side prose the render drops (the digest sweep gates on its own recentDaysDigestPersonalities list, recentDaysDigestSweep.ts, and nothing ties it to crossChannelRenderMode). So promotion here is one atomic step per character: list it for the digest, list it for the archive split render, and write crossChannelRenderMode user-only into that personality configDefaults (the per-personality tier, services/api-gateway/src/routes/user/personality-config-overrides.ts) in the same transaction, with one log line naming all three. An admin-tier flip of the render mode is ruled out for as long as the digest stays per-character. If the digest list is to stay manual for spend reasons, then the render-mode write follows the DIGEST listing (manual or not), never the archive gate alone.
OWNER RULING 2026-09-21 (after the beta.228 cut, via AskUserQuestion): the DIGEST list promotes on the same signal - promotion is fully automatic and atomic across all three writes (recentDaysDigestPersonalities, archiveSplitRenderPersonalities, and crossChannelRenderMode user-only on the per-personality tier). The spend consequence was stated (at most 12 digest generations a day per newly listed active pair) and accepted; the opt-out list is the manual lever. Demotion stays manual.
Acceptance: a component test seeds a personality at 94 percent and one at 96 percent coverage, runs the tick, and asserts only the second is listed in BOTH lists and carries the render mode; a listed character is not re-listed; an opted-out character at 100 percent is skipped; the log line names the personality id, the coverage, and all three writes.
<!-- SECTION:DESCRIPTION:END -->
