---
name: tzurot-review-response
description: 'PR review-response iteration: classify each finding by EDIT SHAPE (trivial → auto-apply as a test-gated fixup commit; semantic → decided when engineering-only, ASK when it carries a product/UX, user-visible, schema, spend, data-rights, or security dimension, changes an existing test assertion, or changes an async boundary or external contract), check reviewer-vs-agent signal conflict, batch-present the four sections, step back at ~3 automated rounds (rule of thumb), and hard-cap at ~6 — hand off to a fresh context or the owner. Invoke with /tzurot-review-response the moment a claude-review or human reviewer posts findings on a PR — before applying anything.'
lastUpdated: '2026-10-11'
---

# Review-Response Iteration

The procedure is the Seyag `review-response` skill (`/review-response`, `seyag:review-response`); load it and follow it. This file holds only what binds it to Tzurot: the PR-monitoring step that invokes it (`05-tooling.md` § PR Monitoring, step 4), ops commands, rule-file pointers, the CI `fixup-check` job, and the driver statement. Every heading below keeps its number so citations (`/tzurot-review-response` rule 2, § 3a, § 5a) land here.

If the seyag plugin is not loaded in this session (a cloud unit or the CI review action may lack it), the pointers below do not resolve: say so, and hand the procedure step to the driver or the owner instead of reconstructing it.

Why this procedure exists, and the key design principle: `seyag:review-response § Why this procedure exists`. When the PR's `claude-review` check quota-walls, run `seyag:review-response § 0. Reviewer unavailable: the quota-wall substitute` first. End-of-round self-check: `seyag:review-response § Checklist for the agent`.

## The rules

### 1. Classify the edit shape first

Procedure: `seyag:review-response § 1. Classify the edit shape first`.

- Security, in the second axis, is scoped by `00-critical.md` § Security.
- The no-modifying-tests constraint behind "changing an existing assertion is always an Ask" is `00-critical.md` § Testing.

### 2. Check for signal conflict

Procedure (the signal-conflict table, origin-language, deferral routing, do-it-now, file-the-batch, backlog candidate, self-contradiction across rounds): `seyag:review-response § 2. Check for signal conflict`. Tzurot bindings:

- **Backlog candidate / tracking surface**: `06-backlog.md`. A one-line follow-up is a tracker task (`pnpm tracker task create`, any promote-when as an annotation in the description); a larger parked idea is a tracker idea doc (`pnpm tracker doc create`). A trigger is optional metadata, never a filing gate (`06-backlog.md` § The admission bar).
- **File the batch**: one PR's worth of sweeping is an idea doc (`pnpm tracker doc create 'Idea: …'`); a pass that needs its own phased rollout is a theme doc plus a `cold/queue.md` bullet. Per `06-backlog.md`'s granularity ladder, those were never follow-up rows.
- **Grep for the batch before creating it**: `pnpm tracker doc search <term>` and `pnpm tracker task list --search <term> --plain`, by the pass's name AND the module it sweeps; if a theme-doc phase or idea doc already owns it, add the finding as a member and say which entry you joined.
- **Origin-language**: "pre-existing" may never be the operative reason in any disposition (`00-critical.md` § Always Leave Code Better Than You Found It). Structural backstop: `pr-merge-review-check.sh` scans the injected review for origin vocabulary and demands per-finding merits dispositions before the merge retry.
- **Process-work PR residue**: `06-backlog.md` § The process-residue default puts the residue of hook, skill, rule, tooling, and CI PRs (substance under `.claude/`, `.husky/`, `packages/tooling/`, `.github/`, tracker/backlog/docs bookkeeping riding along, no runtime or test-infra file touched) into the PR body's `## Residue` section: fixed here, declined with the technical reason, or filed only when it earns `medium` or above. It lands under Backlog candidates tagged `[residue]`; the fails-closed owner-call boundary from `06-backlog.md` § Ruling an item out applies unchanged, and "if declining feels wrong, file it" is the `medium` signal.

### 3. Apply with test-suite gating

Procedure (fixup commit per item, test gate, riders, removing a safety mechanism): `seyag:review-response § 3. Apply with test-suite gating`. Tzurot bindings:

- The package-level test is e.g. `pnpm --filter bot-client test`.
- Rider question (b) includes `schema.prisma` doc comments.
- Fixup-commit cycle: keep fixups through review, autosquash once right before merge, never force-push per round, and `gh pr merge --rebase` does not autosquash (all in `seyag:review-response § 3. Apply with test-suite gating`). The Tzurot mechanics follow and win where the two differ.

Fixup commits autosquash naturally on the next `git rebase --autosquash <base>` (no `-i`, no editor; if `git log --oneline <base>..` still shows a `fixup!` afterwards, this git does not autosquash non-interactively). This is the correct escape valve for a rebase-only workflow — `git revert` is not available on rewritten-history branches, but folding a fixup into its target during the rebase is cheap and native.

**Structural enforcement: the `fixup-check` job in `.github/workflows/ci.yml`** runs on every push to a feature branch and fails if any commit on the branch (since the merge base with develop) has a `fixup!` or `squash!` subject. CI stays red until you autosquash, which means the merge button is gated on it being green — you can't accidentally merge a branch with fixup commits.

The correct pre-merge sequence is:

```bash
# On the feature branch, right before requesting merge:
git rebase --autosquash <base-branch>           # squash all fixups into their targets

# Advisory (non-blocking, TIP COMMIT ONLY — on a multi-commit branch the
# base commit's body is not what `git log -1` shows): enumerations in the
# base body go stale when fixups absorb — counts are what review rounds
# invalidate. Expect prose hits (dates, "one of the…") — re-derive the
# counts, ignore non-claims. Lines are joined first: a count hard-wrapped
# across lines must still match.
git log -1 --format=%B | tr '\n' ' ' | grep -ioE '\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|[0-9]+)\s+[a-z]+' || true

# Re-derive the base body's counts (see below) and amend NON-INTERACTIVELY —
# a bare `git commit --amend` opens $EDITOR and stalls an agent session.
git commit --amend -m "$(cat <<'EOF'
<type>(<scope>): <re-derived subject>

<body re-derived against the FINAL diff — every count and enumeration>

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"

git push --force-with-lease origin <branch>     # CI's fixup-check now passes
gh pr merge <PR#> --rebase --delete-branch      # then merge (or use the web UI)
```

**Amend the base commit's body in that sequence.** Fixup commits never touch the base message, so every count and enumeration written into it at round 0 is stale by merge time — re-derive them against the final diff and amend with the heredoc form above, never a bare `git commit --amend` (which opens `$EDITOR`). Counts and enumerations are the claims a review round most often invalidates, because adding things is what review rounds do — the advisory grep above exists to make them re-derived, not trusted. The merge gate's re-derive prompt covers the PR body, not the commit message. `--amend` reaches only the tip commit, which is the base commit on the ordinary one-semantic-commit-plus-fixups branch. On a multi-commit branch there is no agent-safe form of that pass: `git rebase -i` opens `$EDITOR` on its todo file, exactly the stall a bare `--amend` causes. The one-line escape does NOT exist: `GIT_SEQUENCE_EDITOR=true git rebase -i <base>` accepts the all-`pick` todo verbatim, so it rewrites no message at all — never run `git rebase -i` from an agent session; the non-tip bodies are the owner's interactive job, or the branch is collapsed to a single commit whose body is amended with the heredoc form above. Line-number cites in the body are the first thing to go stale here — prefer grep-token cites (`/tzurot-git-workflow` § Before writing a closing reference in the PR body).

**Final-round one-push exception**: when a round's fixes are the _expected last edits_ (post-autosquash review findings, or a round the agent intends to merge after), combining the fixup with the pre-merge autosquash in ONE force-push is sanctioned — it saves a full CI cycle versus fixup-push → green → autosquash-push → green. Judgment call: use it only when nothing else is expected to change; if the next review finds more, the branch is already squashed and the next fixes start a fresh fixup cycle (no harm, just no savings).

Mid-PR rebase (i.e., autosquash + force-push between review rounds) is reserved for three specific cases, all of which should be rare:

- The user explicitly asks for clean history mid-review.
- A fixup breaks a semantic commit in a way that needs `rebase --edit` to amend (not just autosquash).
- The underlying commit structure itself needs restructuring (splitting a commit, reordering, etc.) — not cosmetic polish.

**"Tidy history for its own sake" is not on that list**: a per-round force-push costs ~4 min of pre-push hook + full CI re-run + claude-review re-run per cycle for zero functional benefit, and risks losing reviewer inline-comment anchors. And do not conflate the rebase-only MERGE strategy (required: `gh pr merge --rebase`, no squash, no merge commits) with a rebase-before-every-push habit — the first is the convention, the second is drift.

### 3a. Review-round fixes are a dispatch, under any driver

Procedure and reason: `seyag:review-response § 3a. Review-round fixes are a dispatch` and `seyag:delegation`. Tzurot driver statement: under Fable, prefer a `SendMessage` resume of the unit's own nested orchestrator (context intact, cache-riding; a fresh spawn re-pays the whole spec). Under Opus or any other single-hop driver, dispatch a fresh worker (`model: sonnet` for mechanical-shape fixes) with the round's findings as the spec. The worker applies the fixes and runs the gates; the main loop reads the diff and the verdict only. Inline application is reserved for a ≤5-line mechanical edit, comment-only edits included (`10-working-posture.md` § Delegation posture). Step-in stays with the main loop on semantic disagreement with the reviewer, or orchestrator uncertainty about the unit's design.

### 4. Batch-present at end of round

Format (the four sections, tags, "never present a raw unified diff", a correction edits the original sentence): `seyag:review-response § 4. Batch-present at end of round`. Tzurot bindings: a `[batch]` item names which theme-doc phase or idea doc now owns the pass (example line: `→ new phase on the owning theme doc (doc-N), this finding is member 1`); a `[residue]` item carries its PR-body disposition, filed only with the sentence that earns it `medium` or above.

### 5. Step back at ~3 automated rounds

Procedure (rule of thumb, round-4 status menu, reset on user intervention): `seyag:review-response § 5. Step back at ~3 automated rounds`. Tzurot binding: "merge as-is" files the remaining items in the appropriate `backlog/**/*.md` file or as tracker tasks.

### 5a. Hard cap at ~6 rounds: hand off, don't keep iterating

Procedure: `seyag:review-response § 5a. Hard cap at ~6 rounds: hand off, don't keep iterating`. Tzurot binding: `pnpm ops gh:ci-gate` prints `REVIEW_ROUND_CAP` at six cycles (`05-tooling.md` § PR Monitoring); the fresh-context implementer is dispatched per `/tzurot-orchestration`.

## Edit-shape whitelist

Lists and extension procedure: `seyag:review-response § Edit-shape whitelist`. Tzurot bindings:

- **Test-only addition**: touching `knownGaps`/baseline files is excluded (`00-critical.md` § Test Coverage Baseline forbids widening those).
- **Documentation-only addition** covers `BACKLOG.md`, `backlog/**/*.md`, release notes, `CHANGELOG.md`, `README.md`, and anything under `docs/`; it still excludes `.claude/rules/*.md` and `.claude/skills/*/SKILL.md`.
- A `backlog/**/*.md` addition to a file the PR hasn't touched is still a trivial-shape edit.

## Relationship to the rules

- **`00-critical.md`** § "Merge Approval" governs the merge gate (standing authorization for feature/fix PRs once truly ready; the release PR always needs explicit approval). This procedure governs iteration _before_ that gate; nothing here loosens it.
- **harness `core.md`** § Safety ("Never modify a test, lint rule or guard just to get past it") remains in force. The test-suite gate in rule 3 fails closed.
- **`05-tooling.md`** PR-monitoring step 4 delegates to this skill.
- **`06-backlog.md`** out-of-scope tracking still applies: follow-ups are filed as tracker tasks (or the appropriate `backlog/**/*.md` file) per rule 4's "Backlog candidates" section, except low-priority process-work residue, which `06-backlog.md` § The process-residue default keeps in the PR body.
