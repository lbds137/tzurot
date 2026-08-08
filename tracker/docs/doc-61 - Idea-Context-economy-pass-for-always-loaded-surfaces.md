---
id: doc-61
title: 'Idea: Context-economy pass for always-loaded surfaces'
type: other
created_date: '2026-08-08 15:01'
---

_Focus: give pruning of `.claude/rules` + skills an owner, a ranking that reflects real cost, and a decision rule for what earns its place._

Owner-approved 2026-08-08 (asked "do we have a skill for periodically pruning excess verbiage from rules / skills? if not we should consider one" -> yes, file it).

## The gap

Four pieces should exist; three do.

| Piece | State |
| --- | --- |
| The constraint — "rules/skills carry constraints, not archaeology" | EXISTS, `07-documentation.md` |
| A ceiling that stops growth past a limit | EXISTS, `pnpm ops lines:check` |
| An audit that walks every rule and skill file | EXISTS, `/tzurot-doc-audit` sections 2 and 3 |
| A pruning procedure — what to cut, how to rank, who decides | MISSING |

Every check in doc-audit sections 2/3 is **accuracy** ("does this still match reality?"). Not one asks **economy** ("is this earning its context cost?"). And `lines:check` is a gate, not a prompt: it can stop growth past a limit, never say "it is time to trim."

## Measured 2026-08-08

Always-loaded per session: **~54,000 tokens** before any work starts (rules ~43k, CURRENT.md ~8.8k, the two CLAUDE.md files ~1.9k).

Per-rule, sorted by real weight:

| File | Lines | ~Tokens | Chars/line |
| --- | --- | --- | --- |
| 05-tooling.md | 396 | 9,958 | 100 |
| 00-critical.md | 361 | 7,777 | 86 |
| 06-backlog.md | 230 | 5,684 | 98 |
| 02-code-standards.md | 263 | 5,303 | 80 |
| 03-database.md | 187 | 4,101 | 87 |
| 04-discord.md | 308 | 3,418 | 44 |
| 07-documentation.md | 84 | 2,630 | 125 |
| 10-working-posture.md | 123 | 1,633 | 53 |
| 09-interaction-style.md | 42 | 1,374 | 130 |
| 01-architecture.md | 94 | 1,263 | 53 |

## Why the metric has to be fixed FIRST

TASK-323 recorded in July that `lines:check` measures the wrong quantity. Still true, and the table above shows it live:

- `04-discord.md` is 308 lines against `05-tooling.md` 396 — by lines they look comparable. By tokens it is **a third** the weight (44 vs 100 chars/line, table-heavy).
- `CURRENT.md` reads "96/97 lines, comfortable" while being the **second-heaviest always-loaded surface in the repo** at 367 chars/line.

A pruning procedure built on line counts sends whoever runs it at `04-discord.md` while `CURRENT.md` sits there at triple the density looking healthy. **TASK-323 is a hard prerequisite**, not a nice-to-have: the ranking IS the value of the pass.

## Shape

**Extend `/tzurot-doc-audit` with an economy pass. Do NOT create a standalone skill.** doc-audit already walks this exact corpus at this exact cadence; a second skill means two walks over the same files that drift apart. It earns its own file only if the pass grows past ~40 lines.

Phases:

1. ~~**TASK-323** — add a bytes (or est-token) dimension to `lines-baseline.json` and the check output, plus a `--surface <name>` flag on `lines:update-baseline` so one metric can ratchet without loosening another.~~ **DONE 2026-08-08 (#2007).** Both dimensions gate independently, the report derives an est-token figure from bytes (nothing gates on the estimate), and `--surface` scopes a refresh. The prerequisite is satisfied; **this pass is now actionable.** First real use confirmed the premise live: a 2-line CURRENT.md edit cost 2,253 bytes, which the old line-only gate would have rejected on lines while never showing the cost that mattered.
2. **The economy pass** in doc-audit — ranked worst-first by the new metric, with a decision rule (below) and a bias toward cutting.
3. Optional follow-on: a trend line, so growth between audits is visible rather than only the ceiling.

## The decision rule is the hard part

"Go delete stuff" is not a procedure. The seed is `07-documentation.md`: rules state the constraint plus at most a one-sentence why; multi-paragraph incident narratives, adoption dates, and council-derivation notes do not belong in always-loaded surfaces — **the operationalized outcome IS the record**, and git preserves the story.

Candidate tests for each passage, to be sharpened when the pass is written:

- Does it state a constraint, or narrate how the constraint was discovered?
- Would a reader act differently without it?
- Is the same thing said in a rule, a skill, AND a doc? (Three copies is the tell.)
- Is it a measurement that has since been superseded by a gate that enforces it?

## A conflict of interest to design around

The agent proposing rule additions should not be the sole judge of what is excess. The July trim bought headroom (baseline 2120, currently 2088 of a 2270 limit) and the agent has been spending it — one more addition was proposed the same day this was filed. The pass should default to cutting and the owner should see the diff.

## Related

- **TASK-323** — the metric fix. Hard prerequisite, **SHIPPED #2007**; ranking is now available worst-first by bytes.
- **TASK-470** — three "assertions that cannot fail" shapes, filed `state:owner` precisely because its natural home is an always-loaded rule. It is the first live test of this doc's conflict-of-interest concern: weigh it inside the pass rather than appending it beside it.
- `07-documentation.md` — the constraint this pass enforces.
- `/tzurot-doc-audit` sections 2 and 3 — the accuracy pass this sits beside.
- doc-58 (docs/reference drift rewrite) — different corpus (`docs/`) and different axis (accuracy); not a duplicate.
