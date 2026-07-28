---
id: doc-18
title: 'Theme: Quota, Billing & Key Identity'
type: other
created_date: '2026-07-28 11:11'
---

### Theme: Quota, Billing & Key Identity

_Focus: make "whose key is this, and whose budget does it spend?" a single answered question instead of a per-call-site guess._

Surfaced 2026-07-24 during the follow-ups triage: 21 rows spread across the flat
table turned out to be one domain with a shared spine. Nothing else in
`cold/queue.md` covers it — every other cluster mapped onto an existing theme.

**Why it's a theme and not 21 nits:** the largest group is literally one bug
class wearing different clothes. `deriveCacheKeyId` branches on whether a key is
*present* rather than on which entity is *billed*, so the identity used to WRITE
a rate-limit/doom marker can differ from the one used to READ it. That single
mismatch produces at least five separately-filed rows. Fixing them one at a time
means fixing the same thing five times and still not having an invariant.

### Phase 1 — Unify the billing identity (the spine)

The rows below are one defect. They should be scoped together, not picked off.

- [ ] **Derive the cache bucket from the billing entity, not key-presence.**
      `deriveCacheKeyId(userApiKey, userId)` returns `user:<id>` whenever a key
      is defined — including for guests carrying the resolved SYSTEM key, who
      should share the `system` bucket. (row: "Doom-cache bucket scoping",
      2026-07-06)
- [ ] **Forced-system-key retries read the wrong identity.** The pre-check reads
      the caller's pre-retarget `cacheKeyId` while the failure is written under
      `system` — so the known-doomed fast-path never fires. Five instances
      recorded across `quotaFallback`, `retargetRoute`, `quotaFallbackRunner`,
      `AuthStep`, and the D12 floor hop. (row: 2026-07-10)
- [ ] **BYOK key rotation leaves a stale block.** A rotated key inherits the old
      key's rate-limit bucket for up to 24h because the scope is
      `user:<discordId>` with no rotation epoch. (row: 2026-04-29)
- [ ] **`cacheKeyId` optionality.** Making it required in
      `InvokeWithRetryOptions` forces every call site to state an identity
      rather than silently opting out. (row: filed via PR #943)
- [ ] **`tryResolveUserKey` has no negative-cache sentinel** — two rows filed
      separately (2026-04-27, 2026-06-17) describing the same missing
      "no user key configured" state.

**Promote when**: any of the five above is picked up. They share a fix; taking
one alone re-opens the others.

### Phase 2 — Free-tier fairness (v2)

v1 ships a rolling window divided among active users. These are the deferred
refinements, all evidence-gated.

- [ ] Usage-history weighting so habitual light users get more headroom (2026-07-08)
- [ ] Sybil / alt-account dilution guard — `N` is inflatable by cheap alts (2026-07-08)
- [ ] z.ai key half of the fair-share + owner-first headroom (2026-07-08)
- [ ] `computeWindowCap` min<=max guard — env path still unguarded (2026-07-08)
- [ ] `tryConsume` pipelining — up to 10 sequential Redis round-trips (2026-07-08)
- [ ] N-comment accuracy + redundant `resolveSystemKey` call (2026-07-08)
- [ ] Fair-share allocation for the SHARED system OpenRouter key — owner flagged
      "address sooner rather than later"; one heavy free user can currently
      starve everyone (2026-07-03)

### Phase 3 — Spend correctness

- [ ] Preprocessing jobs (STT/vision/shapes) lack a spend-idempotency guard on
      stall-requeue — a false stall double-bills the provider, BYOK included.
      The tripwire (stalled-event logging) already ships. (2026-07-14)
- [ ] BYOK extraction billing — extraction bills the SYSTEM key only; needs a
      design pass plus the consent disclosure the onboarding-DM theme notes.
      **Promote when**: a normal (non-backfill) week shows extraction consuming
      a significant share of the coding-plan quota. (2026-07-14)
- [ ] Vision system-fallback daily cap → runtime admin-settings knob (2026-06-14)
- [ ] Extract `AtomicDailyCounter` from `ExtractionBudget` + `VisionFallbackQuota`
      — zero-callback extraction that also backports the atomic INCR+EXPIRE,
      closing a real crash-between-incr-and-expire gap (2026-07-07)

### Phase 4 — Legibility and validation

- [ ] z.ai free-tier integration legibility dig — `ApiKeyResolver` says "no
      system fallback for z.ai" while `ZaiFreeTierAdmission` routes admitted
      guests onto the system key anyway. An adversarial reader concluded the
      free tier doesn't exist. (2026-07-15)
- [ ] Audit api-gateway key validators for 5xx-as-transient classification (2026-05-17)
- [ ] `QUOTA_EXCEEDED` branch of `defaultRateLimitResetMs` is untested (2026-05-18)
- [ ] BYOK `lastUsedAt` tracking — the oldest row in the whole table (2026-01-26)

### Notes

The items live in `tracker/tasks/` as the authoritative text; this file is the
scope index. When a phase is picked up, mark its tasks Done per
`06-backlog`'s session-end removal gate rather than duplicating them here.
