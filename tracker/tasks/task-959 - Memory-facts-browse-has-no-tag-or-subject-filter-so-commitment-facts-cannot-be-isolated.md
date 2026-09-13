---
id: TASK-959
title: >-
  Memory facts browse has no tag or subject filter, so commitment facts cannot
  be isolated
status: To Do
assignee: []
created_date: '2026-09-13 17:02'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 956000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner attempt 2026-09-13 to review commitment facts for TASK-907. The board said "filter by the commitment: tag", but /memory facts exposes only a character option and the browse view has pagination and Sort A-Z — no tag, subject, or tier filter (services/bot-client/src/commands/memory/index.ts, factsBrowse.ts). Commitment facts are identifiable: their statement subject is the literal {assistant} and their entityTags carry commitment:promise | commitment:decision | commitment:address | commitment:advice (services/ai-worker/src/services/extraction/extractionPrompt.ts). At 1,195 facts on one character the only workaround is Sort A-Z and paging to the {assistant} block, which is what blocks the TASK-907 review in practice.
Fix shape: a tag option on /memory facts (string, autocompleted over the entity-tag kinds present for that character — the commitment:* kinds at minimum), forwarded to the facts list route as a filter on entityTags; the browse embed names the active filter in its footer. Alternative if cheaper: a Commitments toggle button on the browse view that filters client-side over the loaded page set — weaker at 1,195 rows, so prefer the route filter. Check the facts list route for an existing tag predicate before adding one (grep -n "entityTags" services/api-gateway/src/routes/user/memory*.ts services/api-gateway/src/routes/user/memory/*.ts).
Acceptance: /memory facts character:X tag:commitment:promise lists only facts carrying that tag; the footer says which filter is active; TASK-907 can be reviewed without paging through the whole set.
<!-- SECTION:DESCRIPTION:END -->
