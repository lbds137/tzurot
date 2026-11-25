---
id: TASK-1550
title: BYOK opt-out from pinned OpenRouter provider routing
status: To Do
assignee: []
created_date: '2026-11-25T18:16:00Z'
labels:
  - area:ai-worker
  - size:M
  - state:dependent
dependencies: []
priority: medium
ordinal: 1544000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner ruling 2026-11-25 on TASK-1261 (item 4): BYOK users get the pinned routing (provider allowlist, allow_fallbacks false, data_collection deny, forwarder ignore list) by default, and the opt-out ships as a follow-up rather than in the routing PR.

What: a BYOK user setting that drops the pin and the deny for requests on their own key. It needs the explicit BYOK flag the routing PR introduces (ApiKeyResolver.getSystemApiKey fills the system key into modelConfig.apiKey, so apiKey-set is not BYOK). User-visible: a settings surface plus help text explaining the privacy trade.

Acceptance: with the opt-out set, a BYOK request carries no provider block (seam test at OpenRouterFetch); system-key and default BYOK requests are unchanged.

Depends on: the TASK-1261 routing PR.
<!-- SECTION:DESCRIPTION:END -->
