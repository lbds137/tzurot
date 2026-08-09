---
id: doc-62
title: >-
  Idea: Memory-promoter skill — periodic generalization pass over the memory
  store
type: other
created_date: '2026-08-09 14:59'
---

_Owner idea (2026-08-09): a skill analogous to `/tzurot-session-mining`, but the corpus is the auto-memory store (`~/.claude/projects/*tzurot*/memory/`) instead of session JSONLs._

**What it does**: periodically sweep every memory file asking "is this content generalizable beyond one machine/one Claude instance?" — a fact every contributor needs is a rule, a procedure is a skill step, a deterministic trigger is a hook. Once the raw material is generalized into the durable layer, the source memories get cleaned up (the promote-atomic-with-deletion rule in `00-critical.md` § Fix Recurring Failures Structurally already governs the endpoint: delete the file, its MEMORY.md index line, and inbound `[[links]]` in the same action).

**Why a skill**: the 2026-07-03 handoff refit did exactly this manually (56 → 26 files) and it worked — but nothing owns doing it again, so the store re-accumulates promotable content until a crisis forces another refit. Same gap shape that motivated `/tzurot-session-mining`: the one-off audit proved the value; the skill makes it periodic.

**Sketch** (to be scoped at build time):

1. **Inventory**: read MEMORY.md + every memory file; classify each as (a) genuinely per-user/per-machine (stays), (b) generalizable constraint → rule candidate, (c) generalizable procedure → skill-step candidate, (d) deterministic-trigger correction → hook candidate, (e) stale/wrong → delete candidate.
2. **Verify before promoting**: memories are point-in-time; re-verify any code/file claims against current source before they enter a rule (the recall system-reminder already warns about this).
3. **Promote**: review-gated PR for rules/skills/hooks changes; memory deletions ride the same working session (atomic).
4. **Report**: net store size before/after, what moved where, what stayed and why.

**Cadence**: piggyback the session-mining cadence (~4–6 weeks) or run when MEMORY.md exceeds a size threshold.

**Relation to existing surfaces**: `/tzurot-doc-audit` Section 0 owns placement criteria + migration triggers for the three durable layers; this skill would be the memory-side feeder into that. The `mined-corpus/reports/memory-store-audit.md` report is prior art from the last manual pass.

