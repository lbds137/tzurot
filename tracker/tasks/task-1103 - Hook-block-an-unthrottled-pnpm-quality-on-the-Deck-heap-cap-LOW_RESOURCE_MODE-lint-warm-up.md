---
id: TASK-1103
title: >-
  Hook: block an unthrottled pnpm quality on the Deck (heap cap +
  LOW_RESOURCE_MODE + lint warm-up)
status: To Do
assignee: []
created_date: '2026-09-25 16:53'
labels:
  - 'area:hooks'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 1096000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm quality unthrottled forks one eslint per package through turbo (four at 1.6-2.1 GB each measured 2026-09-25 by the Deck management session) and drives the 14.8 GB Deck into critical memory; on 2026-09-25 it got a peer session background shell reaped and earlier a quality run of this session reaped. The recipe exists in the shared memory (reference_steamdeck_resource_limits.md: warm the lint cache with npx turbo run lint --concurrency=1 --output-logs=errors-only, then LOW_RESOURCE_MODE=1 NODE_OPTIONS=--max-old-space-size=3072 pnpm quality) and a memory line has now failed to prevent the miss twice, so the fix belongs in a hook, not in attention.

Fix shape: a PreToolUse Bash hook under .claude/hooks (with its probe registered in check-hook-probes-registry.ts) that matches a pnpm quality invocation and blocks it unless the command carries LOW_RESOURCE_MODE=1 and NODE_OPTIONS=--max-old-space-size=3072 in assignment position; the block message prints the two-step recipe verbatim. Scope the match to the Deck (hostname steamdeck) so the cloud lane and CI are untouched. Consider the same guard for pnpm test and pnpm typecheck, which 05-tooling.md already forbids running in parallel.

Acceptance: a bare pnpm quality is blocked with the recipe printed; the throttled form passes; the probe covers both shapes.
<!-- SECTION:DESCRIPTION:END -->
