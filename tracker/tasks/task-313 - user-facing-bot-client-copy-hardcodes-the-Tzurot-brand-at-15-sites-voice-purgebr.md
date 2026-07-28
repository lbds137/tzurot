---
id: TASK-313
title: Hardcoded Tzurot brand in ~15 bot-client copy sites
status: To Do
assignee: []
created_date: '2026-07-22 00:00'
updated_date: '2026-07-28 10:52'
labels:
  - 'area:bot-client'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 313000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Surfaced 2026-07-22 (owner, `/help getting-started` on dev) — user-facing bot-client copy hardcodes the "Tzurot" brand at ~15 sites (voice purge/browse copy, shapes import description, maintenance message, webhook name "Tzurot Personalities", `/help` command descriptions) — the dev app is Rotzot, so dev copy misbrands. The getting-started EMBED now brands from the runtime bot identity + `PUBLIC_SITE_URL`; the rest remain static. Constraint: registered command metadata is deploy-time static — env-driven descriptions would fork the manifest + component snapshots per environment. **Fix shape**: brand-neutral wording ("the bot", "cloned voices") where natural; runtime `client.user.username` where the surface is dynamic. **Promote when**: the next copy sweep touches these families, or a dev user reports confusion.

**Why:** Dev-only cosmetic misbranding; prod copy is correct — not worth forking snapshots now.
<!-- SECTION:DESCRIPTION:END -->
