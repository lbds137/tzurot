---
id: TASK-98
title: 'buildSentinelPersonality type-safety hardening'
status: To Do
assignee: []
created_date: '2026-05-16 00:00'
labels: []
dependencies: []
ordinal: 98000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

`buildSentinelPersonality` type-safety hardening

**Why:** `MultiTagRecovery.buildSentinelPersonality` returns a `Partial<LoadedPersonality>` shape cast via `as unknown as LoadedPersonality` — only `id`/`slug`/`displayName`/`name` are populated. The deliverError path consumes those four fields; any future caller touching other fields (e.g., `llmConfig`, `systemPrompt`) will silently observe `undefined` rather than receive a type error. **Fix shape**: replace the cast with a discriminated-union sentinel type (e.g., `LoadedPersonality | { __sentinel: true; id, slug, displayName, name }`) so consumers must explicitly handle the sentinel case, OR change `LoadedPersonality` itself to make the four "always-present" fields non-optional and the rest optional + add an `isSentinel` discriminator. **Promote when**: a downstream caller of recovery-rebuilt slots needs to access a non-sentinel field of `LoadedPersonality` (next refactor of `SlotDeliveryService` or any extension to `deliverError`). Surfaced 2026-05-16 PR #1034.
<!-- SECTION:DESCRIPTION:END -->
