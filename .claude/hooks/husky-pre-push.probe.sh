#!/bin/bash
# Fixture check for .husky/pre-push — run after ANY edit to the hook.
#
# PARTIAL BY DESIGN. The probe pins three decisions the hook makes for a push:
# which path it takes (docs-only early exit or the code path), what it asks
# turbo to run (whether --filter scopes it to changed packages), and whether a
# push from a linked worktree inherits the main checkout's .env low-resource
# setting per key (the worktree's own .env value wins when it has one; a
# worktree .env without the key still falls back to the main checkout's),
# whether a push from the main checkout itself honours its own .env, whether
# the last of a repeated key wins and a trailing CR, an inline comment,
# surrounding whitespace and one layer of surrounding quotes are stripped from
# the .env value, and whether an on-value reaches child processes normalised to 1
# (an off-value must leave none exported). `pnpm` and `uv`
# are stubbed to log their arguments, so the probe does not run the real gates
# and cannot tell whether build, lint, test, ruff, mypy or pytest pass. `nproc`
# is stubbed too (prints 8) in the shared stub dir, so in EVERY case the
# core-count auto-detect never fires, on any host.
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
echo "LRM=${LOW_RESOURCE_MODE:-}" >>"$PNPM_STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/pnpm"
cat >"$STUB_DIR/uv" <<'STUB'
#!/bin/sh
echo "$*" >>"$PNPM_STUB_LOG"
exit 0
STUB
chmod +x "$STUB_DIR/uv"
cat >"$STUB_DIR/nproc" <<'STUB'
#!/bin/sh
echo 8
STUB
chmod +x "$STUB_DIR/nproc"

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

# check_worktree_env LABEL MAIN_ENV WT_ENV WANT
#   MAIN_ENV / WT_ENV: the .env file body for the main checkout / the linked
#   worktree, or "-" for no .env file. WANT: throttled | unthrottled.
#   Pushes from a linked worktree (or, when WT_ENV is the sentinel "@main",
#   from the main checkout itself, with no worktree created) with
#   LOW_RESOURCE_MODE unset and nproc stubbed to 8; asserts on --concurrency=1
#   in the turbo line, and for throttled also on the hook's "Low-resource mode
#   enabled (LOW_RESOURCE_MODE set)" message and on the pnpm stub having seen
#   LOW_RESOURCE_MODE=1 (the normalised value). For unthrottled, no pnpm stub
#   line from the turbo run onward may carry a non-empty LOW_RESOURCE_MODE
#   (earlier pnpm calls precede step 4 and still see an inherited value).
#   Optional $5: a LOW_RESOURCE_MODE value to set in the environment (default:
#   unset).
check_worktree_env() {
    local label="$1" main_env="$2" wt_env="$3" want="$4" env_value="${5:-}"
    n=$((n + 1))
    local repo="$TMPDIR_PROBE/case-$n"
    local wt="$TMPDIR_PROBE/case-$n-wt"
    local log="$TMPDIR_PROBE/case-$n.pnpm.log"
    local out="$TMPDIR_PROBE/case-$n.out"
    build_repo "$repo" "services/x/src/a.ts"
    if [ "$wt_env" = "@main" ]; then
        wt="$repo"
    else
        git -C "$repo" worktree add -q "$wt" -b fix/probe-wt
        mkdir -p "$wt/services/x/src"
        echo change-wt >"$wt/services/x/src/b.ts"
        git -C "$wt" add -A
        git -C "$wt" commit -qm "change in worktree"
    fi
    # .env is written after the commits so the fixture never tracks it.
    [ "$main_env" = "-" ] || printf '%s\n' "$main_env" >"$repo/.env"
    { [ "$wt_env" = "-" ] || [ "$wt_env" = "@main" ]; } || printf '%s\n' "$wt_env" >"$wt/.env"

    local rc=0
    local env_arg=(-u LOW_RESOURCE_MODE)
    [ -z "$env_value" ] || env_arg=("LOW_RESOURCE_MODE=$env_value")
    (cd "$wt" && env "${env_arg[@]}" PATH="$STUB_DIR:$PATH" PNPM_STUB_LOG="$log" sh .husky/pre-push) >"$out" 2>&1 || rc=$?
    touch "$log"

    local turbo_line
    turbo_line=$(grep -F 'turbo run build lint test' "$log" | head -n 1)

    local ok=0
    if [ -n "$turbo_line" ]; then
        if [ "$want" = throttled ]; then
            [[ "$turbo_line" == *"--concurrency=1"* ]] \
                && grep -qF 'Low-resource mode enabled (LOW_RESOURCE_MODE set)' "$out" \
                && grep -qx 'LRM=1' "$log" && ok=1
        else
            [[ "$turbo_line" != *"--concurrency=1"* ]] \
                && ! awk '/^turbo run build lint test/ {s=1} s && /^LRM=./ {f=1} END {exit !f}' "$log" \
                && ok=1
        fi
    fi

    if [ "$rc" = 0 ] && [ "$ok" = 1 ]; then
        echo "ok: $label"
    else
        echo "FAIL [exit=$rc want=0 | want=$want ok=$ok | turbo: ${turbo_line:-<none>}]: $label"
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

check_worktree_env "worktree with no .env inherits the main checkout's low-resource mode" \
    "LOW_RESOURCE_MODE=1" "-" throttled
check_worktree_env "no .env anywhere stays unthrottled" \
    "-" "-" unthrottled
check_worktree_env "the worktree's own .env wins over the main checkout's" \
    "LOW_RESOURCE_MODE=1" "LOW_RESOURCE_MODE=0" unthrottled
check_worktree_env "a worktree .env without the key still falls back to the main checkout's" \
    "LOW_RESOURCE_MODE=1" "DATABASE_URL=x" throttled
check_worktree_env "an explicit environment value wins over the main checkout's .env" \
    "LOW_RESOURCE_MODE=1" "-" unthrottled 0
check_worktree_env "an on-value like true is exported to children as 1" \
    "LOW_RESOURCE_MODE=true" "-" throttled
check_worktree_env "a main-checkout push is throttled by its own .env" \
    "LOW_RESOURCE_MODE=1" "@main" throttled
check_worktree_env "a main-checkout .env off-value stays unthrottled" \
    "LOW_RESOURCE_MODE=0" "@main" unthrottled
check_worktree_env "a quoted off-value opts out" \
    'LOW_RESOURCE_MODE="0"' "@main" unthrottled
check_worktree_env "a single-quoted on-value throttles" \
    "LOW_RESOURCE_MODE='1'" "@main" throttled
check_worktree_env "a CRLF off-value opts out" \
    $'LOW_RESOURCE_MODE=0\r' "@main" unthrottled
check_worktree_env "a repeated key resolves to its last value" \
    $'LOW_RESOURCE_MODE=1\nLOW_RESOURCE_MODE=0' "@main" unthrottled
check_worktree_env "an off-value with an inline comment opts out" \
    'LOW_RESOURCE_MODE=0 # off' "@main" unthrottled
check_worktree_env "an off-value with trailing whitespace opts out" \
    'LOW_RESOURCE_MODE=0 ' "@main" unthrottled

exit $fail
