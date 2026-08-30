---
id: TASK-787
title: Split the server target out of /deny add everywhere
status: Done
assignee: []
created_date: '2026-08-28 02:41'
updated_date: '2026-08-30 23:53'
labels:
  - 'area:bot-client'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 787000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner verdict from the beta.209 smoke run (2026-08-28, TASK-764 acceptance pass): it is confusing that /deny add everywhere accepts either a user OR a server. index.ts:153-165 — everywhere is the only subcommand exposing server: (a server denial is bot-wide by definition), so it carries two OPTIONAL target options (user:, server:) while every sibling scope subcommand is single-target with a required user:. Two target types under one scope word breaks the scope-first symmetry the redesign bought.

Fix shape (proposal — final naming is owner taste, veto on the PR): make everywhere single-target (user: required), and give server denials their own scope subcommand (e.g. /deny add server + /deny remove server, server: required), so every subcommand names exactly one target shape and no optional-pair validation is needed. Sweep the runtime validation that currently arbitrates the user/server pair, and pnpm test:component for the command-structure snapshots.

Acceptance: each /deny add|remove subcommand takes exactly one target option, required; the old dual-optional everywhere shape is gone; component snapshots updated; owner confirms the naming reads right.

SHIPPED in PR 2262 (merge ba435b81e), four review rounds. Clauses 1-3 met and pinned: a describe.each over both groups asserts the full subcommand list AND that each subcommand exposes exactly one required target option, so everywhere's optional-to-required flip is pinned alongside the new server subcommand; the user/server XOR in resolveDenyTarget is deleted as genuinely unreachable; both generated fixtures (component snapshot and command-manifest.json) regenerated.

CLAUSE 4 GOT A QUALIFIED ANSWER, 2026-08-30, and the owner closed this task on it. From the live picker check: "this is probably an improvement over how the deny command used to work, but I wouldn't say this is the final state. I think it's still kind of confusing." The remaining confusion is a DIFFERENT problem from the one this task fixed — the subcommand slot names the SCOPE for four entries and the TARGET for one, so the picker never says what is being denied. That is filed as doc-87 and is not a reason to keep this task open: 787's scope was the dual-optional shape defect, which is gone. Leaving it open against "the naming is finally right" would make it unclosable against a moving target.

FALSIFIED CLAIM, recorded so it is not repeated: this task and PR 2262 both asserted that the new subcommand sits beside everywhere "in registration order". The owner screenshot shows the picker rendering channel, character, everywhere, server, this-server — ALPHABETICAL. Discord ignores registration order in that list. The claim was never verified against a client before being written into a commit message and a PR body. Adjacency can only be influenced by choosing names that sort together; see doc-87.

INTERIM IMPROVEMENT SHIPPING SEPARATELY (owner call, same exchange): the three scope subcommands whose descriptions do not name the target get it added, so the picker stops being silent about who is denied. everywhere and server already name theirs.
<!-- SECTION:DESCRIPTION:END -->
