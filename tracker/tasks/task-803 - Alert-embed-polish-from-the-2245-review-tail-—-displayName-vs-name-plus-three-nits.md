---
id: TASK-803
title: >-
  Alert-embed polish from the #2245 review tail — displayName vs name, plus
  three nits
status: To Do
assignee: []
created_date: '2026-08-28 23:24'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:owner'
dependencies: []
priority: low
ordinal: 803000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Owner decision needed on the first item; the rest are agent-callable.

1. ANSWERED 2026-08-28 — owner chose to KEEP personality.name and merged #2245 as-is. The greppability argument decided it: the card Personality field matches Railway log lines verbatim, which is what makes an alert correlatable. Do NOT re-raise this as a convention violation; it is a deliberate departure. The rest of item 1 is kept below as the record of what was weighed.

OWNER CALL, and the reason it was not just applied. The Personality field on the ops-alert embed renders personality.name (the internal identifier, e.g. lila) at all 10 reporter call sites. Most of bot-client uses displayName for this purpose — PersonalityChatManager.ts:203, MessageContextBuilder.ts:192, ReplyResolutionService.ts:237, DMSessionProcessor.ts:159 — and displayName is always populated (PersonalityDefaults.ts falls back to db.name). So convention says displayName.

The tradeoff the convention argument misses: name is the value that appears in log lines, so it is what the owner would grep when correlating an alert card against Railway logs. displayName reads better at a glance. Which matters depends on how the owner actually uses that channel — diagnosis-by-correlation favours name, recognition favours displayName. Ask, do not guess. Changing it is one word at each of 10 call sites plus the test fixtures.

2. ReportableJobResult in observability/ErrorChannelReporter.ts is exported with no external importer today — call sites rely on structural typing. Either drop the export keyword or leave it as deliberate module surface; knip currently does not flag it, so this is tidiness rather than a gate failure.

3. deriveDiagnosticFields composes the rescue Model field as fromModel arrow toModel BEFORE sanitizing, so an all-delimiter half (fromModel of exactly "()") leaves a dangling arrow rather than being omitted. addSanitizedField only drops the field when the WHOLE value empties. Contrived — rescue model names come from admin-configured LLM configs, not arbitrary user input — but it is the one gap left in that sweep. Sanitize each half before composing.

4. No test combines sanitizing and clamping on the same value. The strip test uses a short delimiter-only string; the clamp test uses a 5000-char repeat with no delimiters. Nothing pins a value that both contains brackets AND exceeds 1024 chars after stripping. The path is simple enough that a bug is unlikely, but everything else in that file is canary-pinned.

Acceptance: items 2, 3 and 4 closed or explicitly declined with a reason. Item 1 is already resolved — keep name.
<!-- SECTION:DESCRIPTION:END -->
