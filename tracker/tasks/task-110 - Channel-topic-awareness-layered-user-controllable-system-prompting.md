---
id: TASK-110
title: Channel-topic awareness + layered user-controllable system prompting
status: To Do
assignee: []
created_date: '2026-05-18 00:00'
updated_date: '2026-08-31 22:26'
labels:
  - 'area:ai-worker'
  - 'area:docs'
  - 'area:backlog'
  - 'size:L'
  - 'state:dependent'
dependencies: []
priority: medium
ordinal: 110000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Channel-topic awareness + layered user-controllable system prompting

**Why:** Two-part deferred feature: (a) bots should be aware of the Discord channel topic so they can recognize on-topic vs off-topic content; (b) this requires updating the default system prompt in the system-prompts table, which in turn benefits from layered user-controllable prompting first (system → channel → persona → user layers with explicit precedence). Part (b) is the structural enabler; part (a) is the user-facing payoff. **Promote when**: ready to tackle the system-prompts-table architecture work — layered composition design comes first, then schema change, then channel-topic plumbing. **Start**: review `services/ai-worker/src/services/prompt/` for current single-layer assembly; design layered composition before changing schema. Surfaced 2026-05-18 in personal notes. Deferred 2026-05-19. **DESIGN LANDED 2026-07-05**: the layered-composition seam (platform → channel → personality → user-overrides) is §2.1 of `docs/proposals/backlog/prompt-assembly-architecture.md` — typed layers ship in its Phase 1; the channel layer + schema stay trigger-gated as before. Entry retained until the channel layer ships.

🔺 DEMAND SIGNAL 2026-08-31 — a real user asked, and the owner steered toward prioritizing this. A user in the owner Discord asked whether bots can be stopped from doing roleplay actions; the owner answered that it needs a prompting change and that making it customizable keeps losing to bug fixes. Owner note to the agent: "we may have to prioritize customizable system prompt portions because users are starting to ask for it." That request is a USER-OVERRIDES layer use case, not a channel-topic one.

TWO CORRECTIONS FROM READING THE CODE, both of which change what this task is worth.

1. The seam is NOT built, contrary to the line above. Phase 1 shipped the SECTION model, and `services/ai-worker/src/services/prompt/sections.ts` carries TIERS only — `SectionTier = 'S0' | 'S1' | 'H' | 'V'`. Grep it for "layer" and the only hits are prose about tiers. So "typed layers ship in its Phase 1" is optimistic: layered composition WITHIN S1 is Phase 4 of that doc and is unbuilt. Re-verify before scoping, cites drift.

2. The channel dependency is SEPARABLE, and that is the finding that unblocks this. Phase 4 was deferred behind channel-topic awareness, but that is the CHANNEL layer's trigger. `user-overrides` is a different member of the same ordered seam and needs storage, a command, and composition — nothing about channel topics. The user-overrides half can therefore ship with the channel half left trigger-gated exactly where it is. That is not a re-litigation of the deferral; it is splitting a task whose two halves have independent triggers, one of which has now fired.

WHAT THE SPLIT-OUT SLICE STILL NEEDS BEFORE IT IS BUILDABLE (do not treat it as ready):
- A scoping pass. It is smaller than this task's `size:L`, but "smaller than L" is not a size.
- An owner decision the existing records leave open: per-user-GLOBAL or per-user-per-CHARACTER. doc-26 § "User System Prompts (Sidecar Prompts)" names both and picks neither, and that choice drives the schema.
- A named tension with the caching epic, which should be in the design rather than discovered after: S1 sits inside the cacheable prefix. A per-user override in S1 fragments that prefix per user, cutting against Phases 0+1 that shipped and measured a 0.62 prod cache-hit rate. Placement (S1 vs the V tail) is a real design question with a measurable cost either way.

DO NOT FILE A THIRD RECORD for this. The user-facing feature already lives in doc-26 § "User System Prompts (Sidecar Prompts)" (which also notes shapes.inc imports already preserve `customFields.sidecarPrompt`, so imported users have the data sitting unused); the architecture lives in §2.1 of the prompt-assembly doc; this task is the bridge. Add to those, do not fragment.

Priority raised low → medium on the owner steer above. Left `state:dependent` deliberately: the CHANNEL half still is dependent, and re-labelling the whole task would misrepresent it. The split itself is the owner's call.
<!-- SECTION:DESCRIPTION:END -->
