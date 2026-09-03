---
name: tzurot-review-response
description: 'PR review-response iteration: classify each finding by EDIT SHAPE (trivial → auto-apply as a test-gated fixup commit; semantic → ASK), check reviewer-vs-agent signal conflict, batch-present the four sections, step back at ~3 automated rounds (rule of thumb), and hard-cap at ~6 — hand off to a fresh context or the owner. Invoke with /tzurot-review-response the moment a claude-review or human reviewer posts findings on a PR — before applying anything.'
lastUpdated: '2026-09-02'
---

# Review-Response Iteration

When `claude-review` or any PR reviewer returns findings, the agent follows this procedure **instead of** asking the user about every item. Applied from step 4 of the PR-monitoring procedure in `05-tooling.md`.

## Why this procedure exists

This procedure shifts trivial chores to auto-apply (under tight constraints) while preserving explicit approval for anything that changes program behavior.

**Key design principle**: `claude-review` is the same model family as the agent. It has no special epistemic authority. When the reviewer's severity label conflicts with the agent's own classification, that's **uncertainty**, not an override opportunity in either direction. The safe resolution is always ASK.

## The rules

### 1. Classify the edit shape first

Before applying any review suggestion, classify the concrete diff the agent would produce. Match against the whitelists in "Edit-shape whitelist" below.

- Matches a **trivial-shape** whitelist entry → eligible for auto-apply (continue to rule 2)
- Matches an **explicit non-trivial** entry → ASK (skip to rule 4)
- Matches neither → default to semantic-shape → ASK (skip to rule 4)

**Unclassifiable defaults to semantic.** The whitelist fails closed.

Line count is not a classifier. A one-line regex-flag change is semantic; a 20-line scope-local rename is trivial.

### 2. Check for signal conflict

Compare the reviewer's severity label against the edit shape from rule 1:

| Reviewer says                                                                                                 | Agent classifies | Result                                                                                                               |
| ------------------------------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------- |
| "nit / minor / not blocking"                                                                                  | trivial          | **Continue** (aligned)                                                                                               |
| "nit / minor / not blocking"                                                                                  | semantic         | **ASK** (disagreement)                                                                                               |
| "medium / blocking / must fix"                                                                                | trivial          | **ASK** (disagreement)                                                                                               |
| "medium / blocking / must fix"                                                                                | semantic         | **ASK** (aligned on severity)                                                                                        |
| Self-dismisses ("actually fine")                                                                              | Agent agrees     | **DISMISS** (note in summary)                                                                                        |
| Self-dismisses                                                                                                | Agent disagrees  | **ASK** (with dissenting analysis)                                                                                   |
| Scopes a finding by origin ("pre-existing" / "not a regression" / "not introduced here")                      | Any              | **MERITS JUDGMENT** (origin ≠ verdict; see below)                                                                    |
| Contradicts own round-(N-1) call on same item                                                                 | Any              | **DISMISS** (cite prior round's rationale)                                                                           |
| Defers to future work in THIS file/diff ("next time you touch this")                                          | Any              | **DO IT NOW** (colocated and small by construction — filing costs more than fixing; see below)                       |
| Defers to a named cross-file batch ("next X pass/sweep", "worth a follow-up PR")                              | Any              | **FILE THE BATCH** up the granularity ladder — track the pass, not a row awaiting it (see below)                     |
| Defers action on a named OBSERVABLE ("monitor over time" / "if the retry count grows" / "when p95 exceeds X") | Any              | **BACKLOG CANDIDATE** (an observable must be named; pure-aesthetic deferrals → Dismissed; track per `06-backlog.md`) |

**Any disagreement between reviewer and agent defaults to ASK.** Neither side has special authority, and uncertainty is the honest state when signals conflict.

**Origin-language is not a disposition.** "Pre-existing," "not a regression," "not introduced by this PR," and "consistent with existing code" are claims about where a behavior came from, not whether it is correct — a reviewer using them is scoping blame, not issuing a verdict, and such phrasing must not be pattern-matched to the self-dismissal rows above. A finding scoped by origin routes to a merits judgment landing on exactly one of: (a) **fix now** (ride-along or follow-up PR), (b) **backlog entry** with a promote-when trigger, or (c) **correct-as-is** with the technical argument stated in the round summary (e.g. "client-side abort can't interrupt the executor-thread inference, so cancellation buys nothing" — a real reason, where "it was already like that" is not). "Pre-existing" may never be the operative reason in any disposition (`00-critical.md` § Always Leave Code Better Than You Found It). Second-hand adoption counts as the same failure: laundering a dismissal through the reviewer's framing ("reviewer says it's not a regression") is identical to saying it yourself. Structural backstop: `pr-merge-review-check.sh` scans the injected review for origin vocabulary and demands per-finding merits dispositions before the merge retry.

**Where a deferred finding goes** — decided by **what would have to happen for it to be picked up again**:

| The reviewer's deferral rests on...                                                                          | Disposition           |
| ------------------------------------------------------------------------------------------------------------ | --------------------- |
| Future work in **this file or diff** ("next time you touch this")                                            | **Do it now**         |
| A **named batch across files** ("next tooling-DRY pass", "next `.claude/rules` PR", "a follow-up sweep")     | **File the batch**    |
| An observable outside our control (a user report, a metric threshold, a provider change, a feature arriving) | **Backlog candidate** |
| Nothing — taste, or a self-dismissal ("actually fine", "could be cleaner someday")                           | **Dismissed**         |

**Do it now** is the disposition that defaults wrong without this rule. The finding is also, by construction, **small and colocated** — the reviewer named this PR's own code — so the file is already open and the fix is usually smaller than the row describing it. Fix it here.

Do-it-now sends the finding back through **rule 1**, not around it: a trivial-shape fix auto-applies under the test gate and reports under Auto-applied; a semantic-shape one still ASKs and reports under Asks. This disposition changes the destination, never the safety rails.

**A rejected do-it-now does not evaporate — re-route it.** When the user rejects the fix (or a trivial-shape one fails its test gate and escalates to an Ask that's then rejected), the finding has been neither fixed nor tracked, and do-it-now filed nothing by design. That is the only path in this table that can end in _neither_, which is exactly the silent-loss this rule exists to prevent. On rejection, **default to backlog candidate** and report it under Backlog candidates in the same round summary. Re-route to **file the batch** only when the rejection itself reveals the finding belongs to an already-named cross-file pass — the ordinary case cannot, because do-it-now's own classifying condition is _this file or diff_, and file-the-batch is for a pass rather than a place. The user rejecting _this fix, now_ is not a decision to forget the finding — only an explicit "don't track this either" is, and that reads as **Dismissed**.

**File the batch** is the one to reach for when the reviewer named a _pass_ rather than a _place_. "Next tooling-DRY pass" describes work across files this PR never opens — so "colocated and small" is false, and do-it-now would be wrong. But a row waiting to be noticed during that pass is equally wrong: nobody rediscovers it. **Track the pass itself** — a theme-doc phase or a tracker idea doc that owns the whole batch — and let this finding be one of its members. Which of the two: **one PR's worth of sweeping → an idea doc (`pnpm tracker doc create 'Idea: …'`); needs its own phased rollout → a theme doc + `cold/queue.md` bullet.** Same disposition for a finding that's simply too big for this PR (needs a migration, crosses a service boundary, would double the diff). Per `06-backlog.md`'s granularity ladder, those were never follow-up rows.

**Grep for the batch before creating it.** Different PRs surface the same pass repeatedly ("next tooling-DRY pass" appears from whichever file the reviewer happened to be reading), so a rule that files a fresh section each time reproduces the fragmentation it was written to fix, one rung higher. Search the doc store (`pnpm tracker doc search <term>`) and the tracker (`pnpm tracker task list --search <term> --plain`) for the pass by name AND by the module it sweeps; if a theme-doc phase or idea doc already owns it, **add this finding as a member** and say which entry you joined. Only create a new one when the search is genuinely empty.

**Backlog candidate** is the honest deferral. File it at the granularity-appropriate destination (a one-line follow-up → a tracker task via `pnpm tracker task create`, with any promote-when as an annotation in the description; a larger parked idea → a tracker idea doc via `pnpm tracker doc create`), capturing both the concern and the criterion. (A trigger is optional metadata on the item, never a filing gate — per `06-backlog.md` § The admission bar.)

**Dismissed** closes the matter; note it in the summary and move on. A reviewer self-dismissal ("non-issue," "current is correct") that the agent agrees with has no trigger, and neither does a vague preference with no named event.

**Reviewer self-contradiction across rounds**: when round-N reviewer reverses its round-(N-1) stance on the same item (e.g., round 3 says "drop the `?? ''` as unreachable," round 4 says "add `?? ''` back for defensive typing"), the reviewer is not authoritative on its own prior disagreement. Dismiss and cite the earlier round's reasoning in the summary. Don't ping-pong. This is distinct from genuine new information surfacing — a round-N reviewer observation that _builds on_ round-(N-1) (adds context, corrects an error) is normal; a direct reversal on the same fact-pattern is noise.

### 3. Apply with test-suite gating

For items that passed rules 1 and 2 (trivial-shape + no conflict):

1. Apply the edit as a `git commit --fixup=<target-sha>` commit. `target-sha` is the original commit that introduced the code being changed.
2. Run the package-level test for the modified file (e.g., `pnpm --filter bot-client test`).
3. Tests pass → keep the fixup commit.
4. Tests fail → **escalate to ASK immediately**, with the test failure output attached. A trivial-shape edit that breaks tests is the signal that the whitelist mis-classified it; escalation preserves the safety net.

**Riders are caught at review, not at commit.** A fix that ADDS code rather than changing it gets systematically less scrutiny than planned work — "one clause" / "~10 lines" is exactly the size that skips the checks a planned change gets.

The three questions below are **review-side** — what a flagged rider is usually failing, not a ritual to recite before committing; at commit time the rider is already written and the cheap answer is "it's fine".

- (a) Does the addition need its own test? (New function/branch → yes by default; "it's small" is not an exemption.)
- (b) Does it stale a comment or doc elsewhere — including `schema.prisma` doc comments and files the fix doesn't touch?
- (c) Does moving code between files change what a coverage or mutation gate measures? (Extraction can drop a module below a per-file gate that the old file's average was hiding.)

Rule 3's test gate catches breakage; these catch absence.

**Removing a safety mechanism to satisfy a review finding gets the FULL
argument, written against the final diff.** When a fix removes a transaction,
lock, guard, or retry as "unnecessary", check the justifying argument against
the code that will actually run, line by line — not the code the argument
pictures — and write the justification AFTER reading the final diff, never
before. Pin the property the argument rests on with a test where one is
assertable.

Fixup commits autosquash naturally on the next `git rebase -i --autosquash`. This is the correct escape valve for a rebase-only workflow — `git revert` is not available on rewritten-history branches, but fixup-drop during interactive rebase is cheap and native.

**When is "the next rebase"?** Once, **right before merge**, not after each round. Keep fixup commits visible through review iteration and just `git push` them — do not `rebase --autosquash` and do not force-push between rounds. Fixup commits sitting on the branch as `fixup! <target message>` are fine through review; reviewers and CI can read them.

**Critical: `gh pr merge --rebase` does NOT autosquash fixup commits.** It runs `git rebase`, not `git rebase --autosquash`. Fixup commits will land on the base branch with their `fixup!` titles intact and clutter `git log` permanently.

**Structural enforcement: the `fixup-check` job in `.github/workflows/ci.yml`** runs on every push to a feature branch and fails if any commit on the branch (since the merge base with develop) has a `fixup!` or `squash!` subject. CI stays red until you autosquash, which means the merge button is gated on it being green — you can't accidentally merge a branch with fixup commits.

The correct pre-merge sequence is:

```bash
# On the feature branch, right before requesting merge:
git rebase --autosquash <base-branch>           # squash all fixups into their targets

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

**Amend the base commit's body in that sequence.** Fixup commits never touch the base message, so every count and enumeration written into it at round 0 is stale by merge time — re-derive them against the final diff and amend with the heredoc form above, never a bare `git commit --amend` (which opens `$EDITOR`). The merge gate's re-derive prompt covers the PR body, not the commit message. `--amend` reaches only the tip commit, which is the base commit on the ordinary one-semantic-commit-plus-fixups branch. On a multi-commit branch there is no agent-safe form of that pass: `git rebase -i` opens `$EDITOR` on its todo file (probed — a recorder editor was invoked and the rebase stalled), exactly the stall a bare `--amend` causes. So the non-tip bodies are the owner's interactive job, or the branch is collapsed to a single commit whose body is amended with the heredoc form above — never `git rebase -i` from an agent session. The one-line escape does not exist: `GIT_SEQUENCE_EDITOR=true git rebase -i <base>` opens no editor but accepts the all-`pick` todo verbatim, so it rewrites no message at all (probed — subjects unchanged).

**Final-round one-push exception**: when a round's fixes are the _expected last edits_ (post-autosquash review findings, or a round the agent intends to merge after), combining the fixup with the pre-merge autosquash in ONE force-push is sanctioned — it saves a full CI cycle versus fixup-push → green → autosquash-push → green. Judgment call: use it only when nothing else is expected to change; if the next review finds more, the branch is already squashed and the next fixes start a fresh fixup cycle (no harm, just no savings).

Mid-PR rebase (i.e., autosquash + force-push between review rounds) is reserved for three specific cases, all of which should be rare:

- The user explicitly asks for clean history mid-review.
- A fixup breaks a semantic commit in a way that needs `rebase --edit` to amend (not just autosquash).
- The underlying commit structure itself needs restructuring (splitting a commit, reordering, etc.) — not cosmetic polish.

**"Tidy history for its own sake" is not on that list.** Force-push per round costs ~4 min of pre-push hook + full CI re-run + claude-review re-run per cycle — the cumulative wait time compounds across rounds for zero functional benefit. It also risks losing reviewer inline-comment anchors when history rewrites.

Do not conflate "rebase-only merge strategy" (the project's convention — no merge commits, no squash-on-merge, use `gh pr merge --rebase`) with "rebase before every push" (a habit some contributors carry in from other projects). The first is required; the second is drift. **And do not assume `gh pr merge --rebase` will autosquash for you — it won't.**

For items escalated to ASK: do not apply. Skip to rule 4.

### 3a. Review-round fixes are a dispatch, under any driver

A review round's fixes are a DISPATCH by default, whoever drives the main
loop: batch the round's findings into ONE worker dispatch. Under Fable,
prefer a `SendMessage` resume of the unit's own nested orchestrator (context
intact, cache-riding; a fresh spawn re-pays the whole spec). Under Opus or
any other single-hop driver, dispatch a fresh worker (`model: sonnet` for
mechanical-shape fixes) with the round's findings as the spec. The worker
applies the fixes and runs the gates; the main loop reads the diff and the
verdict only. The reason is defect generation, not budget: the context that
wrote an edit cannot independently review it, and inline round-fixes have
produced self-fed loops — round N repairing round N-1's own fix — that a
fresh reader catches before push. Inline application is reserved for
one-line or comment-only edits. Step-in stays with the main loop on:
semantic disagreement with the reviewer, or orchestrator uncertainty about
the unit's design.

### 4. Batch-present at end of round

After processing all review items in a round, present one consolidated message to the user. The format is prescribed for scannability and to make the round-4 convergence check mechanical:

```
## Round N findings

### Auto-applied (M items, M fixup commits)
  [trivial:rename]     parseInput → parseUserInput  (src/handler.ts:22)
  [trivial:import]     remove unused 'Buffer'       (src/utils.ts:3)
  [trivial:comment]    fix typo in JSDoc            (src/types.ts:47)
  [do-it-now:trivial]  drop the dead `retries` param (src/queue.ts:88)
                       reviewer deferred to "next queue touch" — that's here

### Asks (K items)

#### 1. [semantic:control-flow] Replace early-return guard with if/else
   Reviewer: "This endpoint should reject unauthenticated requests early."
   Agent analysis: Agree. Proposed diff:
     - if (!auth) return 401
     + if (auth) { ... } else { return 401 }
   Approve / Reject / Modify?

#### 2. [semantic:logic] Change `&&` to `||` in guard
   Reviewer (nit): "I think this should be ||"
   Agent analysis: This is a truthiness flip — escalating per signal conflict.
   Approve / Reject / Modify?

### Dismissed
  [reviewer self-dismiss]  "Nit about naming — actually current is fine"

### Backlog candidates
  [future] Reviewer suggested follow-up for sort-stability invariant.
  [batch]  Duplicated retry preamble across ~6 tooling commands
           → new phase on the owning theme doc (doc-N), this finding is member 1
```

The four sections (Auto-applied / Asks / Dismissed / Backlog candidates) MUST appear even when empty, so the round structure is consistent and round count is visibly mechanical. The two dispositions added by rule 2 report inside these four, not beside them, and both are **tagged so the routing is checkable rather than asserted**:

- A **do-it-now** item lands under Auto-applied or Asks depending on its shape, tagged `[do-it-now:trivial]` / `[do-it-now:semantic]` with the reviewer's deferral quoted — that pairing is the whole justification for fixing it here instead of filing it, so it belongs in the report.
- A **file-the-batch** item lands under Backlog candidates tagged `[batch]`, naming which theme-doc phase or idea doc now owns the pass.

**A correction EDITS the original sentence; it does not annotate it.** A round
that falsifies a claim usually produces two edits — the code fix, reported
above, and the claim itself, which is easy to leave behind. Appending "update:
actually…" under a wrong sentence in a PR body, a comment, or a doc leaves that
sentence leading the document, and the lead is what the next reader takes away.
Rewrite it. (General to any corrected claim; it sits here because the round
summary is where the falsification lands.)

**Never present a raw unified diff.** Categorization IS the presentation — it lets the user bulk-confirm the auto-applied group and focus attention on the semantic asks without having to visually separate them.

### 5. Step back at ~3 automated rounds

**This is a rule of thumb, not a hard stop** (owner call). Three rounds is where a loop usually stops being refinement — but a round-4 finding that is genuinely substantive (it makes a claim in the diff false, it names a real defect) gets FIXED, not deferred to a menu. Use judgement, and say in the round summary that the guideline was passed and why.

When a PR reaches **round 4 without user intervention** and the remaining items are nits rather than defects, stop and present consolidated status:

```
PR #N has completed 3 rounds of review-respond. Remaining unresolved items:

1. [semantic:control-flow] ... (raised round 2, still open)
2. [semantic:contract] ...     (raised round 3, new)

Each round's fixes have surfaced new findings. Options:
- Merge as-is (remaining items → appropriate `backlog/**/*.md` file)
- Rewrite the PR to address remaining items differently
- Review the loop — maybe the PR scope is wrong
```

Long review loops are usually a convergence failure rather than genuine quality refinement, and the user is better positioned than the agent to decide whether to merge, rewrite, or abandon.

The cap resets on user intervention. **"User intervention" means the user explicitly answered an ASK, approved/rejected an auto-apply call, or directed the agent to take a specific action.** Merely reading a round summary without a response, acknowledging with a thumbs-up emoji, or a "continue" that doesn't address an open ASK does not count — those are light-touch signals the user is still present, but the decision-fatigue pressure the round cap exists to bound is about _active_ user engagement, not _passive_ presence. When in doubt: if the user said something that would differently route an item (answered an ASK, amended a fix, told the agent to do X), reset the counter; if they didn't, don't reset.

### 5a. Hard cap at ~6 rounds: hand off, don't keep iterating

The soft guideline above governs rounds where the residue is nits. **This cap
governs everything, substantive findings included**: when a PR reaches **round 7 without user intervention** (i.e., past ~6
automated rounds), stop iterating in the current context — even on a finding
that would otherwise be FIXED under rule 5. Instead, hand off:

- **Spawn a fresh-context implementer** with the open findings plus the round
  history as its spec (the branch state carries the code; the spec carries the
  intent), and review its diff as any worker's; or
- **Escalate to the owner** with the round ledger when the loop's shape suggests
  the PR's scope is wrong rather than its execution.

Why a hard cap: past ~6 rounds the iterating context generates the defects it then fixes, because its checks inherit the assumptions accumulated across its own rounds. A fresh context is the countermeasure, not more care in the stale one. Same reset-on-user-intervention rule as the soft guideline.

## Edit-shape whitelist

The whitelist loads with this skill. Entries are evaluated in order. The user may extend either list as they develop priors about the agent's judgment.

### Trivial shapes (auto-apply eligible, subject to test gate)

- **Rename within scope** — variable or parameter rename with zero call-site changes outside the current file, no exported-symbol change, no file rename
- **Unused import removal** — remove an import statement where the imported symbol has zero references in the file (IDE-detectable)
- **Comment or docstring fix** — edits to `//`, `/* */`, JSDoc blocks, or Python docstrings that don't touch any code tokens
- **Type annotation addition** — adding `: T` to a variable, parameter, or return type; adding a type guard that only narrows for the compiler; **not** type changes that alter runtime control flow
- **Formatting per linter** — apply `prettier` or `eslint --fix` output verbatim; no manual edits
- **String literal typo fix** — text-content correction in a regular string literal; **not** inside regex patterns, SQL queries, shell commands, URL paths, or any other language-in-a-string context
- **Test-only addition covering this PR's own behavior** — adding `it()`/`describe()` blocks to a `*.test.ts` that exercise behavior THIS PR introduced or changed, with zero production-file edits. Safe because it cannot alter runtime behavior and the test gate proves the assertion holds. **Excludes**: changing or deleting an EXISTING assertion (that's a spec change — ASK), adding a test that requires a production edit to pass (the production edit is the real change — classify THAT), and touching `knownGaps`/baseline files (`00-critical` forbids widening those). Reviewers routinely flag missing coverage on new gating behavior; asking every time is pure decision fatigue.
- **Documentation-only addition** — adding content to `BACKLOG.md`, `backlog/**/*.md`, release notes, `CHANGELOG.md`, `README.md`, or any file under `docs/`. Includes new sections and new entries, not just fixes. **Excludes** edits to `.claude/rules/*.md` and `.claude/skills/*/SKILL.md`, which are load-bearing constraints/procedures — treat those as semantic-shape even though they're markdown. Adding to a documentation file that this PR didn't otherwise touch is still allowed under this shape; "scope expansion" only applies to CODE files (see below).

Implicit rule: "touches a file not in the PR's diff so far" is NOT a blocker for auto-apply as long as the edit is one of the trivial shapes above. The blast radius concern comes from the _shape_ of the change, not the _location_. A `backlog/**/*.md` addition to a file the PR hasn't touched is still a trivial-shape edit; a logic change in an untouched code file is still semantic-shape.

### Explicit non-trivial (always ASK regardless of surface simplicity)

Each of these is flagged because the shape seduces the reader into thinking "this is just a small change" when it alters runtime behavior.

- **Regex pattern or flag change** — including `/g`, `/i`, `/m`, `/s`, capture-group changes, alternation changes. A regex is a language, not a string.
- **Truthiness or comparison operator flip** — `&&` ↔ `||`, `==` ↔ `===`, `!=` ↔ `!==`, `!x` ↔ `!!x`, `x ?? y` ↔ `x || y`, any nullish-coalescing change
- **Null or undefined guard addition** — adding `if (x) return`, `if (!x) throw`, `x?.y` where none existed. Even when it looks defensive, it changes runtime behavior.
- **Async boundary change** — adding or removing `await`, `Promise.all`, `Promise.race`, `.catch`, any timing-sensitive construct
- **Default parameter value change** — flipping a boolean default, changing a numeric threshold, adding a required param
- **External contract change** — API endpoint shape, HTTP header, request/response schema, env var name, event payload, emitted log structure (log parsing counts as contract)

### Extending the whitelist

When the user observes the agent making a category of change it handles well, add it to **Trivial shapes** with format:

```markdown
- **[shape name]** — [precise definition, including explicit non-inclusions] — [why this shape is safe to auto-apply]
```

When the user observes a mis-classification the agent should have avoided, add the specific shape to **Explicit non-trivial** with the mis-classification incident noted.

Keep each entry self-contained so an observer can verify a candidate diff against one entry without reading the full file.

## Checklist for the agent

Before each round's consolidated message:

- [ ] Every review item classified against trivial / non-trivial / unknown (rule 1)
- [ ] Every auto-apply candidate checked against reviewer label for signal conflict (rule 2)
- [ ] Every "no action now" item routed by what would reopen it — Do it now (this file/diff) / File the batch (a named cross-file pass) / Backlog candidate (a named observable) / Dismissed (nothing) per rule 2's deferral rows; a Do-it-now item re-enters rule 1 and lands under Auto-applied or Asks
- [ ] Every origin-scoped finding ("pre-existing" / "not a regression") given a merits disposition — never Dismissed on origin alone (rule 2's origin-language row)
- [ ] Every auto-applied fixup commit has a green package-level test run (rule 3)
- [ ] Round-N message contains all four sections, even empty ones (rule 4)
- [ ] If this is round 4+, consolidated status menu presented instead of another iteration (rule 5)
- [ ] If this is round 7+, findings handed off to a fresh-context implementer or the owner instead of fixed directly (rule 5a)

## Relationship to the rules

- **`00-critical.md`** § "Merge Approval" governs the merge gate (standing authorization for feature/fix PRs once truly ready; the release PR always needs explicit approval). This procedure governs iteration _before_ that gate; nothing here loosens it.
- **`00-critical.md`** "NEVER modify tests to make them pass" remains in force. The test-suite gate in rule 3 fails closed — a trivial-shape edit that breaks tests is escalated, not covered up by modifying tests.
- **`05-tooling.md`** PR-monitoring step 4 delegates to this skill.
- **`06-backlog.md`** out-of-scope tracking still applies — items explicitly flagged as follow-ups are filed as tracker tasks (or the appropriate `backlog/**/*.md` file) per rule 4's "Backlog candidates" section.
