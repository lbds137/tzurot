---
id: doc-106
title: 'Theme: Feature-flag lifecycle for system settings'
type: other
created_date: '2026-09-18 00:54'
---


### Theme: Feature-flag lifecycle for system settings

_Focus: some system settings are feature flags in practice — rollout switches and per-character rollout lists — and nothing distinguishes them from permanent operational switches, records when they should go, or closes the loop when the feature normalizes. Codify the lifecycle so retirement is mechanical, not remembered._

**Owner intake 2026-09-18** ("we seem to be using these settings as kind of feature flags … we add them but forget to circle back around to clean them up, so the settings kind of get bloated over time" → "we probably need a more formalized / codified approach").

**Measured 2026-09-18** (`packages/common-types/src/schemas/api/systemSettings.ts`, keys at HEAD vs the revision at or before 2026-07-19): 21 keys two months ago, 34 now, 13 of them boolean switches or slug lists, **zero keys ever retired**. Lifecycle intent exists only as doc-comment prose ("staged rollout switch", "kill switch") in `systemSettingsRegistryOperations.ts` — no field, no gate, no tracker task has ever owned a flag's removal.

**The inventory, sorted by what each actually is** (verify against the schema before acting — comments drift):

- Permanent operational kill switches (keep): `extractionEnabled`, `archiveSummaryEnqueueEnabled`, `archiveSummaryModelEnabled`, `nightlySyncEnabled`, `recentDaysDigestEnabled` — each stops a scheduled spender or a sync in an incident.
- Rollout switches whose feature has normalized or is about to (retire): `realMessagesEnabled` (ON on prod since 2026-09-08 and dev since 09-13; its own comment says "Phase 2 rollout switch"), `factsInPromptEnabled`, `rosterBlurbEnabled`, `stickerVisionEnabled`; `headerSpoofNeutralizeEnabled` is a hardening default that should become the only code path once trusted.
- Per-character rollout lists (retire by inversion or deletion once every character is flipped): `archiveSplitRenderPersonalities`, `recentDaysDigestPersonalities`.
- Product policy (keep): `zaiFreeTierEnabled`.

### Phase 0 — vocabulary and the registry field (NEXT)

- [ ] Name the concept in `03-database.md` or a short reference doc: a **rollout flag** is a setting whose only job is to stage a feature; it is born with a retirement condition. A **kill switch** is permanent. A **policy setting** is product configuration.
- [ ] Add a required `lifecycle: 'permanent' | 'rollout'` field to every registry entry (`systemSettingsRegistryOperations.ts` and `systemSettingsRegistry.ts`; compile-time forced so no entry can omit it). Rollout entries also carry `retireWhen: <one sentence naming the observable>` and `retireTask: 'TASK-N'` — the tracker task filed at the flag's creation that owns its removal (`state:observable`, the observable = `retireWhen`).
- [ ] Classify the 13 existing entries per the inventory above; file the retire tasks for the rollout ones (the task carries the filing date — no dates in code).

### Phase 1 — the gate

- [ ] Extend `systemSettingsRegistry.test.ts` (or `pnpm ops backlog`, which already resolves `doc-N` ids against the store): every rollout entry's `retireTask` must exist AND be open. A task closed while the flag still exists fails the gate, so the only way to close the loop is to delete the setting — its schema key, registry rows, dashboard row, fallback, and every reader. The digest's aging surface then shows overdue flags for free.
- [ ] A settings-dashboard hint or `pnpm ops settings:flags` line listing rollout flags with their `retireWhen`, so the owner sees the debt where the flags are flipped.

### Phase 2 — the first retirements (each its own small PR)

- [ ] `realMessagesEnabled` → the real-messages path becomes the only path (deletes the `<chat_log>` render arm and its tests; TASK-725's 3×-render measurement note is folded or closed). **Owner ruling 2026-09-18: yes — the first retirement.**
- [ ] `headerSpoofNeutralizeEnabled` → always on.
- [ ] `factsInPromptEnabled`, `rosterBlurbEnabled`, `stickerVisionEnabled` → each on its own observable.
- [ ] The two personality lists: **owner ruling 2026-09-18: DELETE once every character is flipped** — the feature becomes unconditional, the setting, its dashboard row, and the slug filter in the sweep/render go away (an exclusion list would be a new flag by another name; the per-character flip is a rollout, not a policy). The archive list flips per character by design (D3, memory-archive format doc) — the deletion waits on the last gate.

**Related**: TASK-725 (real-messages triple render); `doc-97` (the digest list is its rollout); `docs/proposals/backlog/memory-archive-format.md` (the split-render list's per-character flip). Not a fourth flag mechanism: this reuses the existing registry, tracker, and digest.
