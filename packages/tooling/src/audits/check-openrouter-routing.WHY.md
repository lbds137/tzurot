# Why `guard:openrouter-routing` exists

## What it does

For every model id in `OPENROUTER_ROUTING.PINNED_MODELS` (`@tzurot/common-types/constants/openrouterRouting`), fetches OpenRouter's public per-model endpoints listing (`GET https://openrouter.ai/api/v1/models/<id>/endpoints`), derives the set of served host slugs from `data.endpoints[].tag` (the prefix before `'/'` when present, else the whole tag), and checks that every slug in the model's pinned `only` allowlist is still present.

Runs in the weekly `pnpm ops health` aggregator (`HEALTH_TOOLS`). When the network or OpenRouter API is unreachable, it degrades to a non-failing `status: 'warn'` summary line (`findings: 0`) so offline runs neither report `TOOL BROKEN` nor perma-red the weekly health report.
An HTTP 404 on a pinned model's endpoints route reports `status: 'fail'` (`findings: 0`): an unknown model id was verified by live probe to return HTTP 404 with `{"error":{"message":"Not Found","code":404}}` (2026-11-27, unauthenticated probe against bogus id `z-ai/definitely-not-a-real-model-9x7`), indicating a retired/renamed pin or moved route rather than an offline run. If OpenRouter instead answered `200 OK` with an empty `endpoints` array for a retired model, every allowlisted slug would report missing, which also produces `status: 'fail'` (pinned by the missing-slug unit tests).

## Why it was built

Pinned OpenRouter models send `provider: { only: [...], allow_fallbacks: false, data_collection: 'deny' }` on every chat request (TASK-1261, TASK-1554). Because `allow_fallbacks` is `false`, OpenRouter routes exclusively to the slugs in `only`. Static unit tests on `OPENROUTER_ROUTING` verify slug count, uniqueness, and non-overlap with `FORWARDER_IGNORE`, but cannot detect when OpenRouter renames or retires an upstream provider slug in its live catalog. Left unchecked, retired slugs silently shrink the effective host pool until an outage on the remaining hosts triggers `ROUTING_EXHAUSTED`.

## Threshold rationale

Zero missing allowlisted slugs (`findings === 0`). Every slug in `PINNED_MODELS[modelId]` was deliberately admitted by measurement; any slug disappearing from `/api/v1/models/<id>/endpoints` means the constant carries a dead entry that should either be updated to its renamed slug or removed from `PINNED_MODELS`.

The tool intentionally does not filter on `data.endpoints[].status`: the integer `status` field's semantics on that endpoint are unverified, and a transient provider blip should not fail a slug-existence audit.

## Decay check

When this tool's reminder fires:

- Has `OPENROUTER_ROUTING.PINNED_MODELS` been emptied because all models moved to direct provider APIs or unpinned routing? Delete the tool and remove it from `HEALTH_TOOLS` and `AUDIT_TOOL_REGISTRY`.
- Did OpenRouter change the `/api/v1/models/:author/:slug/endpoints` response structure or require authentication? Re-probe the endpoint and update `extractEndpointsArray` / `deriveHostSlugFromTag` (or retire the check if no public catalog path remains).
