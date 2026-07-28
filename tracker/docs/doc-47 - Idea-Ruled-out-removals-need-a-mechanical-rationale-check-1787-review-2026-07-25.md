---
id: doc-47
title: >-
  Idea: Ruled-out removals need a mechanical rationale check (#1787 review,
  2026-07-25)
type: other
created_date: '2026-07-28 11:11'
---

## Ruled-out removals need a mechanical rationale check (#1787 review, 2026-07-25)

`06-backlog.md`'s **ruled out** exit lets a backlog item be removed on a deliberate decision, guarded by rules: a technical reason stated in the removing commit, merit-not-cost, owner's call for anything user-visible/taste/security, per-item evidence in a batch removal, and a fails-closed nit boundary. The #1787 review flagged the honest weakness — every one of those guards leans on discipline, while several neighbouring rules in that file get an enforcement mechanism (`pr-merge-review-check.sh` scans review bodies for origin vocabulary before allowing a merge retry). The exit that DELETES tracked work is the one currently running on memory.

**Fix shape**: extend `pnpm ops backlog` (or a `.husky` hook, whichever the trigger fits) so a commit that removes rows from `backlog/**/*.md` must carry a rationale — and, mirroring the origin-language scan already in `pr-merge-review-check.sh`, must NOT carry the disallowed reasons ("it's old", "pre-existing", "stale", "nobody got to it", "the trigger never fired"). A bare `docs(backlog): cleanup` touching removals is exactly the rug the exit is written to prevent, and it's mechanically detectable: `git diff` the tracked backlog files for net-removed table rows, then pattern-match the commit message.

**Design questions**: (a) hook vs `pnpm ops` check — a pre-commit hook catches it at authorship where the message is still editable, which argues for the hook, but hooks are skippable with `--no-verify`; (b) how to distinguish a *removal* from a *move* (an item promoted from the tracker into an idea doc is not a rule-out and must not demand a rationale) — probably net-count across `backlog/**` files + `tracker/tasks/` (post-flip, a rule-out is a task archive/deletion, so the check watches that surface too) rather than per-file; (c) whether shipped-item removals (the common case, per the session-end gate) should be exempt, and if so how they self-identify.

**Promote when**: the first batch of rule-outs is about to be written — i.e. when draining the ~55 scattered singletons in the tracker pool reaches the point of ruling any out. Doing it before that is speculative; doing it after is a post-hoc audit of removals nobody can re-check. Filed rather than built in #1787 because it's a real tool feature with its own tests, and the rule it guards says a batch goes up the ladder instead of riding the PR that noticed it.

