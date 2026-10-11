---
name: tzurot-session-mining
description: 'Mine Claude session logs in two lenses — owner friction (user turns) and the agent-side record (misses the owner never remarked on, AND moves that worked and should recur) — and convert every finding into a structural disposition: rule, skill, hook, ops command, or a recorded load-bearing guard. Invoke with /tzurot-session-mining periodically, around a driver handoff, or when a pattern feels recurrent but unquantified.'
lastUpdated: '2026-10-11'
---

# Session Mining — two lenses

The procedure is the Seyag `session-mining` skill (`/session-mining`, `seyag:session-mining`); load it and follow it: the lenses and why every run carries all of them (`seyag:session-mining § Session Mining: extracting learnings`; three there, the owner and agent lenses here, see Step 2), when to run (`seyag:session-mining § When to run`), and the pipeline **extract → mine → synthesize → operationalize**. The point is never the report but the structural fix at the end (`00-critical.md` § Fix Recurring Failures Structurally). This file keeps the Tzurot-specific mechanics: the project-slug paths, the README range ledger, and the extraction commands. Until TASK-1213 moves this skill onto Seyag's tooling, mined ranges and dispositions (`task-<N>`) live in this README, not in Seyag's `session-log` ledger: where a pointed-to Seyag step says `session-log ledger`/`mark` or `tracked <ref>`, use the README and `task-<N>` instead.

If the seyag plugin is not loaded in this session (a cloud unit or the CI review action may lack it), the pointers below do not resolve: say so, and hand the procedure step to the driver or the owner instead of reconstructing it.

## Privacy boundary (Tzurot paths)

`seyag:session-mining § Scope and layout` (privacy boundary) applies in full. Everything this skill produces lives **outside the repo**, under
`~/.claude/projects/-home-deck-Projects-tzurot/mined-corpus/`. Only the
**operationalized outcomes** enter the repo, carrying the invariant without the
archaeology (`02-code-standards.md` § Temporal Markers). Session URLs/identifiers
are secrets per `00-critical.md`.

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

Procedure (owner-lens and agent-lens taxonomies, per-item fields, trailing sections, driver attribution, orchestrator quality, caveat header, fan-out ceiling): `seyag:session-mining § Step 2: mine (parallel reader agents)`. Reports land in `reports/` beside the corpus (`<uuid-prefix>-<daterange>-report.md`, `...-agent-report.md`). Tzurot runs the owner and agent lenses only: Step 1 here writes no procedure-lens file, so skip the Seyag procedure-lens miner and its TEDIUM category until this skill moves to Seyag's `session-extract`/`session-log` tooling.

## Step 3 — Synthesize across reports

Procedure: `seyag:session-mining § Step 3: synthesize`. The synthesis is written to `reports/SYNTHESIS-<date>.md`; a "window" for the zero-trip retirement count is one README entry.

## Step 4 — Operationalize (the actual deliverable)

Ladder (rule → skill → hook/script → memory), the mirror ladder for positives, and presenting findings to the owner: `seyag:session-mining § Step 4: operationalize (the deliverable)`. Tzurot bindings: a deterministic GOOD-MOVE becomes a `pnpm ops` command or a hook with its probe or test; the rule/skill/hook changes go through a **review-gated PR** (they're load-bearing; `00-critical.md` table).

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

`seyag:session-mining § Anti-patterns`. Tzurot binding for the first row: the Step 0 README check, per lens (a range mined owner-only is still unmined for the agent lens).
