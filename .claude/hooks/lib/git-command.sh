#!/bin/bash
# Shared detection: does a Bash tool command string invoke `git commit`?
# Sourced by claim-shape-guard.sh and fixup-rider-check.sh — the regex lives
# here so a future tweak (new global-flag shape, new commit variant) lands in
# one place. (develop-code-commit-guard.sh and git-commit-filter-guard.sh
# carry equivalent Python-side logic — sync manually if the shape changes.)

# is_git_commit_command <command-string> → exit 0 when the string invokes
# `git commit`, tolerating global flags (`git -C path commit`, `git -c k=v
# commit`) and every commit variant (--fixup, --amend, heredoc bodies). The
# trailing ([^-a-zA-Z0-9_]|$) keeps plumbing subcommands (commit-tree,
# commit-graph) from matching — a bare \b treats the hyphen as a boundary.
# Scope is literal `git commit` only: revert/cherry-pick/merge also advance
# HEAD without firing (accepted — the guarded pattern is authored commits).
# The \b in the git anchor is a GNU-grep extension; fine on this project's
# Linux environment, would need rework under BSD/macOS grep.
is_git_commit_command() {
    grep -qE '\bgit([[:space:]]+-{1,2}[^[:space:]]+([[:space:]]+[^[:space:]]+)?)*[[:space:]]+commit([^-a-zA-Z0-9_]|$)' <<<"$1"
}
