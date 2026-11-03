#!/bin/bash
# Fixture check for .husky/pre-push — run after ANY edit to the hook.
#
# PARTIAL BY DESIGN. The probe pins two decisions the hook makes for a push:
# which path it takes (docs-only early exit or the code path) and what it asks
# turbo to run (whether --filter scopes it to changed packages). `pnpm` and `uv`
# are stubbed to log their arguments, so the probe does not run the real gates
# and cannot tell whether build, lint, test, ruff, mypy or pytest pass.
#
# Every case builds a THROWAWAY git repo under a mktemp dir, copies the real
# hook in, makes one commit that changes one file, and runs the hook copy with
# `pnpm` and `uv` stubs first on PATH. Git is real and is not stubbed. The real
# repo is only read, never written.
#
# Every case is a first push (the fixture branch has no upstream), so step 2's
# merge-base branch runs. The `@{u}` branch and the fallbacks used when
# `origin/develop` is missing are not covered.
#
# Usage: .claude/hooks/husky-pre-push.probe.sh   (from anywhere)

set -uo pipefail
# An inherited GIT_DIR would point the fixture's git calls at another repo.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../.." && pwd)
HOOK_SRC="$REPO_ROOT/.husky/pre-push"
TRACKER_SRC="$REPO_ROOT/.claude/hooks/tracker-dirty-push-gate.sh"

TMPDIR_PROBE=$(mktemp -d)
cleanup() { rm -rf "$TMPDIR_PROBE"; }
trap cleanup EXIT

STUB_DIR="$TMPDIR_PROBE/stub"
mkdir -p "$STUB_DIR"
cat >"$STUB_DIR/pnpm" <<'STUB'
#!/bin/sh
echo "$*" >>"$PNPM_STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/pnpm"
cat >"$STUB_DIR/uv" <<'STUB'
#!/bin/sh
echo "$*" >>"$PNPM_STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/uv"

fail=0
n=0

# Build a fresh fixture repo at $1 where the only change on fix/probe is file $2.
build_repo() {
    local repo="$1" file="$2"
    mkdir -p "$repo/.husky" "$repo/.claude/hooks"
    cp "$HOOK_SRC" "$repo/.husky/pre-push"
    cp "$TRACKER_SRC" "$repo/.claude/hooks/tracker-dirty-push-gate.sh"
    git -C "$repo" init -q
    git -C "$repo" config user.email probe@example.invalid
    git -C "$repo" config user.name probe
    git -C "$repo" config commit.gpgsign false
    echo base >"$repo/README.md"
    git -C "$repo" add -A
    git -C "$repo" commit -qm base
    git -C "$repo" update-ref refs/remotes/origin/develop HEAD
    git -C "$repo" checkout -qb fix/probe
    mkdir -p "$repo/$(dirname "$file")"
    echo change >"$repo/$file"
    git -C "$repo" add -A
    git -C "$repo" commit -qm change
}

# check LABEL FILE PATH FILTER
#   PATH:   full (turbo run build lint test, and no `ruff check` line in the log)
#         | docs (lines:check, no turbo)
#         | python (turbo run AND a `ruff check` line: the Python block ran)
#   FILTER: filter (--filter=...[origin/develop]) | nofilter (no --filter) | none
#         | none asserts nothing about the filter; every python row uses it
check() {
    local label="$1" file="$2" want_path="$3" want_filter="$4"
    n=$((n + 1))
    local repo="$TMPDIR_PROBE/case-$n"
    local log="$TMPDIR_PROBE/case-$n.pnpm.log"
    local out="$TMPDIR_PROBE/case-$n.out"
    build_repo "$repo" "$file"

    local rc=0
    (cd "$repo" && PATH="$STUB_DIR:$PATH" PNPM_STUB_LOG="$log" sh .husky/pre-push) >"$out" 2>&1 || rc=$?
    touch "$log"

    local turbo_line
    turbo_line=$(grep -F 'turbo run build lint test' "$log" | head -n 1)

    local path_ok=0 filter_ok=0
    if [ "$want_path" = full ]; then
        [ -n "$turbo_line" ] && ! grep -q 'ruff check' "$log" && path_ok=1
    elif [ "$want_path" = python ]; then
        [ -n "$turbo_line" ] && grep -q 'ruff check' "$log" && path_ok=1
    elif ! grep -q turbo "$log" && grep -q 'ops lines:check' "$log"; then
        path_ok=1
    fi

    case "$want_filter" in
        filter)
            [[ "$turbo_line" == *"--filter=...[origin/develop]"* ]] && filter_ok=1
            ;;
        nofilter)
            [ -n "$turbo_line" ] && [[ "$turbo_line" != *"--filter"* ]] && filter_ok=1
            ;;
        none)
            filter_ok=1
            ;;
    esac

    if [ "$rc" = 0 ] && [ "$path_ok" = 1 ] && [ "$filter_ok" = 1 ]; then
        echo "ok: $label"
    else
        echo "FAIL [exit=$rc want=0 | path=$want_path ok=$path_ok | filter=$want_filter ok=$filter_ok | turbo: ${turbo_line:-<none>}]: $label"
        sed 's/^/     out: /' "$out"
        fail=1
    fi
}

check "package tsconfig takes the code path, filtered" \
    "packages/x/tsconfig.json" full filter
check "service Dockerfile takes the code path, filtered" \
    "services/x/Dockerfile" full filter
check "turbo.json takes the code path, filtered" \
    "turbo.json" full filter
check "root tsconfig.json takes the code path, unfiltered" \
    "tsconfig.json" full nofilter
check "root tsconfig.spec.json takes the code path, unfiltered" \
    "tsconfig.spec.json" full nofilter
check "root .npmrc takes the code path, unfiltered" \
    ".npmrc" full nofilter
check "root pnpm-workspace.yaml takes the code path, unfiltered" \
    "pnpm-workspace.yaml" full nofilter
check "prisma/schema.prisma takes the code path, unfiltered" \
    "prisma/schema.prisma" full nofilter
check "root eslint.config.js takes the code path, unfiltered" \
    "eslint.config.js" full nofilter
check "root vitest.config.ts takes the code path, unfiltered" \
    "vitest.config.ts" full nofilter
check "root package.json takes the code path, unfiltered" \
    "package.json" full nofilter
check "source file takes the code path, filtered" \
    "services/x/src/a.ts" full filter
check "tracker task with a spaced name is docs-only" \
    "tracker/tasks/task-1 - Spaced Name.md" docs none
check "lines baseline json is docs-only" \
    ".github/baselines/lines-baseline.json" docs none
check "markdown doc is docs-only" \
    "docs/a.md" docs none
check "root .node-version takes the code path, unfiltered" \
    ".node-version" full nofilter
check "knip.json takes the code path, filtered" \
    "knip.json" full filter
check "nested turbo.json takes the code path, filtered" \
    "packages/x/turbo.json" full filter
check "voice-engine requirements runs the Python checks" \
    "services/voice-engine/requirements.txt" python none
check "voice-engine dev requirements runs the Python checks" \
    "services/voice-engine/requirements-dev.txt" python none
check "voice-engine pyproject runs the Python checks" \
    "services/voice-engine/pyproject.toml" python none
check "a Python source runs the Python checks" \
    "services/voice-engine/server.py" python none
check "a doc named like a tsconfig is docs-only" \
    "docs/tsconfig-notes.md" docs none
check "requirements outside voice-engine is docs-only" \
    "docs/requirements.txt" docs none
check "root prisma.config.ts takes the code path, unfiltered" \
    "prisma.config.ts" full nofilter
check "a vitest tier config the hook does not run stays filtered" \
    "vitest.component.config.ts" full filter
check "pnpm-lock.yaml takes the code path, filtered" \
    "pnpm-lock.yaml" full filter
check "dependency-cruiser config takes the code path, filtered" \
    ".dependency-cruiser.cjs" full filter

exit $fail
