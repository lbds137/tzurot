---
name: tzurot-usage-audit
description: 'Measure weekly Claude Code plan usage — weighted token totals per model, delegation ratio, implied capacity, and a machine-local drift ledger. Invoke with /tzurot-usage-audit near the weekly reset, after an unusually heavy day, or whenever the owner asks how much of the plan has been spent.'
lastUpdated: '2026-08-25'
---

# Weekly Usage Audit

**Invoke with /tzurot-usage-audit** to turn the raw session logs into the four
numbers that actually govern how this project gets worked: weighted token spend
per model, the share of that spend that went through the main loop rather than
a subagent, the implied weekly capacity, and whether that capacity has drifted
since the last measurement.

## Purpose

Anthropic does not publish the Max plan's weekly limits, and the limits may
move without an announcement. The only instrument available is the local
session record plus a `/usage` reading from the owner's client, so this skill
exists to make that measurement **repeatable** — the same window, the same
weights, the same aggregation — and to write each result into a ledger so
drift is visible as a trend rather than re-derived from scratch each time.

The output feeds a live decision: the delegation posture in
`10-working-posture.md` is justified by arithmetic, and arithmetic that is
never re-measured quietly becomes folklore.

## When to run

- **Near the weekly reset** (Sundays 02:00 America/New_York) — the natural
  window boundary, and the reading most comparable to prior rows.
- **After any unusually heavy day** — a long orchestration run, a big review
  cycle, a mining pass.
- **On request** — "how much have we used", "are we going to run out this
  week", "what is our delegation ratio".

## Privacy boundary (CRITICAL)

**Every output of this skill is machine-local.** The ledger lives at:

```
~/.claude/projects/-home-deck-Projects-tzurot/usage-ledger.md
```

The `-home-deck-Projects-tzurot` slug derives from this machine's checkout
path. On a different checkout or machine, derive it first with
`ls ~/.claude/projects/` and substitute throughout — a wrong slug reads as an
empty week, not as an error.

That file is **never committed, never referenced from a tracked doc, and never
pasted into a PR body, issue, or commit message.** The session JSONLs this
skill reads carry session ids, and session ids/URLs are secrets per
`00-critical.md` § Claude Session URLs Are Secrets — this repo is public. Quote
aggregate numbers to the owner in chat freely; put none of the underlying
identifiers anywhere durable and tracked.

If a usage figure genuinely needs to reach a tracked surface, it goes as a bare
aggregate ("~64M weighted/day sustainable"), with no path, id, or file
reference attached.

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
delegation ratio.

For attribution _within_ the main loop — which tools are actually spending the
budget — group output tokens by tool name over the main session file:

```bash
jq -r 'select(.type=="assistant" and .message.content != null)
  | .message.usage as $u
  | (.message.content[]? | select(.type=="tool_use") | .name) as $tool
  | "\($tool) \($u.output_tokens // 0)"' "$MAIN_SESSION_FILE" \
| awk '{s[$1]+=$2; n[$1]++} END {for (t in s) printf "%-24s out %9d  calls %5d\n", t, s[t], n[t]}' \
| sort -k3 -rn
```

A message issuing several tool calls attributes its output tokens to each of
them, so read this as a ranking of where the calls are, not as a partition of
the total.

## Step 4 — calibrate against a live reading

Ask the owner for a fresh `/usage` reading — both the **Fable percentage** and
the **all-models percentage**. Then:

```
implied capacity = weighted total ÷ (percentage / 100)
```

Compare the implied capacity against the prior rows in the ledger. **Flag drift
greater than ~15% as "limits may have moved"** and say so plainly; do not
silently adopt the new number as truth on a single reading, because a
mis-computed `CUTOFF` produces exactly the same symptom.

**Per-model capacity division is unreliable — use it for the all-models total
only.** Dividing one model's measured weighted spend by that model's meter
percentage produced mutually inconsistent answers from two same-day readings
(2026-08-25: the Fable meter moved 13 points across a stretch where measured
Fable spend implied ~3× that), so Anthropic's internal per-model weighting
evidently differs from the table above. The weighted formula remains the right
instrument for the TOTAL trend and the delegation ratio; for per-model
decisions (is Fable specifically tight?), read the meter percentages directly.

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

## Anti-patterns

| Don't                                                            | Why it breaks the measurement                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Count output tokens only                                         | Misses the cache bill, which is ~75-80% of the weighted total — the answer comes out roughly 4x low                        |
| Aggregate over the main session files alone                      | Subagent spend is real spend; skipping `subagents/` understates every delegated unit and inverts the delegation-ratio call |
| Read a low total from deleted/rotated session files as low usage | An empty or sparse result indicts the query first — check the slug, the `CUTOFF`, and the `find` scope before concluding   |
| Commit the ledger, or reference it from a tracked doc            | It is machine-local by design; the repo is public                                                                          |
| Quote a session id, path, or URL in any tracked surface          | Session identifiers are secrets per `00-critical.md`                                                                       |
| Adopt a new implied capacity from one reading                    | A wrong `CUTOFF` looks identical to a moved limit; require a second reading or a re-derived window                         |

## Related

- `10-working-posture.md` § Delegation posture — the rule this measurement justifies
- `/tzurot-orchestration` — the dispatch mechanics whose cost this quantifies
- `/tzurot-session-mining` — the qualitative sibling; this skill counts tokens, that one counts friction
