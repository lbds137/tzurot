#!/bin/bash
# Fixture check for the temporal-marker block of `.husky/pre-commit` — run
# after ANY edit to that block. It replaces the smoke list that used to live
# as an embedded shell COMMENT in the hook, which a human was expected to
# copy-paste and run; those cases were verified by hand once and never re-run.
#
# WHAT THIS PINS — the two regexes the block decides with, and their AND:
#   1. TEMPORAL_PATTERN, over the catch/ignore cases the hook documents.
#   2. COMMENT_PREFIX, per-language, over real diff-line shapes.
#   3. The composed decision (prefix AND pattern), which is what actually
#      blocks a commit — including the false positive that motivated the
#      per-language split: a TS private field `#count = new Date('202x-…')`
#      is not a comment and must pass.
#
# Both regexes are EXTRACTED from `.husky/pre-commit` rather than copied here.
# A copy would pin the probe's own duplicate and drift silently from the hook
# the moment someone edits one and not the other — which is the failure this
# harness exists to prevent, not to reproduce. The `case` block is extracted
# and eval'd as source text so the python branch's quote-splicing is parsed by
# the same shell that parses it in the hook.
#
# WHAT THIS DOES NOT PIN, deliberately: the rest of `.husky/pre-commit` — the
# generated-file skip, the TZUROT_SKIP_TEMPORAL_CHECK override, the per-file
# loop, and the prisma/codegen/migration/frontmatter blocks. Driving those
# needs the hook to run for real, and the hook's first act is `npx lint-staged`
# followed by codegen — minutes per invocation, against a gate budgeted in
# seconds. The two regexes are where the hand-verified cases lived and where
# the observed regressions have been.
#
# Colocated with the .claude hooks (not in `.husky/`) because husky executes
# only its exact lifecycle filenames — a probe dropped beside the hook would be
# inert AND confusing. `guard:hook-probes` runs it from either directory.
#
# Usage: .claude/hooks/husky-pre-commit.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
HOOK="$REPO_ROOT/.husky/pre-commit"

FAILURES=0

if [ ! -f "$HOOK" ]; then
  printf 'FATAL: %s not found\n' "$HOOK" >&2
  exit 1
fi

# --- extraction ------------------------------------------------------------
# An extraction that silently yields an empty string is the dangerous failure:
# `grep -qEi ""` matches EVERY line, so every catch case would "pass" while the
# hook itself had stopped matching anything. Hard-fail instead of proceeding.

TEMPORAL_PATTERN=$(sed -n "s/^[[:space:]]*TEMPORAL_PATTERN='\(.*\)'$/\1/p" "$HOOK")
if [ -z "$TEMPORAL_PATTERN" ]; then
  printf 'FATAL: could not extract TEMPORAL_PATTERN from %s.\n' "$HOOK" >&2
  printf '       The assignment must stay a single-quoted one-liner:\n' >&2
  printf "         TEMPORAL_PATTERN='...'\n" >&2
  exit 1
fi

CASE_BLOCK=$(sed -n '/^[[:space:]]*case "\$file" in$/,/^[[:space:]]*esac$/p' "$HOOK")
if [ -z "$CASE_BLOCK" ]; then
  printf 'FATAL: could not extract the COMMENT_PREFIX case block from %s.\n' "$HOOK" >&2
  printf '       Expected a `case "$file" in` ... `esac` block.\n' >&2
  exit 1
fi

# prefix_for <filename> — echoes the hook's own COMMENT_PREFIX for that file.
prefix_for() {
  local file="$1" COMMENT_PREFIX=''
  eval "$CASE_BLOCK"
  if [ -z "$COMMENT_PREFIX" ]; then
    printf 'FATAL: case block set no COMMENT_PREFIX for %s\n' "$file" >&2
    exit 1
  fi
  printf '%s' "$COMMENT_PREFIX"
}

# --- assertion helpers -----------------------------------------------------

# pattern_case <catch|ignore> <string>
pattern_case() {
  local want="$1" s="$2" got='ignore'
  echo "$s" | grep -qEi "$TEMPORAL_PATTERN" && got='catch'
  if [ "$got" = "$want" ]; then
    printf 'PASS  (%s)  pattern: %s\n' "$got" "$s"
  else
    printf 'FAIL  (%s, expected %s)  pattern: %s\n' "$got" "$want" "$s"
    FAILURES=$((FAILURES + 1))
  fi
}

# The composed decision, mirroring the hook's pipe order for one diff line.
# composed_case <block|pass> <filename> <diff-line>
composed_case() {
  local want="$1" file="$2" line="$3" got='pass' prefix
  prefix=$(prefix_for "$file")
  printf '%s\n' "$line" \
    | grep -E '^[+]' | grep -v '^[+][+][+]' \
    | grep -E "$prefix" | grep -qEi "$TEMPORAL_PATTERN" && got='block'
  if [ "$got" = "$want" ]; then
    printf 'PASS  (%s)  %s: %s\n' "$got" "$file" "$line"
  else
    printf 'FAIL  (%s, expected %s)  %s: %s\n' "$got" "$want" "$file" "$line"
    FAILURES=$((FAILURES + 1))
  fi
}

# ===========================================================================
# 1. TEMPORAL_PATTERN — the hook's documented catch list
# ===========================================================================
printf '\n--- TEMPORAL_PATTERN: must catch ---\n'
pattern_case catch 'Fixes #42'
pattern_case catch 'bug #1254'
pattern_case catch 'the #1254 drift'
pattern_case catch '(#1254)'
pattern_case catch 'Phase 5b'
pattern_case catch 'Epic Phase 3'
pattern_case catch 'Post-Phase 4'
pattern_case catch 'Phase 6 made X'
pattern_case catch 'round 1 review'
pattern_case catch 'round-1 review'
pattern_case catch 'round-2 claude-review'
# Documented in the rule's own examples but absent from the embedded list.
pattern_case catch 'Added 2026-05-06 to fix data loss'
pattern_case catch 'Surfaced 2026-04-25 by claude-bot'
pattern_case catch 'PR #985 final round review'
pattern_case catch 'GH-1254 regression'
pattern_case catch 'caught in round 3'
# The BARE form, with neither a `#` nor a hyphen. Prose naturally spells a
# rollout position this way ("lands in PR 3") because the number is a slice
# index rather than a link, and that is the shape the rule most wants: a
# position goes stale the moment the plan changes.
pattern_case catch 'see PR 2288'
pattern_case catch 'the PR 3 backfill'

printf '\n--- TEMPORAL_PATTERN: must ignore ---\n'
pattern_case ignore '#FF0000'
pattern_case ignore '#123456'
pattern_case ignore '#123'
pattern_case ignore 'close the door'
pattern_case ignore 'Phase 1 (scan)'
pattern_case ignore 'Phase 2 (flush)'
pattern_case ignore 'round-trip review'
pattern_case ignore 'round-trips through the encoder'
pattern_case ignore 'a rounded-corner review panel'
# The decade scope exists so spec/RFC dates don't trip the hook.
pattern_case ignore 'RFC 3339 (2002-07-15)'
# The bare-`PR` alternative is word-bounded on BOTH sides, and each bound has
# its own case here because only that case can catch it going missing.
# Leading: without it, `-i` lets any word ending in those letters open the
# match (measured — `expr 3` matched). Trailing: without it, the digit run
# stops wherever it likes and a hex-ish token reads as a number (measured —
# `PR 1a2b3c` matched on the leading `1`).
# The plural is a non-match under EITHER bound (`PRs ` holds no `PR ` at all),
# so it pins the alternative's literal space rather than a bound.
pattern_case ignore 'PRs since 2026'
pattern_case ignore 'expr 3 evaluates left to right'
pattern_case ignore 'PR 1a2b3c is a color'

# ===========================================================================
# 2. COMMENT_PREFIX — the per-language split is load-bearing
# ===========================================================================
printf '\n--- COMMENT_PREFIX: per-language selection ---\n'
for probe_file in foo.ts foo.tsx foo.js foo.jsx foo.prisma; do
  got=$(prefix_for "$probe_file")
  if printf '%s' "$got" | grep -q '//'; then
    printf 'PASS  C-style prefix for %s\n' "$probe_file"
  else
    printf 'FAIL  %s got a non-C-style prefix: %s\n' "$probe_file" "$got"
    FAILURES=$((FAILURES + 1))
  fi
done
got=$(prefix_for foo.py)
if printf '%s' "$got" | grep -q '#'; then
  printf 'PASS  hash/docstring prefix for foo.py\n'
else
  printf 'FAIL  foo.py got a non-python prefix: %s\n' "$got"
  FAILURES=$((FAILURES + 1))
fi

# ===========================================================================
# 3. The composed decision — prefix AND pattern, over real diff lines
# ===========================================================================
printf '\n--- composed: TS/JS comment shapes block ---\n'
composed_case block foo.ts '+// Caught in PR #1254'
composed_case block foo.ts '+ * Surfaced 2026-04-25 by claude-bot'
composed_case block foo.ts '+/* fixes #4242 */'
composed_case block foo.ts '+  // Epic Phase 5b introduced this'
composed_case block foo.tsx '+// round-2 claude-review'

printf '\n--- composed: code (not comments) passes ---\n'
# The whole reason the prefix match is per-language: a TS private field looks
# like a python comment. Blocking it would make the hook unusable on any class
# holding a dated private field.
composed_case pass foo.ts "+  #count = new Date('2026-01-01');"
composed_case pass foo.ts "+const cutoff = '2026-01-01';"
# A DOCUMENTED scope boundary, not an oversight: the hook matches full-line
# comments only, because separating an inline comment from a string literal
# needs a real lexer rather than a grep chain. Pinned so that narrowing it is a
# deliberate change and widening it is a visible one.
composed_case pass foo.ts '+doSomething(); // Caught in PR #1254'
# A python-style comment in a TS file must NOT be treated as a comment; this is
# the assertion that fails if the two branches are ever collapsed into one.
composed_case pass foo.ts '+# Surfaced 2026-04-25'

printf '\n--- composed: python comment shapes ---\n'
composed_case block foo.py '+# Surfaced 2026-04-25'
composed_case block foo.py '+"""Fixes #4242."""'
composed_case block foo.py "+'''Caught in round 3.'''"
composed_case pass foo.py "+cutoff = '2026-01-01'"
# The mirror of the TS case above: C-style comment markers are not python
# comments, so a `//`-prefixed line in a .py file is not a comment line.
composed_case pass foo.py '+// Surfaced 2026-04-25'

printf '\n--- composed: comments without markers pass ---\n'
composed_case pass foo.ts '+// close the door behind you'
composed_case pass foo.ts '+ * Phase 1 (scan) walks the tree'
composed_case pass foo.py '+# round-trips through the encoder'

printf '\n--- composed: diff headers are not comment lines ---\n'
# The `grep -v '^[+][+][+]'` stage; a header naming a dated path must not read
# as an added line.
composed_case pass foo.ts '+++ b/src/2026-01-01-migration.ts'

if [ "$FAILURES" -gt 0 ]; then
  printf '\n%d probe(s) FAILED\n' "$FAILURES" >&2
  exit 1
fi
printf '\nAll probes passed\n'
