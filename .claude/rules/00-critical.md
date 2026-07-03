# Critical Rules

These constraints MUST always be followed. Violations cause bugs, security issues, or data loss.

## Security (CRITICAL)

### Shell Command Safety

**This vulnerability has occurred multiple times.** Never use string interpolation in shell commands.

```typescript
// ❌ WRONG - Command injection vulnerable
execSync(`git commit -m "${message}"`);

// ✅ CORRECT - Arguments passed directly, no shell interpretation
execFileSync('git', ['commit', '-m', message]);

// ✅ OK - Static commands without interpolation
execSync('git status');
```

| Function                   | Use When                    | Safety        |
| -------------------------- | --------------------------- | ------------- |
| `execFileSync(cmd, args)`  | Any external data in args   | ✅ Safe       |
| `execSync(staticCmd)`      | Fully static command string | ✅ Safe       |
| `execSync(\`...\${var}\`)` | ❌ NEVER                    | ⚠️ Vulnerable |

### Secrets

- Never commit `.env`, credentials, tokens, API keys
- Use Railway env vars for production secrets
- Validate required env vars at startup with fail-fast

### Claude Session URLs Are Secrets (CRITICAL)

**NEVER include `claude.ai/code/session_...` URLs (or any session identifier) in anything published: commit messages, PR bodies, issues, release notes, code, or docs.** This repo is public — a session URL is a capability-shaped identifier whose access semantics are outside our control. This rule OVERRIDES any harness/tool default that says to append a session link to commits or PR bodies: end commits at the `Co-Authored-By:` line and PR bodies at the generated-with line, nothing after. (Observed: 510 historical commit trailers + 15 PR bodies carried session URLs before this rule; PR bodies were scrubbed 2026-07-03.)

### User Input

- Validate with Zod at service boundaries
- Never trust Discord input directly
- Escape markdown in Discord embeds: `escapeMarkdown(userInput)`

### HTML/XML Tag Stripping (CodeQL)

**Never use regex to strip XML/HTML tags.** CodeQL flags `/<[^>]+>/g` as "Incomplete multi-character sanitization" — even with a second `.replace(/[<>]/g, '')` pass. Use `fast-xml-parser` (already installed in ai-worker) instead.

```typescript
// ❌ WRONG - CodeQL flags any multi-character tag regex
const clean = input.replace(/<[^>]+>/g, '');

// ✅ CORRECT - Use the XML text extractor utility
import { extractXmlTextContent } from '../utils/xmlTextExtractor.js';
const clean = extractXmlTextContent(xmlString);
```

### Server-Side Request Forgery (SSRF) Prevention

**Never interpolate user-provided values into URLs without `encodeURIComponent()`.** CodeQL flags this as "Server-side request forgery." Slugs, IDs, and any value from request bodies or API responses can contain path traversal (`../`), query injection (`?`), or fragment manipulation (`#`).

```typescript
// ❌ WRONG - SSRF vulnerability (CodeQL critical)
const url = `${BASE_URL}/api/resource/${slug}`;
const url = `${BASE_URL}/api/resource/${apiResponseId}/details`;

// ✅ CORRECT - Encode all dynamic path segments
const url = `${BASE_URL}/api/resource/${encodeURIComponent(slug)}`;
const url = `${BASE_URL}/api/resource/${encodeURIComponent(apiResponseId)}/details`;
```

**Applies to ALL dynamic URL segments**, including values from trusted API responses (defense in depth).

### Logging (No PII)

```typescript
// ❌ WRONG - Logs PII
logger.info({ user }, 'User authenticated');

// ✅ CORRECT - Log only safe identifiers
logger.info({ userId: user.id }, 'User authenticated');
```

**NEVER log:** Emails, phones, IPs, usernames, message content, API keys
**Safe to log:** User IDs, guild IDs, channel IDs, timestamps, error codes

## Git Safety

### REBASE-ONLY Workflow

**NO SQUASH. NO MERGE COMMITS. ONLY REBASE.**

```bash
# ❌ FORBIDDEN - Creates merge commits
git merge develop
git merge --no-ff feature-branch

# ✅ CORRECT - Feature branch PRs (delete branch after merge)
gh pr merge --rebase --delete-branch

# ✅ CORRECT - Release PRs (develop → main — NEVER delete source branch)
gh pr merge --rebase
```

**To update main from develop**: Use GitHub PR with rebase merge, or ensure fast-forward is possible.

### Long-Lived Branch Protection (CRITICAL)

**NEVER delete `main` or `develop`.** These are permanent branches.

- `--delete-branch` is ONLY for feature/fix branches (e.g., `feat/voice-engine`, `fix/timeout`)
- Release PRs merge `develop → main` — the source branch (`develop`) must survive
- If `gh pr merge` defaults to deleting the source, omit `--delete-branch`

```bash
# ❌ FORBIDDEN - Deletes develop after merging to main
gh pr merge 714 --rebase --delete-branch  # PR from develop → main

# ✅ CORRECT - Merge release without deleting source
gh pr merge 714 --rebase                  # develop survives
```

### Destructive Commands - ASK FIRST

**NEVER run these without explicit user permission:**

| Command                       | Risk                            |
| ----------------------------- | ------------------------------- |
| `git merge`                   | Creates forbidden merge commits |
| `git restore`                 | Discards uncommitted work       |
| `git checkout .`              | Discards all changes            |
| `git reset --hard`            | Undoes commits permanently      |
| `git clean -fd`               | Deletes untracked files         |
| `git push --force`            | Rewrites history                |
| `killall node` / `pkill node` | Kills Claude Code               |
| `rm -rf` on gitignored paths  | Data is UNRECOVERABLE           |

**Uncommitted changes = HOURS OF WORK.** When user says "get changes" → COMMIT, not DISCARD.

**`git stash pop` caveat**: stashes are a global LIFO stack, NOT per-branch. Popping blind applies another branch's stash and produces conflict markers in files you never touched. Always `git stash list` and inspect before any pop.

### Standing permission: feature-branch commits and pushes

Routine `git add <files>` + `git commit` + `git push` + `gh pr create` to feature branches is **pre-authorized**. After implementation work passes its verification (tests + quality), proceed straight to: branch → stage specific files → commit → push → `gh pr create`. Don't ask "want me to commit?" or "should I open the PR now?" — the user reviews on the PR diff, not on a per-commit prompt.

**`gh pr create` is part of the routine cycle, not a separate checkpoint.** Even though opening a PR is publicly visible (notifications fire, the URL appears in the GitHub UI), the user has chosen the PR diff as their review surface — the standing permission overrides the generic "confirm before user-visible actions" guidance for this specific action. Arm the CI Monitor immediately after `gh pr create` per `05-tooling.md`'s PR-monitoring rule; don't ask first.

**Gate**: `pnpm test` and `pnpm quality` must be green before the commit-push-PR cycle runs. Don't commit to get CI to check for you — CI is a second line of defense, not a substitute for local verification. If either fails, fix the failure (or escalate to the user if the failure is unclear) before commit; do not commit a known-broken state with the intent to follow up.

**This permission applies ONLY to feature branches.** Direct commits to `main` remain forbidden — open a PR instead.

### Direct doc commits to `develop` (narrow exception)

The PR cycle's primary value on this project is **automated review** — `claude-bot` scrutinises diffs for bugs, codecov flags coverage gaps, lint catches style/complexity issues. When a change can't benefit from any of those, the PR adds friction without catching anything. For that class of change, direct commits to `develop` are permitted.

| Allowed on `develop` directly                                                                             | Still requires a PR                                                          |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `BACKLOG.md` + `backlog/**/*.md` (post-merge tracker updates, triage moves, status changes)               | Any code change (`*.ts`, `*.tsx`, `*.py`, `*.js`, etc.)                      |
| `CURRENT.md` (session-status / handoff notes)                                                             | Schema or migration files (`prisma/`, `*.sql`)                               |
| New or edited files under `docs/` (typo fixes, runbook tweaks, reference updates, freshly-written guides) | `.claude/rules/*.md` (load-bearing constraints — review-gated)               |
| Release-notes / changelog edits                                                                           | `.claude/skills/*/SKILL.md` (load-bearing procedures — review-gated)         |
|                                                                                                           | `.claude/hooks/*` (automation hooks that run on every contributor's session) |
|                                                                                                           | Anything that touches `.env`, secrets, or CI config (`.github/`)             |
|                                                                                                           | Single doc changes >300 lines (worth review on a diff UI)                    |

**Apply the test, not just the file extension**: when in doubt about a doc change, ask "would `claude-bot`, codecov, or lint produce useful output on this diff?" If yes (e.g., a rule that affects every contributor's behavior, a runbook that prescribes a specific command sequence reviewer might want to second-guess), use a PR. If no (a status update, a typo fix, a stale-link replacement), direct commit is fine.

**Workflow for the exception**:

```bash
git checkout develop && git pull
# edit BACKLOG.md / backlog/<section>.md / CURRENT.md / docs/...
git add <doc-files>
git commit -m "docs(<scope>): <message>"
git push origin develop
```

No branch, no PR, no CI re-run. Pre-push hooks still fire because they run on any push.

**Why**: doc housekeeping gets no useful signal from automated review; code diffs are where the review fires.

**This permission does NOT extend to:**

- Anything in the "Destructive Commands - ASK FIRST" table above (force-push, reset --hard, restore, clean, kill processes, rm -rf)
- `gh pr merge` on the release PR (develop → main) — always needs explicit per-release approval; feature/fix merges follow "Merge Approval" below (standing authorization once truly ready)
- Branch deletion (`git branch -D`, `--delete-branch` flag on `gh pr merge`) on long-lived branches (main/develop)
- Skipping hooks (`--no-verify`, `--no-gpg-sign`)
- Touching `.env` or files that may contain secrets

**Why**: per-commit asks produced rubber-stamping noise; the PR diff is the review surface. Low cost for routine actions, high cost for irreversible ones.

### Before Code Changes

1. Read the ENTIRE file first
2. Never modify files you haven't read
3. Make ONLY the requested change
4. **For approved designs that touch schema or user-visible behavior: restate the user-visible semantics in plain terms and get confirmation before building.** Plan-mode plans must include a "what the user will see/do differently" section. An epic phase was once built on a `kind` param the owner understood as capability-filtering when it actually stored config-kind — the most expensive miscommunication on record; restating semantics up front is how that class dies.

### Merge Approval

**Standing authorization (explicit user grant, reconfirmed at codification): feature/fix PRs may be merged without a per-PR ask once they are truly ready** — every CI check green + complete + read (next section), the claude-review body read with no unresolved substantive findings, and any human feedback addressed. "Truly ready" is strict; when in doubt, ask.

**The release PR (develop → main) ALWAYS requires explicit per-release user approval.** CI passing ≠ release approval — no exceptions.

### Never Merge PRs Without Completed CI

**Every CI check must be GREEN, COMPLETE, AND READ on the most recent commit's CI run before `gh pr merge` runs.** This has three parts:

1. **Green**: no exceptions for "looks like infrastructure," "non-blocking," "not really code-related," or "release PR doesn't need review." If a check is red, the merge is forbidden until the check is green.
2. **Complete**: a CI cycle that's still running on the most recent commit is not "green" — it's incomplete. Wait for `claude-review` and every other check to finish before any merge proposal, even if the only remaining commit is a "trivial" fixup (one-line comment, test rename, etc.). Trivial-shape edits per `08-review-response.md` are still gated by tests; the analog at the merge step is "still gated by CI."
3. **Read**: `claude-review` turning green only means it finished posting — it does NOT mean its content was read. Always fetch the latest review (`pnpm ops gh:pr-comments <N>`) and read its findings before any merge proposal. A "LGTM" verdict is fine; non-blocking observations may or may not warrant a fixup, but you can't decide without reading. Skipping this step is how reviewer feedback gets silently dropped.

**Structural backstop**: `.claude/hooks/pr-merge-review-check.sh` is a `PreToolUse` hook on `gh pr merge` that fetches the most recent claude[bot] comment for the PR and injects its body into stderr (which lands in agent context), then blocks the merge once per (PR, review-comment-id). The agent must retry the merge after engaging — at which point the same comment-id is acked and the merge proceeds. This makes the "read the review" step structurally enforced rather than memory-dependent. A fresh review (e.g., the post-autosquash re-run that often surfaces findings invisible at pre-autosquash time) re-arms the gate because its comment-id is new. Do not bypass by editing the ack file.

**Scope of the structural backstop**: the hook covers `claude[bot]` issue-level comments (where claude-review posts via `gh pr comment`). It does NOT enforce reading formal `/pulls/{N}/reviews` summaries or human reviewer line-comments — those remain attention-dependent and you should fetch them via `pnpm ops gh:pr-reviews <N>` and `pnpm ops gh:pr-comments <N>` per the PR-monitoring rule in `05-tooling.md`.

If post-merge feedback surfaces from claude-review on a tiny fixup, it can always be fixed on develop afterwards via the doc-commit exception (for docs) or a tiny follow-up PR (for code). The cost of one more CI cycle (~5 min) is far smaller than the cost of merging through an unreviewed change.

**Why:** CI green-by-omission is invisible by default. A failed `claude-review` (or any other check) sitting next to 14 green checks looks identical to "all green" at a glance, and skipping it silently sacrifices the signal it would have produced. Release PRs in particular benefit from a holistic second-look review even when the constituent code was reviewed PR-by-PR.

**How to apply when a check fails:**

| Failure shape                                                                                    | Action                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure flake (binary not found, missing secret, transient network error in action setup) | `gh run rerun <run-id> --failed` and re-arm the CI Monitor. Do not merge until the rerun passes.                                                                                  |
| Substantive review finding (claude-review or human reviewer)                                     | Apply per `08-review-response.md` — auto-apply trivial-shape edits, ASK on semantic-shape, present batch summary. Then re-run CI. Do not merge until the review verdict is green. |
| Real code failure (test red, lint error, type error)                                             | Fix the code. Do not skip the check.                                                                                                                                              |

**Bypassing CI is forbidden** even when the user has approved the merge in principle — approval is contingent on the merge happening through a green pipeline. If the user explicitly says "merge it anyway despite the red check," confirm once that they understand which check is red and what signal is being skipped before proceeding.

**Observed**: release PR #892 — an infra-red claude-review was merged through; the correction is rerun-then-merge, never merge-through.

## Testing

- **NEVER modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- Run `pnpm test` before pushing - no exceptions
- Run `pnpm test:component` when changes affect: slash command options/structure, command file discovery, or service integration points. The `CommandHandler.component.test.ts` has **snapshot tests** that break on any command option change.

### Test Coverage Baseline

- **NEVER add NEW code to `knownGaps` baseline** - write proper tests instead
- `knownGaps` is for pre-existing tech debt, not new features
- When audit fails with "NEW gaps", fix by adding tests, not by updating baseline
- File: `.github/baselines/test-coverage-baseline.json`

## Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Always Leave Code Better Than You Found It

**Never dismiss issues as "pre-existing" or "out of scope."** If you discover a problem while working in an area — missing tests, coverage gaps, code smells, unclear naming, stale comments — fix it. "Pre-existing" is not a reason to ignore something; it's an explanation of how it got there.

This applies to:

- **Missing test coverage** for modules you're modifying or extracting
- **Code quality issues** adjacent to your changes (dead imports, unclear names)
- **Coverage gaps** flagged in PR reviews — fix them, don't explain them away
- **Documentation** that's stale or misleading in files you're touching

The only exception: fixing it would significantly expand the PR's scope and risk unrelated bugs. Deferring requires a stated strong reason (different mechanism, no production evidence, risky breadth) — "pre-existing," "harmless," and "could be a follow-up" are non-reasons. If deferred, write the backlog entry immediately and fix it in a follow-up, not "someday." Declined ideas get NO tombstone in docs or backlog — the decline rationale lives in the PR/commit that declined them.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

### Don't Present Speculation as Fact

When making claims about causation, origin, intent, or history, distinguish between what you **observed** (tool output, file contents, git log, schema, test results) and what you **infer** (guesses about how something got that way, who did it, or why). Only state claims as fact when you have direct evidence. Otherwise:

- Name it as a hypothesis ("one possibility is..." / "without more data I can't tell whether X or Y")
- Better: say "I don't know" and propose concrete verification steps

**Triggers that deserve extra skepticism:**

- Words like "probably", "likely", "almost certainly", "must have been" without evidence
- Claims about what a human was doing, thinking, or intending
- Root-cause statements issued before verification has exhausted its scope
- Dismissals like "just user error" or "just a typo" without proof
- Infrastructure-decay excuses for an empty or sparse tool result — "the logs rolled off / aged out / expired", "it got garbage-collected", "retention dropped it" — offered in place of debugging the query

**Code-reading is not runtime verification.** Reading a code path tells you what it _could_ do given an input; it does NOT tell you which input actually occurred, or which branch actually ran, at runtime. A claim that _a specific execution did X_ — "the root cause is", "it returns empty here", "this branch runs" — requires a runtime observation (a log line, a test result, a repro) before it is stated as fact. "I read the code and it would do X" is a hypothesis; label it one ("code-reading suggests X; not yet runtime-confirmed") until a tool confirms it. Do NOT build or ship a fix on a code-read mechanism that hasn't been runtime-confirmed — ship the one diagnostic that produces the observation first. The pull to give a satisfying "found it!" is the tell: confident fact-framing on an unverified mechanism is exactly the failure this guards against.

**An empty or sparse tool result is not evidence that the data is gone.** When a query returns nothing — or less than you expected — the cause is almost always the _query_, not missing data: a wrong filter field, an out-of-range flag value, the wrong scope, or finicky query syntax. Do NOT explain it away with infrastructure-decay claims ("the logs rolled off", "it aged out of retention", "it expired", "it got GC'd") unless you have direct evidence that's literally true. That's the satisfying answer, and it's almost always wrong — stating it as fact sends the user looking for data that's sitting right there. Default to "my query is wrong": enumerate why it could be returning nothing, and fix the query before blaming the store. (Railway-log specifics — the `--lines` cap, filtering by the field the log actually carries, the ended-deploy lookup — live in the `/tzurot-deployment` skill.)

**Negative existence claims require an exhaustive search.** "We don't have X," "there's no way to do Y," and "that's not possible in this codebase" are claims about the ENTIRE codebase; a one-vocabulary grep cannot support them. Before stating one: search ≥3 vocabulary variants (your term, the domain's term, the library's term), sweep the generated declaration index (`pnpm ops xray --format md | grep -iE 'termA|termB|termC'` — regenerated from source, cannot be stale), and check for dormant scaffolding (`pnpm knip:dead`). If the sweep still finds nothing, state the claim WITH its evidence — "I searched A/B/C and found nothing" — which honestly invites correction. **The user's "I thought we had X" is a search order, not a debate prompt**: their vague memory has repeatedly beaten confident absence claims (webhook `applicationId`, the dormant `isProxyMessage` stub, the OpenRouter key that was "missing").

**Completion claims require re-reading the scope definition.** Before declaring a theme, epic, or multi-part task "done"/"complete," re-open its scope artifact (theme file, plan, epic roadmap) and enumerate remaining items by name. "The last PR merged" is not "done" — the definition's own checklist being empty is. An overclaimed completion silently removes work from the finishing-first queue, which is strictly worse than leaving it visibly unfinished (the Stryker theme was declared done with one of many packages piloted).

**Why this matters:** Users rely on assertions to decide what to do next. Speculation-as-fact produces wasted work when the real cause turns out to be different, and erodes trust when the pattern repeats. Prefer "the evidence shows X; the remaining candidates for why Y are A / B / C — here's how to narrow it" over "it was Z."

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances → List affected files → Justify exclusions.

### Fix Recurring Failures Structurally

When a failure pattern surfaces — a missed verification step, a skimmed review, a wrong tool default, an incorrect assumption that recurs — the first response should be to prevent recurrence at the system level, not just promise to try harder next time. Ask three questions in order:

1. **Can a rule catch this?** Add to `.claude/rules/` if it's a hard constraint ("never X without Y", "always do Z before A"). Rules always load.
2. **Can a skill capture this procedurally?** Add to `.claude/skills/<skill>/SKILL.md` if it's a workflow step the skill should own. Skills load on invocation.
3. **Can a hook enforce it automatically?** Add to `.claude/hooks/` if the trigger is deterministic and the correction mechanical. Hooks fire without reliance on model attention.

Claude's per-instance auto-memory at `~/.claude/projects/*/memory/` is a complement, not a substitute. Memory gives future-Claude the narrative ("this happened on date X during PR #Y"); rules/skills/hooks give the instruction. Memory is local to one machine and one Claude instance; rules and skills are source-controlled and apply to every contributor and every session.

**When something is important enough to flag as feedback, it is usually important enough to make recurrence structurally harder.** If a failure mode belongs in memory, first ask whether it also belongs in a rule or skill. Don't let memory become a graveyard of "try harder" notes.

**Promotion is atomic with deletion.** When a memory's content is promoted into a rule/skill/hook, delete the memory file, its MEMORY.md index line, and any inbound `[[links]]` in the same action — never leave the draft behind. Redundant memories reload every session and drift out of sync with the promoted rule.

**A tool without a named decision-point trigger goes unused.** When building or adopting a tool, write down the moment it must be reached for ("before asserting X", "after every push") in the relevant rule/skill — a tool that exists only in a command-reference table gathers dust (xray: 95 mentions while being built, near-zero use in the month after).

Scope the structural fix to the **class** of failure, not just the exact symptom. And don't over-expand — a one-line rule addition or a paragraph in a skill is usually enough. Rules state constraints plus at most a one-sentence why; multi-paragraph incident narratives don't belong here — the operationalized outcome IS the record (git preserves the story).
