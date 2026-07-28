---
id: TASK-110
title: Channel-topic awareness + layered user-controllable system prompting
status: To Do
assignee: []
created_date: '2026-05-18 00:00'
updated_date: '2026-07-28 10:48'
labels:
  - 'area:ai-worker'
  - 'area:docs'
  - 'area:backlog'
  - 'size:L'
dependencies: []
priority: low
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Channel-topic awareness + layered user-controllable system prompting

**Why:** Two-part deferred feature: (a) bots should be aware of the Discord channel topic so they can recognize on-topic vs off-topic content; (b) this requires updating the default system prompt in the system-prompts table, which in turn benefits from layered user-controllable prompting first (system → channel → persona → user layers with explicit precedence). Part (b) is the structural enabler; part (a) is the user-facing payoff. **Promote when**: ready to tackle the system-prompts-table architecture work — layered composition design comes first, then schema change, then channel-topic plumbing. **Start**: review `services/ai-worker/src/services/prompt/` for current single-layer assembly; design layered composition before changing schema. Surfaced 2026-05-18 in personal notes. Deferred 2026-05-19. **DESIGN LANDED 2026-07-05**: the layered-composition seam (platform → channel → personality → user-overrides) is §2.1 of `docs/proposals/backlog/prompt-assembly-architecture.md` — typed layers ship in its Phase 1; the channel layer + schema stay trigger-gated as before. Entry retained until the channel layer ships.
<!-- SECTION:DESCRIPTION:END -->
