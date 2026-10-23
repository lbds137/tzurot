#!/bin/bash
# .husky/pre-commit step: when the staged diff removes a declaration-shaped
# identifier (export/default/async-qualified function, bare function,
# generator `function*`, const =, type = (generic parameters allowed),
# interface, class — default/abstract included) WITHOUT re-declaring it on
# a + line, grep the worktree for that identifier surviving in comment
# lines or *.md files and print each hit as `file:line: identifier`.
# Known shape gaps (stated as gaps, not TODOs): enum/const enum, let/var,
# declare function/declare class, typed consts (const x: Foo = …), and
# nested generic parameters (type Foo<T extends Record<string, unknown>> =
# — the (<[^=<>]*>)? group cannot nest).
# "Removed" means removed MINUS re-added: a modified declaration is a -/+
# pair and cancels, so signature edits, const value edits and cross-file
# moves are no-ops while true deletions and renames sweep. The compiler
# catches surviving CODE references; nothing catches surviving PROSE
# (10-working-posture.md § A changed premise sweeps its prose — this hook
# makes it mechanical).
#
# Removed lines from EVERY file type feed the shapes (a deleted .md line
# that reads like a declaration counts); binary files are skipped by the
# grep's -I.
#
# Precision trades, stated (a guard whose output is mostly false positives
# trains the reader to skim past the true ones):
# - Only a trimmed-line comment START counts (`//`, `*`, `/*`, `#`). An
#   inline trailing comment (`legacyFn(); // does X`) does NOT — detecting
#   it needs parser-level comment extraction this hook refuses to hand-roll.
# - Identifiers shorter than 4 chars are skipped (loop vars: fn, res, ctx),
#   and a stop-word list of common-word names is skipped (this that
#   data item node config options params result value). The list is a
#   false-positive trade, not a vocabulary claim; it lives in ONE place
#   below and is pinned by the probe.
# - The search is `git grep --untracked`: tracked plus untracked-but-
#   not-ignored files. Gitignored prose (docs/local/) and build output
#   (dist/) are never searched. The grep runs with -c core.quotepath=false
#   (as the diff calls do) so a non-ASCII path prints raw. Hits are parsed
#   as `path:line:content` on the first two colons, so a path containing a
#   colon would mis-attribute — declined (a -z re-parse is complexity out
#   of proportion): this repo's naming is space-free and colon-free.
# - No diff-file exclusion: a name re-declared on a + side is already
#   cancelled by the -/+ subtraction before any grep, and `git grep` reads
#   the worktree, where the removed lines no longer exist — so excluding
#   the diff's own files could only suppress TRUE removals' surviving
#   mentions inside staged files, exactly the hits this hook exists to
#   print (probe case (ab) pins this).
# - Excluded surfaces, with the reason stated: .claude/hooks/ and .husky/
#   (wiring, not prose); tracker/ and backlog/ (task and doc bodies
#   legitimately NARRATE removed mechanisms — event records, not
#   invariants; their drift guards are backlog lint + the digest);
#   CHANGELOG* and .md under docs/incidents/ (event records too). The REST
#   of .claude/ — rules, skills — stays in scope: always-loaded invariant
#   prose is exactly what goes stale silently. Plus this hook's own source.
# - More than 40 identifiers SURVIVING the length+stop-word filter prints
#   one summary line and exits: a big refactor should not turn the commit
#   banner into a flood (the cap counts the sweep list, not raw removals).
#   A second cap bounds the banner itself: more than 40 surviving mention
#   LINES print the first 40 plus one overflow line, never the full flood.
#
# Advisory only: never blocks, always exits 0, and every git/sed/awk failure
# fails open (empty result = silence, the same direction as claim-shape-guard).
#
# Fixture check: run .claude/hooks/removed-identifier-sweep.probe.sh after
# ANY edit.

set -uo pipefail

# Follow the repo the hook actually runs in: `git rev-parse --show-toplevel`
# resolves to the root of the worktree the commit is made in — including a
# LINKED worktree, where the session's CLAUDE_PROJECT_DIR may still point at
# the MAIN tree (husky inherits the caller's environment, and the wrong tree
# would be swept). CLAUDE_PROJECT_DIR survives only as the fallback for runs
# outside any repo; the probe harness cd's into its throwaway repo first, so
# it never takes this fallback either.
REPO=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -n "$REPO" ]; then
    cd "$REPO" 2>/dev/null || exit 0
else
    cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
fi

# The declaration shapes as one sed program, shared by both sides of the
# diff so a new shape lands on removed and added lines alike. The type arm
# takes an optional generic parameter list (`type Foo<T> =`), the class arm
# the default/abstract slots TS allows (`export default abstract class`).
shape_sed() {
    sed -nE \
        -e 's/^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(async[[:space:]]+)?function[[:space:]]*\*?[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*).*$/\4/p' \
        -e 's/^[[:space:]]*(export[[:space:]]+)?interface[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*).*$/\2/p' \
        -e 's/^[[:space:]]*(export[[:space:]]+)?(default[[:space:]]+)?(abstract[[:space:]]+)?class[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*).*$/\4/p' \
        -e 's/^[[:space:]]*(export[[:space:]]+)?const[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)[[:space:]]*=.*$/\2/p' \
        -e 's/^[[:space:]]*(export[[:space:]]+)?type[[:space:]]+([A-Za-z_$][A-Za-z0-9_$]*)(<[^=<>]*>)?[[:space:]]*=.*$/\2/p'
}

# One `git diff --cached` pass feeding both sides: identifiers pulled from
# the `-` lines MINUS those re-declared on `+` lines (a modified declaration
# is a -/+ pair and must cancel). `comm -23` needs sorted input: LC_ALL=C
# sort -u provides the order on both sides and the comm runs under LC_ALL=C
# to match it. --no-color and --no-ext-diff keep the body byte-predictable
# against the user's color and external-diff config, and the -c overrides
# force canonical diff headers regardless of the user's diff config (the
# sibling claim-shape-guard depends on the same).
DIFF_BODY=$(git -c diff.mnemonicprefix=false -c core.quotepath=false diff --no-color --no-ext-diff --cached 2>/dev/null)
REMOVED_IDS=$(printf '%s\n' "$DIFF_BODY" | sed -nE 's/^-//p' | shape_sed | LC_ALL=C sort -u)
ADDED_IDS=$(printf '%s\n' "$DIFF_BODY" | sed -nE 's/^\+//p' | shape_sed | LC_ALL=C sort -u)
IDENTIFIERS=$(LC_ALL=C comm -23 <(printf '%s\n' "$REMOVED_IDS") <(printf '%s\n' "$ADDED_IDS"))

# Nothing removed (or git failed) → nothing to sweep.
[ -n "${IDENTIFIERS//[[:space:]]/}" ] || exit 0

# Length floor + stop words. KEPT IN ONE PLACE on purpose: this pair is the
# precision trade that keeps an advisory hook worth reading, and the probe
# pins both (a stop-word and a short identifier with surviving comment
# mentions must stay silent).
SWEEP=$(printf '%s\n' "$IDENTIFIERS" \
    | grep -E '^.{4,}$' \
    | grep -vxE 'this|that|data|item|node|config|options|params|result|value') || SWEEP=""

[ -n "${SWEEP//[[:space:]]/}" ] || exit 0

# Flood cap AFTER the filter: the cap counts the names the sweep would
# actually run — short names and stop words are noise the filter already
# drops and must not spend the budget.
COUNT=$(printf '%s\n' "$SWEEP" | wc -l)
if [ "$COUNT" -gt 40 ]; then
    printf '%s removed identifiers — sweep skipped (too large; run it by hand)\n' "$COUNT"
    exit 0
fi

HITS=""
while IFS= read -r ident; do
    [ -n "$ident" ] || continue
    found=$(git -c core.quotepath=false grep -n -F -w -I --untracked -e "$ident" 2>/dev/null \
        | awk -v IDENT="$ident" '
BEGIN {
    nhits = 0
    seen_code = 0
}
{
    path = $0; sub(/:.*/, "", path)
    rest = $0; sub(/^[^:]*:/, "", rest)
    lineno = rest; sub(/:.*/, "", lineno)
    content = rest; sub(/^[^:]*:/, "", content)
    if (path ~ /^\.claude\/hooks\//) next
    if (path ~ /^\.husky\//) next
    if (path ~ /^tracker\//) next
    if (path ~ /^backlog\//) next
    if (path ~ /(^|\/)CHANGELOG/) next
    if (path ~ /^docs\/incidents\/.*\.md$/) next
    trimmed = content
    sub(/^[[:space:]]+/, "", trimmed)
    head2 = substr(trimmed, 1, 2)
    head1 = substr(trimmed, 1, 1)
    # A leading hash opens prose only OUTSIDE the JS/TS family: in ts/js
    # files it is code (private class fields, shebangs). It stays a comment
    # marker in py, sh, yml, toml and the rest.
    is_prose = (path ~ /\.md$/ || head2 == "//" || head2 == "/*" || head1 == "*")
    if (!is_prose && head1 == "#" && path !~ /\.(ts|js|jsx|tsx|cts|mts)$/) {
        is_prose = 1
    }
    if (!is_prose) {
        # A surviving code hit means the name is still referenced on a
        # non-comment line outside the diff — any non-prose line counts
        # (a string literal, a .json value, a /* continuation line that
        # does not start with *). The compiler owns the code side, so the
        # whole identifier goes silent (probe case (t) pins this).
        seen_code = 1
        next
    }
    hits[nhits++] = path ":" lineno ": " IDENT
}
END {
    if (seen_code) {
        print "CODE"
    } else {
        for (i = 0; i < nhits; i++) print hits[i]
    }
}') || found=""
    # The sentinel means the name still appears on a non-comment line
    # somewhere — skip the identifier entirely. A real hit line always
    # carries `path:line:`, so it can never equal the bare word.
    [ "$found" = "CODE" ] && continue
    # Append with an EXPLICIT newline: bare `HITS="$HITS$found"` lets the
    # command substitution's trailing-newline strip merge identifier N's
    # last hit line into identifier N+1's first (probe case (d) pins one
    # hit per output line; a silent identifier appends nothing).
    [ -n "$found" ] && HITS+="$found"$'\n'
done < <(printf '%s\n' "$SWEEP")

if [ -n "${HITS//[[:space:]]/}" ]; then
    printf '⚠ Stale prose naming removed identifier(s):\n'
    total=$(printf '%s' "$HITS" | wc -l)
    if [ "$total" -gt 40 ]; then
        # The banner cap: first 40 lines, then one overflow line — never
        # the full flood (probe case (u) pins the 40 + cap-line shape).
        printf '%s' "$HITS" | head -n 40
        printf '… and %d more hits (cap)\n' "$((total - 40))"
    else
        printf '%s' "$HITS"
    fi
fi

exit 0
