# Branch Protection

Both `main` and `develop` are protected by **rulesets**. Classic branch protection is no
longer used anywhere in this repo.

**These JSON files are a record of the live configuration, not its source.** GitHub does
not read them; they are applied by hand via the API. Verify against live before trusting
them (commands below) — this directory previously described a configuration that had never
been applied, and drifted unnoticed for over a year.

| Branch    | Ruleset                          | ID         | Snapshot                  |
| --------- | -------------------------------- | ---------- | ------------------------- |
| `main`    | Solo Developer Branch Protection | `5788828`  | `branch-protection.json`  |
| `develop` | Develop Branch Protection        | `20512308` | `develop-protection.json` |

Those two files are the whole directory. Three leftover import variants from the original
repo setup once sat here describing a combined `main`+`develop` ruleset that was never
applied anywhere; they were deleted rather than kept, because importing one would have
created a third ruleset overlapping the two live ones. **Keep it that way** — one snapshot
per live ruleset, no speculative variants. Git history has them if they are ever wanted.

## How they differ, and why

|                       | `main`       | `develop`                |
| --------------------- | ------------ | ------------------------ |
| Pull request required | yes          | yes                      |
| Merge method          | rebase only  | rebase only              |
| Branch deletion       | blocked      | blocked                  |
| Linear history        | required     | required                 |
| Required checks       | the 12 below | those 12 + `fixup-check` |
| Force-push            | blocked      | **allowed**              |
| Admin bypass          | **never**    | **always**               |
| Copilot review        | on           | **off**                  |

**`allowed_merge_methods` lives inside the `pull_request` rule, so a branch with no
`pull_request` rule has no merge-method enforcement at all.** That is why `develop`
carries one despite direct doc-commits being allowed: `required_linear_history` blocks
merge commits, but a squash is a single linear commit and slips straight past it — so
without this rule the "NO SQUASH" half of `CLAUDE.md`'s REBASE-ONLY policy was
unenforced on the branch that receives every feature merge. The admin bypass is what
keeps direct doc-commits working alongside it; a push reports both bypassed rules:

```
remote: Bypassed rule violations for refs/heads/develop:
remote: - N of N required status checks are expected.
remote: - Changes must be made through a pull request.
```

(Both lines are what a real direct doc-push reports — the pull-request rule is bypassed
alongside the checks, which is what confirms the two coexist.)

The last three differences are load-bearing — do not "tidy" them into parity with `main`:

- **Force-push allowed.** `pnpm ops release:finalize` rebases `develop` onto `main` and
  force-pushes. The `develop` ruleset therefore carries no `non_fast_forward` rule.
- **Admin bypass.** It is what lets the sanctioned direct doc-commits
  (`00-critical.md` § Direct doc commits) push without a PR and without checks having run.
  Removing the bypass actor breaks that workflow — and, per the block above, also the
  merge-method enforcement's ability to coexist with it.

The last of those is a live open choice rather than a constraint:

- **Copilot review runs on `main` only.** The `copilot_code_review` rule predates the
  `develop` ruleset and was never extended to it. The defensible reading is that `main`
  PRs are release PRs — few, high-stakes, worth a second automated reader — while every
  feature PR already gets `claude-review` on the way into `develop`, so adding Copilot
  there doubles review volume on the branch that carries the most traffic. Extending it
  to `develop` is a one-rule edit if that tradeoff is ever wanted.

## Required status checks

Both branches require these 12:

`lint` · `build` · `unit-tests (ai-worker | api-gateway | bot-client | packages | tooling | website)` ·
`component-integration-tests` · `docker-build-smoke-ok` · `voice-engine-tests` · `mutation-tests`

Chosen because they always run and must always be green. Deliberately **excluded**:
`codecov/patch`, `CodeQL`, `GitGuardian Security Checks`, `claude-review` — third-party or
advisory checks whose external flakiness should not hard-block a merge. `claude-review` is
enforced instead by `.claude/hooks/pr-merge-review-check.sh`, which blocks the merge until
the review body has been read. **`CodeQL` is path-filtered and genuinely does not run on
some PRs** (a docs-only PR touching this directory produced no CodeQL run at all) — as a
required context it would leave those PRs permanently unmergeable.

**`develop` additionally requires `fixup-check`; `main` must NOT.** The job blocks a merge
while unsquashed `fixup!`/`squash!` commits remain, so requiring it on `develop` gives that
structural teeth against a UI merge (agent discipline is not the only path in). But it is
`if:`-gated off for `main` and `develop` refs, and on a release PR — whose head ref IS
`develop` — it reports **`skipping`**, not `pass` (observed on release PR #1979). Requiring
it on `main`, where there is **no bypass actor**, risks permanently deadlocking every
release PR. The asymmetry is the point; do not "fix" it into symmetry.

`strict` is **off** on both, and that was decided rather than defaulted. Turning it on
requires every PR to be up to date with its base before merging, which would catch the
class where a green PR's CI ran against a stale base and `gh pr merge --rebase` does not
re-run it. Three reasons it loses here:

- **The base moves for non-code reasons.** Sanctioned direct doc-commits to `develop`
  (tracker close-outs, `CURRENT.md`) land several times a day, and each one would strand
  every open PR into a rebase plus a full CI cycle. The tax is per-base-movement, not
  per-PR.
- **It would not hold anyway.** `develop`'s bypass actor is `always`, so it would be
  routinely merged through — and a gate that is habitually bypassed is worse than none:
  it trains the reader to skim past `Bypassed rule violations`, the same line that
  reports something real.
- **On `main` it is near-inert.** `release:finalize` rebases `develop` onto `main`, so
  `develop` already contains `main`'s tip by construction; strict would fire only in the
  gap between a direct `main` change and the next finalize.

The underlying risk is real but is better handled by rebasing open PRs when the base moves
_meaningfully_ (a dependency bump, a shared-module change) — a judgment `strict` cannot
make, since it cannot tell a lockfile bump from a `CURRENT.md` edit. **Revisit if** a
second contributor appears, or work becomes genuinely parallel across branches touching
the same modules; today it is sequential.

`docker-build-smoke-ok` is a join job over the six docker matrix legs (five services plus
the `rotzot`-branded website build) — it exists to be ONE stable required-check name, so
adding a leg does not require a protection edit.

## Reading the live config

```bash
gh api repos/lbds137/tzurot/rulesets                    # both, with IDs
gh api repos/lbds137/tzurot/rulesets/5788828            # main
gh api repos/lbds137/tzurot/rulesets/20512308           # develop

# What actually applies to a branch (resolves every ruleset that matches it)
gh api repos/lbds137/tzurot/rules/branches/develop
```

`rules/branches/{branch}` resolves rule TYPES, not bypass actors — check
`current_user_can_bypass` on the ruleset itself for that (`never` on `main`, `always` on
`develop`).

## If a release PR cannot merge because CI infrastructure is down

`main` has **no bypass actor at all** — not even the owner. That is deliberate
(`00-critical.md`: bypassing CI is forbidden), but it means an Actions outage or a wedged
required check has no fast escape hatch. The recovery path is to edit the ruleset:
temporarily set `enforcement` to `"evaluate"` (reports without blocking) or drop the
affected context, merge, then `PUT` the snapshot back. Reach for this only for genuine
infrastructure failure, never to merge past a real red check — and restore immediately,
because the snapshot in this directory is the only record of what the ruleset should be.

## Re-applying after drift or an accidental edit

Each snapshot is a verbatim copy of its live ruleset. `PUT` is a **full-object replace** —
every rule must be present in the payload or it is silently dropped.

```bash
gh api -X PUT repos/lbds137/tzurot/rulesets/5788828  --input .github/rulesets/branch-protection.json
gh api -X PUT repos/lbds137/tzurot/rulesets/20512308 --input .github/rulesets/develop-protection.json
```

To recreate one from scratch (IDs change), `POST` to `repos/lbds137/tzurot/rulesets` with
the same payload, then update the IDs above.

**Renaming a CI job is a two-step change.** A required context that never reports blocks
merges forever, and on `main` there is no bypass. Update the protection snapshot and apply
it in the same change as the `ci.yml` rename.
