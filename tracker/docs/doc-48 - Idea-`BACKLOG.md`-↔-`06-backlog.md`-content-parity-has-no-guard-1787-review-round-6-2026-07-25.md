---
id: doc-48
title: >-
  Idea: `BACKLOG.md` ↔ `06-backlog.md` content parity has no guard (#1787 review
  round 6, 2026-07-25)
type: other
created_date: '2026-07-28 11:11'
---

## `BACKLOG.md` ↔ `06-backlog.md` content parity has no guard (#1787 review round 6, 2026-07-25)

The HOT/COLD split exists so session-start context stays small: `BACKLOG.md` is read *instead of* `.claude/rules/06-backlog.md`, which means it must **duplicate** the rule content — and duplicated content drifts silently. #1787 demonstrated it twice in two consecutive review rounds: adding a third removal exit ("ruled out") to the rule file left `BACKLOG.md` still stating two, and left its filing decision-tree routing "small, one sentence" items straight into `cold/follow-ups.md` — the exact filing the same PR's admission bar exists to prevent. An agent reading only the HOT manifest would have been actively instructed to do the opposite of the new rule. `backlog/cold/follow-ups.md`'s own header was a third stale copy, found only by applying `00-critical`'s Grep Rule after the reviewer named the first.

Nothing checks this. Verified during the round: no tooling references the shared phrases (`grep -rn "genuinely obsolete\|leaves the backlog" packages/tooling/src` → empty), and `guard:proposal-links` is the only guard that touches `BACKLOG.md` at all — it checks inbound links, not content.

**Three candidate shapes:**

1. **A parity check** — `pnpm ops guard:backlog-parity` asserting that a small set of canonical claims (the exit count, the ladder destinations, the admission-bar branches) appear consistently in `BACKLOG.md` and `.claude/rules/06-backlog.md` (the third stale surface, the follow-ups table header, retired with the substrate flip). Binary sync-check shape, so NOT audit-class (same category as `guard:duplicate-exports`/`guard:gate-parity` per `docs/reference/audit-enforcement.md`) — no WHY.md, no canary, no `--summary`. Cheap, but it only detects drift; it doesn't remove the duplication.

2. **Make the copies pointers.** `.claude/skills/tzurot-docs/SKILL.md:73` already does this correctly — "See `.claude/rules/06-backlog.md` for the canonical topology + the granularity-ladder filing rule" — and it cannot go stale. If `BACKLOG.md`'s staleness and decision-tree sections shrank to a one-line summary plus a pointer, there would be nothing to keep in sync. The tension: that costs a file-open at the moment of filing, which is exactly the friction the HOT surface exists to avoid, and the whole reason the content was inlined. Needs a judgment call on how much of the rule genuinely must be inline to be *acted on* versus merely *known about*.

3. **Extend `dev:deferred-refs` past the tracker store.** It scans tracker tasks for entries naming your changed paths and prints them at commit/push (`packages/tooling/src/dev/check-deferred-refs.ts`) — tasks only. Pointing it also at the doc store (`tracker/docs/`) would make a **filed batch surface at the moment someone touches a file it names**, which is the missing half of the admission bar's file-the-batch disposition: today a batch entry is grep-on-demand only, so it waits to be rediscovered by the very sweep it was meant to prompt. This is a smaller change than either option above and mechanizes the disposition rather than merely detecting its failure — likely the right first move, with the parity check as a follow-on.

**Honest qualification to the admission bar, measured today**: the bar's premise is "nobody greps a several-hundred-row table before unrelated work." `dev:deferred-refs` does exactly that grep, automatically, at every push — so the premise is not absolute. But the empirical rate is low: across ~6 pushes touching tooling, rules, workflows, and docs, it surfaced **1 of 357 rows**, because most rows name a module or symbol rather than a path it can match. The bar stands; the qualification is that a path-naming follow-up row is meaningfully more reachable than a symbol-naming one, which is an argument for naming paths when a row is filed at all.

**Promote when**: a review catches a third `BACKLOG.md` ↔ rule contradiction (reviews run on every PR, so this fires without anyone remembering), or the drain work reaches a rule-out batch and edits these surfaces anyway. The earlier trigger on this entry — "the next edit to any rule `BACKLOG.md` restates" — was itself the opportunistic shape this PR's admission bar rejects, filed an hour after shipping the prohibition; replaced rather than kept.

