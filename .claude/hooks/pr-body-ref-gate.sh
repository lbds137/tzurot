#!/bin/bash
# PreToolUse hook (matcher: Bash) — two rules over a PR-body write.
#
# RULE 1 (unresolved tracker reference): blocks a PR-body write whose body
# claims a tracker reference ("filed as TASK-123", "closes doc-45") that does
# not resolve on origin/develop.
#
# A PR body claiming a follow-up was "filed as TASK-N" over a task that was
# never committed is a false claim to every reader of that PR — `git
# ls-files`/`existsSync` cannot see an uncommitted tracker file from the PR's
# vantage point, and neither can the reviewer, another checkout, or the next
# session. `/tzurot-git-workflow` § "Before writing a closing reference"
# already prescribes the `git ls-tree` verification check in prose; it was
# skipped, so the correction moves to a deterministic trigger
# (00-critical.md § Fix Recurring Failures Structurally).
#
# RULE 2 (claim-shaped body line): blocks — once per body text per UTC day —
# a PR-body write whose body carries a claim-shaped line
# (certainty/provenance/counted-noun vocabulary, or an uncited
# "verified"/"every caller"/closing reference) with no cite and no hedge. The
# shared vocabulary lives in the claim-shapes lib under this directory's lib/
# subfolder, sourced by this hook AND by pr-merge-review-check.sh — a change
# to that file changes both scans, and each hook's own probe is the test for
# its half (02-code-standards.md § "A Comment That Asserts Behavior Is a
# Claim"). Rule 1 runs first and is a hard block (no ack, no retry-through);
# rule 2 runs only once rule 1 has not blocked, and acks per
# body-text-SHA-256-plus-UTC-date so an unchanged retry proceeds within the
# same day while a genuinely edited body — or the same body on a later day —
# is rescanned.
#
# Known false positive: rule 1 (only) scans the WHOLE Bash command string
# rather than a precisely-parsed body argument (see the KNOWN GAPS note
# below on why). A heredoc that merely CONTAINS the text for creating a PR
# therefore fires rule 1 too — deliberate, not widened. Rule 2 scans only
# the parsed PR body text (see extract_pr_body), never the command string,
# so a claim-shaped word sitting in --title or elsewhere in the command does
# not reach it.
#
# Scope: `gh pr create`, `gh pr edit`, `pnpm ops gh:pr-edit`, and a
# `gh api -X PATCH .../pulls/N -F body=@file` (or `-f body=<text>`)
# invocation, each when carrying `--body`, `--body-file`, or a
# `-f/-F/--field body=` argument. Rule 1's
# claim-verb spans ("filed as", "tracked in", "closes", "completes",
# "finishes") followed by a TASK-N or doc-N id are checked — a bare mention
# ("see TASK-99999 for background") makes no claim and is deliberately left
# alone.
#
# Fail-open throughout: a missing origin/develop ref, a git error, an empty
# tracker/ listing, or an unsupported grep dialect all pass the command
# through rather than block it. A broken gate must never block a real PR.
# An unreadable --body-file is the one degraded case rather than a pass: the
# file's content is dropped from BODY_TEXT, rule 1's command-text scan still
# covers the rest of the command, and extract_pr_body's inline-value
# attempts still run for rule 2 (so an inline --body in the same command is
# still found even when a --body-file elsewhere is unreadable).
#
# KNOWN GAPS:
#   - gh's SHORT flag `-b` is not matched (`-f`/`-F body=` are). The repo's own commands
#     write the long flags (`--body`, `--body-file`), and the cheap `--body`
#     pre-filter below is what keeps this hook off the critical path of
#     every Bash call — widening it to short flags would cost every non-PR
#     command a slower pre-filter for a shape this repo doesn't produce.
#     `-f`/`--raw-field` carries a literal string, so `-f body=@x` is scanned
#     as the text `@x`; `-F`/`--field body=@x` reads the file at that path.
#   - Rule 1's scan covers the WHOLE command text, not a precisely-parsed
#     --body argument, so that the `--body "$(cat <<'EOF' … EOF)"` heredoc
#     form — the dominant shape in this repo — is covered without a shell
#     tokenizer. A reference sitting in `--title` is therefore also caught
#     by rule 1; that is a claim too, so it's deliberate rather than an
#     over-block to apologize for. Rule 2 does NOT share this gap — it never
#     sees the command text at all, only extract_pr_body's parsed output.
#   - A QUOTED --body-file path (`--body-file "$F"`) is not extracted — the
#     path matcher stops at the quote, so the FILE's content goes unscanned
#     (fail-open direction, same family as the short-flag gap). Rule 1's
#     command-text scan still covers the rest of the command; an inline
#     `--body` in the same command is separately picked up by
#     extract_pr_body's own inline-value parsing, so rule 2 still sees it.
#   - A whole-token QUOTED `-F body="@path"` is not recognized as a file
#     reference — the `@` matcher stops at the quote — so the literal text
#     `@path` is what gets scanned rather than the file's content (fail-open
#     direction, same family as the quoted --body-file gap above). This
#     repo's own commands never quote the whole `-F body=@path` token, so the
#     gap is documented rather than closed.
#   - A whole-token QUOTED field argument (`-f "body=…"`, and the same for
#     `-F` and `--field`) is not scanned by EITHER rule. The required-flag
#     check below matches `body=` only where it directly follows the flag's
#     whitespace; a leading quote sits there instead, so the check rejects
#     and the hook exits 0 before rule 1 or rule 2 runs. Pre-filter #1's
#     `body=` glob still admits the command — the flag check is what turns it
#     away. The miss has a SECOND layer behind that one: extract_pr_body's
#     inline-value patterns anchor on `body="` after the flag's whitespace
#     too, so widening only the flag check leaves BODY_TEXT empty and rule 2
#     with nothing to scan. Both were mutated to make the probe case below go
#     red, which is how the second layer was found. Probe: "whole-token-quoted
#     -f \"body=…\" is a documented fail-open miss", against the inline
#     `-f body="…"` control case immediately above it, which varies only where
#     the quote sits. This repo's own commands never write the whole-token
#     quoted form, so this is documented rather than closed, same fail-open
#     family as the two quoted-token bullets above.
#   - A PR body edited through the ISSUES endpoint (`gh api -X PATCH
#     .../issues/N -F body=…`, which GitHub accepts for a PR) is not
#     scanned: the PATCH shape is recognized by `pulls/N` only. This repo's
#     conventions never edit a PR body that way.
#   - A PR number carried in a SHELL VARIABLE (`gh api -X PATCH
#     .../pulls/$N -f body=…`) is not scanned by either rule. The
#     IS_PATCH_PR_API check below anchors on `pulls/[0-9]+` against the raw
#     command text, which the hook never expands, so `pulls/$N` fails the
#     digit anchor, the PATCH family is not recognized, and a scripted
#     PR-body edit passes through unscanned (fail-open direction). Probe:
#     "shell-variable PR number is a documented fail-open miss", against the
#     same inline `-f body="…"` control case, which varies only the PR number
#     from a literal to `$N`. This repo edits PR bodies through `pnpm ops
#     gh:pr-edit`, which is matched by name and needs no `pulls/N` at all.
#   - A RELATIVE --body-file path resolves against this hook's own cwd (the
#     repo root, per the settings.json wrapper), not the wrapped command's
#     cwd — `cd sub/dir && gh pr create --body-file ./x.md` therefore fails
#     the readability check, and only that FILE's content is lost; rule 1's
#     command text scan and extract_pr_body's inline-value attempts both
#     still run.
#   - `gh pr create --fill` sources the body from commit messages with no
#     --body flag at all, so the pre-filter passes it through unscanned.
#     Closing it would mean reconstructing the body from git log (or
#     blocking a legitimate flag); this repo's conventions never use --fill,
#     so the gap is documented rather than closed.
#   - CLAIM_CITE_EXEMPT_REGEX's backticked-span cite is broad on purpose: an
#     incidental backticked value containing a colon — a timestamp like
#     `4:30pm`, a ratio — sitting beside an uncited count on the same line
#     exempts that whole line, even though the backticked value cites
#     nothing. This is deliberate under-blocking: a retriable soft gate must
#     never over-block, and a false negative here costs nothing the reviewer
#     can't still catch, while a false positive costs a retry on every write.
#     Tighten only if false negatives show up in practice.
#   - Under an Acceptance heading, the closing-reference exemption is
#     LINE-scoped: the whole `closes TASK-N` line is exempt, including any
#     unrelated claim that happens to share that line. This is deliberate
#     under-blocking in the same direction as the backticked-span cite bullet
#     above — a retriable soft gate must never over-block. Narrow the
#     exemption to just the closing clause only if false negatives show up in
#     practice.
#   - A backticked command outside CLAIM_CITE_EXEMPT_REGEX's command
#     alternative, carrying no `/` or `:` of its own, does not count as a
#     cite. That alternative is the repo's tooling vocabulary and grows on
#     demand — the cost of a miss is one retry.
#   - Rule 2's BLOCK — not its scan — fails open when `sha256sum` is missing
#     or yields an empty hash. The guard sits downstream of the
#     `flagged_count -eq 0` early return, so the scan has already run and
#     collected its flagged lines; what cannot be computed is the ack key
#     that scopes a block to one body text, and a shared empty key would ack
#     every body for the rest of the UTC day. Losing one write's worth of
#     blocking beats acking the whole day. Probe: "claim scan fails open when
#     sha256sum yields an empty hash" — that case covers the empty-hash half;
#     the missing-binary half is out of reach of the probe's PATH-PREPEND
#     technique, since a prepended directory cannot hide a binary from
#     `command -v` (replacing PATH outright could reach it). Both halves take
#     the same return, so the coverage is unaffected.
#
# Fixture check: run .claude/hooks/pr-body-ref-gate.probe.sh after ANY edit.

set -uo pipefail

# A missing lib must fail OPEN, explicitly: without the guard the unbound
# regex would die inside a pipeline subshell and the scan would silently
# match nothing, which is the same outcome with a stderr trace attached.
source "$(dirname "${BASH_SOURCE[0]}")/lib/claim-shapes.sh" || exit 0

INPUT=$(cat)

# Raw pre-filter #1, before any jq fork — same reasoning as the sibling
# lossy-pipe-guard.sh: this runs on every Bash call, so the cheapest possible
# reject dominates. CLI flags have no case variance, so a case-sensitive glob
# here is not a hole (unlike the nocasematch situation lossy-pipe-guard has
# to account for with `git commit`/`gh pr` prose). `body=` widens this to the
# `gh api -F body=@file` / `-f body=<text>` PATCH shape, which never writes
# literal `--body`.
case "$INPUT" in
  *"--body"* | *"body="*) ;;
  *) exit 0 ;;
esac

# Raw pre-filter #2: narrow to the PR-write command families before paying
# for jq. The PATCH shape always carries the literal `gh api`, so the cheap
# glob narrows on that; the later three-way `gh api` / `-X|--method PATCH` /
# `pulls/N` check below is what does the real narrowing.
case "$INPUT" in
  *"pr create"* | *"pr edit"* | *"gh:pr-edit"* | *"gh api"*) ;;
  *) exit 0 ;;
esac

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" != "Bash" ] && exit 0

CMD=$(jq -r '.tool_input.command // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$CMD" ] && exit 0

# Command-family check on the decoded command, case-insensitively. The `gh …`
# alternative allows global flags between `gh` and `pr`, mirroring
# lossy-pipe-guard's reasoning about adjacency-only spellings missing
# `gh --repo owner/name pr create`. The PATCH alternative is checked as three
# ANDed greps (gh api / -X|--method PATCH / pulls/N) rather than one regex,
# so the PATCH and path tokens can appear in either order in the command.
IS_PATCH_PR_API=0
if printf '%s' "$CMD" | grep -qiE 'gh[[:space:]]+api' &&
  printf '%s' "$CMD" | grep -qiE -- '(-X|--method)[[:space:]=]*PATCH' &&
  printf '%s' "$CMD" | grep -qiE 'pulls/[0-9]+'; then
  IS_PATCH_PR_API=1
fi
if ! printf '%s' "$CMD" | grep -qiE '(gh([[:space:]]+[^[:space:]]+)*[[:space:]]+pr[[:space:]]+(create|edit))|(ops[[:space:]]+gh:pr-edit)' &&
  [ "$IS_PATCH_PR_API" -ne 1 ]; then
  exit 0
fi

# Require --body/--body-file, or (for the PATCH form) a -f/-F/--field body=
# argument, on the decoded command.
if ! printf '%s' "$CMD" | grep -qE -- '--body(-file)?\b|(-f|-F|--field)[[:space:]]+body='; then
  exit 0
fi

# extract_pr_body: the SINGLE parser for "what is the PR body text", used by
# BOTH rules — rule 1 folds its output into SCAN_TEXT alongside the command
# text (unchanged from before this split); rule 2 scans ONLY this output,
# never the command text, so a claim-shaped word sitting in --title or
# elsewhere in the command cannot reach rule 2. Tries each supported flag
# shape in order of preference and sets the global BODY_TEXT. Signals a
# `grep -oP` dialect failure by RETURNING 3 rather than calling `exit`
# directly — `exit` inside a function invoked via command substitution would
# only kill a subshell, not the hook — and the caller turns a 3 into a
# top-level `exit 0`.
#
# Fail-open here means "extract what we can", NOT "abandon the check": an
# unreadable --body-file path or a quote-parsing miss on an inline value
# yields no text from THAT source and falls through to the next candidate
# source, rather than aborting the whole extraction. Probe: "prose
# --body-file mention still scans inline body" — rule 1's command-text half
# still catches that case regardless of what this function extracts.
#
# Known limitation: the inline-value patterns below do not handle an
# escaped quote embedded in the value (`--body "she said \"hi\""`) — the
# regex stops at the first literal quote character, the same imprecision as
# any non-tokenizing shell scan of --body text.
extract_pr_body() {
  BODY_TEXT=""
  BODY_FROM_FILE=0
  local body_file rc body resolved

  # --body-file <path> / --body-file=<path>
  body_file=$(printf '%s' "$CMD" | grep -oP -- '--body-file[= ]+\K[^\s'"'"'"]+')
  rc=$?
  if [ "$rc" -gt 1 ]; then
    return 3
  fi
  # -F body=@<path> / --field body=@<path> (the PATCH form's file shape).
  # `-f`/`--raw-field` sends its value as a LITERAL STRING (gh api --help:
  # "-f, --raw-field key=value  Add a string parameter in key=value format"),
  # so `-f body=@x` is inline text rather than a file reference — that shape
  # is handled by the inline ladder below, never here.
  if [ -z "$body_file" ]; then
    body_file=$(printf '%s' "$CMD" | grep -oP -- '(-F|--field)[[:space:]]+body=@\K[^\s'"'"'"]+')
    rc=$?
    if [ "$rc" -gt 1 ]; then
      return 3
    fi
  fi
  if [ -n "$body_file" ]; then
    case "$body_file" in
      /*) resolved="$body_file" ;;
      *) resolved="$PWD/$body_file" ;;
    esac
    if [ -r "$resolved" ]; then
      BODY_TEXT=$(cat "$resolved" 2>/dev/null)
      BODY_FROM_FILE=1
      return 0
    fi
    # Unreadable path: fall through to the inline forms below rather than
    # stopping — an unreadable --body-file could coexist with an inline
    # --body in the same command.
  fi

  # Inline forms, most-specific (quoted) first so a quoted value's own
  # spaces aren't truncated by the bare-value pattern below.
  body=$(printf '%s' "$CMD" | grep -oP -- '--body="\K[^"]*' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- "--body='\K[^']*" | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- '--body[[:space:]]+"\K[^"]*' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- "--body[[:space:]]+'\K[^']*" | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- '--body=\K[^[:space:]]+' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- '--body[[:space:]]+\K[^[:space:]"'"'"']\S*' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi

  # -f body=<text> / -F body=<text> / --field body=<text> — inline string
  # field on the PATCH form. `-f`/`--raw-field` always sends a literal
  # string. `-F`/`--field` sends a literal string too UNLESS the value
  # starts with `@`, in which case gh reads it as a file path — that shape
  # is handled above, before this ladder, so a `-F body=@path` command never
  # reaches here. Quoted forms come first so a quoted value's own spaces
  # survive.
  body=$(printf '%s' "$CMD" | grep -oP -- '(-f|-F|--field)[[:space:]]+body="\K[^"]*' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- "(-f|-F|--field)[[:space:]]+body='\K[^']*" | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi
  body=$(printf '%s' "$CMD" | grep -oP -- '(-f|-F|--field)[[:space:]]+body=\K\S+' | head -n1)
  if [ -n "$body" ]; then BODY_TEXT="$body"; return 0; fi

  return 0
}

extract_pr_body
EXTRACT_RC=$?
if [ "$EXTRACT_RC" -eq 3 ]; then
  exit 0
fi

SCAN_TEXT="$CMD"
# An INLINE body is already present verbatim in the command text, so
# appending the extracted copy would scan it twice; only a body read from a
# FILE adds text the command string does not already carry.
if [ "$BODY_FROM_FILE" -eq 1 ] && [ -n "$BODY_TEXT" ]; then
  SCAN_TEXT="$SCAN_TEXT
$BODY_TEXT"
fi

# Rule 1 (unresolved tracker reference), wrapped as a function so rule 2 can
# run whenever rule 1 does NOT block — including every fail-open path below
# (no ids found, no origin/develop, empty listings) — rather than only on the
# narrow all-refs-resolved path. Returns 2 (and prints the block) or 0.
run_ref_check() {
# Claim-verb spans only — a bare mention makes no claim. Intervening tokens
# are restricted to horizontal whitespace ON PURPOSE: the pattern must not
# span a newline, which keeps this conservative (a claim verb on one line and
# an unrelated id on a later line never matches).
#
# Both alternations carry a negative lookbehind so a longer word ending in a
# verb or an id does not match: `(?<![A-Za-z])` keeps `discloses`/`encloses`
# from matching the `closes` verb, and `(?<![A-Za-z-])` keeps `SUBTASK-100`
# and `asciidoc-12` from matching an id. The `-` in the id class is what
# rejects a hyphenated prefix token (`SUB-TASK-100`). The id lookbehind sits
# AFTER the `[\x60*_(\[]*` wrapper class, so a backticked or bracketed id
# still matches — the wrapper char, not a letter, is what precedes the id.
# grep runs this with -i; probed, the lookbehinds are not widened by it.
#
# The trailing `(…)*` chain picks up a comma/`and`-separated RUN of ids after
# one verb. Without it the `{0,3}` window capped a span at ~4 ids and the
# fifth was never extracted — a fail-open under-check. The chain uses only
# horizontal whitespace, preserving the no-newline invariant above.
# The optional `:?` after the verb covers GitHub's `Closes: TASK-N` colon
# convention — probed unmatched without it.
# Probes: "discloses", "SUBTASK", backticked-id, five-chained-ids, and
# colon-after-verb cases.
REF_PATTERN='(?<![A-Za-z])(filed as|tracked in|closes|completes|finishes):?([ \t]+[^ \t]+){0,3}[ \t]+[\x60*_(\[]*(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+)([\x60*_)\]]*[ \t]*[,;]?[ \t]*(and[ \t]+)?[\x60*_(\[]*(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+))*'
REF_SPANS=$(printf '%s' "$SCAN_TEXT" | grep -oPi "$REF_PATTERN")
RC=$?
if [ "$RC" -gt 1 ]; then
  return 0
fi
if [ "$RC" -eq 1 ]; then
  return 0
fi

IDS=$(printf '%s\n' "$REF_SPANS" | grep -oPi '(?<![A-Za-z-])(TASK-[0-9]+|doc-[0-9]+)' | tr 'A-Z' 'a-z' | sort -u)
# `set -o pipefail` (top of file) is what makes this RC carry a mid-pipeline
# grep failure rather than sort's status — probed: a PCRE error propagates
# as 2 through tr|sort under pipefail. Removing pipefail would silently turn
# this into a sort-only check; the [ -z "$IDS" ] below is the backstop.
RC=$?
if [ "$RC" -gt 1 ]; then
  return 0
fi
[ -z "$IDS" ] && return 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || return 0
git -C "$ROOT" rev-parse --verify --quiet origin/develop >/dev/null 2>&1 || return 0

TASK_LIST=$(git -C "$ROOT" ls-tree -r --name-only origin/develop -- tracker/tasks/ tracker/archive/tasks/ 2>/dev/null) || return 0
DOC_LIST=$(git -C "$ROOT" ls-tree -r --name-only origin/develop -- tracker/docs/ tracker/archive/docs/ 2>/dev/null) || return 0

# Empty listing fail-open, per-kind: an empty listing is an infrastructure
# signal (no tracker dir on that ref, a shallow clone), never evidence that a
# specific id is missing. Ids of an empty-listing kind are SKIPPED rather than
# the whole check abandoned, so the other kind still resolves against its own
# populated listing.
MISSING=""
while IFS= read -r id; do
  [ -z "$id" ] && continue
  case "$id" in
    task-*)
      [ -z "$TASK_LIST" ] && continue
      printf '%s\n' "$TASK_LIST" | grep -qiF -- "/${id} " && continue
      ;;
    doc-*)
      [ -z "$DOC_LIST" ] && continue
      printf '%s\n' "$DOC_LIST" | grep -qiF -- "/${id} " && continue
      ;;
    *)
      continue
      ;;
  esac
  MISSING="$MISSING$id
"
done <<<"$IDS"

[ -z "$MISSING" ] && return 0

{
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "PR BODY REF GATE — unresolved tracker reference(s)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "This PR body claims one or more tracker references that do not"
  echo "resolve on origin/develop:"
  printf '%s' "$MISSING"
  echo
  echo "These do not resolve on origin/develop. A tracker file that exists"
  echo "only in the working tree does not exist from the reviewer's"
  echo "vantage point — not \`git log\`, not another checkout, not the next"
  echo "session."
  echo
  echo "Verify (one command per unresolved id):"
  while IFS= read -r miss; do
    [ -z "$miss" ] && continue
    case "$miss" in
      task-*) VERIFY_DIR="tracker/tasks/" ;;
      *) VERIFY_DIR="tracker/docs/" ;;
    esac
    printf '  git ls-tree -r --name-only origin/develop -- %s | grep %s\n' "$VERIFY_DIR" "$miss"
  done <<<"$MISSING"
  echo
  echo "Fix: commit and push the tracker file to develop first, or correct"
  echo "the reference."
  echo
  echo "Per /tzurot-git-workflow § \"Before writing a closing reference\"."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
} >&2
return 2
}

# Drops lines inside triple-backtick / `~~~` fences, printing everything
# else through unchanged. Shared by both passes below so the fence
# toggle-state machine exists exactly once — a fence-opening/closing line
# itself toggles the state and is dropped, never printed.
strip_fenced_lines() {
  local fence_open=0
  local fence_line
  # `|| [ -n "$fence_line" ]` keeps a final line with no trailing newline —
  # BODY_TEXT is piped in via `printf '%s'`, not a here-string, so it lacks
  # the newline `<<<` would otherwise append; without this, `read` fails on
  # that last partial line and the loop body never runs for it, silently
  # dropping a single-line (or last-line) body.
  while IFS= read -r fence_line || [ -n "$fence_line" ]; do
    # A fence indented under a list item still toggles the fence state, so
    # the leading-whitespace-stripped line — not the raw line — is what gets
    # matched against the fence markers.
    local stripped
    stripped=${fence_line#"${fence_line%%[![:space:]]*}"}
    case "$stripped" in
      '```'* | '~~~'*)
        if [ "$fence_open" -eq 0 ]; then fence_open=1; else fence_open=0; fi
        continue
        ;;
    esac
    [ "$fence_open" -eq 1 ] && continue
    printf '%s\n' "$fence_line"
  done
}

# Rule 2 (claim-shaped body line, blocked once per body text per UTC day). Runs over
# BODY_TEXT — extract_pr_body's parsed PR-body output — ONLY, never the raw
# command text SCAN_TEXT carries for rule 1. A command with no body at all
# (BODY_TEXT empty) makes this a no-op.
run_claim_scan() {
  [ -z "$BODY_TEXT" ] && return 0

  # Unfenced text computed ONCE and shared by both passes below — the
  # Acceptance-heading detector and the main scan loop must agree on which
  # lines are "real" body text vs. example prose inside a fenced block.
  local unfenced
  unfenced=$(printf '%s' "$BODY_TEXT" | strip_fenced_lines)

  # Acceptance-heading detector: a heading found INSIDE a fenced code block is
  # example prose, not a real Acceptance section, so it runs over the
  # already-unfenced text. A single pass over the whole body (rather than
  # folding this into the main scan loop below) is required so the narrowing
  # sees the FINAL value — a real Acceptance heading appearing AFTER the
  # closing `Closes TASK-N` line must still count. Case-insensitive so a
  # lowercase `## acceptance` heading counts the same as `## Acceptance`.
  local has_acceptance=0
  if printf '%s' "$unfenced" | grep -qiE '^[[:space:]]*##+[[:space:]]*Acceptance'; then
    has_acceptance=1
  fi

  local flagged_count=0
  local flagged_lines=""
  local line
  while IFS= read -r line; do
    if printf '%s' "$line" | grep -qE '^[[:space:]]*>'; then continue; fi
    # A heading is a section label, not a claim — "## Verified, and how"
    # names what the section covers rather than asserting something is true.
    if printf '%s' "$line" | grep -qE '^[[:space:]]*#{1,6}[[:space:]]'; then
      continue
    fi

    if ! printf '%s' "$line" | grep -qiE "$CLAIM_SHAPE_CORE_REGEX|$CLAIM_SHAPE_PR_BODY_EXTRA_REGEX"; then
      continue
    fi
    if printf '%s' "$line" | grep -qiE "$CLAIM_CITE_EXEMPT_REGEX"; then
      continue
    fi
    # Closing-reference narrowing: a bare `closes TASK-N`/`closes doc-N`
    # line is exempt once the body carries an Acceptance heading — the
    # heading is the cite for a closing reference's own claim (the item is
    # actually done).
    if [ "$has_acceptance" -eq 1 ] && printf '%s' "$line" | grep -qiE '\bcloses?:? (TASK|doc)-[0-9]+'; then
      continue
    fi

    flagged_count=$((flagged_count + 1))
    if [ "$flagged_count" -le 20 ]; then
      flagged_lines="$flagged_lines$line
"
    fi
  done <<<"$unfenced"

  [ "$flagged_count" -eq 0 ] && return 0

  # Block once per body TEXT PER UTC DAY (not per PR, not forever) — an
  # unchanged retry proceeds within the same day; a body edited to fix the
  # flagged lines is a new key and is scanned again; the day boundary bounds
  # how long a stale ack can silently suppress a re-scan. Same date-scoped-key
  # shape as dispatch-posture-gate.sh's ACK_KEY, and the same
  # write-key-then-exit mechanism (fail-open on an unwritable ack file, since
  # blocking on retry would infinite-loop).
  # No sha256sum means no ack key to scope the block to THIS body text; a
  # shared empty key would ack every body for the rest of the UTC day, so
  # fail open instead of computing a degraded key. Note what is lost: this
  # guard is downstream of the `flagged_count -eq 0` return above, so the
  # scan itself has already run and flagged its lines — only the BLOCK is
  # given up here, for this one write.
  command -v sha256sum >/dev/null 2>&1 || return 0
  local body_hash
  body_hash=$(printf '%s' "$BODY_TEXT" | sha256sum | cut -d' ' -f1)
  # Same reasoning as the availability check above: an empty hash is as
  # unusable as a missing binary for scoping the ack key.
  [ -z "$body_hash" ] && return 0
  local ack_key
  ack_key="$(date -u +%F):${body_hash}"
  local ack_file="${PR_BODY_CLAIM_ACK_FILE:-/tmp/.claude_pr_body_claim_ack.$(id -u)}"

  if [ -f "$ack_file" ] && grep -qxF "$ack_key" "$ack_file" 2>/dev/null; then
    return 0
  fi

  if ! printf '%s\n' "$ack_key" >>"$ack_file" 2>/dev/null; then
    echo "pr-body-ref-gate (claim scan): could not write ack file $ack_file — failing open" >&2
    return 0
  fi
  chmod 600 "$ack_file" 2>/dev/null || true

  {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "PR BODY CLAIM-SHAPE GATE — uncited/unhedged claim line(s)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    if [ "$flagged_count" -gt 20 ]; then
      printf 'This PR body carries %s claim-shaped line(s), showing the first 20:\n\n' "$flagged_count"
    else
      printf 'This PR body carries %s claim-shaped line(s):\n\n' "$flagged_count"
    fi
    printf '%s' "$flagged_lines"
    if [ "$flagged_count" -gt 20 ]; then
      printf '+%s more\n' "$((flagged_count - 20))"
    fi
    echo
    echo "Verify each line with a command or a file:line cite on the same"
    echo "line, or hedge it in place (\"unverified\", \"not verified\")."
    echo "A retry proceeds once this body's text is unchanged, within the"
    echo "same UTC day."
    echo
    echo "Per .claude/rules/02-code-standards.md § \"A Comment That Asserts"
    echo "Behavior Is a Claim\" and /tzurot-git-workflow § \"Before writing a"
    echo "closing reference in the PR body\"."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  } >&2
  return 2
}

run_ref_check
REF_RC=$?
if [ "$REF_RC" -eq 2 ]; then
  exit 2
fi

run_claim_scan
CLAIM_RC=$?
if [ "$CLAIM_RC" -eq 2 ]; then
  exit 2
fi

exit 0
