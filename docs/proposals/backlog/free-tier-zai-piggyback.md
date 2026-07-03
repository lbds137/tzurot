# Free-Tier Piggyback on the Owner's z.ai Coding Plan (GLM-4.5-Air only)

Let free (guest) users reach **GLM-4.5-Air** via the bot owner's z.ai coding-plan
subscription, instead of only the `:free` OpenRouter tier.

**Status**: Backlogged design. Spends the owner's paid z.ai quota on anonymous
traffic, so it must not ship without the abuse/quota design below being built —
not just the routing change. Surfaced 2026-06-14 (owner), off the GLM-5 z.ai work.

## Motivation

Guest users currently fall back to the system `OPENROUTER_API_KEY` restricted to
`:free` OpenRouter models (`ApiKeyResolver.resolveApiKey` → system key +
`isGuestMode: true`). GLM-4.5-Air is meaningfully better than the free OpenRouter
tier and bills at the cheapest **1× quota multiplier** on the owner's coding
plan. Routing free users to **only** GLM-4.5-Air via the owner's z.ai
subscription is a low-cost quality bump for the free tier.

The hard constraint: free users would be spending the owner's real money. The
per-request cost is bounded (1× multiplier, single model), but **volume is not**
without explicit guards. This proposal is mostly about those guards; the routing
change itself is small.

## Scope

| Area | Change |
| --- | --- |
| Config | New system env var `ZAI_CODING_API_KEY` (the z.ai analogue of `OPENROUTER_API_KEY`). Today there is no system z.ai key — `ModelFactory.ts` notes the system `OPENROUTER_API_KEY` belongs to OpenRouter, not z.ai. |
| Routing | In `ApiKeyResolver` / `ProviderRouter`: when a user has **no z.ai BYOK key** AND the requested model is **`glm-4.5-air`** (bare or `z-ai/`-prefixed), resolve the **system z.ai key** and route to z.ai-direct — instead of the OpenRouter guest fallback. All other models keep existing free-OpenRouter behavior. |
| Model gating | `glm-4.5-air` isn't a `:free` OpenRouter model, so guest model-allowlist logic (`GUEST_MODE` / `isFreeModel`) needs a carve-out for this specific z.ai-direct case. |
| Abuse/quota | New guards (see below) before any free traffic touches the owner's key. |

## The part that needs deliberate design: abuse + quota

This is the gate. Routing is ~20 LOC; the guards are the actual work.

### 1. Per-user and global ceilings

- **Per-user rate limit** on the free-z.ai path (requests/window), distinct from
  the existing OpenRouter guest limits. Reuse `RateLimitCache` keyed by
  `(userId, 'zai-free')`.
- **Global daily/monthly ceiling** on total free-z.ai requests so a traffic
  spike can't drain the owner's plan. When the global ceiling trips, free users
  silently fall back to the existing `:free` OpenRouter tier (graceful
  degradation, not an error).
- Decide concrete numbers with the owner before building. Open question: per-user
  N/hour and global M/day.

### 2. Credit-exhaustion handling

- Reuse `CreditExhaustionCache` for the system z.ai key: once z.ai returns a
  quota/credit error, stop routing free traffic to it for a cooldown window and
  fall back to `:free` OpenRouter. Mirrors the existing OpenRouter
  credit-exhaustion behavior so the owner's plan can't be hammered after it's
  already tapped out.

### 3. Secret handling

- `ZAI_CODING_API_KEY` is a secret: Railway env var, never logged (same
  discipline as `OPENROUTER_API_KEY`). Fail-fast validation at startup if the
  free-z.ai feature flag is on but the key is missing.

### 4. `isGuestMode` interaction

- The free-z.ai path is still **guest** traffic — set `isGuestMode`
  appropriately so other free-tier restrictions (model allowlist, etc.) keep
  applying. This adds a *guest path that uses the system z.ai key* rather than a
  user BYOK key; it must not accidentally promote the user to authenticated
  status or unlock paid models.

## Suggested rollout

1. Feature flag (env) defaulting **off** — ships dark.
2. Wire the routing carve-out + the model-gating carve-out behind the flag.
3. Wire the abuse guards (per-user + global ceiling + credit-exhaustion).
4. Turn on in dev, observe quota consumption against a synthetic load.
5. Decide production ceilings with the owner, then enable in prod.

## Open questions (resolve before building)

- Per-user and global ceiling numbers.
- Should the global ceiling reset daily or monthly (matching the coding-plan
  billing cycle)?
- Does z.ai expose a balance/quota endpoint we can poll to set the global
  ceiling dynamically, or is a static config ceiling the only option? (Ties into
  the deferred "z.ai 402 status verification" + "validation-model fallback"
  items — z.ai's documented API surface is thin.)

## Why not now

A genuine free-tier improvement we'd do eventually, but it spends real money on
anonymous traffic, so it needs the abuse/quota design above actually built — not
a quick win. **Promote when**: free-tier quality becomes a priority and the owner
is ready to commit a bounded slice of the coding-plan quota to guests.

## Related

- Backlog entry: `backlog/cold/ideas.md` → "Free-tier piggyback on the owner's z.ai
  coding plan — GLM-4.5-Air only" (this doc is its design expansion).
- Deferred z.ai error-shape items (`backlog/cold/follow-ups.md`): "z.ai 402 HTTP status
  verification", "z.ai integration validation-model fallback" — both feed the
  dynamic-ceiling open question.

## Quota fairness + owner protection (added 2026-07-03 — expands scope to BOTH shared system keys)

Owner directive: sharing must be built "very carefully so that it doesn't affect
my ability to use the plan I paid for." That makes owner protection the hard
requirement, fair-share among free users the second, and it applies to the
EXISTING shared `OPENROUTER_API_KEY` free tier as much as the future z.ai key —
today one heavy free user can starve all others (and on z.ai, could starve the
owner). "Not an active concern yet, but an area of vulnerability to address
sooner rather than later."

Design constraints for the allocation layer (provider-agnostic — one mechanism,
two keys):

1. **Owner-first headroom**: free-tier consumption of the z.ai key hard-caps at
   a configurable fraction of the plan's quota window (e.g. free users
   collectively never exceed N%/day), so the owner's own usage is never queued
   behind guests. Owner requests bypass the free-tier allocator entirely.
2. **Per-user fair share, dynamic**: per-user budgets derived from the remaining
   window quota and active-user count rather than fixed constants — a lone user
   may use more; under contention budgets shrink. (Redis is the natural home:
   sliding-window counters per user + a global window counter.)
3. **Degrade, don't error**: a free user over budget falls back to the free
   OpenRouter tier (for z.ai) or gets a friendly in-character rate message with
   reset time (for OpenRouter) — never a raw provider 402/429.
4. **Observability**: per-window usage split (owner vs free-tier, per-user
   top-N) visible via an admin command or the weekly audit, so quota-eating
   is diagnosable before it's an incident.
