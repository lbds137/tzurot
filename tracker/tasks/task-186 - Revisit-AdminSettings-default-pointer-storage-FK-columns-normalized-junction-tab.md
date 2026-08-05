---
id: TASK-186
title: >-
  Revisit AdminSettings default-pointer storage: FK columns → normalized
  junction table
status: To Do
assignee: []
created_date: '2026-06-29 00:00'
updated_date: '2026-07-28 10:50'
labels:
  - 'area:embeddings'
  - 'area:db'
  - 'size:M'
  - 'state:dependent'
dependencies: []
priority: low
ordinal: 186000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Revisit `AdminSettings` default-pointer storage: FK columns → normalized junction table

**Why:** P3-S3 stores the global/free default config pointers as **4 nullable FK columns** on the `AdminSettings` singleton (`{global,free}Default{Llm,Vision}ConfigId`) — councilled (GLM-5.2 / Kimi-K2.7 / Qwen-3.7-max) and chosen on **YAGNI** grounds: it matches the existing per-slot-FK pattern (`User.defaultVisionConfigId`, `UserPersonalityConfig`) and 2 tiers × 2 slots is too few to justify a table. Qwen's dissent favored a normalized `DefaultLlmConfig(tier, slot) → configId` junction table (enums `GLOBAL/FREE` × `CHAT/VISION`) for extensibility — the right call IF the slot/tier count grows (new modalities/tiers don't sprawl columns on the singleton + don't diverge from a clean lookup). **Fix shape**: migrate the N FK columns on `AdminSettings` → a `DefaultLlmConfig` junction table with `@@id([tier, slot])` + `onDelete:SetNull`; resolver does one `findMany` → `Record<Tier, Record<Slot, Config>>`. **Promote when**: the default slot or tier count grows beyond 2×2 (e.g. an audio/embeddings slot, or a premium/beta tier). Surfaced 2026-06-29 (P3-S3 schema council; owner swayed by YAGNI for now, flagged for revisit).
<!-- SECTION:DESCRIPTION:END -->
