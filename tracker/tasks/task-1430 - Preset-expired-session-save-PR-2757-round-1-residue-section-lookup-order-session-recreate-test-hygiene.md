---
id: TASK-1430
title: >-
  Preset expired-session save: PR 2757 round-1 residue (section lookup order,
  session recreate, test hygiene)
status: To Do
assignee: []
created_date: '2026-11-16T22:13:00Z'
labels:
  - area:bot-client
  - size:S
  - state:ready
dependencies: []
priority: low
ordinal: 1430000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR 2757 claude-review round 1, verdict: none block the merge. Items in services/bot-client/src/commands/preset/dashboard.ts handleSectionModalSubmit and dashboard.test.ts: (1) look up the section in PRESET_DASHBOARD_CONFIG before the expired-session refetch, and tell the user on an unknown sectionId instead of returning silently after the ack; (2) after an expired-session save, recreate the session from the saved flat (sessionManager.set) so the next click does not take the expired path again; (3) use mockResolvedValueOnce/mockRejectedValueOnce in the expired-session describe so implementations do not leak; (4) in the global-routing test assert fetchPreset was called with the user client (pins the decision that the user endpoint serves accessible globals). Sibling sweep (item 5) done at merge: persona and character dashboards send only top-level fields with absent meaning unchanged, so their empty-object baseline is safe.
<!-- SECTION:DESCRIPTION:END -->
