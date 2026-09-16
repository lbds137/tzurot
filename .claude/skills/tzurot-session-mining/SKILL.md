---
name: tzurot-session-mining
description: 'Mine Claude session logs in two lenses — owner friction (user turns) and the agent-side record (misses the owner never remarked on, AND moves that worked and should recur) — and convert every finding into a structural disposition: rule, skill, hook, ops command, or a recorded load-bearing guard. Invoke with /tzurot-session-mining periodically, around a driver handoff, or when a pattern feels recurrent but unquantified.'
lastUpdated: '2026-09-16'
---

# Session Mining — two lenses

**Invoke with /tzurot-session-mining** to mine session JSONLs in two lenses —
the OWNER lens (friction, seen from user turns) and the AGENT lens (the
assistant's own record: misses nobody remarked on, and moves that worked) —
and operationalize both. A friction-only run produces a refit that
dismantles what was working, because nothing in its evidence said it was; a
positives-only run papers over misses. Every run carries both, and every
finding, negative or positive, ends as a disposition.

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
operationalizations. The rule is per LENS: the README records each range
with the lens(es) it was mined through (`owner`, `agent`), and a range mined
through the owner lens only is unmined for the agent lens — re-mining it
there inflates nothing. Raw JSONLs age out of `~/.claude/projects/` while
the user-side extracts under `corpus/` survive, and the agent lens needs the
raw file; so before planning an agent-lens pass over an old range, check
`ls ~/.claude/projects/-home-deck-Projects-tzurot/*.jsonl` against the
README — a range whose raw file is gone can only ever carry the owner lens,
and the unmined delta should be extracted (both lenses) promptly rather than
left for the next run. The ACTIVE session (this one) is fine to include if it
has substantial history; note that its tail is still being written.

**Also read the prior run's disposition list** (same README entry — Step 4
requires one per proposal): confirm each `shipped` PR merged and each
`task-<N>` still resolves (`pnpm tracker task list --search <term> --plain`),
and flag any proposal whose disposition is missing or dangling. For each
`recorded-load-bearing` guard, confirm the hook or gate still exists by
name — a moat around a deleted guard is a stale claim. Then tally each
hook's trips across the last three README entries' ledgers: a hook at zero
in all three is the retirement question Step 3 hands to the owner. This
look-back is the consumer of the disposition table — without it, proposals
evaporate between runs exactly as the 2026-07-25 run's did.

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

**Mid-turn messages are NOT `type=="user"`.** Messages typed while a turn is
running land as `type=="queue-operation"` entries (`operation=="enqueue"`,
plain-string `.content`) — a user-only extraction drops exactly the
corrections issued while the user watched something go wrong. Union them in:

    # same shell, same $CORPUS and same session list as the block above —
    # $f and $CORPUS are loop-scoped, so this must run inside the loop too
    for f in <session-uuid-1> <session-uuid-2>; do
      jq -r 'select(.type == "queue-operation" and .operation == "enqueue")
        | select((.content // "") | length > 0)
        | "=== \(.timestamp) [mid-turn] ===\n\(.content)\n"' \
        ~/.claude/projects/-home-deck-Projects-tzurot/$f.jsonl >> $CORPUS/$f.txt
    done

Blocks are appended out of chronological order; the timestamps let the miner
interleave. Verify non-zero yield with a bare count first when the session had
any mid-turn traffic. The stream is not only human messages — Monitor output
and task-notification blocks enqueue the same way, so the extract will carry
harness dumps beside the human corrections. That is consistent with the
deliberately-raw posture above: the miner sorts them, the `[mid-turn]` marker
tells it where to look.

### 1b — The agent-side extract (second corpus file per session)

The owner lens cannot see an agent miss nobody remarked on, or a move that
worked; both live in assistant turns and tool results. Extract them to a
SEPARATE file so the two lenses are never conflated — assistant text in
full, each tool call as a one-line stub, and tool results ONLY when they
errored (hook blocks and gate refusals land here, which is what makes
`GUARD-HELD` countable):

Same shell, same `$CORPUS` and same session list as the Step 1 block: `$f`
and `$CORPUS` are loop-scoped, and in a fresh shell an unset `CORPUS` sends
the file to `/<uuid>.agent.txt` (the write fails) rather than the corpus dir.

    for f in <session-uuid-1> <session-uuid-2>; do
      jq -r '. as $e
        | if $e.type == "assistant" then
            ($e.message.content // [])[]
            | if .type == "text" then "=== \($e.timestamp) [agent] ===\n\(.text)\n"
              elif .type == "tool_use" then "--- \($e.timestamp) tool \(.name): \((.input.command // .input.description // .input.file_path // .input.prompt // .input.skill // .input.query // .input.pattern // .input.message // "") | tostring | .[0:160])"
              else empty end
          elif $e.type == "user" then
            ($e.message.content | if type == "array" then .[] else empty end)
            | select(.type == "tool_result" and .is_error == true)
            | "--- \($e.timestamp) tool-error: \(((.content // "") | if type == "string" then . else (map(.text // "") | join(" ")) end) | .[0:300])"
          else empty end' \
        ~/.claude/projects/-home-deck-Projects-tzurot/$f.jsonl > $CORPUS/$f.agent.txt
    done

It runs comparable in size to the user-side extract — measured 0.95× and
1.5× on two sessions — but is shaped differently: mostly one-line tool stubs
around a minority of prose blocks. The miner reads it marker-first (Step 2),
never linearly. Positive-control the extract before mining:
`grep -c 'tool-error' $CORPUS/<uuid>.agent.txt` on a session known to have
tripped a hook must be non-zero, or the field shape has drifted. The extract
keeps `text` and `tool_use` blocks only — `thinking` blocks are dropped on
purpose (they would multiply the size), so SELF-CORRECTION covers reversals
that reached visible text or a tool result, not ones resolved silently
inside a thinking block.

## Step 2 — Mine (parallel reader agents, one per corpus file)

Spawn one agent per corpus file (parallel — they're independent). Each writes
`reports/<uuid-prefix>-<daterange>-report.md`. The miner prompt must include:

**The taxonomy** — every flagged item lands in exactly one category:

| Category    | What it captures                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CORRECTION  | User corrects a factual/behavioral error the assistant made                                                                            |
| REPEAT      | User re-reports a bug believed fixed, or re-issues a prior instruction                                                                 |
| FRUSTRATION | Emotional signal — profanity, confidence-loss statements, exasperation                                                                 |
| TRUST-CHECK | User verifies a claim instead of accepting it ("are you sure", "did you actually")                                                     |
| REDIRECT    | User re-scopes or redirects mid-task (assistant was heading the wrong way)                                                             |
| PROCESS-GAP | User names a missing process, tool, or rule                                                                                            |
| PREFERENCE  | User states a durable working-style preference                                                                                         |
| DECISION    | Owner decision/directive that should be durable session state                                                                          |
| RATIFIED    | Owner endorses a behavior in so many words ("yes, exactly that", "keep doing this"), or accepts a non-obvious recommendation unchanged |

**Per-item fields**: `#` · timestamp · **verbatim quote** (never paraphrase;
mark quotes recovered from compaction summaries `[via summary]` — they are
compactor-preserved verbatim, not assistant paraphrase) · 1–2 sentence context
· **Before?** (has this pattern appeared earlier in THIS corpus — yes/no, with
the tell, e.g. the user's own "again", "tbh", "has come up a few times").

**Per-report trailing sections**: `RECURRING WITHIN THIS FILE` (patterns with
2+ hits) and `TOP 10 LOAD-BEARING QUOTES` (the quotes a future session most
needs to have read).

**The agent lens** — a second miner per `.agent.txt`, writing its own report
file beside the owner-lens one (`reports/<uuid-prefix>-<daterange>-agent-report.md`
— two parallel miners on one file is a write race), its own taxonomy (every
item lands in exactly one):

| Category        | What it captures                                                                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SELF-CORRECTION | The agent reverses its own prior factual claim, unprompted or after a tool result                                                                                            |
| TOOL-MISUSE     | A command failed on the invocation shape, not the data — malformed SHA, wrong cwd, filtered push — including every hook block                                                |
| REWORK          | Work redone because of an agent error: wrong branch, mangled file, a gate re-run after a self-inflicted red                                                                  |
| GOOD-MOVE       | An action no rule, skill, or hook prescribes, that worked, in a situation that will recur — a hand-run check that caught a defect, a one-off helper, a verification sequence |
| GUARD-HELD      | An existing hook, gate, or skill step fired and was right — counted as trips / escapes / false positives, per guard                                                          |

A hook block is filed once, as a TOOL-MISUSE item, and also increments its
hook's GUARD LEDGER row; GUARD-HELD is for a catch with no misuse item of
its own.

Per-item fields: `#` · timestamp · the move or miss in one line (tool stub or
quote) · outcome (what it caught, or what it cost) · **Prescribed?** (a
rule/skill/hook already names this — yes with the pointer, or no; for a
GOOD-MOVE candidate a yes is the reclassification test — it is GUARD-HELD) ·
**Recurred?** (the same move elsewhere in the corpus — recurrence is the
promotion key, a one-off is memory at most). GOOD-MOVE tells: a check whose
result changed the agent's next action; a defect caught before commit or push.
Read marker-first: `tool-error` lines, the `[agent]` blocks around each, then
the GOOD-MOVE sweep by the tells. Trailing sections: `GUARD LEDGER` (per guard:
trips / escapes / false positives — 0/0/0 is a finding, see Step 3) and
`KEEP LIST` (GOOD-MOVE items with recurrence counts; the merged GOOD-MOVE +
RATIFIED list is assembled in Step 3).

**Driver-attribution + orchestrator-quality lens**: when the mined window
spans model switches, or the run evaluates orchestrator-mode work, add to the
miner prompt: (a) pin the driver timeline from the session JSONL's per-message
`.message.model` field (`<synthetic>` entries are harness placeholders, not
switches) and tag every item with the driver in effect at its timestamp;
(b) flag separate ORCH-numbered items for review rounds exceeding ~3 on one
PR, defect origin (spec vs worker vs orchestrator's own edits), self-fed
review loops (round N fixing round N-1's fix), work claims a reviewer or owner
had to correct, and worker-caught wrong premises in dispatched specs; (c) add
a `DRIVER SPLIT` trailing section (item counts per driver per category).
Attribute honestly — when the lens targets one driver but the evidence lands
on another, the report's caveat header says so.

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
3. **Harvest positives with the same evidence bar.** Rank GOOD-MOVE and
   RATIFIED by recurrence exactly as failures are ranked. GUARD-HELD counts
   are the moat: a guard with trips and zero escapes is recorded as
   load-bearing so a later economy pass cannot cut it on cost alone; a guard
   with zero trips across three or more windows (a window is one mining run,
   i.e. one README entry) is a retirement question for the owner, never
   preserved by reflex.
   The lens cross-reference happens here, not in a miner: an owner RATIFIED
   item names the adjacent agent move as a GOOD-MOVE candidate, and only the
   synthesis reads both lenses' reports.
4. Write `reports/SYNTHESIS-<date>.md` with the ranking, per-finding proposed
   operationalizations (R-numbered), and an execution plan.

## Step 4 — Operationalize (the actual deliverable)

For each accepted finding, apply `00-critical.md` § Fix Recurring Failures
Structurally: **rule** (hard constraint, every contributor) → **skill**
(procedure step) → **hook** (deterministic trigger + mechanical correction) →
**memory** (narrative/per-user context only — never a "try harder" note).

Positives take the mirror ladder, into the same disposition table. A
GOOD-MOVE that is deterministic and mechanical (a command can run the check)
→ a `pnpm ops` command or a hook, with its probe or test, plus a
decision-point trigger sentence in the rule or skill that owns the moment. A
GOOD-MOVE that needs judgment but recurs → a named step, with its trigger, in
the skill that governs the moment. RATIFIED → the default written into the
rule or skill that governs the choice, so no later session re-asks.
GUARD-HELD → `recorded-load-bearing <trips/escapes/FPs>` in the README, or
`retire-candidate` handed to the owner. The test is the same as for a fix: a
move that exists only in a report row is not kept.

- Rules/skills/hooks changes go through a **review-gated PR** (they're
  load-bearing; `00-critical.md` table).
- Presenting to the user: findings ranked with evidence counts + proposed
  fix per finding. The user accepts/rejects operationalizations — mining
  output is a proposal, not a mandate.
- Update `mined-corpus/reports/README.md` with the newly-mined corpus date
  ranges (this is what Step 0 of the NEXT run checks) — per lens: a range
  mined through one lens is listed with that lens only, so the next Step 0
  can see what the other lens still owes. The entry also carries the run's
  consolidated GUARD LEDGER — every hook under `.claude/hooks/` with its
  trips / escapes / false positives, zero-trip hooks included — which is the
  persistence point the retirement count reads.
- **The README entry must carry a disposition per proposal** — each P/R-numbered
  item ends the run as exactly one of `shipped <PR/commit>`, `task-<N>`
  (tracker), `rejected (<reason>)`, `recorded-load-bearing <counts>`, or
  `retire-candidate`. A proposal with no disposition is the
  promise-rot this skill exists to mine: the 2026-07-25 run left three of its
  four proposals in the synthesis report only, and all three silently
  evaporated. Step 0 of the next run reads these dispositions and flags any
  `task-<N>` that no longer resolves.
- Session-end: any deferred finding gets a backlog entry per `06-backlog.md`
  — a report row is not a tracking surface.
- Stamp the run: `pnpm ops cadence:mark session-mining`, then commit
  `backlog/cadence-ledger.json` to develop.

## Anti-patterns

| Don't                                                   | Do instead                                                                                                     |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Re-mine a range through a lens already applied to it    | Step 0 README check, per lens; a range mined owner-only is still unmined for the agent lens                    |
| Paraphrase and present it as a quote                    | Verbatim only; `[via summary]` when compaction-recovered                                                       |
| Fix a violated-rule finding by writing another rule     | Hook / decision-point trigger / workflow change — remove the opportunity                                       |
| Land findings as "try harder" memory notes              | Structural fix or explicit accepted-risk disposition                                                           |
| Commit or reference corpus/report content in the repo   | Only operationalized outcomes enter the repo                                                                   |
| Mine severity-first from one dramatic session           | Recurrence across corpora is the ranking key                                                                   |
| Mine friction only; keep positives as a "preserve" list | Harvest GOOD-MOVE / RATIFIED with recurrence counts; promote by the mirror ladder                              |
| Preserve a guard because it exists                      | Count trips / escapes / false positives; zero trips over ≥3 windows goes to the owner as a retirement question |
| Read the agent-side extract linearly                    | Marker-first: `tool-error` lines, the `[agent]` blocks around them, then the GOOD-MOVE sweep                   |
