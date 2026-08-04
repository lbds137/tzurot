---
id: TASK-389
title: >-
  Sticker descriptions are a tier-3 asset stored at tier 1 (1h Redis, no durable
  home)
status: To Do
assignee: []
created_date: '2026-08-01 14:59'
updated_date: '2026-08-04 13:50'
labels:
  - 'size:M'
  - 'area:ai-worker'
dependencies: []
priority: medium
ordinal: 389000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Found by doc-56's durability audit (#1890) — the one open tier violation it surfaced.**

A sticker is the cleanest tier-3 asset in the system: describing it costs a vision call, and the asset is IMMUTABLE and SHARED across every user who ever sends that sticker. One description could serve all of them forever.

Instead it lands in `VisionDescriptionCache` — 1h Redis, L1 only, explicitly no durable tier (`services/ai-worker/src/redis.ts` says "L1 Redis only (no L2 PostgreSQL)"). There is no sticker table or column in `prisma/schema.prisma`.

**Not a design mistake — a deliberate trade with an unbuilt second half.** #1872 routed stickers through the ordinary attachment -> download -> vision -> describe chain on purpose, to inherit the CDN allowlist, size caps, model cascade and failure fallbacks rather than reimplement them. That was right. The durable store was always meant to be a separate piece.

**The fix is designed and unbuilt: doc-55 PR-2**, the snowflake-keyed asset table, described there as "the only outstanding piece of this doc". This task exists so the gap is tracked as a TIER VIOLATION and not only as a feature idea — a feature can be deprioritised on product grounds; a violation should be closed or consciously accepted.

**Cost of leaving it:** every 1h TTL expiry re-describes a sticker the system has already paid to describe, across all users, forever. Unlike an ordinary Discord attachment (ephemeral URL, genuinely not worth persisting — which is WHY the Postgres L2 was removed before beta.110), a sticker snowflake is stable and re-describable at any time, so the reason that justified dropping the L2 does not apply to stickers.

**Acceptance:** a sticker description survives a Redis flush and a 1h+ gap; key is the sticker snowflake, not an attachment URL; `durability-tiers.md`'s tier-3 table stops saying OPEN VIOLATION.

**Promote when:** doc-55 PR-2 is picked up, or vision spend on repeat stickers becomes visible in usage data.
<!-- SECTION:DESCRIPTION:END -->
