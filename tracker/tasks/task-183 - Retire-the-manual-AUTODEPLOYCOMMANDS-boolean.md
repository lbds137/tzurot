---
id: TASK-183
title: Retire the manual AUTO_DEPLOY_COMMANDS boolean
status: To Do
assignee: []
created_date: '2026-06-28 00:00'
updated_date: '2026-07-28 10:49'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 183000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Retire the manual `AUTO_DEPLOY_COMMANDS` boolean — derive command-registration from the environment (+ optional change-detection)

**Why:** Slash-command registration on bot boot (`index.ts:722`) is gated on the hand-set `AUTO_DEPLOY_COMMANDS` env var (schema: optional, default-falsy; `.env.example`=false; dev+prod="true"). Its ONE legitimate job is the **local-dev opt-out** (a local `pnpm dev` skips registration so it can't clobber/churn the shared app's GLOBAL commands). But it's a **footgun**: a hand-set per-env flag that MUST be `true` on dev/prod — if it ever silently went missing there, the bot boots fine while commands quietly stop updating (the exact "new option didn't appear in Discord" confusion). It also re-runs a global bulk `rest.put` on EVERY boot/redeploy even when the command set is unchanged, churning Discord's ~1h global propagation + burning the command-update rate budget on crash-loops. **Fix shape**: (a) derive enablement from the environment (auto-on when running on Railway / `ENVIRONMENT ∈ {dev,prod}`, off locally) instead of a hand-set boolean — kills the footgun while keeping local protection; (b) optionally add change-detection — hash `command-manifest.json` (already generated), store/compare the last-registered hash, skip the PUT when unchanged. **Open question** (determines whether the local opt-out is even needed): does local `pnpm dev` point at the SHARED dev Discord app or a separate throwaway app? If always separate → the clobber concern evaporates and the var is near-dead config (simpler: just always-register on Railway). If shared → the env-derived guard is required. **Promote when**: a config/`.claude` tidy pass, or if a crash-loop hits Discord command rate limits. Surfaced 2026-06-28 (user, during S2c/S2d dev-validation setup).
<!-- SECTION:DESCRIPTION:END -->
