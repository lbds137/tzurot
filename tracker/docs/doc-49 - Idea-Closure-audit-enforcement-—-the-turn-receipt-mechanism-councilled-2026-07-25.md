---
id: doc-49
title: >-
  Idea: Closure-audit enforcement — the turn-receipt mechanism (councilled
  2026-07-25)
type: other
created_date: '2026-07-28 11:11'
---

## Closure-audit enforcement — the turn-receipt mechanism (councilled 2026-07-25)

Three failure classes share one cause: **the agent ends a turn without auditing its own completeness.** Deferred work left only in chat, user questions left unanswered, and factual claims asserted without checking are the same defect — state mutated in prose, where nothing can verify it. Rules exist for all three (`06-backlog` § promise ledger, `09-interaction-style` § Answer the User's Questions First, `00-critical` § Don't Present Speculation as Fact) and all three were violated repeatedly in a single session, which makes them compliance findings rather than missing-rule findings: another rule restating them is worthless.

**Councilled unanimously (three models, no split).** The finding that generalizes: *hooks work when they check canonical representations; they fail when they infer semantics from unstructured text.* `pr-merge-review-check.sh` has never failed because nothing in it is interpreted — trigger is a tool call, payload is a comment id, decision is "does an ack file exist." `promise-ledger-check.sh` made three separate semantic inferences from prose and produced three independent failures in one day. A base-rate argument reinforces it: a Stop hook fires on *every* turn, so even a small false-positive rate compounds into multiple daily misfires.

**The proposed mechanism**: convert the absence into a required presence. A structured turn-receipt the Stop hook validates for **format**, not content — one ritual, three predicates (questions↔answers, deferrals↔backlog write, claims↔evidence). The agent does the semantics; the hook enforces only that the audit happened. It raises the bar from *passive omission* to *active lie* and makes violations mineable. That is a real improvement, not a guarantee, and should not be oversold as one.

**Recorded dissent from the unanimous advice**: all three models proposed an ALWAYS-ON receipt (`close_turn` tool, or a receipt block on every turn). None weighed the owner-facing cost — the owner reads on a phone and dictates by voice, so a mandatory structured block on every reply taxes the surface actually consumed, to fix a problem that only occurs on turns carrying promises or questions. **Prefer the conditional form**: receipt only when the user asked something or work was deferred.

**Remaining pieces, by blast radius**:
- **Question-receipt hook** (moderate) — a Stop hook that extracts questions from the user's last message and requires the closing message to address each. Same shape as the promise hook but with a canonical input (the user's `?`) rather than an inferred one.
- **The turn ritual / `close_turn`** (high) — changes how every turn ends. Wants its own PR and live observation of its first hours, because a guard that misfires at every turn-end trains reflexive acknowledgement, which destroys the signal more thoroughly than the original gap did.
- **Known gap left open by the promise-hook rework**: a same-turn backlog write still clears every promise in the turn, so filing item A licenses promising item B. Fixing that by matching write-to-promise would reintroduce the semantic inference the rework removed; the receipt is the honest fix.

**Promote when**: the next session that opens fresh (this is deliberately not end-of-session work), or the next observed instance of an untracked commitment surviving the reworked promise hook. **Related**: the probe harnesses are still "run manually after editing the hook" rather than CI-wired — see the follow-ups row on that; a receipt hook makes wiring them up more valuable, since it would run against every turn.

