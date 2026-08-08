#!/bin/bash
# Shared detection: does a Bash tool command string invoke `git commit`?
#
# NO RUNTIME CONSUMER. claim-shape-guard.sh used to source this; it moved to a
# husky channel and now keys off git state (the staged diff), which needs no
# command-text matching at all. What remains is the CANONICAL REFERENCE
# copy of the pattern: develop-code-commit-guard.sh and git-commit-filter-guard.sh
# carry equivalent Python-side logic, and
# packages/tooling/src/dev/gitCommitPatternAgreement.test.ts extracts all three
# and runs them over a shared case table — change one without the others and it
# names the copy that drifted.
#
# Keeping a consumer-free reference is a deliberate call, not an oversight: the
# two live copies are Python regexes inside blocking hooks, and a language-
# neutral third copy is what the agreement test compares them against. If that
# stops earning its keep, delete this file and reduce the test to two sources.

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
