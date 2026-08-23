#!/bin/bash
# Tracker-dirty push gate — called from .husky/pre-push.
#
# A filed tracker task is invisible to every backlog query until COMMITTED.
# `pnpm ops backlog` prints a warn-level notice for uncommitted tracker files,
# and that warning was read past twice in one session (four filed-but-never-
# committed tasks across the 2026-08-09..12 window, one AFTER the warning
# shipped) — warn-level output does not constrain at long context, so this
# GATES at the one deterministic moment it can: the push (2026-08-12 mining,
# R3; owner-approved).
#
# CI stays un-gated on purpose (the backlog gate's exit-neutrality there is a
# recorded decision in 05-tooling.md); this is a LOCAL gate only. Bypass for
# the rare intentional case:
#
#   TZUROT_ALLOW_UNCOMMITTED_TRACKER=1 git push ...
#
# Fail-open on anything that is not a clear "tracker/ is dirty": not a git
# repo, git errors, no tracker/ dir. A broken gate must not block pushes.

set -uo pipefail

[ -n "${TZUROT_ALLOW_UNCOMMITTED_TRACKER:-}" ] && exit 0

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
[ -d "$ROOT/tracker" ] || exit 0

DIRTY=$(git -C "$ROOT" status --porcelain -- tracker/ 2>/dev/null) || exit 0
[ -z "$DIRTY" ] && exit 0

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

printf "${RED}✖ Uncommitted tracker/ files — a filed task is invisible to every backlog query until committed:${NC}\n" >&2
printf '%s\n' "$DIRTY" >&2
# Branch-aware remediation: "commit them first", read on a feature branch, is
# precisely the instruction that produces a board-commit-on-feature-branch
# mis-commit (recovered 3x; board-commit-branch-gate.sh is the hard stop).
BRANCH=$(git -C "$ROOT" branch --show-current 2>/dev/null || echo "")
case "$BRANCH" in develop | main | '' | release/* | chore/release-*) BOARD_SAFE=1 ;; *) BOARD_SAFE=0 ;; esac
if [ "$BOARD_SAFE" = 1 ]; then
    printf "${YELLOW}  Commit them first (tracker/ files may be committed directly to develop),${NC}\n" >&2
else
    printf "${YELLOW}  You are on '%s' — switch to develop and commit them THERE (a tracker${NC}\n" "$BRANCH" >&2
    printf "${YELLOW}  commit on a feature branch strands the task on a branch no query reads),${NC}\n" >&2
fi
printf "${YELLOW}  or bypass once with: TZUROT_ALLOW_UNCOMMITTED_TRACKER=1 git push ...${NC}\n" >&2
exit 1
