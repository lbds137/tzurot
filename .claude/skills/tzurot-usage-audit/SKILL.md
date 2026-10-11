---
name: tzurot-usage-audit
description: 'Measure weekly Claude Code plan usage — weighted token totals per model, delegation ratio, implied capacity, and a machine-local drift ledger. Invoke with /tzurot-usage-audit near the weekly reset, after an unusually heavy day, or whenever the owner asks how much of the plan has been spent.'
lastUpdated: '2026-10-11'
---

# Weekly Usage Audit

The procedure is the Seyag `usage-audit` skill (`/usage-audit`, `seyag:usage-audit`): what the audit measures and why (`seyag:usage-audit § Usage Audit`), when to run it (its description: near the weekly reset, after an unusually heavy day, on request), and its privacy boundary (`seyag:usage-audit § Privacy boundary`). This file keeps the Tzurot-specific steps. The output feeds a live decision: the delegation posture in `10-working-posture.md` is justified by arithmetic, and arithmetic that is never re-measured quietly becomes folklore.

If the seyag plugin is not loaded in this session (a cloud unit or the CI review action may lack it), the pointers below do not resolve: say so, and hand the procedure step to the driver or the owner instead of reconstructing it.

## Privacy boundary: Tzurot ledger

Everything in `seyag:usage-audit § Privacy boundary` applies; session ids/URLs are secrets per `00-critical.md` § Claude Session URLs Are Secrets, and this repo is public. The Tzurot-only ledger these steps write lives at:

```
~/.claude/projects/-home-deck-Projects-tzurot/usage-ledger.md
```

The `-home-deck-Projects-tzurot` slug derives from this machine's checkout
path. On a different checkout or machine, derive it first with
`ls ~/.claude/projects/` and substitute throughout — a wrong slug reads as an
empty week, not as an error.

## Step 1 — establish the window

The billing window resets **Sundays at 02:00 America/New_York**. Find the most
recent one and convert it to UTC, because the JSONL `timestamp` fields are UTC
ISO strings:

```bash
TZ=America/New_York date        # what "now" is in the reset's own timezone
date -u +%FT%T                  # the UTC clock the logs are stamped in
```

Compute the most recent Sunday 02:00 ET, convert to UTC (ET is UTC-4 in EDT,
UTC-5 in EST — check which is in force rather than assuming), and use that as
`CUTOFF` below. A `CUTOFF` an hour wrong changes the total by a few percent; a
`CUTOFF` a day wrong invalidates the whole reading, so state the window
explicitly in the report.

## Step 2 — weighted totals per model

Kept, not pointed at `seyag:usage-audit § Step 2: the sweep`: TASK-1105 replaces this sweep. It sums every line (about 2x the Seyag sweep, see Step 4), so its totals stay in the Tzurot ledger.

Aggregate over the project directory's session JSONLs **and** each session's
`<uuid>/subagents/agent-*.jsonl` — subagent spend is real spend, and omitting
it is the single most common way this measurement comes out low.

```bash
D=~/.claude/projects/-home-deck-Projects-tzurot
CUTOFF="2026-08-24T06:00"   # example: the reset instant in UTC
find "$D" -name '*.jsonl' -not -path '*/mined-corpus/*' | while read -r f; do
  jq -r --arg c "$CUTOFF" 'select(.timestamp > $c and .type=="assistant" and .message.usage != null)
    | .message.usage as $u
    | "\(.message.model) \($u.input_tokens // 0) \($u.output_tokens // 0) \($u.cache_read_input_tokens // 0) \($u.cache_creation_input_tokens // 0)"' "$f" 2>/dev/null
done | awk '{
  w = $2*1 + $3*5 + $4*0.1 + $5*1.25
  wsum[$1]+=w; osum[$1]+=$3; n[$1]++
} END {
  for (m in wsum) printf "%-30s weighted %12.0f  out %10d  msgs %6d\n", m, wsum[m], osum[m], n[m]
  t=0; for (m in wsum) t+=wsum[m]; printf "TOTAL weighted: %.0f\n", t
}'
```

**Weights** (owner-calibrated — do not re-derive them mid-audit):

| Component   | Multiplier |
| ----------- | ---------- |
| input       | 1x         |
| output      | 5x         |
| cache read  | 0.1x       |
| cache write | 1.25x      |

Cache reads are typically **~75-80% of the weighted bill** blended across main
loop and subagents — and **~85% of main-loop spend specifically** (subagents
start from smaller fresh contexts, pulling the blended figure down; the
main-loop-only number is the one `10-working-posture.md` § Delegation posture
quotes). The practical
consequence is worth stating every time this runs: the lever is the number of
**main-loop tool calls**, not reply length. Each main-loop call re-reads the
whole context as a cache read, so a chatty reply is cheap and an extra inline
grep is not.

The `2>/dev/null` on the `jq` call suppresses parse noise from partially-written
lines in a live session file. If the total comes back implausibly small, drop
the redirect and re-run — an empty result is far more often a bad `CUTOFF` or a
wrong project-dir slug than a genuinely quiet week.

## Step 3 — delegation ratio

Run the same aggregation twice with the `find` scoped differently: once over
the top-level session files (main loop), once over the `subagents/` files
(delegated). The ratio of weighted subagent spend to weighted total is the
delegation ratio. (Its totals inherit Step 2's line-summing until TASK-1105 lands.)

Per-tool attribution within the main loop: `seyag:usage-audit § Step 2: the sweep` (its "Per-tool attribution" block).

## Step 4 — calibrate against a live reading

Ask the owner for a fresh `/usage` reading — both the **Fable percentage** and
the **all-models percentage**. Then:

```
implied capacity = weighted total ÷ (percentage / 100)
```

Compare against the prior rows in the ledger; the ~15% drift flag, the never-adopt-from-one-reading rule, and why per-model capacity division is unreliable (use the all-models total only; read per-model meter percentages directly): `seyag:usage-audit § Step 3: calibrate and act`. "The ledger" here is this skill's Tzurot ledger (§ Privacy boundary), never Seyag's sweep ledger: Step 2 here sums every JSONL line, which Seyag measures at about 2x its once-per-reply totals, so the two ledgers' numbers do not mix until TASK-1105 and TASK-1213 land.

## Step 4a — act on the reading

A reading is a decision point, not just a row. Compare each percentage against
pro-rata for the window (`days elapsed ÷ 7`):

- **Fable ahead of pro-rata** → the named lever is the **Opus-driver backup
  lane** (`/tzurot-orchestration` § Mode decision table): routine work moves to
  an Opus-driven main loop until the reset, reserving Fable for
  planning/design/verification passes. Surface this to the owner as a
  recommendation at the moment of the reading — the lane is their sanctioned
  fallback, and waiting for them to notice the meter defeats the audit.
- **All-models ahead of pro-rata** → pace levers: lighter days, boundary
  compaction, batched bookkeeping (`10-working-posture.md` § Delegation
  posture carries the economics).
- **Both comfortably under** → say so and change nothing; the audit's job is
  also to license normal pace.

## Step 5 — append to the ledger

One dated row per audit:

```
| date | window | weighted total | /usage % | implied capacity | main-loop share | notes |
```

If the ledger file does not exist yet, seed it with the known calibration
points before appending the new row:

| date       | window | weighted total | /usage % | implied capacity | main-loop share | notes                       |
| ---------- | ------ | -------------- | -------- | ---------------- | --------------- | --------------------------- |
| 2026-08-23 | week   | 69.2M          | 15%      | ~461M            | —               | owner calibration           |
| 2026-08-23 | week   | 72.0M          | 16%      | ~450M            | —               | owner calibration, same day |

The two rows agree on **capacity ≈450M weighted/week**, which is the working
figure until a later reading moves it. At a 7-day spread that is a sustainable
pace of **≈64M weighted/day**.

Then stamp the run in the TRACKED cadence ledger — it holds only the date,
never usage figures, and is a different file from the machine-local ledger
above: `pnpm ops cadence:mark usage-audit`, then commit
`backlog/cadence-ledger.json` to develop.

## Anti-patterns

The shared anti-patterns (subagent files, one-folder sweeps, a wrong window start, adopting capacity from one reading, committing the ledger or quoting a session id): `seyag:usage-audit § Anti-patterns`. Tzurot-specific:

| Don't                    | Why it breaks the measurement                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| Count output tokens only | Misses the cache bill, which is ~75-80% of the weighted total — the answer comes out roughly 4x low |

## Related

- `10-working-posture.md` § Delegation posture — the rule this measurement justifies
- `/tzurot-orchestration` — the dispatch mechanics whose cost this quantifies
- `/tzurot-session-mining` — the qualitative sibling; this skill counts tokens, that one counts friction and keepers
