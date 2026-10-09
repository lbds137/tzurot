---
id: TASK-1182
title: Detect admin/global LLM configs whose model id left the OpenRouter catalog
status: Done
assignee: []
created_date: '2026-10-05 19:27'
updated_date: '2026-10-09 02:03'
labels:
  - 'area:api-gateway'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 1172000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: OpenRouter delisted qwen/qwen3.8-27b:free (404 "This model is unavailable for free. The paid version is available now - use this slug instead: qwen/qwen3.8-27b"). It was the admin free default, so every guest turn and vision tier-2 call now 404s and falls to openrouter/free. Nothing noticed until one rescued-alert fired (prod 2026-10-05 19:20Z, request ca9899b9). Catalog validation runs only at config write time (services/api-gateway/src/utils/llmConfigValidation.ts), never again.

What: a periodic check (ride the model-catalog refresh, see TASK-650) that resolves every admin-default, free-default and global preset model id against the catalog and pings the owner channel when one is gone.

Acceptance: delisting a configured global model produces one owner alert naming the config and the missing id within one refresh cycle; a catalog outage does not alert as a delisting.
<!-- SECTION:DESCRIPTION:END -->
