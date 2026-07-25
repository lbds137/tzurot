---
name: tzurot-review-response
description: 'PR review-response iteration: classify each finding by EDIT SHAPE (trivial → auto-apply as a test-gated fixup commit; semantic → ASK), check reviewer-vs-agent signal conflict, batch-present the four sections, cap at 3 automated rounds. Invoke with /tzurot-review-response the moment a claude-review or human reviewer posts findings on a PR — before applying anything.'
lastUpdated: '2026-07-25'
---

# Review-Response Iteration

When `claude-review` or any PR reviewer returns findings, the agent follows this procedure **instead of** asking the user about every item. Applied from step 4 of the PR-monitoring procedure in `05-tooling.md`.

## Why this procedure exists

The prior policy was "report only, never fix without user approval." Rigorously safe but produces decision fatigue — a typical PR reaches 3–5 review rounds with ~10 trivial findings per session, and the user spent meaningful attention rubber-stamping items the agent could have safely auto-applied. This procedure shifts trivial chores to auto-apply (under tight constraints) while preserving explicit approval for anything that changes program behavior.

**Key design principle**: `claude-review` is the same model family as the agent. It has no special epistemic authority. When the reviewer's severity label conflicts with the agent's own classification, that's **uncertainty**, not an override opportunity in either direction. The safe resolution is always ASK.

## The six rules

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

**Do it now** is the disposition that defaults wrong without this rule. "Next time you touch this file" _sounds_ like a named condition, so it reads as a backlog candidate — but the condition is "somebody remembers," and remembering means grepping a several-hundred-row table before unrelated work, which nobody does. Filing it is how it never happens. The finding is also, by construction, **small and colocated** — the reviewer named this PR's own code — so the file is already open and the fix is usually smaller than the row describing it. Fix it here.

Do-it-now sends the finding back through **rule 1**, not around it: a trivial-shape fix auto-applies under the test gate and reports under Auto-applied; a semantic-shape one still ASKs and reports under Asks. This disposition changes the destination, never the safety rails.

**A rejected do-it-now does not evaporate — re-route it.** When the user rejects the fix (or a trivial-shape one fails its test gate and escalates to an Ask that's then rejected), the finding has been neither fixed nor tracked, and do-it-now filed nothing by design. That is the only path in this table that can end in _neither_, which is exactly the silent-loss this rule exists to prevent. On rejection, **default to backlog candidate** and report it under Backlog candidates in the same round summary. Re-route to **file the batch** only when the rejection itself reveals the finding belongs to an already-named cross-file pass — the ordinary case cannot, because do-it-now's own classifying condition is _this file or diff_, and file-the-batch is for a pass rather than a place. The user rejecting _this fix, now_ is not a decision to forget the finding — only an explicit "don't track this either" is, and that reads as **Dismissed**.

**File the batch** is the one to reach for when the reviewer named a _pass_ rather than a _place_. "Next tooling-DRY pass" describes work across files this PR never opens — so "colocated and small" is false, and do-it-now would be wrong. But a row waiting to be noticed during that pass is equally wrong: nobody rediscovers it. **Track the pass itself** — a theme phase or a `cold/ideas.md` section that owns the whole batch — and let this finding be one of its members. Which of the two: **one PR's worth of sweeping → `cold/ideas.md`; needs its own phased rollout → a theme.** Same disposition for a finding that's simply too big for this PR (needs a migration, crosses a service boundary, would double the diff). Per `06-backlog.md`'s granularity ladder, those were never follow-up rows.

**Grep for the batch before creating it.** Different PRs surface the same pass repeatedly ("next tooling-DRY pass" appears from whichever file the reviewer happened to be reading), so a rule that files a fresh section each time reproduces the fragmentation it was written to fix, one rung higher. Search `backlog/cold/` for the pass by name AND by the module it sweeps; if a theme phase or `cold/ideas.md` section already owns it, **add this finding as a member** and say which entry you joined. Only create a new one when the grep is genuinely empty.

**Backlog candidate** is the honest deferral: the trigger is an event we will observe rather than a moment we must remember. File it in the granularity-appropriate backlog file (a one-line follow-up with its promote-when → `backlog/cold/follow-ups.md`; a larger parked idea → `cold/ideas.md`), capturing both the concern and the criterion. (A trigger is a field on the item, not its own bucket — the old "route to Deferred" rule is gone.)

**Dismissed** closes the matter; note it in the summary and move on. A reviewer self-dismissal ("non-issue," "current is correct") that the agent agrees with has no trigger, and neither does a vague preference with no named event.

**Why the bar is here**: `cold/follow-ups.md` grew 3× in five weeks under the old two-way split, and a full read found ~0 rows removable — the pile was honest, just unreachable. A third of it carried triggers that can never fire on their own: "next time someone touches this" (nobody greps to find it) and "next tooling pass" (the pass was never scheduled, because only its symptoms got filed). Admitting either shape as a row is strictly worse than fixing it, scheduling the batch, or declining it.

**Reviewer self-contradiction across rounds**: when round-N reviewer reverses its round-(N-1) stance on the same item (e.g., round 3 says "drop the `?? ''` as unreachable," round 4 says "add `?? ''` back for defensive typing"), the reviewer is not authoritative on its own prior disagreement. Dismiss and cite the earlier round's reasoning in the summary. Don't ping-pong. This is distinct from genuine new information surfacing — a round-N reviewer observation that _builds on_ round-(N-1) (adds context, corrects an error) is normal; a direct reversal on the same fact-pattern is noise.

### 3. Apply with test-suite gating

For items that passed rules 1 and 2 (trivial-shape + no conflict):

1. Apply the edit as a `git commit --fixup=<target-sha>` commit. `target-sha` is the original commit that introduced the code being changed.
2. Run the package-level test for the modified file (e.g., `pnpm --filter bot-client test`).
3. Tests pass → keep the fixup commit.
4. Tests fail → **escalate to ASK immediately**, with the test failure output attached. A trivial-shape edit that breaks tests is the signal that the whitelist mis-classified it; escalation preserves the safety net.

Fixup commits autosquash naturally on the next `git rebase -i --autosquash`. This is the correct escape valve for a rebase-only workflow — `git revert` is not available on rewritten-history branches, but fixup-drop during interactive rebase is cheap and native.

**When is "the next rebase"?** Once, **right before merge**, not after each round. Keep fixup commits visible through review iteration and just `git push` them — do not `rebase --autosquash` and do not force-push between rounds. Fixup commits sitting on the branch as `fixup! <target message>` are fine through review; reviewers and CI can read them.

**Critical: `gh pr merge --rebase` does NOT autosquash fixup commits.** It runs `git rebase`, not `git rebase --autosquash`. Fixup commits will land on the base branch with their `fixup!` titles intact and clutter `git log` permanently (observed 2026-04-24 on PRs #889 and #890 — both required force-push cleanup of develop after merge).

**Structural enforcement: the `fixup-check` job in `.github/workflows/ci.yml`** runs on every push to a feature branch and fails if any commit on the branch (since the merge base with develop) has a `fixup!` or `squash!` subject. CI stays red until you autosquash, which means the merge button is gated on it being green — you can't accidentally merge a branch with fixup commits.

The correct pre-merge sequence is:

```bash
# On the feature branch, right before requesting merge:
git rebase --autosquash <base-branch>           # squash all fixups into their targets
git push --force-with-lease origin <branch>     # CI's fixup-check now passes
gh pr merge <PR#> --rebase --delete-branch      # then merge (or use the web UI)
```

**Final-round one-push exception**: when a round's fixes are the _expected last edits_ (post-autosquash review findings, or a round the agent intends to merge after), combining the fixup with the pre-merge autosquash in ONE force-push is sanctioned — it saves a full CI cycle versus fixup-push → green → autosquash-push → green. Judgment call: use it only when nothing else is expected to change; if the next review finds more, the branch is already squashed and the next fixes start a fresh fixup cycle (no harm, just no savings).

Mid-PR rebase (i.e., autosquash + force-push between review rounds) is reserved for three specific cases, all of which should be rare:

- The user explicitly asks for clean history mid-review.
- A fixup breaks a semantic commit in a way that needs `rebase --edit` to amend (not just autosquash).
- The underlying commit structure itself needs restructuring (splitting a commit, reordering, etc.) — not cosmetic polish.

**"Tidy history for its own sake" is not on that list.** Force-push per round costs ~4 min of pre-push hook + full CI re-run + claude-review re-run per cycle — the cumulative wait time compounds across rounds for zero functional benefit. It also risks losing reviewer inline-comment anchors when history rewrites.

Do not conflate "rebase-only merge strategy" (the project's convention — no merge commits, no squash-on-merge, use `gh pr merge --rebase`) with "rebase before every push" (a habit some contributors carry in from other projects). The first is required; the second is drift. **And do not assume `gh pr merge --rebase` will autosquash for you — it won't.**

For items escalated to ASK: do not apply. Skip to rule 4.

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
           → new phase on cold/themes/<slug>.md, this finding is member 1
```

The four sections (Auto-applied / Asks / Dismissed / Backlog candidates) MUST appear even when empty, so the round structure is consistent and round count is visibly mechanical. The two dispositions added by rule 2 report inside these four, not beside them, and both are **tagged so the routing is checkable rather than asserted**:

- A **do-it-now** item lands under Auto-applied or Asks depending on its shape, tagged `[do-it-now:trivial]` / `[do-it-now:semantic]` with the reviewer's deferral quoted — that pairing is the whole justification for fixing it here instead of filing it, so it belongs in the report.
- A **file-the-batch** item lands under Backlog candidates tagged `[batch]`, naming which theme phase or `cold/ideas.md` section now owns the pass.

Without the tags both dispositions are invisible in the summary: a do-it-now fix reads as an ordinary trivial edit, and a filed batch reads as an ordinary deferral.

**Never present a raw unified diff.** Categorization IS the presentation — it lets the user bulk-confirm the auto-applied group and focus attention on the semantic asks without having to visually separate them.

### 5. Cap iteration at 3 automated rounds

If a PR reaches **round 4 of review-respond cycles without user intervention**, stop. Present consolidated status:

```
PR #N has completed 3 rounds of review-respond. Remaining unresolved items:

1. [semantic:control-flow] ... (raised round 2, still open)
2. [semantic:contract] ...     (raised round 3, new)

Each round's fixes have surfaced new findings. Options:
- Merge as-is (remaining items → appropriate `backlog/**/*.md` file)
- Rewrite the PR to address remaining items differently
- Review the loop — maybe the PR scope is wrong
```

Long review loops are almost always a convergence failure, not genuine quality refinement. The user is better positioned than the agent to decide whether to merge, rewrite, or abandon. Forcing the decision at round 4 prevents the agent and reviewer from indefinitely discovering new nits.

The cap resets on user intervention. **"User intervention" means the user explicitly answered an ASK, approved/rejected an auto-apply call, or directed the agent to take a specific action.** Merely reading a round summary without a response, acknowledging with a thumbs-up emoji, or a "continue" that doesn't address an open ASK does not count — those are light-touch signals the user is still present, but the decision-fatigue pressure the round cap exists to bound is about _active_ user engagement, not _passive_ presence. When in doubt: if the user said something that would differently route an item (answered an ASK, amended a fix, told the agent to do X), reset the counter; if they didn't, don't reset.

### 6. Reviewer mode decay across rounds (aspirational)

On round 1: reviewer runs a full audit (all severities, all categories).

On round 2+: reviewer should flag only:

- **Blocking** items that would prevent merge
- **New regressions** introduced by the agent's round-(N-1) fixes

This is a constraint on the _reviewer's_ behavior, not the agent's — but since the reviewer is configured by the same project rules, it belongs here. Implementation: pass a `round_number` hint to the review prompt; round > 1 filters to blocking + regressions.

**Current status: aspirational.** The existing `claude-review` GitHub Action is not round-aware. Until it is, the agent follows rules 1–5 regardless of what the reviewer surfaces — rule 5's round cap provides the backstop when reviewer keeps finding new nits.

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

The whitelist is expected to drift over time as trust develops. Keep each entry self-contained so an observer can verify a candidate diff against one entry without reading the full file.

## Checklist for the agent

Before each round's consolidated message:

- [ ] Every review item classified against trivial / non-trivial / unknown (rule 1)
- [ ] Every auto-apply candidate checked against reviewer label for signal conflict (rule 2)
- [ ] Every "no action now" item routed by what would reopen it — Do it now (this file/diff) / File the batch (a named cross-file pass) / Backlog candidate (a named observable) / Dismissed (nothing) per rule 2's deferral rows; a Do-it-now item re-enters rule 1 and lands under Auto-applied or Asks
- [ ] Every origin-scoped finding ("pre-existing" / "not a regression") given a merits disposition — never Dismissed on origin alone (rule 2's origin-language row)
- [ ] Every auto-applied fixup commit has a green package-level test run (rule 3)
- [ ] Round-N message contains all four sections, even empty ones (rule 4)
- [ ] If this is round 4+, consolidated status menu presented instead of another iteration (rule 5)

## Relationship to the rules

- **`00-critical.md`** § "Merge Approval" governs the merge gate (standing authorization for feature/fix PRs once truly ready; the release PR always needs explicit approval). This procedure governs iteration _before_ that gate; nothing here loosens it.
- **`00-critical.md`** "NEVER modify tests to make them pass" remains in force. The test-suite gate in rule 3 fails closed — a trivial-shape edit that breaks tests is escalated, not covered up by modifying tests.
- **`05-tooling.md`** PR-monitoring step 4 delegates to this skill.
- **`06-backlog.md`** out-of-scope tracking still applies — items explicitly flagged as follow-ups are added to the appropriate `backlog/**/*.md` file per rule 4's "Backlog candidates" section.
