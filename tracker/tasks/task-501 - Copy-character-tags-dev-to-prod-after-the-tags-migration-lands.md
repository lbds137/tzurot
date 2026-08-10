---
id: TASK-501
title: Copy character tags dev-to-prod after the tags migration lands
status: To Do
assignee: []
created_date: '2026-08-10 01:41'
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
Acceptance: prod count of hellaverse-tagged personalities matches dev (34 at filing, or current dev state at run time); owner sees tags in prod /character view.
<!-- SECTION:DESCRIPTION:END -->
