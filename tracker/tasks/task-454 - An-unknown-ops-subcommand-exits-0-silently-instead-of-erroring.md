---
id: TASK-454
title: An unknown ops subcommand exits 0 silently instead of erroring
status: Done
assignee: []
created_date: '2026-08-07 00:56'
updated_date: '2026-08-07 02:34'
labels:
  - 'area:tooling'
  - 'size:S'
dependencies: []
priority: medium
ordinal: 453000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
pnpm ops no:such:command prints nothing and exits 0. An operator typo in the subcommand name is indistinguishable from success — no message, no nonzero exit, no help text.

This is the same class the UsageError work (PR 1990) exists to fix: a mistake the operator can correct by retyping should surface as a clean one-line message and a nonzero exit. It was verified as PRE-EXISTING during that PR (checked against the unmodified cli.ts at HEAD before the branch, which behaved identically), so it is not a regression from that work — but it was left only as a note in the PR body, and per 06-backlog.md a PR-body mention is not tracking. Surfaced again by the 1990 round-3 review, which searched tracker/tasks/ and found nothing.

Mechanism: cac dispatches to a default command or to nothing when no registered command matches. cli.ts registers no default command and no command:* handler, so an unmatched name falls through runMatchedCommand as a no-op — nothing throws, so the new top-level handler never sees it.

Fix shape: register a fallback that throws a UsageError naming the unknown command and pointing at pnpm ops --help. cac exposes a command:* event and supports a default command; either would do. Keep the message shape consistent with the other usage errors (one line, no stack).

Acceptance: pnpm ops no:such:command prints one line naming the unknown command and exits nonzero.

MEMBER (1990 round-3 finding 3): packages/tooling/src/memory/backfill-facts.ts lines 85 and 203 still throw plain Error for windowSize and --limit validation, the same operator-facing shape converted to UsageError everywhere else. NOT reachable via the CLI today — memory.ts registerBackfillFactsCommand validates both flags with parseIntFlag before calling backfillFacts, so these are defense-in-depth guards. Convert them in the same pass for consistency.
<!-- SECTION:DESCRIPTION:END -->
