---
name: tzurot-session-mining
description: 'Mine Claude session logs for recurring friction and convert findings into structural fixes (rules/skills/hooks). Invoke with /tzurot-session-mining periodically or when a failure pattern feels recurrent but unquantified.'
lastUpdated: '2026-07-19'
---

# Session Friction Mining

**Invoke with /tzurot-session-mining** to mine session JSONLs for recurring
friction and operationalize the findings.

This proceduralizes the 2026-07-03 handoff audit (7 corpora, ~2,700 user
messages → the SYNTHESIS that produced rules 09/10, the review-response
whitelist, and the memory refit). The pipeline: **extract → mine → synthesize →
operationalize**. The point is never the report — it's the structural fix at
the end (`00-critical.md` § Fix Recurring Failures Structurally).

## When to run

- **Periodically** — roughly every 4–6 weeks of active development, or when
  ~500+ new user messages have accumulated since the last mining pass.
- **Before/after a model handoff** or major process change (the original
  trigger).
- **On a hunch with a count of one** — when a user correction feels like it
  has happened before but you can't cite the prior instance, mining turns
  "feels recurrent" into evidence.
- **On request** — "mine the sessions", "why does this keep happening".

## Privacy boundary (CRITICAL)

Everything this skill produces lives **outside the repo**, under
`~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/`. Corpus extracts
and reports contain verbatim user quotes and session content — they are
machine-local working material and must NEVER be committed, referenced from
tracked docs, or pasted into PR bodies/commit messages. Only the
**operationalized outcomes** (a rule edit, a skill addition, a hook) enter the
repo, carrying the invariant without the archaeology (`02-code-standards.md`
§ Temporal Markers). Session URLs/identifiers are secrets per `00-critical.md`.

## Step 0 — Inventory: what's unmined?

```bash
# Sessions on disk, by size (small ones are usually /config noise — skip <50KB)
ls -laS ~/.claude/projects/-home-deck-Projects-tzurot/*.jsonl

# What's already mined — README.md tracks corpus date ranges
cat ~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/reports/README.md
```

The project-slug path above matches this machine's checkout
(`/home/deck/Projects/tzurot`). If it doesn't exist — different checkout
path, worktree, remote agent — derive the slug via `ls ~/.claude/projects/`
before proceeding: an `ls` against a wrong path silently reads as "nothing
to mine," not as an error.

Compare session-file date ranges (first/last `.timestamp` in each JSONL)
against the README's mined ranges. **Never re-mine an already-mined range** —
re-mined findings inflate recurrence counts and re-litigate settled
operationalizations. The ACTIVE session (this one) is fine to include if it
has substantial history; note that its tail is still being written.

## Step 1 — Extract corpus

One `.txt` per session, user-turns only, timestamped blocks:

```bash
CORPUS=~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/corpus
for f in <session-uuid-1> <session-uuid-2>; do
  jq -r 'select(.type == "user" and (.isMeta | not))
    | . as $e
    | ($e.message.content
       | if type == "string" then .
         elif type == "array" then (map(select(.type == "text") | .text) | join("\n"))
         else empty end)
    | select(length > 0)
    | "=== \($e.timestamp) ===\n\(.)\n"' \
    ~/.claude/projects/-home-deck-Projects-tzurot/$f.jsonl > $CORPUS/$f.txt
done
wc -l $CORPUS/*.txt   # sanity: non-trivial line counts
```

The extract is **deliberately raw**: it keeps system-reminder injections,
`<local-command-caveat>` blocks, compaction summaries, and skill dumps
alongside direct user messages. Do not pre-filter — compaction summaries
preserve verbatim user quotes from compacted-away turns (the "All user
messages" sections), and several of the highest-signal findings in the
original audit survived ONLY there. The miner agent sorts signal from noise.

## Step 2 — Mine (parallel reader agents, one per corpus file)

Spawn one agent per corpus file (parallel — they're independent). Each writes
`reports/<uuid-prefix>-<daterange>-report.md`. The miner prompt must include:

**The taxonomy** — every flagged item lands in exactly one category:

| Category    | What it captures                                                                   |
| ----------- | ---------------------------------------------------------------------------------- |
| CORRECTION  | User corrects a factual/behavioral error the assistant made                        |
| REPEAT      | User re-reports a bug believed fixed, or re-issues a prior instruction             |
| FRUSTRATION | Emotional signal — profanity, confidence-loss statements, exasperation             |
| TRUST-CHECK | User verifies a claim instead of accepting it ("are you sure", "did you actually") |
| REDIRECT    | User re-scopes or redirects mid-task (assistant was heading the wrong way)         |
| PROCESS-GAP | User names a missing process, tool, or rule                                        |
| PREFERENCE  | User states a durable working-style preference                                     |
| DECISION    | Owner decision/directive that should be durable session state                      |

**Per-item fields**: `#` · timestamp · **verbatim quote** (never paraphrase;
mark quotes recovered from compaction summaries `[via summary]` — they are
compactor-preserved verbatim, not assistant paraphrase) · 1–2 sentence context
· **Before?** (has this pattern appeared earlier in THIS corpus — yes/no, with
the tell, e.g. the user's own "again", "tbh", "has come up a few times").

**Per-report trailing sections**: `RECURRING WITHIN THIS FILE` (patterns with
2+ hits) and `TOP 10 LOAD-BEARING QUOTES` (the quotes a future session most
needs to have read).

**Corpus caveat header**: each report opens by stating the corpus's date
range, message count, and how much survives only via compaction summaries.

## Step 3 — Synthesize across reports

One synthesis pass (inline or a single agent reading all reports):

1. **Rank by recurrence across corpora**, not severity-within-one-session. A
   pattern hit in 4 corpora outranks a spectacular one-off.
2. **Check each top pattern against the EXISTING rules/skills/hooks** — the
   critical fork:
   - No rule exists → a missing-structure finding (write one).
   - **A rule exists and is still violated** → a compliance finding; another
     rule restating it is worthless. Look for a hook (deterministic trigger),
     a decision-point trigger sentence in the existing rule, or a workflow
     change that removes the opportunity to fail.
3. **Preserve positive findings** — name what's working so a future refit
   doesn't dismantle it.
4. Write `reports/SYNTHESIS-<date>.md` with the ranking, per-finding proposed
   operationalizations (R-numbered), and an execution plan.

## Step 4 — Operationalize (the actual deliverable)

For each accepted finding, apply `00-critical.md` § Fix Recurring Failures
Structurally: **rule** (hard constraint, every contributor) → **skill**
(procedure step) → **hook** (deterministic trigger + mechanical correction) →
**memory** (narrative/per-user context only — never a "try harder" note).

- Rules/skills/hooks changes go through a **review-gated PR** (they're
  load-bearing; `00-critical.md` table).
- Presenting to the user: findings ranked with evidence counts + proposed
  fix per finding. The user accepts/rejects operationalizations — mining
  output is a proposal, not a mandate.
- Update `mined-corpus/reports/README.md` with the newly-mined corpus date
  ranges (this is what Step 0 of the NEXT run checks).
- Session-end: any deferred finding gets a backlog entry per `06-backlog.md`
  — a report row is not a tracking surface.

## Anti-patterns

| Don't                                                 | Do instead                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Re-mine already-mined date ranges                     | Step 0 README check; mine only the delta                                 |
| Paraphrase and present it as a quote                  | Verbatim only; `[via summary]` when compaction-recovered                 |
| Fix a violated-rule finding by writing another rule   | Hook / decision-point trigger / workflow change — remove the opportunity |
| Land findings as "try harder" memory notes            | Structural fix or explicit accepted-risk disposition                     |
| Commit or reference corpus/report content in the repo | Only operationalized outcomes enter the repo                             |
| Mine severity-first from one dramatic session         | Recurrence across corpora is the ranking key                             |
