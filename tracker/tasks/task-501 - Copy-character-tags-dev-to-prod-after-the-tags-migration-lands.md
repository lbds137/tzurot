---
id: TASK-501
title: Copy character tags dev-to-prod after the tags migration lands
status: Done
assignee: []
created_date: '2026-08-10 01:41'
updated_date: '2026-08-10 02:54'
labels:
  - 'area:db'
  - 'size:S'
  - 'state:dependent'
dependencies: []
priority: high
ordinal: 501000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the doc-60 tag rollout was seeded on DEV by a bulk SQL apply (34 hellaverse-tagged characters, owner-corrected 2026-08-09) that deliberately did NOT bump updated_at - so the nightly LWW sync will never carry the tags to prod, and prod lacks the tags column until the next release premigrate anyway.
Fix shape: immediately after the next release (premigrate applies 20260809185820_add_personality_tags to prod), run a one-off copy: read slug->tags from dev where tags is non-empty, UPDATE prod personalities SET tags = <dev tags>, updated_at = now() WHERE slug matches AND tags = <empty array literal>. The explicit updated_at bump is CORRECT on prod (system of record; prod winning future syncs propagates tags back to dev). Do NOT instead bump dev updated_at and let sync carry it - a dev row winning LWW replaces the whole prod row and can clobber prod-side edits.
HARD DEADLINE within the release: the copy must run BEFORE the first 3am nightly sync after the release lands. During the skew window the nightly sync fails loudly and syncs nothing (NightlyDbSyncScheduler.ts - no schema-skew override), so dev tags are safe until release. But once schemas match, sync resumes - and any prod row edited during the window is newer than dev tag rows (deliberately un-bumped), so prod would win LWW and erase those dev tags. Run the copy in the same working session as the release merge; treat it as a release-procedure step, not a follow-up.
Acceptance: prod count of hellaverse-tagged personalities matches dev (34 at filing, or current dev state at run time); owner sees tags in prod /character view; copy completed before the first post-release nightly sync.
<!-- SECTION:DESCRIPTION:END -->
