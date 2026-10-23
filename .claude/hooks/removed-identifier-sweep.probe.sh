#!/bin/bash
# Fixture check for removed-identifier-sweep.sh — run after ANY edit to the
# hook. 33 checks assert the fire/silent/summary table over the shapes that
# matter:
#   - a removed `export function` named in a comment in another file FIRES
#     with that file:line (the spec's headline case);
#   - the other declaration shapes reach a mention: bare `function`,
#     `export async function`, generator `function*`, `interface`, `type`,
#     and `class`;
#   - an identifier with no surviving mention stays silent;
#   - a stop-word removal and a <4-char removal stay silent even with a
#     comment mention (the precision filters sit BEFORE the grep);
#   - a surviving CODE mention is not prose (that is the compiler's surface);
#   - a moved name (removed here, re-added on a + line of the same staged
#     diff) stays silent (cancelled by the -/+ subtraction);
#   - a .md mention fires; docs/incidents/*.md, tracker/, backlog/,
#     .claude/, and CHANGELOG* stay silent (the path exclusions);
#   - a removal of more than 40 names SURVIVING the filters prints the
#     too-large summary instead of a flood; an empty index stays silent;
#   - a MODIFIED declaration (a -/+ pair) cancels — "removed" means removed
#     MINUS re-added: a signature change and a const value edit stay silent
#     even with a third-file comment mention;
#   - a removal with nothing re-declared on the + side is a TRUE removal
#     even when it reads as a move: its mention in a third file (not in the
#     diff) FIRES (contrast the move case above);
#   - a true removal whose surviving mention sits INSIDE a staged file
#     FIRES: nothing re-declares the name, so the subtraction does not
#     cancel it, and a file being in the staged diff is not a silencer;
#   - a true deletion beside an unrelated modification in the same diff
#     still FIRES on the deleted name;
#   - a leading-# line is prose outside JS/TS (.py FIRES) and code inside
#     them (#private fields stay silent);
#   - the flood cap counts AFTER the filter: 35 real names beside 6
#     stop-word removals still sweep and fire.
#   - a name still declared as CODE in another COMMITTED file stays silent
#     (shared, not removed — the compiler's surface); an identifier with
#     more than 40 surviving mention LINES prints the first 40 plus one
#     overflow line (the banner cap);
#   - .claude/rules/ is in scope (a mention FIRES — always-loaded invariant
#     prose is exactly what goes stale silently); .claude/hooks/ stays
#     silent (wiring);
#   - a generic `export type Foo<T> =` removal, an `export default class` /
#     `export abstract class` removal, and an `export default function`
#     removal each reach their mention; a JSDoc ` * ` line and a
#     `/*`-opened line are prose.
#
# Asserts that must hold PER LINE use the LINE: (exact line),
# COUNT:<n>:<BRE> (anchored per-line count), and TAIL: (exact LAST output
# line; the sentinel capture keeps trailing newlines observable) prefixes
# in `check`, so a merged multi-identifier output line cannot satisfy them.
#
# The hook reads real git state (`git diff --cached`) and greps the tracked
# worktree (`git grep`), so the fixtures are commits + staged changes in a
# THROWAWAY repo under $(mktemp -d); each check cd's into that repo and runs
# the hook there — the hook follows `git rev-parse --show-toplevel` — so the
# probe never touches this repo's index or history, and CLAUDE_PROJECT_DIR
# stays what it is in a real run (the hook's out-of-repo fallback only).
#
# This hook never exits nonzero, so the harness asserts BOTH the exit code
# and what reached stdout — exit code alone cannot distinguish fire from
# silent here.
#
# Usage: .claude/hooks/removed-identifier-sweep.probe.sh   (from repo root)

set -uo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
HOOK="$SCRIPT_DIR/removed-identifier-sweep.sh"

REPO=$(mktemp -d)
cleanup() { rm -rf "$REPO"; }
trap cleanup EXIT

git init -q -b main "$REPO" >/dev/null 2>&1 || {
    echo "FATAL: could not init throwaway repo" >&2
    exit 1
}
git -C "$REPO" config user.email probe@example.invalid
git -C "$REPO" config user.name 'Probe Harness'
git -C "$REPO" config commit.gpgsign false

# Commit EVERYTHING currently in the tree, so the next staged change reads
# as a REMOVAL against a real HEAD (the hook only sweeps removed lines).
commit_all() {
    git -C "$REPO" add -A >/dev/null 2>&1
    git -C "$REPO" commit -q --no-verify -m 'probe: fixture' >/dev/null 2>&1
}

# Overwrite a file with a bare comment and stage it: its function lines
# leave HEAD's tree and enter the staged diff as REMOVED lines.
empty_and_stage() { # $1=relpath
    printf '// %s emptied for the fixture.\n' "$(basename "$1")" >"$REPO/$1"
    git -C "$REPO" add -- "$1" >/dev/null 2>&1
}

fail=0

check() { # $1=expected_exit  $2=fire|silent|summary  $3=label  [$4=substring|LINE:exact-line|COUNT:n:BRE...]
    local out got fired want kind n pat cnt label
    # Run from INSIDE the throwaway repo: the hook follows
    # `git rev-parse --show-toplevel`, and CLAUDE_PROJECT_DIR is only its
    # out-of-repo fallback — cd-ing here exercises the path a real
    # pre-commit run takes.
    # A sentinel appended INSIDE the substitution keeps the hook's trailing
    # newlines observable (command substitution would strip them), so a
    # trailing blank line in the output is detectable. The sentinel also
    # carries the HOOK's exit status (`st=$?` reads it before printf's own
    # 0 replaces it), so the exit-code assert below still tests the hook.
    out=$(cd "$REPO" && "$HOOK" 2>/dev/null; st=$?; printf '@@PROBE_TAIL@@%s' "$st")
    got=${out##*@@PROBE_TAIL@@}
    out=${out%%@@PROBE_TAIL@@*}
    if grep -q 'Stale prose naming removed identifier' <<<"$out"; then
        fired="fire"
    elif grep -q 'sweep skipped (too large' <<<"$out"; then
        fired="summary"
    elif [ -z "${out//[[:space:]]/}" ]; then
        fired="silent"
    else
        fired="unexpected-output"
    fi
    if [ "$got" != "$1" ] || [ "$fired" != "$2" ]; then
        echo "FAIL [exit=$got want=$1 | $fired want=$2]: $3"
        fail=1
    else
        echo "ok   [exit=$got | $fired]: $3"
    fi
    label=$3
    shift 3
    for want in "$@"; do
        kind=${want%%:*}
        case $kind in
        LINE)
            # Whole-line assert: a merged multi-identifier output line can
            # contain every substring and still fail this.
            if ! grep -qxF -- "${want#LINE:}" <<<"$out"; then
                echo "FAIL [no output line exactly '${want#LINE:}']: $label"
                fail=1
            fi
            ;;
        TAIL)
            # Last-output-line assert: the sentinel capture preserves
            # trailing newlines, so a blank final line fails this. The
            # extraction pipes through `printf '%s'` — a `<<<` here-string
            # would append its own newline and always read as a blank tail.
            if [ "$(printf '%s' "$out" | tail -n1)" != "${want#TAIL:}" ]; then
                echo "FAIL [last output line is '$(printf '%s' "$out" | tail -n1)', want '${want#TAIL:}']: $label"
                fail=1
            fi
            ;;
        COUNT)
            # Anchored per-line count: exactly n output lines match the BRE
            # (grep -cx), so merged lines under-count and fail.
            n=${want#COUNT:}
            pat=${n#*:}
            n=${n%%:*}
            cnt=$(grep -cx -- "$pat" <<<"$out" || true)
            if [ "$cnt" != "$n" ]; then
                echo "FAIL [lines matching '$pat' = $cnt, want $n]: $label"
                fail=1
            fi
            ;;
        *)
            if ! grep -qF -- "$want" <<<"$out"; then
                echo "FAIL [output missing '$want']: $label"
                fail=1
            fi
            ;;
        esac
    done
}

# (a) the headline case: a removed export function whose name survives in a
# comment in ANOTHER file — must fire with that file:line.
mkdir -p "$REPO/src"
printf 'export function legacyHelper(alpha: string): string {\n  return alpha;\n}\n' >"$REPO/src/legacy.ts"
printf '// legacyHelper formats the banner text.\n' >"$REPO/src/mentions.ts"
commit_all
empty_and_stage src/legacy.ts
check 0 fire "removed export function named in a comment elsewhere" "src/mentions.ts:1: legacyHelper"

# (b) bare `function` (no export) — the optional-export arm must not swallow
# the bare form.
printf 'function plainHelper(beta: string): string {\n  return beta;\n}\n' >"$REPO/src/legacy.ts"
printf '// plainHelper is described here too.\n' >"$REPO/src/mentions2.ts"
commit_all
empty_and_stage src/legacy.ts
check 0 fire "removed bare function named in a comment elsewhere" "src/mentions2.ts:1: plainHelper"

# (c) `export async function` — the async-qualified arm must reach the
# mention.
printf 'export async function asyncHelper(gamma: string): Promise<string> {\n  return gamma;\n}\n' >"$REPO/src/async.ts"
printf '// asyncHelper awaits the banner.\n' >"$REPO/src/mentions3.ts"
commit_all
empty_and_stage src/async.ts
check 0 fire "removed export async function named in a comment" "src/mentions3.ts:1: asyncHelper"

# (c2) generator `function*` — the star must not break the function arm.
printf 'export function* genFn(x: number): Generator<number> {\n  yield x;\n}\n' >"$REPO/src/gen.ts"
printf '// genFn yields the banner.\n' >"$REPO/src/mentions4.ts"
commit_all
empty_and_stage src/gen.ts
check 0 fire "removed generator (function*) named in a comment" "src/mentions4.ts:1: genFn"

# (d) interface / type / class removals, each reaching a .md mention.
printf 'export interface PanelArgs {\n  width: number;\n}\nexport type PanelMode = (panel: string) => void;\nexport class PanelHost {\n  open(): void {}\n}\n' >"$REPO/src/shapes.ts"
printf 'The PanelArgs carry a width, PanelMode drives it, PanelHost opens it.\n' >"$REPO/SHAPES.md"
commit_all
empty_and_stage src/shapes.ts
check 0 fire "removed interface/type/class each reach the .md mention" \
    "LINE:SHAPES.md:1: PanelArgs" "LINE:SHAPES.md:1: PanelHost" "LINE:SHAPES.md:1: PanelMode" \
    "COUNT:3:SHAPES\.md:1: Panel[A-Za-z]*" \
    "TAIL:SHAPES.md:1: PanelMode"

# (e) precision filters run BEFORE the grep: a stop-word (`data`) and a
# short identifier (`fn`) both have surviving comment mentions and must
# still stay silent.
printf 'const data = loadSeed();\nexport function fn(x: number): number {\n  return x;\n}\n' >"$REPO/src/filters.ts"
printf '// data flows here, fn is tiny.\n' >"$REPO/src/filtnotes.ts"
commit_all
empty_and_stage src/filters.ts
check 0 silent "stop-word (data) and short (fn) removals stay silent despite comment mentions"

# (f) the identifier is gone everywhere — the silent norm.
printf 'export function lonelyFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/lonely.ts"
commit_all
empty_and_stage src/lonely.ts
check 0 silent "removed identifier with no surviving mention"

# (g) a surviving CODE mention is not prose — the compiler's surface, and
# the reason only comment lines and .md count.
printf 'export function keptFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/kept.ts"
printf 'const y = keptFn(1);\n' >"$REPO/src/caller.ts"
commit_all
empty_and_stage src/kept.ts
check 0 silent "surviving CODE mention is not prose"

# (h) a MOVE: the name is removed from one.ts and re-added in two.ts (a +
# line of the same staged diff), so the -/+ subtraction cancels it before
# any grep — the case must stay silent.
printf 'export function movedFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/one.ts"
printf '// movedFn belongs in two.ts.\n' >"$REPO/src/two.ts"
commit_all
printf '// one.ts emptied for the fixture.\n' >"$REPO/src/one.ts"
printf 'export function movedFn(x: number): number {\n  return x;\n}\n// movedFn lives here now.\n' >"$REPO/src/two.ts"
git -C "$REPO" add src/one.ts src/two.ts >/dev/null 2>&1
check 0 silent "moved name: re-declared on a + line, cancelled by the -/+ subtraction"

# (i) a root .md mention fires (markdown is kept unless a path excludes it).
printf 'export function docdFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/docd.ts"
printf 'The docdFn helper formats the export.\n' >"$REPO/README.md"
commit_all
empty_and_stage src/docd.ts
check 0 fire "identifier named in a root .md fires" "README.md:1: docdFn"

# (j) the path exclusions, one identifier per branch so a single leak in any
# branch fails its own case.
printf 'export function incidentFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/inc1.ts"
mkdir -p "$REPO/docs/incidents" "$REPO/tracker" "$REPO/backlog" "$REPO/.claude"
printf 'incidentFn was retired; see the fix forward.\n' >"$REPO/docs/incidents/post.md"
commit_all
empty_and_stage src/inc1.ts
check 0 silent "mention under docs/incidents/*.md stays silent"

printf 'export function trackerFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/inc2.ts"
printf 'trackerFn notes live in the tracker.\n' >"$REPO/tracker/task-1.md"
commit_all
empty_and_stage src/inc2.ts
check 0 silent "mention under tracker/ stays silent"

printf 'export function backlogFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/inc3.ts"
printf 'backlogFn notes live in the backlog.\n' >"$REPO/backlog/idea.md"
commit_all
empty_and_stage src/inc3.ts
check 0 silent "mention under backlog/ stays silent"

printf 'export function claudeFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/inc4.ts"
mkdir -p "$REPO/.claude/hooks"
printf 'claudeFn notes live under .claude/hooks.\n' >"$REPO/.claude/hooks/notes.md"
commit_all
empty_and_stage src/inc4.ts
check 0 silent "mention under .claude/hooks/ stays silent"

printf 'export function changelogFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/inc5.ts"
printf 'changelogFn was removed in this release.\n' >"$REPO/CHANGELOG.md"
commit_all
empty_and_stage src/inc5.ts
check 0 silent "mention in CHANGELOG.md stays silent"

# (k) the flood cap: 41 removed identifiers → one summary line, not a
# banner plus 41 hits. If the banner ALSO printed, `check` classifies the
# output as `fire` and this fails.
: >"$REPO/src/big.ts"
i=1
while [ "$i" -le 41 ]; do
    printf 'export function bigFn%02d(x: number): number {\n  return x;\n}\n' "$i" >>"$REPO/src/big.ts"
    i=$((i + 1))
done
commit_all
: >"$REPO/src/big.ts"
git -C "$REPO" add src/big.ts >/dev/null 2>&1
check 0 summary "41 removed identifiers prints the too-large summary, not a flood"

# (l) nothing staged → silence.
git -C "$REPO" reset -q >/dev/null 2>&1
check 0 silent "empty index"

# (m) a MODIFIED declaration is a -/+ pair and cancels: a signature change
# with a surviving comment mention in a THIRD file (not in the diff) must
# stay silent.
printf 'export function formatBanner(a: string): string {\n  return a;\n}\n' >"$REPO/src/banner.ts"
printf '// formatBanner renders the header text.\n' >"$REPO/src/banner-notes.ts"
commit_all
printf 'export function formatBanner(a: string, b: string): string {\n  return a + b;\n}\n' >"$REPO/src/banner.ts"
git -C "$REPO" add src/banner.ts >/dev/null 2>&1
check 0 silent "signature change (-/+ pair) cancels despite a third-file mention"

# (n) a const value edit is a -/+ pair and cancels: a comment mention in a
# third file must stay silent.
printf 'const retryTimeout = 5000;\n' >"$REPO/src/timing.ts"
printf '// retryTimeout bounds the backoff.\n' >"$REPO/src/timing-notes.ts"
commit_all
printf 'const retryTimeout = 6000;\n' >"$REPO/src/timing.ts"
git -C "$REPO" add src/timing.ts >/dev/null 2>&1
check 0 silent "const value edit (-/+ pair) cancels despite a comment mention"

# (o) a "move" whose destination is NOT staged is, to the index, a TRUE
# removal: with the only mention in a third file (not in the diff) it must
# FIRE. Nothing re-declares the name on a + line, so the -/+ subtraction
# does not cancel it, and the stale prose must surface.
printf 'export function relocatedFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/old-home.ts"
printf '// relocatedFn moved to the new module.\n' >"$REPO/src/third-notes.ts"
commit_all
empty_and_stage src/old-home.ts
check 0 fire "unstaged-destination move = true removal; third-file mention fires" "src/third-notes.ts:1: relocatedFn"

# (p) a true deletion beside an UNRELATED modification in the same diff
# still fires on the deleted name (the modification -/+ pair cancels and
# must not eat the deletion).
printf 'export function doomedFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/doomed.ts"
printf 'const aside = 1;\n' >"$REPO/src/aside.ts"
printf '// doomedFn is described here.\n' >"$REPO/src/doomed-notes.ts"
commit_all
empty_and_stage src/doomed.ts
printf 'const aside = 2;\n' >"$REPO/src/aside.ts"
git -C "$REPO" add src/doomed.ts src/aside.ts >/dev/null 2>&1
check 0 fire "true deletion beside an unrelated modification still fires" "src/doomed-notes.ts:1: doomedFn"

# (q) a leading-# line in a .ts file is CODE (a private class field), not
# prose: a removed identifier named on such a line stays silent.
printf 'export function privFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/priv.ts"
printf '#privFn = 3;\n' >"$REPO/src/fields.ts"
commit_all
empty_and_stage src/priv.ts
check 0 silent "a #private line in a .ts file is code, not prose"

# (r) the same leading-# line in a .py file IS prose: it fires.
printf 'export function pyFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/pyhook.ts"
printf '# pyFn handled the legacy path.\n' >"$REPO/src/legacy.py"
commit_all
empty_and_stage src/pyhook.ts
check 0 fire "a leading-# line in a .py file is prose" "src/legacy.py:1: pyFn"

# (s) the flood cap counts AFTER the filter: 35 real names beside 6
# stop-word removals leave 35 names SURVIVING the filter — at or under the
# 40 cap, so the sweep must still run and fire. Each real name gets its OWN
# mention line, so the COUNT assert is exact per line.
: >"$REPO/src/many.ts"
i=1
while [ "$i" -le 35 ]; do
    printf 'export function realFn%02d(x: number): number {\n  return x;\n}\n' "$i" >>"$REPO/src/many.ts"
    i=$((i + 1))
done
printf 'const data = 1;\nconst this = 2;\nconst that = 3;\nconst item = 4;\nconst node = 5;\nconst value = 6;\n' >"$REPO/src/stopwords.ts"
: >"$REPO/src/stop-notes.ts"
i=1
while [ "$i" -le 35 ]; do
    printf '// realFn%02d leads the pack.\n' "$i" >>"$REPO/src/stop-notes.ts"
    i=$((i + 1))
done
printf '// data, this, that, item, node and value all flow here.\n' >>"$REPO/src/stop-notes.ts"
commit_all
: >"$REPO/src/many.ts"
: >"$REPO/src/stopwords.ts"
git -C "$REPO" add src/many.ts src/stopwords.ts >/dev/null 2>&1
check 0 fire "35 real + 6 stop-word removals sweep and fire (cap counts post-filter)" \
    "src/stop-notes.ts:1: realFn01" \
    "COUNT:35:src/stop-notes\.ts:[0-9][0-9]*: realFn[0-9][0-9]"

# (t) a removed const whose name is ALSO declared in another COMMITTED file:
# that surviving declaration is a code hit, so the name is shared, not
# removed — the sweep stays silent despite the prose mention. The second
# declaration must be COMMITTED, not staged in the same diff: a staged
# shared-b.ts would put sharedConst on both sides of the -/+ subtraction
# and cancel the name for the wrong reason.
printf 'export const sharedConst = 1;\n' >"$REPO/src/shared-a.ts"
printf 'export const sharedConst = 2;\n' >"$REPO/src/shared-b.ts"
printf '// sharedConst still documented here.\n' >"$REPO/src/shared-notes.ts"
commit_all
empty_and_stage src/shared-a.ts
check 0 silent "name still declared as code in a committed file stays silent"

# (u) the banner cap: one identifier with 45 surviving mention lines prints
# the first 40 plus one overflow line, never all 45.
printf 'export function cappedFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/capped.ts"
: >"$REPO/CAPPED.md"
i=1
while [ "$i" -le 45 ]; do
    printf 'cappedFn mention line %d.\n' "$i" >>"$REPO/CAPPED.md"
    i=$((i + 1))
done
commit_all
empty_and_stage src/capped.ts
check 0 fire "45 surviving mention lines cap at 40 + one overflow line" \
    "COUNT:40:CAPPED\.md:[0-9][0-9]*: cappedFn" \
    "LINE:… and 5 more hits (cap)"

# (v) .claude/rules/ is in scope: always-loaded invariant prose is exactly
# what goes stale silently, so a mention there FIRES.
printf 'export function rulesFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/rulehook.ts"
mkdir -p "$REPO/.claude/rules"
printf 'rulesFn was removed; the invariant now lives in the hook.\n' >"$REPO/.claude/rules/test-fixture.md"
commit_all
empty_and_stage src/rulehook.ts
check 0 fire "a mention under .claude/rules/ fires" \
    "LINE:.claude/rules/test-fixture.md:1: rulesFn"

# (w) generic type alias: `export type Filter<T> = …` extracts Filter.
printf 'export type Filter<T> = (item: T) => boolean;\n' >"$REPO/src/gentype.ts"
printf 'The Filter predicate narrows each batch.\n' >"$REPO/GENTYPE.md"
commit_all
empty_and_stage src/gentype.ts
check 0 fire "removed generic type alias reaches the .md mention" \
    "LINE:GENTYPE.md:1: Filter"

# (x) default/abstract class arms: both names extract and reach the .md
# mention as separate per-line hits.
printf 'export default class DefaultHost {\n  open(): void {}\n}\nexport abstract class AbstractBase {\n  open(): void {}\n}\n' >"$REPO/src/classes.ts"
printf 'DefaultHost opens it, AbstractBase frames it.\n' >"$REPO/CLASSES.md"
commit_all
empty_and_stage src/classes.ts
check 0 fire "removed default/abstract class each reach the .md mention" \
    "LINE:CLASSES.md:1: DefaultHost" "LINE:CLASSES.md:1: AbstractBase"

# (y) a JSDoc ` * ` line and a `/*`-opened line are prose: both fire.
printf 'export function jsdocFn(x: number): number {\n  return x;\n}\nexport function blockFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/jsdoc.ts"
printf '/**\n * jsdocFn formats the header.\n */\n/* blockFn opens the panel */\n' >"$REPO/src/jsdoc-notes.ts"
commit_all
empty_and_stage src/jsdoc.ts
check 0 fire "JSDoc * and /*-opened mentions are prose" \
    "LINE:src/jsdoc-notes.ts:2: jsdocFn" "LINE:src/jsdoc-notes.ts:4: blockFn"

# (z) the .husky/ path exclusion stays silent.
printf 'export function huskyFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/huskyhook.ts"
mkdir -p "$REPO/.husky"
printf 'huskyFn wiring note.\n' >"$REPO/.husky/pre-commit"
commit_all
empty_and_stage src/huskyhook.ts
check 0 silent "mention under .husky/ stays silent"

# (aa) `export default function` extracts its name and fires.
printf 'export default function defaultFn(x: number): number {\n  return x;\n}\n' >"$REPO/src/defaultfn.ts"
printf '// defaultFn was the module entry.\n' >"$REPO/src/defaultfn-notes.ts"
commit_all
empty_and_stage src/defaultfn.ts
check 0 fire "removed export default function named in a comment" \
    "LINE:src/defaultfn-notes.ts:1: defaultFn"

# (ab) a TRUE removal whose surviving mention sits INSIDE a staged file: the
# function is deleted and its trailing comment stays. Nothing re-declares the
# name on a + line, so the -/+ subtraction does not cancel it, and a file
# being part of the staged diff is not a reason to silence a true removal —
# the surviving prose is exactly the hit this hook exists to print.
printf 'export function fooFn(alpha: string): string {\n  return alpha;\n}\n// delegates to fooFn\n' >"$REPO/src/keepnote.ts"
commit_all
printf '// delegates to fooFn\n' >"$REPO/src/keepnote.ts"
git -C "$REPO" add src/keepnote.ts >/dev/null 2>&1
check 0 fire "true removal: surviving comment inside a staged file fires" \
    "src/keepnote.ts:1: fooFn"

[ "$fail" = 0 ] && echo "ALL PASS" || {
    echo "FAILURES"
    exit 1
}
