---
id: TASK-1408
title: Preset editor cannot clear a sampling parameter (temperature and friends)
status: To Do
assignee: []
created_date: '2026-11-12T17:13:00Z'
labels:
  - area:bot-client
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1389000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: Lila hit it 11-12 editing her global preset (Opus 4.5 -> Opus 5.5): blanking temperature left the stored value in place. Chats relayed; the lead below verified against the code.
What: the bot-client preset editor has no clear path for numeric sampling params. parseNumericParams (config.ts:91) skips empty strings, buildAdvancedParameters (config.ts:135-136) returns null when no sampling param and no thinking level remain, and unflattenPresetData (config.ts:167-169) then omits advancedParameters from the payload — so blanking the ONLY advanced param sends no change and the stored value survives. Only description has a clear path (NULL_WHEN_EMPTY_FIELDS config.ts:64, the null branch at :155). The dashboard modal prefills current values, so an emptied field always means clear-intent; the parser treats it as no-op.
Open question for the fix: the gateway side. ANSWERED 11-12 (driver read): the gateway REPLACES the whole object — LlmConfigService.ts:362-363 sets updateData.advancedParameters whenever the payload carries it (no per-key merge), and the schema accepts a bare {} (SamplingParamsSchema fields all optional, llmAdvancedParams.ts). So the fix is bot-client-only: in parseNumericParams/unflattenPresetData, distinguish field ABSENT (undefined = untouched, omit) from field PRESENT-BUT-EMPTIED (clear intent — omit the key from the rebuilt object and SEND the object even when empty, letting the gateway replace clear it). Remaining read before the fix: what the dashboard modal actually submits (all fields always vs touched-only) — it decides the cleared-vs-untouched signal; guard the create path so it never starts writing empty objects. Lila ruling 12:16: quick fix rides beta.244 with the caching fix.
Acceptance: blanking temperature on a preset (as the only advanced param) clears the stored value — verified in dev by edit, reload, export shows no temperature; blanking one of several advanced params clears only that key; a normal edit with values untouched still updates name/model without touching advancedParameters.
<!-- SECTION:DESCRIPTION:END -->
