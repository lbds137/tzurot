---
id: TASK-192
title: 'Zero-staleness invalidation for the owner global-config autocomplete cache'
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
labels:
  - 'area:bot-client'
dependencies: []
ordinal: 192000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Zero-staleness invalidation for the owner global-config autocomplete cache

**Why:** beta.142 shipped the INTERIM fix: `handleGlobalConfigAutocomplete`'s `globalConfigCache` got its own dedicated 30s TTL (`GLOBAL_CONFIG_CACHE_TTL_MS`) instead of the shared `TIMEOUTS.CACHE_TTL` — which a stale comment claimed was 60s but is actually **5 minutes**, so a new global preset was invisible in the `/preset global default|free-default` picker for up to 5 min (runtime-observed 2026-06-29 owner dev smoke: imported "qwen 3.7", "took a while" to appear). 30s bounds it; the cache is NOT yet event-invalidated, so up-to-30s staleness remains. (The picker is now capability-agnostic — one `global-configs:all` cache key, not per-kind — so the invalidation target is a single key.) **Proper fix (this follow-up)**: pub/sub-invalidate on global-config mutation for zero staleness. **Open question that gates it**: which mutation makes a config GLOBAL (no obvious `/preset global create`; import/create make USER configs) — that's the invalidation point. **Fix shape**: subscribe bot-client to `LlmConfigCacheInvalidationService` global-scope events (bot-client doesn't subscribe to LLM-config events today — only personality/channel/denylist) + reset the cache on receipt; the gateway must broadcast on the global-config mutation. **Promote when**: the 30s window still bites the owner, or the next preset-autocomplete touch. Surfaced 2026-06-29 (owner dev smoke for beta.142); interim TTL fix in the beta.142 release.
<!-- SECTION:DESCRIPTION:END -->
