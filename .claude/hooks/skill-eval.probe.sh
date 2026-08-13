#!/bin/bash
# Fixture check for skill-eval.sh — run after ANY edit to the hook.
#
# skill-eval.sh has no side effects and no exit-code contract (it always
# exits 0, whether or not it matched anything) — the assertions here are
# purely on STDOUT: does the "SKILL CHECK" banner appear, and does it name
# the right skill(s). A probe asserting only exit codes would pass against a
# hook whose regex table had rotted into matching nothing at all.
#
# This hook was previously registered as unprobed (regex miss degrades to "no
# suggestion", never a wrong action). That reasoning covered the hook's
# ACTION but not its regex CORRECTNESS, and the review-response branch's
# regex went through THREE wrong shapes before the current one — each fix
# reopening a different failure from the other side. The full history is in
# skill-eval.sh, above the branch itself, and in section 2 below; it is
# deliberately not restated a third time here, because three copies of a
# count is how they drift apart. A run of wrong fixes is the recurrence this
# probe exists to block.
#
# Every branch in the script gets at least one positive and one negative
# case. The review-response branch gets far more than that — it is the one
# that kept being wrong — covering the false-positive and false-negative
# classes from every prior fix shape plus the two documented known gaps.
# Deliberately no count here: the section grows, and a stale number in a
# header is worse than no number (this line said "15-string sweep" while the
# section held 26 cases).
#
# Usage: .claude/hooks/skill-eval.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/skill-eval.sh"

FAILURES=0

if [ ! -f "$HOOK" ]; then
  printf 'FATAL: %s not found\n' "$HOOK" >&2
  exit 1
fi

STDOUT_FILE=$(mktemp)
STDERR_FILE=$(mktemp)
trap 'rm -f "$STDOUT_FILE" "$STDERR_FILE"' EXIT

# invoke <prompt-text> — builds the {"prompt": ...} payload the hook reads
# and captures stdout for the assertions below.
#
# stderr is CAPTURED, not discarded. `2>/dev/null` here would defeat this
# file's own purpose: a malformed regex makes grep error to stderr, the branch
# condition evaluates false, and the hook prints no banner — indistinguishable
# from a correct miss, so every assert_miss and assert_silent would pass
# against a completely broken hook. Measured, not theorised: an unbalanced
# paren in ADDRESS_BROAD produces 20 failures with the guard below and "All
# probes passed" without it. That is the shape 10-working-posture.md
# § "Lossy steps are for known output shapes" names.
invoke() {
  jq -nc --arg p "$1" '{prompt: $p}' | bash "$HOOK" >"$STDOUT_FILE" 2>"$STDERR_FILE"
}

ok() { printf 'PASS  %s\n' "$1"; }
bad() {
  printf 'FAIL  %s\n' "$1"
  # On a miss-side failure the hook's stderr is usually the whole explanation.
  if [ -s "$STDERR_FILE" ]; then
    printf '      hook stderr: %s\n' "$(tr '\n' ';' <"$STDERR_FILE")"
  fi
  FAILURES=$((FAILURES + 1))
}

# A hook that errored is never a passing case, whatever the banner said.
# Checked on EVERY assertion so a miss-side case cannot pass by crashing.
assert_no_stderr() {
  if [ -s "$STDERR_FILE" ]; then
    bad "$1 — hook wrote to stderr, so this result proves nothing"
    return 1
  fi
  return 0
}

# assert_hit <label> <skill-name> — the banner names this skill.
assert_hit() {
  assert_no_stderr "$1" || return
  if grep -qF "$2" "$STDOUT_FILE"; then ok "$1"; else
    bad "$1 (expected '$2' in: $(tr '\n' ';' <"$STDOUT_FILE"))"
  fi
}

# assert_miss <label> <skill-name> — the banner does NOT name this skill.
# Distinct from assert_silent: some cases assert one skill fires while
# another sibling-sounding one must not, so "no banner at all" is too strong.
assert_miss() {
  assert_no_stderr "$1" || return
  if grep -qF "$2" "$STDOUT_FILE"; then
    bad "$1 (unexpected '$2' in: $(tr '\n' ';' <"$STDOUT_FILE"))"
  else
    ok "$1"
  fi
}

# assert_silent <label> — no banner at all (nothing matched any branch).
assert_silent() {
  assert_no_stderr "$1" || return
  if [ -s "$STDOUT_FILE" ]; then
    bad "$1 (expected no banner, got: $(tr '\n' ';' <"$STDOUT_FILE"))"
  else
    ok "$1"
  fi
}

# ===========================================================================
# 1. Every OTHER branch — one positive + one negative each, so this probe
#    covers the whole script rather than only the review-response regex.
# ===========================================================================
printf '\n--- other skill branches (one positive + one negative each) ---\n'

invoke 'I need to write a new prisma migration for the users table'
assert_hit "db-vector: prisma migration" "tzurot-db-vector"
invoke 'can you rename this variable for clarity'
assert_miss "db-vector: unrelated rename request" "tzurot-db-vector"

invoke 'add a beforeEach to mock the fake timer in this vitest file'
assert_hit "testing: vitest + fake timer" "tzurot-testing"
invoke 'can you rename this variable for clarity'
assert_miss "testing: unrelated rename request" "tzurot-testing"

invoke 'the production service on railway is throwing 500s, check the logs'
assert_hit "deployment: railway + production" "tzurot-deployment"
invoke 'can you rename this variable for clarity'
assert_miss "deployment: unrelated rename request" "tzurot-deployment"

invoke 'go ahead and git commit this and open a pull request'
assert_hit "git-workflow: commit + PR" "tzurot-git-workflow"
invoke 'can you rename this variable for clarity'
assert_miss "git-workflow: unrelated rename request" "tzurot-git-workflow"

invoke "let's wrap up the session, update CURRENT.md"
assert_hit "docs: session wrap-up + CURRENT.md" "tzurot-docs"
invoke 'can you rename this variable for clarity'
assert_miss "docs: unrelated rename request" "tzurot-docs"

invoke 'run a documentation audit to check for stale docs'
assert_hit "doc-audit: documentation audit" "tzurot-doc-audit"
invoke 'can you rename this variable for clarity'
assert_miss "doc-audit: unrelated rename request" "tzurot-doc-audit"

invoke 'this bug keeps happening, the delete button does not show up after creation'
assert_hit "bug-remediation: recurring + delete button" "tzurot-bug-remediation"
invoke 'can you rename this variable for clarity'
assert_miss "bug-remediation: unrelated rename request" "tzurot-bug-remediation"

invoke "don't we already have a helper for this kind of normalization"
assert_hit "reuse-scout: don't we already have" "tzurot-reuse-scout"
invoke 'can you rename this variable for clarity'
assert_miss "reuse-scout: unrelated rename request" "tzurot-reuse-scout"

invoke "let's start a design boulder session for the new subsystem"
assert_hit "design-boulder: design boulder session" "tzurot-design-boulder"
invoke 'can you rename this variable for clarity'
assert_miss "design-boulder: unrelated rename request" "tzurot-design-boulder"

invoke "I'm stuck, can we brainstorm with the council"
assert_hit "council-mcp: stuck + brainstorm + council" "tzurot-council-mcp"
invoke 'can you rename this variable for clarity'
assert_miss "council-mcp: unrelated rename request" "tzurot-council-mcp"

invoke 'run an arch audit to check the boundary rules'
assert_hit "arch-audit: architecture audit" "tzurot-arch-audit"
invoke 'can you rename this variable for clarity'
assert_miss "arch-audit: unrelated rename request" "tzurot-arch-audit"

invoke 'why does this keep recurring, can you mine the session logs'
assert_hit "session-mining: mine the session logs" "tzurot-session-mining"
invoke 'we determined the root file to undermine the session'
assert_miss "session-mining: 'determine'/'undermine' do not false-match \\bmine\\b" "tzurot-session-mining"

invoke 'can you delegate this to a worker agent'
assert_hit "orchestration: delegate to a worker" "tzurot-orchestration"
invoke 'can you rename this variable for clarity'
assert_miss "orchestration: unrelated rename request" "tzurot-orchestration"

invoke 'can you rename this variable for clarity'
assert_silent "a fully unrelated prompt triggers no banner at all"

# ===========================================================================
# 2. Review-response branch — the noun-vs-verb "address" sweep. This is the
#    branch that went through three wrong shapes before the current one:
#    unanchored `address.*(review|finding)`
#    false-matched unrelated clauses; a determiner/quantifier whitelist fixed
#    that but dropped real positives with a noun object between "address" and
#    "review"/"finding" ("address concerns from the review"), because a
#    whitelist can only enumerate what its author thought of; a whole-PROMPT
#    broad-match-minus-exclusion fixed that but let an unrelated noun-sense
#    "address" elsewhere in a multi-topic prompt veto a genuine trigger
#    ("let me address that finding, and also update the persona's mailing
#    address field" — the two matches shared no correlation because both
#    scans ran over the whole prompt independently). The current shape scopes
#    the broad-match/exclusion decision to one CLAUSE (split on `.!?,`) so an
#    unrelated clause can't veto a real one. Deepest coverage here so none of
#    the four failure modes can regress unnoticed: 15 positives (11 original +
#    3 for the intervening-noun-object shape + 1 compound-clause case for the
#    cross-clause veto) and 6 negatives (4 noun-sense "address" cases + 1
#    noun-only compound + 1 widened-modifier-list case).
# ===========================================================================
printf '\n--- review-response: the noun-vs-verb "address" sweep ---\n'

invoke 'please address the review comments'
assert_hit "positive: please address the review comments" "tzurot-review-response"
invoke 'address the finding from the reviewer'
assert_hit "positive: address the finding from the reviewer" "tzurot-review-response"
invoke 'please address these findings'
assert_hit "positive: please address these findings" "tzurot-review-response"
invoke 'address review comments'
assert_hit "positive: address review comments" "tzurot-review-response"
invoke 'addressing the reviewer comments'
assert_hit "positive: addressing the reviewer comments" "tzurot-review-response"
invoke 'let me address that finding'
assert_hit "positive: let me address that finding" "tzurot-review-response"
invoke 'address all the findings'
assert_hit "positive: address all the findings" "tzurot-review-response"
invoke 'address round 2 findings'
assert_hit "positive: address round 2 findings (digits in the gap)" "tzurot-review-response"
invoke 'please address my review comments'
assert_hit "positive: please address my review comments" "tzurot-review-response"
invoke "let's address the outstanding findings"
assert_hit "positive: let's address the outstanding findings" "tzurot-review-response"
invoke 'address each finding individually'
assert_hit "positive: address each finding individually" "tzurot-review-response"

# The three cases that caught the whitelist regression: a noun object
# ("comments", "concerns") sits between "address" and "review", which no
# determiner/quantifier whitelist has room for. These must stay HIT.
invoke 'please address the outstanding comments from review'
assert_hit "positive: please address the outstanding comments from review (intervening noun object)" "tzurot-review-response"
invoke 'address concerns from the review'
assert_hit "positive: address concerns from the review (intervening noun object)" "tzurot-review-response"
invoke 'can you address concerns raised in the review'
assert_hit "positive: can you address concerns raised in the review (intervening noun object)" "tzurot-review-response"

invoke 'update the address field and review the schema'
assert_miss "negative: update the address field and review the schema" "tzurot-review-response"
invoke 'the address book needs a review'
assert_miss "negative: the address book needs a review" "tzurot-review-response"
invoke 'she updated her mailing address before the review'
assert_miss "negative: she updated her mailing address before the review" "tzurot-review-response"
invoke 'the address bar review setting was changed'
assert_miss "negative: the address bar review setting was changed" "tzurot-review-response"

# The cross-clause veto that motivated clause-scoping: a genuine trigger and
# an unrelated noun-sense "address" in the SAME prompt, joined by a comma
# rather than a `.!?`. Splitting on `.!?` alone leaves this as one segment and
# the veto still fires — splitting on `.!?,` is what separates the two topics.
invoke "let me address that finding, and also update the persona's mailing address field to match the schema"
assert_hit "positive: compound clause — genuine trigger must survive an unrelated noun-sense address elsewhere in the prompt" "tzurot-review-response"
invoke 'update the mailing address field, then ship it'
assert_miss "negative: compound clause with ONLY a noun-sense address (no review/finding anywhere) stays silent" "tzurot-review-response"
invoke 'please update your work address before you review the handbook'
assert_miss "negative: widened modifier list catches 'work address' (previously fell through the 19-word list)" "tzurot-review-response"

# KNOWN ACCEPTED LIMITATION, pinned deliberately as a miss so it is visible
# rather than forgotten. Clause-scoping correlates the veto to a clause, not
# to the specific "address" occurrence that matched, so a single clause
# holding BOTH a genuine trigger and an unrelated noun-sense address is still
# vetoed. Asserting the current (wrong) answer documents the gap and makes any
# future fix announce itself by turning this line red — at which point flip it
# to assert_hit. See the KNOWN, ACCEPTED RESIDUAL note in skill-eval.sh.
invoke 'kindly address the review at the office address'
assert_miss "known limitation: same-clause co-occurrence still vetoes a genuine trigger" "tzurot-review-response"

# A noun that merely starts with the same seven letters. NOUN_CONTEXT cannot
# veto this one — its \b after "address" fails against the trailing letters —
# so BROAD's own closed suffix set (es|ed|ing)?\b is the only thing ruling it
# out. A leading \b does NOT: "addressee" begins at a word boundary like any
# other word, which is why the boundary that matters here is the trailing one.
invoke 'let me address that finding; also update my mailing address'
assert_hit "positive: semicolon-joined compound — the veto must not cross the semicolon" "tzurot-review-response"

# Conjunction-joined, no punctuation: tr splits characters, not words, so
# these stay one clause and the veto fires. Pinned as a miss to keep the
# documented gap visible; flip to assert_hit if a real splitter ever lands.
# An incidental period (version/decimal/IP) splits the clause and loses the
# trigger — pinned as a miss so the documented gap stays visible. The same
# string without the decimal hits, which is the proof it is the split and not
# the pattern.
invoke 'please address open issue build v3.2 review needed'
assert_miss "known limitation: an incidental period splits the clause" "tzurot-review-response"
invoke 'please address open issue build v3 review needed'
assert_hit "control: same phrasing without the decimal still fires" "tzurot-review-response"

invoke 'let me address that finding and also update my mailing address'
assert_miss "known limitation: conjunction-joined clauses are not split" "tzurot-review-response"

invoke 'the addressee reviewed the letter before sending'
assert_miss "negative: addressee is not an inflection of the verb, so BROAD's suffix anchor rejects it" "tzurot-review-response"

# The other alternatives in the same branch stay covered too — a future edit
# collapsing them into the address(...) whitelist should not go unnoticed.
invoke 'apply the review feedback from claude-review'
assert_hit "positive: review feedback + claude-review (other alternatives)" "tzurot-review-response"
invoke 'hey claude, review the auth flow'
assert_miss "negative: claude.?review requires adjacency, not just both words present" "tzurot-review-response"
invoke "let's review the backlog"
assert_miss "negative: bare 'review X' without a feedback noun does not match" "tzurot-review-response"

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
