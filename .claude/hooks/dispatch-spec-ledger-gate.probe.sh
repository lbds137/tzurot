#!/bin/bash
# Fixture check for dispatch-spec-ledger-gate.sh — run after ANY edit to the hook.
#
# Builds a throwaway CLAUDE_PROJECT_DIR holding fake dispatch specs, so the
# probe never reads the real (gitignored) docs/local/dispatch/ tree.
#
# Usage: .claude/hooks/dispatch-spec-ledger-gate.probe.sh   (from anywhere)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/dispatch-spec-ledger-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

FIXTURE="$TMPDIR_PROBE/fixture"
mkdir -p "$FIXTURE/docs/local/dispatch"

# A spec WITH the required section.
cat >"$FIXTURE/docs/local/dispatch/with-ledger.md" <<'SPEC'
# Dispatch spec — a unit

## Step 0 — base-SHA verification

Required base: `abc1234`.

## Premise ledger (re-verify each before building)

| # | Premise | Established by | Re-verify with |
|---|---------|----------------|----------------|
| L1 | the fix is not already built | grep for its own name | re-run the grep |

## The item
SPEC

# The same spec MINUS the section — the shape the gate exists to catch.
grep -v '^## Premise ledger' "$FIXTURE/docs/local/dispatch/with-ledger.md" \
  >"$FIXTURE/docs/local/dispatch/no-ledger.md"

FAILURES=0

# run <expected-exit> <expect-message-substring|-> <label> <tool_name> <prompt>
run() {
  local expected="$1" needle="$2" label="$3" tool="$4" prompt="$5"
  local out actual
  out=$(
    jq -n --arg t "$tool" --arg p "$prompt" '{tool_name:$t,tool_input:{prompt:$p}}' \
      | CLAUDE_PROJECT_DIR="$FIXTURE" "$HOOK" 2>&1
  )
  actual=$?
  if [ "$actual" -ne "$expected" ]; then
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ "$needle" != "-" ] && ! grep -qF "$needle" <<<"$out"; then
    printf 'FAIL  (exit %d ok, message missing %q)  %s\n' "$actual" "$needle" "$label"
    FAILURES=$((FAILURES + 1))
    return
  fi
  printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
}

# Same contract as run(), plus the two inputs the inline/mechanical checks read:
# the project dir the hook resolves against, and the `isolation` field. An
# optional 7th arg supplies `subagent_type` — the nested-dispatch pair's
# inner worker (opus-implementer) carries no isolation flag of its own but
# still runs gate commands, so the phantom-block gating needs it too.
# run_iso <expected-exit> <expect-substring|-> <label> <project-dir> <isolation|-> <prompt> [<subagent_type|->]
run_iso() {
  local expected="$1" needle="$2" label="$3" projdir="$4" iso="$5" prompt="$6" subtype="${7:--}"
  local out actual json
  if [ "$iso" = "-" ] && [ "$subtype" = "-" ]; then
    json=$(jq -n --arg p "$prompt" '{tool_name:"Agent",tool_input:{prompt:$p}}')
  elif [ "$iso" = "-" ]; then
    json=$(jq -n --arg p "$prompt" --arg s "$subtype" \
      '{tool_name:"Agent",tool_input:{prompt:$p,subagent_type:$s}}')
  elif [ "$subtype" = "-" ]; then
    json=$(jq -n --arg p "$prompt" --arg i "$iso" \
      '{tool_name:"Agent",tool_input:{prompt:$p,isolation:$i}}')
  else
    json=$(jq -n --arg p "$prompt" --arg i "$iso" --arg s "$subtype" \
      '{tool_name:"Agent",tool_input:{prompt:$p,isolation:$i,subagent_type:$s}}')
  fi
  out=$(printf '%s' "$json" | CLAUDE_PROJECT_DIR="$projdir" "$HOOK" 2>&1)
  actual=$?
  if [ "$actual" -ne "$expected" ]; then
    printf 'FAIL  (exit %d, expected %d)  %s\n' "$actual" "$expected" "$label"
    printf '     got: %s\n' "$out"
    FAILURES=$((FAILURES + 1))
    return
  fi
  if [ "$needle" != "-" ] && ! grep -qF "$needle" <<<"$out"; then
    printf 'FAIL  (exit %d ok, message missing %q)  %s\n' "$actual" "$needle" "$label"
    printf '     got: %s\n' "$out"
    FAILURES=$((FAILURES + 1))
    return
  fi
  printf 'PASS  (exit %d)  %s\n' "$actual" "$label"
}

# A minimal inline prompt body, parameterized by whether it carries the section.
# Kept as a helper so a case's intent is the ONE thing that varies between them.
inline_prompt() { # $1 = "ledger" | "no-ledger", $2 = extra body lines
  if [ "$1" = "ledger" ]; then
    printf 'Implement the unit.\n\n## Premise ledger\n\n| L1 | a premise | a read | a probe |\n\n%s\n' "$2"
  else
    printf 'Implement the unit. Every premise here is obvious.\n\n%s\n' "$2"
  fi
}

# --- case 1: no spec path in the prompt → not this gate's job ----------------
run 0 - "prompt with no dispatch-spec path passes" "Agent" \
  "Read packages/tooling/src/dev/foo.ts and summarize it."

# --- case 2: spec that HAS the section → passes ------------------------------
run 0 - "spec with a Premise ledger passes (relative path)" "Agent" \
  "Your spec is docs/local/dispatch/with-ledger.md — read it in full."

# --- case 2b: same, named by ABSOLUTE path (the routine dispatch shape) ------
run 0 - "spec with a Premise ledger passes (absolute path)" "Agent" \
  "Your spec is $FIXTURE/docs/local/dispatch/with-ledger.md — read it in full."

# --- case 3: spec MISSING the section → blocks, message names the section ----
run 2 "Premise ledger" "spec without a Premise ledger blocks" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 3b: the two mandatory rows are named in the block message ----------
run 2 "FIX'S OWN NAME" "block message names the fix-name row" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."
run 2 "PRIOR TASK ID" "block message names the prior-task row" "Agent" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 4: named spec that does not exist → passes -------------------------
# The dispatch will fail on its own first read with a clearer error; a gate
# that blocked here would just be a worse error message.
run 0 - "named-but-absent spec passes" "Agent" \
  "Your spec is docs/local/dispatch/never-written.md — read it in full."

# --- case 5: a non-Agent tool is out of scope --------------------------------
run 0 - "tool_name=Bash passes" "Bash" \
  "Your spec is docs/local/dispatch/no-ledger.md — read it in full."

# --- case 6: heading-level and case tolerance --------------------------------
# `### premise ledger` in a nested spec is the same section; the gate must not
# demand exactly two hashes or exactly one capitalization.
cat >"$FIXTURE/docs/local/dispatch/h3-lower.md" <<'SPEC'
# Spec
### premise ledger
| L1 | a premise | a read | a probe |
SPEC
run 0 - "### and lowercase heading counts as the section" "Agent" \
  "Your spec is docs/local/dispatch/h3-lower.md — read it in full."

# --- case 7: the words in prose are NOT the section --------------------------
# A spec that merely mentions a premise ledger without carrying one must still
# block; otherwise the gate is satisfied by the sentence describing it.
cat >"$FIXTURE/docs/local/dispatch/prose-only.md" <<'SPEC'
# Spec

This unit has no premise ledger because every premise is obvious.
SPEC
run 2 "Premise ledger" "prose mention without the section still blocks" "Agent" \
  "Your spec is docs/local/dispatch/prose-only.md — read it in full."

# --- case 8: spec exists but is UNREADABLE → fails open ----------------------
# grep exits 2 when it cannot read the file. That is an internal error, not a
# missing section, so the gate must pass rather than block a real dispatch.
UNREADABLE="$FIXTURE/docs/local/dispatch/unreadable.md"
cp "$FIXTURE/docs/local/dispatch/no-ledger.md" "$UNREADABLE"
chmod 000 "$UNREADABLE"
if [ "$(id -u)" -eq 0 ] || [ -r "$UNREADABLE" ]; then
  printf 'SKIP  (running as root, or the filesystem ignores mode 000 — an unreadable file cannot be staged)  unreadable spec fails open\n'
else
  run 0 "failing open" "unreadable spec fails open" "Agent" \
    "Your spec is docs/local/dispatch/unreadable.md — read it in full."
fi
# Restore the mode so the trap's cleanup can remove the fixture tree.
chmod 644 "$UNREADABLE"

# --- case 9: inline prompt + worktree isolation, no section → blocks ---------
# The shape the widened scope exists to catch: instructions written into the
# Agent call rather than a file are a spec too.
run_iso 2 "inline prompt" "inline worktree dispatch without the section blocks" \
  "$FIXTURE" worktree "$(inline_prompt no-ledger '')"

# --- case 10: inline prompt + worktree isolation, WITH the section → passes --
run_iso 0 - "inline worktree dispatch carrying the section passes" \
  "$FIXTURE" worktree "$(inline_prompt ledger '')"

# --- case 11: inline prompt, no isolation → out of scope --------------------
# Explore fan-outs, miners and guide agents mutate nothing and carry no spec.
run_iso 0 - "inline dispatch without worktree isolation is out of scope" \
  "$FIXTURE" - "$(inline_prompt no-ledger '')"

# --- case 12: a named spec file wins over the prompt ------------------------
# The prompt itself carries no section; the spec it names does. The file is the
# text under check, so this passes — the pre-existing behaviour, now pinned
# against the isolation-aware path that could have overridden it.
run_iso 0 - "named spec with the section passes even when the prompt lacks it" \
  "$FIXTURE" worktree \
  "Read docs/local/dispatch/with-ledger.md in full and implement it."

# --- case 12b: a named spec file still blocks by PATH, not as "inline" -------
run_iso 2 "no-ledger.md" "named spec without the section blocks naming the file" \
  "$FIXTURE" worktree \
  "Read docs/local/dispatch/no-ledger.md in full and implement it."

# --- case 12c: a named-but-absent spec + worktree isolation falls through to
# the inline check over the prompt itself, rather than being exempted --------
run_iso 2 "inline prompt" \
  "named-but-absent spec plus worktree isolation falls through to the inline check" \
  "$FIXTURE" worktree \
  "Handle it like docs/local/dispatch/gone-since.md did, but inline: $(inline_prompt no-ledger '')"

# --- case 12d: same shape, but the inline prompt itself carries the section -
run_iso 0 - \
  "named-but-absent spec plus worktree isolation, inline prompt carries the section, passes" \
  "$FIXTURE" worktree \
  "Handle it like docs/local/dispatch/gone-since.md did, but inline: $(inline_prompt ledger '')"

# --- R2(a) phantom `pnpm --filter` scripts ----------------------------------
mkdir -p "$FIXTURE/packages/probe"
# Three scripts, so the block message's space-joined list is a distinctive
# string and case 13b pins the LIST, not merely the presence of one name.
# `test.integration` (an interior period) pins the trailing-punctuation-only
# strip: jq's alphabetical key sort puts it after `test`.
cat >"$FIXTURE/packages/probe/package.json" <<'PKG'
{ "name": "@tzurot/probe", "scripts": { "test": "vitest run", "lint": "eslint .", "test.integration": "vitest run --config vitest.integration.config.ts" } }
PKG

# --- case 13: a script the package does not declare → blocks ----------------
run_iso 2 "phantom pnpm script" "phantom pnpm script blocks" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe typecheck`.')"

# --- case 13b: the block names the package's real scripts -------------------
run_iso 2 "lint test test.integration" "phantom block prints the package's actual script list" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe typecheck`.')"

# --- case 14: a script the package DOES declare → passes --------------------
run_iso 0 - "declared pnpm script passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test`.')"

# --- case 14b: a pnpm SUBCOMMAND in the script slot is not a script → passes
run_iso 0 - "pnpm subcommand in the script slot is skipped" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe exec vitest run`.')"

# --- case 14c: a flag before the script is walked past → blocks -------------
run_iso 2 "phantom pnpm script" "a flag before a phantom script is walked past" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe run typecheck`.')"

# --- case 14d: same, but with a leading flag instead of `run` ---------------
run_iso 2 "phantom pnpm script" "a leading flag before a phantom script is walked past" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --silent typecheck`.')"

# --- case 14d2: a phantom behind FOUR flags is still reached (window is 7) --
run_iso 2 "phantom pnpm script" "a script behind four flags is still reached" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --a --b --c --d typecheck`.')"

# --- case 14e: `run` before a DECLARED script still passes -------------------
run_iso 0 - "run before a declared script still passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe run test`.')"

# --- case 14f: a flag before a DECLARED script still passes ------------------
run_iso 0 - "a flag before a declared script still passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --silent test`.')"

# --- case 14g: `run` with nothing after it inside the token window → passes -
# The walk runs out of tokens without finding a script name.
run_iso 0 - "run with nothing after it in the token window fails open" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe run`')"

# --- case 14j: the `-F` shorthand for `--filter` is matched too -------------
run_iso 2 "phantom pnpm script" "the -F shorthand is checked like --filter" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm -F @tzurot/probe typecheck`.')"
run_iso 0 - "the -F= form with a declared script passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm -F=@tzurot/probe test`.')"

# --- case 14k: a chained `&&` command's phantom script is caught -------------
# Before the fix, a single `pnpm --filter` regex hit could swallow a SECOND
# `pnpm --filter` invocation whole, so the walk found only the FIRST
# command's script and the second command's phantom escaped detection.
# Splitting CHECK_TEXT into command segments first closes that gap.
run_iso 2 "phantom pnpm script" "the second command of a && chain is checked" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test && pnpm --filter @tzurot/probe typecheck`.')"

# --- case 14l: same shape, chained with `;` ----------------------------------
run_iso 2 "phantom pnpm script" "the second command after ; is checked" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test; pnpm --filter @tzurot/probe typecheck`.')"

# --- case 14m: a chain of two DECLARED scripts still passes ------------------
run_iso 0 - "a chain of declared scripts passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test && pnpm --filter @tzurot/probe lint`.')"

# --- case 14h: a dotted script name survives the trailing-punctuation strip -
# Only TRAILING punctuation is stripped now: the interior period in
# `test.integration` must not be truncated away by the walk.
run_iso 0 - "a dotted script name survives the trailing-punctuation strip" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test.integration.`')"

# --- case 14i: a dotted PHANTOM script is still detected ---------------------
run_iso 2 "phantom pnpm script" "a dotted phantom is still detected" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe test.phantom.`')"

# --- case 14n: a prompt carrying NO pnpm filter at all still passes ---------
# The phantom section short-circuits before building the workspace name→
# manifest map when the scan found nothing to resolve, so this path must stay
# green with the map never built.
run_iso 0 - "a worktree prompt with no pnpm command passes with no manifest map built" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: read the file and report what it says.')"

# --- case 15: a glob filter is not a package filter → passes ----------------
run_iso 0 - "glob --filter is skipped" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Build with `pnpm --filter "./packages/**" build`.')"

# --- case 15b: an unknown workspace package fails open ----------------------
run_iso 0 - "unresolvable @tzurot package fails open" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/not-a-package typecheck`.')"

# --- case 15c: a digit-bearing package name is matched -----------------------
mkdir -p "$FIXTURE/packages/probe2"
cat >"$FIXTURE/packages/probe2/package.json" <<'PKG'
{ "name": "@tzurot/probe2", "scripts": { "test": "x", "only-in-probe2": "x" } }
PKG
run_iso 2 "phantom pnpm script" "a digit-bearing package name is matched" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe2 typecheck`.')"

# --- case 15f: pnpm's documented MULTI-package form --------------------------
# A repeated selector is the shape a positional walk misreads as the script:
# the second `@tzurot/...` sits exactly where the script is expected. It is a
# real form — the repo's own `test:low-mem` script and ci.yml both use it.
run_iso 0 - "a repeated --filter selector is not mistaken for the script" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --filter @tzurot/probe2 test`.')"

# --- case 15f2: the same form naming a script NEITHER package declares -------
run_iso 2 "phantom pnpm script" "a phantom behind a repeated --filter is still caught" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --filter @tzurot/probe2 typecheck`.')"

# --- case 15f3: declared by only the SECOND selected package → passes --------
# Probed, not assumed: `pnpm --filter A --filter B <script>` exits 0 and skips
# the package lacking the script, erroring (ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT)
# only when NONE of the selected packages declares it. Blocking here would be
# a false block on a command that genuinely succeeds.
run_iso 0 - "a script declared by only one of two selected packages passes" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --filter @tzurot/probe2 only-in-probe2`.')"

# --- case 15f4: the SINGLE-selector form of the same script still blocks -----
# Same script, one selector that does not declare it — the case pnpm really
# does fail. This is what keeps 15f3 from being a blanket exemption.
run_iso 2 "phantom pnpm script" "the single-selector form of that same script still blocks" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe only-in-probe2`.')"

# --- case 15g: a flag taking a SEPARATE-WORD value ---------------------------
# `--filter` is one member of this class, not the whole of it: `--reporter`,
# `-C` and `--workspace-concurrency` all put a non-script token where a
# positional walk expects the script. The declared script later in the command
# is what settles it.
run_iso 0 - "a separate-word flag value is not mistaken for the script" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --reporter default test`.')"

# --- case 15g2: same flag shape, but the real script IS a phantom → blocks ---
run_iso 2 "phantom pnpm script" "a phantom after a separate-word flag value still blocks" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe --reporter default typecheck`.')"

# --- case 15h: a path-shaped flag value is never a script name ---------------
run_iso 0 - "a path-shaped flag value is not mistaken for the script" \
  "$FIXTURE" worktree \
  "$(inline_prompt ledger 'Gate: `pnpm --filter @tzurot/probe -C packages/probe test`.')"

# --- case 15d: the phantom check now runs WITHOUT worktree isolation --------
# The nested-dispatch pair's inner worker (opus-implementer, no isolation of
# its own) still carries gate commands, so a phantom script there must still
# be caught — this is the CAN_RUN_GATES=1-via-subagent_type path.
run_iso 2 "phantom pnpm script" "the inner worker (opus-implementer, no isolation) is still blocked on a phantom" \
  "$FIXTURE" - \
  "$(inline_prompt no-ledger 'Gate: `pnpm --filter @tzurot/probe typecheck`.')" \
  opus-implementer

# --- case 15d2: a pure research prompt quoting the SAME phantom is warned, --
# not blocked — it cannot run the command at all.
run_iso 0 "not blocking" "a research prompt quoting a phantom is warned, not blocked" \
  "$FIXTURE" - \
  "$(inline_prompt no-ledger 'Gate: `pnpm --filter @tzurot/probe typecheck`.')" \
  Explore

# --- case 15d3: same shape, no subagent_type and no isolation at all --------
run_iso 0 - "a non-worktree, non-opus-implementer dispatch with a phantom is not blocked" \
  "$FIXTURE" - \
  "$(inline_prompt no-ledger 'Gate: `pnpm --filter @tzurot/probe typecheck`.')" \
  general-purpose

# --- case 15e: a declared script without worktree isolation still passes ----
run_iso 0 - "a non-worktree dispatch with a declared script passes" \
  "$FIXTURE" - \
  "$(inline_prompt no-ledger 'Gate: `pnpm --filter @tzurot/probe test`.')"

# --- case 11 (re-confirmed above) still holds: a non-worktree dispatch with
# no ledger and no pnpm command must still be OUT of scope for the ledger
# requirement — the phantom-check widening in 15d/15e must not have widened
# the ledger requirement itself.

# --- R2(b) base SHA must be the main checkout's HEAD ------------------------
# These need a real repo to compare against, so the project dir for them is a
# throwaway two-commit repo rather than the spec fixture tree.
GITFIX="$TMPDIR_PROBE/gitrepo"
mkdir -p "$GITFIX"
if ! command -v git >/dev/null 2>&1 ||
  ! git -C "$GITFIX" init -q >/dev/null 2>&1; then
  printf 'SKIP  (git unavailable — the base-SHA cases need a real repo)  base-SHA cases\n'
else
  git -C "$GITFIX" config user.email 'probe@example.invalid'
  git -C "$GITFIX" config user.name 'Probe'
  git -C "$GITFIX" config commit.gpgsign false
  printf 'one\n' >"$GITFIX/a.txt"
  git -C "$GITFIX" add a.txt >/dev/null 2>&1
  git -C "$GITFIX" commit -q --no-verify -m 'first probe commit' >/dev/null 2>&1
  printf 'two\n' >"$GITFIX/a.txt"
  git -C "$GITFIX" commit -q --no-verify -am 'second probe commit' >/dev/null 2>&1

  OLD_SHA=$(git -C "$GITFIX" rev-parse HEAD~1 2>/dev/null)
  HEAD_SHA=$(git -C "$GITFIX" rev-parse HEAD 2>/dev/null)

  if [ -z "$OLD_SHA" ] || [ -z "$HEAD_SHA" ]; then
    printf 'FAIL  (could not build the two-commit probe repo)  base-SHA cases\n'
    FAILURES=$((FAILURES + 1))
  else
    # --- case 16: base names an older commit → blocks -----------------------
    run_iso 2 "not the main checkout's HEAD" "base SHA behind HEAD blocks" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$OLD_SHA\`")"

    # --- case 16b: the block prints BOTH subjects, so the drift is readable --
    run_iso 2 "first probe commit" "base-SHA block names the spec's base subject" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$OLD_SHA\`")"
    run_iso 2 "second probe commit" "base-SHA block names HEAD's subject" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$OLD_SHA\`")"

    # --- case 17: base IS HEAD → passes ------------------------------------
    run_iso 0 - "base SHA equal to HEAD passes" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$HEAD_SHA\`")"

    # --- case 17b: an UPPER-CASE base SHA is still a candidate --------------
    # `git rev-parse` resolves upper-case hex, so a spec that pastes one names
    # a real commit; a case-sensitive token extraction would drop it and skip
    # the check entirely. Pinned in both directions: matching HEAD passes...
    run_iso 0 - "an upper-case base SHA equal to HEAD passes" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$(tr 'a-f' 'A-F' <<<"$HEAD_SHA")\`")"

    # --- case 17c: ...and an upper-case DRIFTED one still blocks ------------
    # This is the half that actually fails if the extraction is case-sensitive:
    # 17b would pass for the wrong reason (no candidate → fail open).
    run_iso 2 "not the main checkout's HEAD" "an upper-case base SHA behind HEAD still blocks" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Base SHA: \`$(tr 'a-f' 'A-F' <<<"$OLD_SHA")\`")"

    # --- case 18: a hex-shaped token that resolves to nothing → fails open --
    run_iso 0 - "unresolvable base SHA fails open" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger 'Base SHA: `deadbee1234567`')"

    # --- case 18b: no base line at all → fails open -------------------------
    run_iso 0 - "spec text with no base line fails open" \
      "$GITFIX" worktree "$(inline_prompt ledger 'Nothing to resolve here.')"

    # --- case 18c: a database/rebase line does not supply the base candidate -
    # The FIRST base-ish line only mentions "database"; the real base line
    # follows. A whole-word match must skip the first and still resolve HEAD.
    run_iso 0 - "a database/rebase line does not supply the base candidate" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "See the database change in commit \`$OLD_SHA\` for context.
Base SHA: \`$HEAD_SHA\`")"

    # --- case 18d: a bare "base" line with no sha/commit/colon nearby -------
    # supplies no candidate at all, even though it's on its own line and
    # even though a real base line with the candidate SHA follows it.
    run_iso 0 - "a bare 'base' line without sha/commit/colon does not supply the candidate" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "The base tables \`$OLD_SHA\` are unchanged.
Base SHA: \`$HEAD_SHA\`")"

    # --- case 18e: the "Required base SHA:" phrasing resolves the candidate -
    run_iso 0 - "the 'Required base SHA:' phrasing resolves the candidate" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Required base SHA: \`$HEAD_SHA\`")"

    # --- case 18f: same phrasing still blocks on real drift -----------------
    run_iso 2 "not the main checkout's HEAD" "the 'Required base SHA:' phrasing still blocks on drift" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "Required base SHA: \`$OLD_SHA\`")"

    # --- case 18g: a bare colon after "base" (no sha/commit nearby) does not
    # supply a candidate on its own — the colon-alone fallback was dropped.
    run_iso 0 - "a bare colon after base does not supply a candidate" \
      "$GITFIX" worktree \
      "$(inline_prompt ledger "The base module: see \`$OLD_SHA\` elsewhere.
Base SHA: \`$HEAD_SHA\`")"
  fi
fi

exit $FAILURES
