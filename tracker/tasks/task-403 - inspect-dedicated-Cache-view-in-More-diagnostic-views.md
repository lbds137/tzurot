---
id: TASK-403
title: 'inspect: dedicated Cache view in More diagnostic views'
status: Done
assignee: []
created_date: '2026-08-02 21:57'
updated_date: '2026-08-04 03:50'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: low
ordinal: 403000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ask 2026-08-02 after smoke F ("would be nice if we had a separate cache viewer menu but not crucial for now") - cache telemetry currently lives as two lines in the summary embed (Cached Tokens + hit %); a dedicated view has room for the full picture.
What: add a Cache entry to the /inspect "More diagnostic views" menu (bot-client inspect views.ts + menu registration) rendering: cached vs total prompt tokens + hit %, OpenRouter cacheDiscount when present, and the per-section prefix map from systemPromptSections (id, tier, chars, offset - already stored in the diagnostic payload by #1905/#1907) so a cache miss can be localized to the section that changed without leaving Discord.
Acceptance: menu entry renders for a post-restructure log; degrades gracefully (view still opens, says unavailable) on pre-restructure logs missing the fields.
<!-- SECTION:DESCRIPTION:END -->
