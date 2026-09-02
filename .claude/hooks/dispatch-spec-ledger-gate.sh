#!/bin/bash
# PreToolUse hook (matcher: Agent) — a dispatch spec referenced from an Agent
# prompt must carry a `## Premise ledger` section.
#
# Why: a spec's runtime premises are the half a worker cannot check for itself.
# The premises that failed all looked correct on the page; the ledger is what
# turns each one into a re-verification the orchestrator actually runs
# (/tzurot-orchestration § The spec template, item 1).
#
# Scope is deliberately narrow: only a prompt that NAMES a spec file under
# `docs/local/dispatch/` is gated, and only when that file exists on disk. A
# dispatch with its instructions inline, or a prompt naming a spec that has not
# been written yet, is not this gate's business (exit 0).
#
# This gate enforces the section's PRESENCE, not its quality — the quality is
# the orchestrator's re-verification, which no hook can see.
#
# Fail-open on any internal error (missing jq, unreadable prompt, a spec file
# grep cannot read): a broken gate must never block a real dispatch. Only a
# readable spec that genuinely lacks the section blocks.

set -uo pipefail

INPUT=$(cat)

TOOL_NAME=$(jq -r '.tool_name // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ "$TOOL_NAME" = "Agent" ] || exit 0

PROMPT=$(jq -r '.tool_input.prompt // empty' <<<"$INPUT" 2>/dev/null || echo "")
[ -z "$PROMPT" ] && exit 0

# Only the FIRST spec path named in the prompt is checked: one spec per
# dispatch is the convention, so a second named path is normally a template or
# reference the worker reads rather than the spec it must satisfy.
#
# The leading character class absorbs an
# absolute prefix (the orchestrator is routinely told to read the spec from the
# MAIN checkout, which is an absolute path), so both forms resolve.
SPEC=$(grep -oE '[A-Za-z0-9._/-]*docs/local/dispatch/[A-Za-z0-9._-]+\.md' <<<"$PROMPT" 2>/dev/null | head -n 1)
[ -z "$SPEC" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
case "$SPEC" in
  /*) RESOLVED="$SPEC" ;;
  *) RESOLVED="$PROJECT_DIR/$SPEC" ;;
esac

# A named-but-absent spec is not this gate's job — the dispatch will fail on its
# own first read, with a clearer error than anything this hook could print.
[ -f "$RESOLVED" ] || exit 0

# grep's exit codes are three-valued and only ONE of them means "the section is
# genuinely absent": 0 = found, 1 = no match, 2 (or anything else) = grep could
# not READ the file. Collapsing that to "non-zero blocks" turns an unreadable
# spec into a block, which is the fail-closed direction this gate must never
# take.
grep -qiE '^##+ *Premise ledger' "$RESOLVED" 2>/dev/null
GREP_STATUS=$?

if [ "$GREP_STATUS" -eq 0 ]; then
  exit 0
fi

if [ "$GREP_STATUS" -ne 1 ]; then
  echo "dispatch-spec-ledger-gate: could not read $RESOLVED (grep exit $GREP_STATUS) — failing open" >&2
  exit 0
fi

cat >&2 <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DISPATCH SPEC — no \`## Premise ledger\` section
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  $RESOLVED

Every dispatch spec carries a \`## Premise ledger\` section: one row per
runtime premise the spec asserts, naming the read or probe that
established it and how the orchestrator re-verifies it before building
on it. A premise that only looks correct on the page is the failure
shape this section exists to catch.

Two rows are mandatory in every ledger:
  - the grep for the FIX'S OWN NAME — is it already built?
  - the grep for a PRIOR TASK ID or shipped PR that already covers it

Add the section to the spec, then retry the dispatch.
(/tzurot-orchestration § The spec template, item 1. This gate checks
the section is PRESENT; its quality is your re-verification's job.)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
exit 2
