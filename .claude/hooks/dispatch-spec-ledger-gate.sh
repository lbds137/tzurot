#!/bin/bash
# PreToolUse hook (matcher: Agent) — a worktree dispatch must carry a
# `## Premise ledger` section, and its mechanical spec claims must hold.
#
# Why: a spec's runtime premises are the half a worker cannot check for itself.
# The premises that failed all looked correct on the page; the ledger is what
# turns each one into a re-verification the orchestrator actually runs
# (/tzurot-orchestration § The spec template, item 1).
#
# Scope, in this order:
#   - a prompt naming a spec file under `docs/local/dispatch/` that RESOLVES
#     to a real file is checked against THAT FILE;
#   - otherwise (no spec named, or a named spec that does not resolve — a
#     path that does not resolve may be narrative, such as a prior spec since
#     cleaned up or a typo, not evidence the dispatch carries no premises to
#     check) a dispatch whose `tool_input.isolation` is the literal
#     `worktree` is checked against the PROMPT ITSELF, because an inline
#     prompt is a spec that merely was not written to a file;
#   - every other Agent call — research agents, Explore fan-outs, miners —
#     carries no ledger requirement, but is NOT fully out of scope: its
#     prompt text still feeds the phantom-script check below, because the
#     nested-dispatch pair's INNER worker is launched without an isolation
#     flag of its own and carries the gate commands.
#
# Past the ledger check, the two mechanical checks below run over the same
# text (the spec file when one is named, else the prompt), but with DIFFERENT
# scope from each other:
#   - a phantom `pnpm --filter @tzurot/<pkg> <script>` whose script is
#     declared by NONE of the workspace packages the invocation selects —
#     the check RUNS for EVERY Agent prompt, but it only BLOCKS a dispatch
#     that can actually run the command (`isolation: worktree`, or
#     `subagent_type: opus-implementer` as the nested pair's inner worker
#     with no isolation flag of its own); everywhere else (Explore, a miner,
#     a plain research agent) it warns to stderr and keeps scanning, since
#     such a prompt may legitimately quote a phantom script for discussion
#     rather than execution;
#   - a base SHA that resolves but is NOT the main checkout's current HEAD —
#     worktree-only, since a research agent's prompt has no base SHA to
#     drift from. `worktree.baseRef: "head"` cuts the worktree from wherever
#     HEAD stands at spawn time, so a dispatch fired from the wrong branch
#     gets a valid but WRONG base — which the worker's own step-0 self-heal
#     cannot see.
#
# `isolation: "remote"` is deliberately out of scope for every check here —
# no remote dispatch exists in this repo's workflow, a remote agent shares no
# object store so the base-SHA check is meaningless there, and the ledger
# contract for it lives in /tzurot-orchestration, not this hook.
#
# This gate enforces the section's PRESENCE, not its quality — the quality is
# the orchestrator's re-verification, which no hook can see.
#
# Fail-open on any internal error (missing jq or git, unreadable prompt, a
# spec file grep cannot read, a package.json that will not parse, a project
# dir that is not a git checkout): a broken gate must never block a real
# dispatch. Only a genuinely missing section, a genuinely phantom script, and
# a genuinely divergent base SHA block. Both mechanical checks below also scan
# one line at a time, so a command or SHA soft-wrapped across lines is not
# seen — fail-open, by design, not an oversight. Likewise, a script named
# behind more than six flags/subcommands falls outside the phantom-script
# check's captured token window and is not seen — also fail-open. The
# phantom-script walk fails open once more, on token SHAPE: a token carrying
# `@`, `/` or `=` is never treated as a script name, so a repeated `--filter`
# selector, a path argument and a glued `--flag=value` are all passed over
# rather than mistaken for the script. A value-taking flag NOT in the table
# below whose value happens to equal a declared script still rescues the
# hit — the table names the flags known to take a separate-word value; any
# other value-taking flag falls back to the shape rule and can slip through.
# And the outer capture recognises only `--filter`/`-F` as the ENTRY flag
# before a selector, so an invocation whose sole selector rides
# `--filter-prod` never becomes a hit at all — invisible, not merely
# fail-open on its value.

set -uo pipefail

INPUT=$(cat)

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" = "Agent" ] || exit 0

PROMPT=$(jq -r '.tool_input.prompt // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$PROMPT" ] && exit 0

# `isolation` is a real Agent tool_input field. Only the literal `worktree`
# marks a file-mutating dispatch; anything else (absent, `remote`) is a
# research agent as far as this gate is concerned.
ISOLATION=$(jq -r '.tool_input.isolation // empty' <<<"$INPUT" 2>/dev/null || echo "")

# `subagent_type` distinguishes the nested-dispatch pair's INNER worker
# (opus-implementer, no isolation flag of its own — still runs the gate
# commands a spec quotes) from a research agent (Explore, general-purpose,
# claude-code-guide) that carries no gates to run at all.
SUBAGENT_TYPE=$(jq -r '.tool_input.subagent_type // empty' <<<"$INPUT" 2>/dev/null || echo "")

# Whether this dispatch can actually RUN the gate commands a spec/prompt
# quotes: a worktree dispatch always can, and so can the inner worker of a
# nested pair even without its own isolation flag. Everything else (Explore,
# a miner, a plain research agent) cannot run anything — it only reads or
# discusses.
CAN_RUN_GATES=0
if [ "$ISOLATION" = "worktree" ] || [ "$SUBAGENT_TYPE" = "opus-implementer" ]; then
  CAN_RUN_GATES=1
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"

# One regex, applied to a file in the named-spec path and to the prompt text in
# the inline path, so the two paths cannot drift apart.
LEDGER_RE='^##+ *Premise ledger'

# $1 = headline suffix (empty, or " (inline prompt)"), $2 = the "where" line.
block_missing_ledger() {
  cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH SPEC — no \`## Premise ledger\` section$1
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
$2

Every dispatch spec carries a \`## Premise ledger\` section: one row per
runtime premise the spec asserts, naming the read or probe that
established it and how the orchestrator re-verifies it before building
on it. A premise that only looks correct on the page is the failure
shape this section exists to catch. An inline prompt is a spec too —
writing the instructions into the Agent call instead of a file does not
make its premises any more checkable by the worker.

Two rows are mandatory in every ledger:
  - the grep for the FIX'S OWN NAME — is it already built?
  - the grep for a PRIOR TASK ID or shipped PR that already covers it

Add the section, then retry the dispatch.
(/tzurot-orchestration § The spec template, item 1. This gate checks
the section is PRESENT; its quality is your re-verification's job.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
  exit 2
}

# Only the FIRST spec path named in the prompt is checked: one spec per
# dispatch is the convention, so a second named path is normally a template or
# reference the worker reads rather than the spec it must satisfy.
#
# The leading character class absorbs an
# absolute prefix (the orchestrator is routinely told to read the spec from the
# MAIN checkout, which is an absolute path), so both forms resolve.
SPEC=$(grep -oE '[A-Za-z0-9._/-]*docs/local/dispatch/[A-Za-z0-9._-]+\.md' <<<"$PROMPT" 2>/dev/null | head -n 1)

# CHECK_TEXT is the text the mechanical checks below read: the spec file's
# content when one is named and readable, else the prompt itself.
CHECK_TEXT=""

RESOLVED=""
if [ -n "$SPEC" ]; then
  case "$SPEC" in
    /*) RESOLVED="$SPEC" ;;
    *) RESOLVED="$PROJECT_DIR/$SPEC" ;;
  esac
fi

# A named spec path that does not resolve to a real file is NOT treated as
# "no spec named": the path can fail to resolve because the spec was cleaned
# up after a prior dispatch, or was mistyped, neither of which means the
# prompt carries no premises to check. A worktree dispatch with an unresolved
# spec path therefore falls through to the inline check below, over the
# prompt text itself, rather than being exempted from the gate entirely.
if [ -n "$SPEC" ] && [ -f "$RESOLVED" ]; then
  # grep's exit codes are three-valued and only ONE of them means "the section
  # is genuinely absent": 0 = found, 1 = no match, 2 (or anything else) = grep
  # could not READ the file. Collapsing that to "non-zero blocks" turns an
  # unreadable spec into a block, which is the fail-closed direction this gate
  # must never take.
  grep -qiE "$LEDGER_RE" "$RESOLVED" 2>/dev/null
  GREP_STATUS=$?

  if [ "$GREP_STATUS" -eq 1 ]; then
    block_missing_ledger "" "  $RESOLVED"
  fi

  if [ "$GREP_STATUS" -ne 0 ]; then
    echo "dispatch-spec-ledger-gate: could not read $RESOLVED (grep exit $GREP_STATUS) — failing open" >&2
    exit 0
  fi

  CHECK_TEXT=$(cat "$RESOLVED" 2>/dev/null)
  if [ -z "$CHECK_TEXT" ]; then
    echo "dispatch-spec-ledger-gate: could not re-read $RESOLVED for the mechanical checks — failing open" >&2
    exit 0
  fi
elif [ "$ISOLATION" = "worktree" ]; then
  # An inline worktree dispatch is gated against its own prompt. The same
  # three-valued grep handling applies, even though a here-string is far less
  # likely to be unreadable than a file.
  grep -qiE "$LEDGER_RE" <<<"$PROMPT" 2>/dev/null
  GREP_STATUS=$?

  if [ "$GREP_STATUS" -eq 1 ]; then
    block_missing_ledger " (inline prompt)" "  (inline prompt, isolation: worktree)"
  fi

  if [ "$GREP_STATUS" -ne 0 ]; then
    echo "dispatch-spec-ledger-gate: could not scan the inline prompt (grep exit $GREP_STATUS) — failing open" >&2
    exit 0
  fi

  CHECK_TEXT="$PROMPT"
else
  # No ledger requirement for a research agent — but its prompt still gets
  # the phantom-script check below: the nested-dispatch pair's INNER worker
  # is launched without an isolation flag of its own and carries the gate
  # commands, so a phantom script there would otherwise go unchecked.
  CHECK_TEXT="$PROMPT"
fi

# ---------------------------------------------------------------------------
# Phantom `pnpm --filter @tzurot/<pkg> <script>`
# ---------------------------------------------------------------------------
# The SCAN runs for EVERY Agent prompt reaching this point, not just worktree
# ones — but it only BLOCKS ($CAN_RUN_GATES = 1); everywhere else it warns to
# stderr and keeps going, since a research prompt may legitimately quote a
# phantom script for discussion rather than execution.
# Glob filters (`--filter "./packages/**"`) and non-@tzurot filters never match;
# `-F`, pnpm's documented shorthand for `--filter`, is matched too.
# The tail captures up to seven following tokens (not just one) so the walk
# below can step past flags and pnpm subcommands to find the real script.
#
# CHECK_TEXT is split into command segments FIRST (on &&, ||, ;, and |) so a
# chained one-liner is scanned command-by-command: without the split, a hit's
# capture window can run past its own command's script and swallow a SECOND
# `pnpm --filter` invocation whole, in which case the walk below finds only
# the FIRST command's script and never reaches the second command's — a
# phantom script chained after `&&`/`;`/`|` then silently escapes detection.
# A markdown table pipe is split too, harmlessly — it never contains a `pnpm
# --filter` token to begin with.
SEGMENTED_TEXT=$(sed -E 's/(\&\&|\|\||;|\|)/\n/g' <<<"$CHECK_TEXT" 2>/dev/null)
FILTER_HITS=$(grep -oE 'pnpm (--filter|-F)[ =]"?@tzurot/[A-Za-z0-9_-]+"? +[^ ]+( +[^ ]+){0,6}' <<<"$SEGMENTED_TEXT" 2>/dev/null)
FILTER_STATUS=$?
if [ "$FILTER_STATUS" -gt 1 ]; then
  echo "dispatch-spec-ledger-gate: could not scan for pnpm filters (grep exit $FILTER_STATUS) — skipping the phantom-script check" >&2
  FILTER_HITS=""
fi

# The workspace name→manifest map is BUILT, never assumed: package names do not
# all map to `packages/<name>` — the four services live under `services/`. It
# costs one `jq` per workspace manifest, so it is built only once the scan has
# actually found a filter invocation to resolve; the overwhelmingly common
# Agent prompt contains no pnpm command at all and pays nothing.
PKG_MAP=""
if [ -n "$FILTER_HITS" ]; then
  for MANIFEST in "$PROJECT_DIR"/packages/*/package.json "$PROJECT_DIR"/services/*/package.json; do
    [ -f "$MANIFEST" ] || continue
    PKG_NAME=$(jq -r '.name // empty' "$MANIFEST" 2>/dev/null)
    [ -n "$PKG_NAME" ] || continue
    PKG_MAP="$PKG_MAP$PKG_NAME|$MANIFEST
"
  done
fi

while IFS= read -r HIT; do
  [ -n "$HIT" ] || continue
  # Normalize `--filter=@tzurot/x` to the spaced form so the selector becomes a
  # token in its own right — glued to its flag it would never be recognized as
  # one of the packages the invocation selects — and drop the optional quotes
  # around the package name. Both substitutions are global: an invocation may
  # carry more than one selector.
  CLEANED=${HIT//\"/}
  CLEANED=${CLEANED//--filter=/--filter }
  CLEANED=${CLEANED//-F=/-F }

  # Every token from field 2 onward (field 1 is `pnpm` itself), classified by
  # SHAPE rather than by position. Position is what the earlier walk relied on,
  # and it cannot survive pnpm's real grammar: any flag taking a separate-word
  # value (`--filter`, `--reporter`, `-C`, `--workspace-concurrency`) puts a
  # non-script token exactly where a positional walk expects the script.
  mapfile -t FILTER_TOKENS < <(awk '{for (i = 2; i <= NF; i++) print $i}' <<<"$CLEANED")
  [ "${#FILTER_TOKENS[@]}" -gt 0 ] || continue

  # Strip TRAILING prose punctuation (backtick, period, comma, closing paren)
  # one character at a time — a token at the end of a sentence (`run`` or
  # `test`.) must still match `run` or resolve as the real script name. Only
  # trailing characters are removed: a script name with an interior period
  # (`test.integration`) must survive intact rather than being truncated at
  # the first dot.
  for ((TOK_IDX = 0; TOK_IDX < ${#FILTER_TOKENS[@]}; TOK_IDX++)); do
    TOK="${FILTER_TOKENS[$TOK_IDX]}"
    while [ -n "$TOK" ] && [ "${TOK%[\`.,)]}" != "$TOK" ]; do
      TOK=${TOK%[\`.,)]}
    done
    FILTER_TOKENS[TOK_IDX]="$TOK"
  done

  # Pass 1 — resolve EVERY `@tzurot/*` selector the invocation names, and union
  # their declared scripts. pnpm's own rule, probed rather than assumed, is that
  # `pnpm --filter A --filter B <script>` fails
  # (ERR_PNPM_RECURSIVE_RUN_NO_SCRIPT, exit 1) only when NONE of the selected
  # packages declares the script, and exits 0 — silently skipping the package
  # that lacks it — when at least one does. So the union, not any single
  # package, is what decides whether the command can run at all.
  FILTER_SELECTORS=""
  FILTER_PKGS=""
  PKG_FILES=""
  PKG_SCRIPTS=""
  PKG_PARSE_FAILED=""
  for TOK in "${FILTER_TOKENS[@]}"; do
    case "$TOK" in
      @tzurot/*) ;;
      *) continue ;;
    esac
    FILTER_SELECTORS="$FILTER_SELECTORS $TOK"
    # The trailing `|` anchors the end of the name, so `@tzurot/test` cannot
    # match `@tzurot/test-utils`.
    MATCH=$(grep -F "$TOK|" <<<"$PKG_MAP" 2>/dev/null | head -n 1)
    [ -n "$MATCH" ] || continue
    PKG_FILE=${MATCH#*|}
    PKG_KEYS=$(jq -r '(.scripts // {}) | keys | join(" ")' "$PKG_FILE" 2>/dev/null)
    JQ_STATUS=$?
    if [ "$JQ_STATUS" -ne 0 ]; then
      PKG_PARSE_FAILED="$PKG_FILE (jq exit $JQ_STATUS)"
      break
    fi
    FILTER_PKGS="$FILTER_PKGS $TOK"
    PKG_FILES="$PKG_FILES $PKG_FILE"
    PKG_SCRIPTS="$PKG_SCRIPTS $PKG_KEYS"
  done

  if [ -n "$PKG_PARSE_FAILED" ]; then
    echo "dispatch-spec-ledger-gate: could not parse $PKG_PARSE_FAILED — skipping that filter" >&2
    continue
  fi
  if [ -z "$FILTER_PKGS" ]; then
    echo "dispatch-spec-ledger-gate: no workspace manifest named$FILTER_SELECTORS under $PROJECT_DIR — skipping that filter" >&2
    continue
  fi

  # pnpm flags that take a SEPARATE-WORD value, so the `case " $X " in
  # *" $TOK "*)` idiom already used below can match one. Values glued with
  # `=` are already normalized to the spaced form above (`--filter=`, `-F=`)
  # or stay glued to their flag, so the whole `--flag=value` token is one
  # `-*` token the arm below skips outright — only the separate-word
  # form needs this table. An unlisted value-taking flag reopens the class
  # for its own value only — fail-open, named in the header.
  VALUE_TAKING_FLAGS='--filter -F --filter-prod --changed-files-ignore-pattern --test-pattern -C --dir --reporter --workspace-concurrency --loglevel --resume-from'

  # Pass 2 — decide whether the invocation names a script the selected packages
  # can actually run. A flag (`--silent`, `-r`) or the literal `run` is skipped;
  # a pnpm SUBCOMMAND means the hit names no script at all, so the whole hit is
  # skipped. A token carrying `@`, `/` or `=` is never a script name — a
  # package.json key cannot be a scoped selector, a path, or a glued
  # `--flag=value` — so those are passed over too.
  #
  # The first bare word matching the union settles it: the command runs, so the
  # hit passes. Only when NO token matches does the first unmatched bare word
  # become the reported phantom. The value-taking-flag table above is what
  # keeps a LISTED flag's separate-word value from being read at all: the
  # SKIP_VALUE latch below skips it structurally, so it can neither rescue the
  # hit (by matching a declared script) nor abort it (by matching a subcommand
  # keyword). Scanning on past a non-match is what still protects an UNLISTED
  # flag's value — unmatched, but the real script later in the command still
  # rescues the hit.
  FOUND_DECLARED=""
  FILTER_SCRIPT=""
  IS_SUBCOMMAND=""
  SKIP_VALUE=""
  for TOK in "${FILTER_TOKENS[@]}"; do
    if [ -n "$SKIP_VALUE" ]; then
      SKIP_VALUE=""
      case "$TOK" in
        # A flag where a value was expected is parsed as a flag, matching
        # pnpm (probed live with a file-writing script: `--reporter --silent
        # sayhi` ran it silently, while `--reporter sayhi x` consumed sayhi as
        # the value and ran nothing) — fall through to normal handling.
        -*) ;;
        *) continue ;;
      esac
    fi
    case "$TOK" in
      "" | -* | run)
        case " $VALUE_TAKING_FLAGS " in
          *" $TOK "*) SKIP_VALUE=1 ;;
        esac
        continue
        ;;
      exec | add | install | remove | update | dlx | list | why | outdated)
        IS_SUBCOMMAND=1
        break
        ;;
      *@* | */* | *=*) continue ;;
    esac
    case " $PKG_SCRIPTS " in
      *" $TOK "*)
        FOUND_DECLARED=1
        break
        ;;
    esac
    [ -n "$FILTER_SCRIPT" ] || FILTER_SCRIPT="$TOK"
  done

  [ -z "$IS_SUBCOMMAND" ] || continue
  [ -z "$FOUND_DECLARED" ] || continue
  [ -n "$FILTER_SCRIPT" ] || continue

  # Deduplicated for the message only; `LC_ALL=C` keeps the order identical to
  # jq's codepoint-sorted `keys` when a single package is selected.
  PKG_SCRIPTS=$(tr ' ' '\n' <<<"$PKG_SCRIPTS" | grep -v '^$' | LC_ALL=C sort -u | tr '\n' ' ')
  PKG_SCRIPTS=${PKG_SCRIPTS% }

  # A dispatch that cannot run gates at all (a research agent, an Explore
  # fan-out, a miner) may still legitimately quote a phantom script — e.g.
  # discussing what a spec SHOULD say. Warn instead of blocking; only a
  # dispatch that can actually run the command loses a cycle to it.
  if [ "$CAN_RUN_GATES" -ne 1 ]; then
    echo "dispatch-spec-ledger-gate: research prompt quotes a script no selected package declares ($FILTER_PKGS $FILTER_SCRIPT) — not blocking a non-gate-running dispatch" >&2
    continue
  fi

  cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH SPEC — phantom pnpm script
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 $FILTER_PKGS $FILTER_SCRIPT

No selected package declares that script. Manifests checked:$PKG_FILES
Their scripts are:
  $PKG_SCRIPTS

A verification gate the package cannot run is not a gate: the worker
spends a cycle on the failure and reports it as a diff problem. Correct
the command in the spec (or add the script), then retry the dispatch.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
  exit 2
done <<<"$FILTER_HITS"

# The base-SHA check below is worktree-only: a research agent's prompt has no
# base SHA to drift from (the phantom-script check above already ran for
# every Agent prompt, worktree or not).
[ "$ISOLATION" = "worktree" ] || exit 0

# ---------------------------------------------------------------------------
# Base SHA must be the main checkout's HEAD
# ---------------------------------------------------------------------------
command -v git >/dev/null 2>&1 || {
  echo "dispatch-spec-ledger-gate: git unavailable — skipping the base-SHA check" >&2
  exit 0
}

HEAD_SHA=$(git -C "$PROJECT_DIR" rev-parse HEAD 2>/dev/null)
if [ -z "$HEAD_SHA" ]; then
  echo "dispatch-spec-ledger-gate: $PROJECT_DIR is not a readable git checkout — skipping the base-SHA check" >&2
  exit 0
fi

# Candidates come only from lines that talk about a base — matched as a whole
# word ("database" and "rebase" don't contribute candidates) AND followed
# within 20 characters by `sha` or `commit`, so a line that merely mentions
# "base" in passing ("the base tables are unchanged") cannot supply a
# candidate, and neither can a bare colon after "base" with no `sha`/`commit`
# nearby ("the base module: see abc1234 elsewhere") — only a line actually
# naming a base SHA/commit can.
# The token extraction is case-INSENSITIVE to match the line filter above it:
# `git rev-parse` resolves an upper-case hex SHA, so a spec that pastes one
# must not silently drop out of the candidate list and skip the check.
CANDIDATES=$(grep -iE '\bbase\b.{0,20}\b(sha|commit)\b' <<<"$CHECK_TEXT" 2>/dev/null | tr -d '`' | grep -oiE '\b[0-9a-f]{7,40}\b' 2>/dev/null)

BASE_SHA=""
while IFS= read -r TOKEN; do
  [ -n "$TOKEN" ] || continue
  RESOLVED_SHA=$(git -C "$PROJECT_DIR" rev-parse --verify --quiet "${TOKEN}^{commit}" 2>/dev/null)
  if [ -n "$RESOLVED_SHA" ]; then
    BASE_SHA="$RESOLVED_SHA"
    break
  fi
done <<<"$CANDIDATES"

if [ -z "$BASE_SHA" ]; then
  echo "dispatch-spec-ledger-gate: no resolvable base SHA in the spec text — skipping the base-SHA check" >&2
  exit 0
fi

[ "$BASE_SHA" = "$HEAD_SHA" ] && exit 0

BASE_LINE=$(git -C "$PROJECT_DIR" log -1 --format='%h %s' "$BASE_SHA" 2>/dev/null)
HEAD_LINE=$(git -C "$PROJECT_DIR" log -1 --format='%h %s' "$HEAD_SHA" 2>/dev/null)
BRANCH=$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)

cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH SPEC — base SHA is not the main checkout's HEAD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  spec base:  $BASE_LINE
  HEAD ($BRANCH):  $HEAD_LINE

A worktree is cut from HEAD at spawn time, not from the SHA the spec
names. Dispatching from a different branch therefore hands the worker a
VALID but WRONG base — and its step-0 self-heal cannot see the
difference, because the spec's SHA resolves and the tree looks clean.

Fix: park the main checkout on the branch whose HEAD is the base before
the Agent call, or correct the spec's base line to the SHA the worktree
will actually be cut from.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
