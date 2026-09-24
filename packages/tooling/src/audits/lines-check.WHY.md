# Why `lines:check` exists

## What

A size ratchet over the always-loaded context surfaces: the
`.claude/rules/*.md` set (summed across all files), `CURRENT.md` (alone), and
the `.claude/skills/*/SKILL.md` set (summed across all skill bodies).
`pnpm ops lines:check` measures every surface on **two dimensions — lines and
bytes** — and fails when any surface exceeds either budget
(`baseline + graceMargin`), with the baseline in
`.github/baselines/lines-baseline.json`. `pnpm ops lines:update-baseline` is
the sanctioned refresh path, and `--surface <name>` scopes it to one surface.
The gate runs in `pnpm quality`, the CI lint job, AND the pre-push docs-only
fast path — the last one matters most, because doc-only pushes skip every heavy
check and are exactly how these surfaces bloat.

On top of the per-surface ratchet, the gate ALSO enforces a fixed instructions
ceiling: `CLAUDE.md` + `.claude/rules/*.md`, summed as `.length`, must stay at
or under `INSTRUCTION_CHARS_CEILING` (`lines-ceiling.ts`). It merges into the
same failure list and findings count as the per-surface budgets, but it is not
one of them — see § Hard ceiling (not a baseline).

`--breakdown` adds a read-only per-file ranking of every surface, worst-first
by bytes: the gate says whether a surface is over budget, the ranking says
which of its files to open. It is **not** wired into any of those automated
paths and never gates anything — it is run by hand, by whoever is doing the
economy pass in `/tzurot-doc-audit`.

## Hard ceiling (not a baseline)

`INSTRUCTION_CHARS_CEILING` mirrors Claude Code's own instruction-file warning
total (150,000 characters on a 1M-context driver), minus a 3,000-character
allowance for the machine-local `~/.claude/CLAUDE.md` that CI cannot see (it
is not checked in, and this ceiling does not measure it). It sums `.length` —
UTF-16 code units — because that is what the harness itself sums when deciding
whether to warn; the `rules` surface's `bytes` dimension measures UTF-8 bytes,
a different unit, and the two are not interchangeable. It counts `CLAUDE.md`,
which the `rules` surface does not.

It is a fixed number, never a baseline entry, because the limit it mirrors is
external: `lines:update-baseline` can ratchet every OTHER budget here up or
down because those budgets are ours to hold, but nobody here owns the
harness's warning threshold, so no refresh path may raise this one.

Hedge: the harness derives the limit from the model's context window (floored
at 120,000, as read from the Claude Code 2.1.281 binary), so a driver with a
different context window gets a different total, and the value is not verified
stable across harness versions — this ceiling mirrors observed behavior, not a
documented contract.

## Why

The always-loaded surfaces are paid on every single session start: every
line of `.claude/rules/` and `CURRENT.md` is context consumed before any
work happens, for every contributor, forever. They grow through the cheapest
commit path in the repo (doc commits, which legitimately skip builds and
tests), so nothing structural pushed back on growth. The 2026-07 context
refit cut the rules archaeology down to ~1,900 lines and capped CURRENT.md
at ~40 — this ratchet exists so that recovered headroom doesn't silently
erode. With it, regrowth becomes an explicit decision (a baseline bump
visible in review) instead of drift nobody chose.

## Why two dimensions

Lines is not what these surfaces cost; tokens are, and the two diverge badly —
density varies several-fold across the corpus, and `CURRENT.md` runs several
times denser again. So the line ratchet rated `CURRENT.md` "comfortable" at 96
of 97 lines while it carried a fifth of the entire rules surface's bytes in
under a twentieth of its lines — anyone following the ratchet to pick a trim
target was sent at the wrong file, which is worse than having no ranking at
all. A dense rewrite that halves a file's line count while growing its payload
is invisible to lines and caught by bytes.

The live figures are deliberately not quoted here. They move with every edit to
the corpus, so a copy in prose is stale the day after it is written — which is
the same defect this document would be describing. `lines:check --breakdown`
prints them from measurement.

Bytes rather than tokens because bytes are exact, deterministic, and carry no
tokenizer dependency; the report derives a token figure from them for
readability, and nothing gates on that estimate.

## Threshold rationale

Baseline-and-hold at the **measured** count, not a round-number cap. The
grace margins (150 lines / 12,000 bytes for rules, 20 lines / 4,000 bytes for
CURRENT.md, 250 lines / 17,000 bytes for skills) absorb legitimate small additions between refreshes — a new rule
subsection, a release's smoke checklist — without demanding a baseline bump
for every paragraph. The byte margins are set from that same intent rather
than converted from the line margins, because the surfaces absorb
different things (~7% on rules, and the same proportion on skills, is one section at the corpus's own density;
~11% on CURRENT.md is a checklist that reverts at the next reset). Hard growth
beyond the margin requires `lines:update-baseline`, which shows up as a
baseline-file diff a reviewer can question. Trimming a surface and refreshing
ratchets the budget DOWN, locking in the win.

`--surface <name>` exists because the all-or-nothing refresh is not neutral:
it ratchets every surface at once, so a refresh wanted for a surface that was
TRIMMED also writes a LOOSER budget for one that grew, inside a single commit
that reads as bookkeeping. That happened once — a post-trim refresh would have
tightened `rules` and loosened `CURRENT.md` together, so it was skipped
entirely and the trim went unrecorded. Scoping the write is what makes the
tightening safe to run on its own.

## Decay check

Three failure modes, three detectors. (1) **Tool rot**: the canary fixture
(`test-fixtures/audit-canaries/lines-check/`) is a fake repo root whose
surfaces deliberately exceed a tiny runtime-built baseline; the canary test
asserts `status: 'fail'` with EXACTLY four findings (the two over-budget surfaces x two
dimensions), so a change that breaks glob matching, either count, or that
silently drops a dimension from evaluation turns CI red. (2) **Config drift**: the baseline
carries a `configHash` over `getLinesConfigFingerprint()` (impl version,
surface set, globs) — changing what gets measured without refreshing the
baseline hard-fails. Bump `LINES_IMPL_VERSION` when the counting or matching
logic changes. (3) **Hollow measurements**: a surface whose glob matches
zero files is a failure, never a 0-line pass — moving `.claude/rules/`,
renaming `CURRENT.md`, or moving `.claude/skills/` cannot silently disarm the
gate.

The instructions ceiling has its own decay coverage in
`lines-ceiling.test.ts`: a fixed-ceiling pass/fail boundary, CLAUDE.md's
contribution to the sum, a multibyte case pinning `.length` over
`Buffer.byteLength`, and hollow measurement for a missing `CLAUDE.md` or an
empty rules glob — plus a `runLinesCheck` wiring case proving the gate itself
fails when the ceiling is exceeded.
