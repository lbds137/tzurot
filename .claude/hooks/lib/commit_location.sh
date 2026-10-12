# Shared by develop-code-commit-guard.sh and board-commit-branch-gate.sh
# (sourced via $HOOK_LIB; not executable on its own, no probe of its own: both
# guards' probes exercise it, and check-hook-probes scans only the top-level
# hooks directory).
#
# WHERE A COMMAND'S COMMITS LAND. Both guards place the commit in a checkout
# the same way, from line 2 of lib/branch_switch.py (the TAB-separated distinct
# locations every commit can run in: `<start>` = the starting checkout, an
# absolute path, or a plain relative path from the start directory). Only the
# direction each guard fails in differs, so these functions return results and
# NEVER exit, cd, print or pick a direction: each guard maps CL_UNTRUSTED,
# CL_MULTI and CL_ACTION itself (develop: untrusted sibling = judged as develop,
# several checkouts = block; board gate: untrusted sibling = judged as a
# feature branch, several checkouts = live evaluation, the develop guard owns
# the block).
#
# Both guards run `set -uo pipefail` (no `set -e`): every variable read here is
# initialised before use, and every command that may fail is guarded.

# commit_location_start <project_common> <project_dir> <shell_cwd> <require_top>
#   project_common  the project checkout's absolute git-common-dir ("" = unknown)
#   project_dir     the directory the guard starts in when there is no usable
#                   shell cwd
#   shell_cwd       the payload `.cwd` when the caller found it a usable
#                   directory, else ""
#   require_top     non-empty: a start directory with no toplevel counts as
#                   foreign even when its common dir matches the project's
#                   (board gate); empty: only a differing common dir does
#                   (develop guard)
# Sets CL_PROJECT_COMMON, CL_START_DIR, CL_START_TOP (the start checkout's
# toplevel, "" when the start is not in a work tree) and CL_START_FOREIGN ("1"
# when the shell sits in another repository or in none).
commit_location_start() {
  local common
  CL_PROJECT_COMMON="$1"
  CL_START_DIR="$2"
  CL_START_FOREIGN=""
  if [ -n "$3" ]; then
    CL_START_DIR="$3"
  fi
  CL_START_TOP=$(git -C "$CL_START_DIR" rev-parse --show-toplevel 2>/dev/null || echo "")
  if [ -n "$3" ]; then
    common=$(git -C "$CL_START_DIR" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
    if [ -n "$CL_PROJECT_COMMON" ] \
      && { [ "$common" != "$CL_PROJECT_COMMON" ] || { [ -n "$4" ] && [ -z "$CL_START_TOP" ]; }; }; then
      CL_START_FOREIGN=1
    fi
  fi
  return 0
}

# commit_location_resolve <line2> <others_inert>
#   line2           the helper's line 2 (tab-separated locations); empty or "?"
#                   returns with nothing set (the caller handles both itself)
#   others_inert    "1" when every non-commit segment is inert (line 3)
# Resolves each location against CL_START_DIR to its toplevel. `<start>` is the
# start checkout, a location that does not resolve counts as the start
# checkout, and locations are deduped by toplevel.
# Sets:
#   CL_MULTI         "1" when the commits span more than one distinct checkout
#   CL_REP           the first non-`<start>` location ("" when only `<start>`),
#                    the single directory the rest of the flow is judged on
#   CL_ACTION        "" (keep the live evaluation), "silent" (a different
#                    repository, every other segment inert: not this repo's
#                    commit) or "sibling" (another worktree of this repository)
#   CL_SIBLING_TOP   the sibling worktree's toplevel, when CL_ACTION=sibling
#   CL_UNTRUSTED     "1" for a sibling whose branch cannot be trusted (a
#                    non-inert segment could move it)
# CL_START_FOREIGN is left alone: on "sibling" the caller clears its own copy
# (the develop guard only after its `cd` into the sibling succeeded).
commit_location_resolve() {
  local locs="$1" inert="$2" loc abs top key keys="" target_top target_common
  local -a parts=()
  CL_MULTI=""
  CL_REP=""
  CL_ACTION=""
  CL_SIBLING_TOP=""
  CL_UNTRUSTED=""
  if [ -z "$locs" ] || [ "$locs" = "?" ]; then
    return 0
  fi
  # shellcheck disable=SC2034 # parts is read below
  IFS=$'\t' read -ra parts <<<"$locs"
  local start_key="$CL_START_TOP"
  [ -z "$start_key" ] && start_key="<start>"
  for loc in "${parts[@]}"; do
    [ -z "$loc" ] && continue
    if [ "$loc" = "<start>" ]; then
      key="$start_key"
    else
      # Non-start locations that reach the single-checkout path below share one
      # toplevel (CL_MULTI handles more than one), so any one represents them.
      [ -z "$CL_REP" ] && CL_REP="$loc"
      case "$loc" in
        /*) abs="$loc" ;;
        *) abs="$CL_START_DIR/$loc" ;;
      esac
      top=$(git -C "$abs" rev-parse --show-toplevel 2>/dev/null || echo "")
      # A location that does not resolve to a toplevel counts as the starting
      # checkout: a nonexistent directory means the cd failed and the commit
      # runs at the start, and an existing non-git directory has no branch to
      # judge.
      key="${top:-$start_key}"
    fi
    case $'\n'"$keys"$'\n' in
      *$'\n'"$key"$'\n'*) : ;;
      *) keys="${keys:+$keys$'\n'}$key" ;;
    esac
  done
  case "$keys" in
    *$'\n'*)
      CL_MULTI=1
      return 0
      ;;
  esac
  [ -z "$CL_REP" ] && return 0
  case "$CL_REP" in
    /*) abs="$CL_REP" ;;
    *) abs="$CL_START_DIR/$CL_REP" ;;
  esac
  target_top=$(git -C "$abs" rev-parse --show-toplevel 2>/dev/null || echo "")
  # Acts when the target's toplevel differs from the start checkout's, or when
  # the start is foreign (a start outside this repository has no toplevel of
  # ours to compare). The common-dir comparison is against the PROJECT's.
  if [ -n "$target_top" ] && { [ "$target_top" != "$CL_START_TOP" ] || [ -n "$CL_START_FOREIGN" ]; }; then
    target_common=$(git -C "$target_top" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || echo "")
    # An unreadable common dir on either side decides nothing.
    if [ -n "$target_common" ] && [ -n "$CL_PROJECT_COMMON" ]; then
      if [ "$target_common" = "$CL_PROJECT_COMMON" ]; then
        CL_ACTION=sibling
        CL_SIBLING_TOP="$target_top"
        if [ "$inert" != "1" ]; then
          CL_UNTRUSTED=1
        fi
      elif [ "$inert" = "1" ]; then
        CL_ACTION=silent
      fi
    fi
  fi
  return 0
}
