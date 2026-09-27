---
id: doc-62
title: >-
  Idea: Memory-promoter skill — periodic generalization pass over the memory
  store
type: other
created_date: '2026-08-09 14:59'
---

_Owner idea (2026-08-09): a skill analogous to `/tzurot-session-mining`, but the corpus is the auto-memory store (`~/Documents/claude-memory`, shared by every session on this machine) instead of session JSONLs._

**What it does**: periodically sweep every memory file asking "is this content generalizable beyond one machine/one Claude instance?" — a fact every contributor needs is a rule, a procedure is a skill step, a deterministic trigger is a hook. Once the raw material is generalized into the durable layer, the source memories get cleaned up (the promote-atomic-with-deletion rule in `00-critical.md` § Fix Recurring Failures Structurally governs the endpoint: propose deleting the file, its MEMORY.md index line, and inbound `[[links]]`, and delete only on the owner's yes, because the store is shared by every session).

**Why a skill**: the 2026-07-03 handoff refit did exactly this manually (56 → 26 files) and it worked — but nothing owns doing it again, so the store re-accumulates promotable content until a crisis forces another refit. Same gap shape that motivated `/tzurot-session-mining`: the one-off audit proved the value; the skill makes it periodic.

**Sketch** (to be scoped at build time):

1. **Inventory**: read MEMORY.md + every memory file; classify each as (a) genuinely per-user/per-machine (stays), (b) generalizable constraint → rule candidate, (c) generalizable procedure → skill-step candidate, (d) deterministic-trigger correction → hook candidate, (e) stale/wrong → delete candidate.
2. **Verify before promoting**: memories are point-in-time; re-verify any code/file claims against current source before they enter a rule (the recall system-reminder already warns about this).
3. **Promote**: review-gated PR for rules/skills/hooks changes; memory deletions are proposed to the owner and applied on her yes.
4. **Report**: net store size before/after, what moved where, what stayed and why.

**Cadence**: piggyback the session-mining cadence (~4–6 weeks) or run when MEMORY.md exceeds a size threshold.

**Relation to existing surfaces**: `harness:doc-audit` § Step 2 (in the claude-harness plugin) now owns the memory audit: per-file verdicts, destination first, deletion proposed on the owner's gate, on the 14-day `memory-prune` cadence. Much of this sketch (steps 1-3) is that step; what it does not do is measure the store or signal "time to trim" (doc-63's gap). The `mined-corpus/reports/memory-store-audit.md` report is prior art from the last manual pass.

