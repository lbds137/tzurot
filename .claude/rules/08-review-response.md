# Review-Response Iteration

When `claude-review` or any PR reviewer returns findings, the agent follows this procedure **instead of** asking the user about every item. Applied from step 4 of the PR-monitoring procedure in `05-tooling.md`.

## Why this rule exists

The prior rule was "report only, never fix without user approval." Rigorously safe but produces decision fatigue — a typical PR reaches 3–5 review rounds with ~10 trivial findings per session, and the user spent meaningful attention rubber-stamping items the agent could have safely auto-applied. This procedure shifts trivial chores to auto-apply (under tight constraints) while preserving explicit approval for anything that changes program behavior.

**Key design principle**: `claude-review` is the same model family as the agent. It has no special epistemic authority. When the reviewer's severity label conflicts with the agent's own classification, that's **uncertainty**, not an override opportunity in either direction. The safe resolution is always ASK.

Derived from a three-model council review (Gemini 3.1 Pro → Kimi K2.6 → GLM-5.1) on 2026-04-24 after a session where two PRs each hit 5–6 review rounds with extensive rubber-stamping overhead.

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

| Reviewer says                                 | Agent classifies | Result                                     |
| --------------------------------------------- | ---------------- | ------------------------------------------ |
| "nit / minor / not blocking"                  | trivial          | **Continue** (aligned)                     |
| "nit / minor / not blocking"                  | semantic         | **ASK** (disagreement)                     |
| "medium / blocking / must fix"                | trivial          | **ASK** (disagreement)                     |
| "medium / blocking / must fix"                | semantic         | **ASK** (aligned on severity)              |
| Self-dismisses ("actually fine")              | Agent agrees     | **DISMISS** (note in summary)              |
| Self-dismisses                                | Agent disagrees  | **ASK** (with dissenting analysis)         |
| Contradicts own round-(N-1) call on same item | Any              | **DISMISS** (cite prior round's rationale) |

**Any disagreement between reviewer and agent defaults to ASK.** Neither side has special authority, and uncertainty is the honest state when signals conflict.

**Reviewer self-contradiction across rounds**: when round-N reviewer reverses its round-(N-1) stance on the same item (e.g., round 3 says "drop the `?? ''` as unreachable," round 4 says "add `?? ''` back for defensive typing"), the reviewer is not authoritative on its own prior disagreement. Dismiss and cite the earlier round's reasoning in the summary. Don't ping-pong. This is distinct from genuine new information surfacing — a round-N reviewer observation that _builds on_ round-(N-1) (adds context, corrects an error) is normal; a direct reversal on the same fact-pattern is noise.

### 3. Apply with test-suite gating

For items that passed rules 1 and 2 (trivial-shape + no conflict):

1. Apply the edit as a `git commit --fixup=<target-sha>` commit. `target-sha` is the original commit that introduced the code being changed.
2. Run the package-level test for the modified file (e.g., `pnpm --filter bot-client test`).
3. Tests pass → keep the fixup commit.
4. Tests fail → **escalate to ASK immediately**, with the test failure output attached. A trivial-shape edit that breaks tests is the signal that the whitelist mis-classified it; escalation preserves the safety net.

Fixup commits autosquash naturally on the next `git rebase -i --autosquash`. This is the correct escape valve for a rebase-only workflow — `git revert` is not available on rewritten-history branches, but fixup-drop during interactive rebase is cheap and native.

For items escalated to ASK: do not apply. Skip to rule 4.

### 4. Batch-present at end of round

After processing all review items in a round, present one consolidated message to the user. The format is prescribed for scannability and to make the round-4 convergence check mechanical:

```
## Round N findings

### Auto-applied (M items, M fixup commits)
  [trivial:rename]     parseInput → parseUserInput  (src/handler.ts:22)
  [trivial:import]     remove unused 'Buffer'       (src/utils.ts:3)
  [trivial:comment]    fix typo in JSDoc            (src/types.ts:47)

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
```

The four sections (Auto-applied / Asks / Dismissed / Backlog candidates) MUST appear even when empty, so the round structure is consistent and round count is visibly mechanical.

**Never present a raw unified diff.** Categorization IS the presentation — it lets the user bulk-confirm the auto-applied group and focus attention on the semantic asks without having to visually separate them.

### 5. Cap iteration at 3 automated rounds

If a PR reaches **round 4 of review-respond cycles without user intervention**, stop. Present consolidated status:

```
PR #N has completed 3 rounds of review-respond. Remaining unresolved items:

1. [semantic:control-flow] ... (raised round 2, still open)
2. [semantic:contract] ...     (raised round 3, new)

Each round's fixes have surfaced new findings. Options:
- Merge as-is (remaining items → BACKLOG.md)
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

The whitelist is loaded with the rule. Entries are evaluated in order. The user may extend either list as they develop priors about the agent's judgment.

### Trivial shapes (auto-apply eligible, subject to test gate)

- **Rename within scope** — variable or parameter rename with zero call-site changes outside the current file, no exported-symbol change, no file rename
- **Unused import removal** — remove an import statement where the imported symbol has zero references in the file (IDE-detectable)
- **Comment or docstring fix** — edits to `//`, `/* */`, JSDoc blocks, or Python docstrings that don't touch any code tokens
- **Type annotation addition** — adding `: T` to a variable, parameter, or return type; adding a type guard that only narrows for the compiler; **not** type changes that alter runtime control flow
- **Formatting per linter** — apply `prettier` or `eslint --fix` output verbatim; no manual edits
- **String literal typo fix** — text-content correction in a regular string literal; **not** inside regex patterns, SQL queries, shell commands, URL paths, or any other language-in-a-string context
- **Documentation-only addition** — adding content to `BACKLOG.md`, release notes, `CHANGELOG.md`, `README.md`, or any file under `docs/`. Includes new sections and new entries, not just fixes. **Excludes** edits to `.claude/rules/*.md` and `.claude/skills/*/SKILL.md`, which are load-bearing constraints/procedures — treat those as semantic-shape even though they're markdown. Adding to a documentation file that this PR didn't otherwise touch is still allowed under this shape; "scope expansion" only applies to CODE files (see below).

Implicit rule: "touches a file not in the PR's diff so far" is NOT a blocker for auto-apply as long as the edit is one of the trivial shapes above. The blast radius concern comes from the _shape_ of the change, not the _location_. A `BACKLOG.md` addition to a file the PR hasn't touched is still a trivial-shape edit; a logic change in an untouched code file is still semantic-shape.

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

The whitelist is expected to drift over time as trust develops. Keep each entry self-contained so an observer can verify the rule against a candidate diff without reading the full file.

## Checklist for the agent

Before each round's consolidated message:

- [ ] Every review item classified against trivial / non-trivial / unknown (rule 1)
- [ ] Every auto-apply candidate checked against reviewer label for signal conflict (rule 2)
- [ ] Every auto-applied fixup commit has a green package-level test run (rule 3)
- [ ] Round-N message contains all four sections, even empty ones (rule 4)
- [ ] If this is round 4+, consolidated status menu presented instead of another iteration (rule 5)

## Relationship to other rules

- **`00-critical.md`** "Never merge PRs without user approval" remains in force. This rule governs iteration _before_ merge approval; it does not loosen the merge gate.
- **`00-critical.md`** "NEVER modify tests to make them pass" remains in force. The test-suite gate in rule 3 fails closed — a trivial-shape edit that breaks tests is escalated, not covered up by modifying tests.
- **`05-tooling.md`** PR-monitoring step 4 delegates to this file.
- **`06-backlog.md`** out-of-scope tracking still applies — items explicitly flagged as follow-ups are added to `BACKLOG.md` per rule 4's "Backlog candidates" section.
