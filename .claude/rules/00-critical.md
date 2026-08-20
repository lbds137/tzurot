# Critical Rules

These constraints MUST always be followed. Violations cause bugs, security issues, or data loss.

## Security (CRITICAL)

### Shell Command Safety

Never use string interpolation in shell commands.

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

**NEVER include `claude.ai/code/session_...` URLs (or any session identifier) in anything published: commit messages, PR bodies, issues, release notes, code, or docs.** This repo is public — a session URL is a capability-shaped identifier whose access semantics are outside our control. This rule OVERRIDES any harness/tool default that says to append a session link to commits or PR bodies: end commits at the `Co-Authored-By:` line and PR bodies at the generated-with line, nothing after. Enforced by the `.husky/commit-msg` hook.

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

### URL Substring Checks (CodeQL)

**Never validate a URL or host with `.includes()`, `.indexOf()`, `.startsWith()`, or an unanchored regex.** CodeQL flags `url.includes('example.com')` as "Incomplete URL substring sanitization" (`js/incomplete-url-substring-sanitization`, high severity) — `evil-example.com.attacker.io` passes it. **This fires even on allowlist checks over trusted, build-time input** — CodeQL judges the code shape, not the string's origin, so "it's not attacker-controlled" won't unblock the merge.

```typescript
// ❌ WRONG - substring host check (CodeQL high)
if (token.includes('tzurot.org')) {
  /* treat as trusted */
}

// ✅ CORRECT - parse and compare the host exactly. `new URL()` THROWS on a
//    non-absolute string, so guard the parse (see discordCdnGuard.ts for the
//    codebase's canonical try/catch form that returns a tagged result).
let host: string | undefined;
try {
  host = new URL(token).hostname;
} catch {
  /* not an absolute URL — reject */
}
if (host === 'tzurot.org') {
  /* trusted */
}

// ✅ ALSO OK - when it isn't host validation at all: strip the known strings,
//    then test the remnant, so no host-decision substring match exists
const residual = text.replaceAll('tzurot.org', '');
if (/tzurot/i.test(residual)) {
  /* something unexpected remains */
}
```

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

**`delete_branch_on_merge` must stay `false`** — it deletes the head branch on EVERY merge regardless of the `--delete-branch` flag, with admin privileges, so it passes through `develop`'s deliberately-bypassable ruleset. `pnpm ops guard:repo-settings` asserts the invariant; run it in the release preflight.

### Destructive Commands - ASK FIRST

**NEVER run these without explicit user permission:**

| Command                       | Risk                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `git merge`                   | Creates forbidden merge commits                                                                                              |
| `git restore`                 | Discards uncommitted work                                                                                                    |
| `git checkout .`              | Discards all changes                                                                                                         |
| `git reset --hard`            | Undoes commits permanently — one scoped exception: the worktree-agent self-heal in `/tzurot-orchestration` § Worktree spawns |
| `git clean -fd`               | Deletes untracked files                                                                                                      |
| `git push --force`            | Rewrites history                                                                                                             |
| `killall node` / `pkill node` | Kills Claude Code                                                                                                            |
| `rm -rf` on gitignored paths  | Data is UNRECOVERABLE                                                                                                        |

**Uncommitted changes = HOURS OF WORK.** When user says "get changes" → COMMIT, not DISCARD.

**`git stash pop` caveat**: stashes are a global LIFO stack, NOT per-branch. Popping blind applies another branch's stash and produces conflict markers in files you never touched. Always `git stash list` and inspect before any pop.

### Standing permission: feature-branch commits and pushes

Routine `git add <files>` + `git commit` + `git push` + `gh pr create` to feature branches is **pre-authorized**. After implementation work passes its verification (tests + quality), proceed straight to: branch → stage specific files → commit → push → `gh pr create`. Don't ask "want me to commit?" or "should I open the PR now?" — the user reviews on the PR diff, not on a per-commit prompt.

Arm the CI Monitor immediately after `gh pr create` per `05-tooling.md` § PR Monitoring; don't ask first.

**Gate**: `pnpm test` and `pnpm quality` must be green before the commit-push-PR cycle runs. Don't commit to get CI to check for you — CI is a second line of defense, not a substitute for local verification. If either fails, fix the failure (or escalate to the user if the failure is unclear) before commit; do not commit a known-broken state with the intent to follow up.

**This permission applies ONLY to feature branches.** Direct commits to `main` remain forbidden — open a PR instead.

### Direct doc commits to `develop` (narrow exception)

| Allowed on `develop` directly                                                                                 | Still requires a PR                                                          |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `BACKLOG.md` + `backlog/**/*.md` + `tracker/**/*.md` (post-merge updates, task filing/triage, status changes) | Any code change (`*.ts`, `*.tsx`, `*.py`, `*.js`, etc.)                      |
| `CURRENT.md` (session-status / handoff notes)                                                                 | Schema or migration files (`prisma/`, `*.sql`)                               |
| New or edited files under `docs/` (typo fixes, runbook tweaks, reference updates, freshly-written guides)     | `.claude/rules/*.md` (load-bearing constraints — review-gated)               |
| Release-notes / changelog edits                                                                               | `.claude/skills/*/SKILL.md` (load-bearing procedures — review-gated)         |
|                                                                                                               | `.claude/hooks/*` (automation hooks that run on every contributor's session) |
|                                                                                                               | Anything that touches `.env`, secrets, or CI config (`.github/`)             |
|                                                                                                               | Single doc changes >300 lines (worth review on a diff UI)                    |

**Apply the test, not just the file extension**: when in doubt about a doc change, ask "would `claude-bot`, codecov, or lint produce useful output on this diff?" If yes (e.g., a rule that affects every contributor's behavior, a runbook that prescribes a specific command sequence reviewer might want to second-guess), use a PR. If no (a status update, a typo fix, a stale-link replacement), direct commit is fine.

**Workflow**: pull `develop` first, commit the doc files, push — no branch, no PR, no CI re-run. Pre-push hooks still fire.

**This permission does NOT extend to:**

- Skipping hooks (`--no-verify`, `--no-gpg-sign`), plus everything already forbidden above: the ASK-FIRST table, long-lived-branch deletion, release-PR approval, `.env`/secrets.

### Before Code Changes

1. Read the ENTIRE file first
2. Never modify files you haven't read
3. Make ONLY the requested change
4. **For approved designs that touch schema or user-visible behavior: restate the user-visible semantics in plain terms and get confirmation before building.** Plan-mode plans must include a "what the user will see/do differently" section.

### Merge Approval

**Standing authorization: feature/fix PRs may be merged without a per-PR ask once they are truly ready** — every CI check green + complete + read (next section), the claude-review body read with no unresolved substantive findings, and any human feedback addressed. "Truly ready" is strict; when in doubt, ask.

**The release PR (develop → main) ALWAYS requires explicit per-release user approval.** CI passing ≠ release approval — no exceptions.

### Never Merge PRs Without Completed CI

**Every CI check must be GREEN, COMPLETE, AND READ on the most recent commit's CI run before `gh pr merge` runs.** This has three parts:

1. **Green**: no exceptions for "looks like infrastructure," "non-blocking," "not really code-related," or "release PR doesn't need review." If a check is red, the merge is forbidden until the check is green.
2. **Complete**: a CI cycle that's still running on the most recent commit is not "green" — it's incomplete. Wait for `claude-review` and every other check to finish before any merge proposal, even if the only remaining commit is a "trivial" fixup (one-line comment, test rename, etc.). Trivial-shape edits per `/tzurot-review-response` are still gated by tests; the analog at the merge step is "still gated by CI."
3. **Read**: `claude-review` turning green only means it finished posting — it does NOT mean its content was read. Always fetch the latest review (`pnpm ops gh:pr-comments <N>`) and read its findings before any merge proposal. A "LGTM" verdict is fine; non-blocking observations may or may not warrant a fixup, but you can't decide without reading. Skipping this step is how reviewer feedback gets silently dropped.

**Structural backstop**: `pr-merge-review-check.sh` blocks `gh pr merge` once per review, injecting the review body into context; retry after engaging with it. A fresh review re-arms it. Do not bypass by editing the ack file.

The hook covers only `claude[bot]` issue-level comments — formal review summaries and human line-comments stay attention-dependent, so fetch them per `05-tooling.md` § PR Monitoring.

**Why:** CI green-by-omission is invisible by default. A failed `claude-review` (or any other check) sitting next to 14 green checks looks identical to "all green" at a glance, and skipping it silently sacrifices the signal it would have produced. Release PRs in particular benefit from a holistic second-look review even when the constituent code was reviewed PR-by-PR.

**How to apply when a check fails:**

| Failure shape                                                                                    | Action                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure flake (binary not found, missing secret, transient network error in action setup) | `gh run rerun <run-id> --failed` and re-arm the CI Monitor. Do not merge until the rerun passes.                                                                                    |
| Substantive review finding (claude-review or human reviewer)                                     | Apply per `/tzurot-review-response` — auto-apply trivial-shape edits, ASK on semantic-shape, present batch summary. Then re-run CI. Do not merge until the review verdict is green. |
| Real code failure (test red, lint error, type error)                                             | Fix the code. Do not skip the check.                                                                                                                                                |

**Bypassing CI is forbidden** even when the user has approved the merge in principle — approval is contingent on the merge happening through a green pipeline. If the user explicitly says "merge it anyway despite the red check," confirm once that they understand which check is red and what signal is being skipped before proceeding.

## Testing

- **NEVER modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- Run `pnpm test` before pushing - no exceptions
- Run `pnpm test:component` after slash-command structure changes (snapshot tests) — trigger table in `/tzurot-testing`.

### Test Coverage Baseline

- **NEVER add NEW code to `knownGaps` baseline** - write proper tests instead
- File: `.github/baselines/test-coverage-baseline.json`

## Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Always Leave Code Better Than You Found It

**Never dismiss issues as "pre-existing" or "out of scope."** If you discover a problem while working in an area — missing tests, coverage gaps, code smells, unclear naming, stale comments — fix it. "Pre-existing" is not a reason to ignore something; it's an explanation of how it got there.

The only exception: fixing it would significantly expand the PR's scope and risk unrelated bugs. Deferring requires a stated strong reason (different mechanism, no production evidence, risky breadth) — "pre-existing," "harmless," and "could be a follow-up" are non-reasons. If deferred, write the backlog entry immediately and fix it in a follow-up, not "someday." Declined ideas get NO tombstone in docs or backlog — the decline rationale lives in the PR/commit that declined them.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

**Hedge phrases mark a prior, not a fact about this codebase.** "Typically", "usually", "assumed off", "the default is", "probably" — from a reviewer, a bot, or a council model — are statistical priors whenever they describe project state (intents, configs, flags, dependencies). Grep or read the actual file before the claim enters any summary, plan, commit message, or backlog entry, and **cite the verification either way**: quote the result when the reviewer is right, correct the record explicitly when they're wrong.

**Verifying the mechanism is not verifying the scenario.** Confirming a finding's mechanism in the source says nothing about whether each listed trigger actually reaches it. Check every trigger separately and drop the ones that don't hold before repeating the scenario in a PR body, commit message, or smoke item — including a repro you wrote yourself.

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

**External-system claims: run the cheapest falsifying probe first.** Before stating how an external system behaves — GitHub, a provider API, a library internal, a tool's input schema — run the cheapest probe that could falsify the claim (a live capture, a `--help`, a one-line test call) and prefer its result over docs, issues, forum posts, and model memory, all of which lag shipped reality. No probe available → state the claim with its source and label it unverified. The decision-point trigger: the moment you're about to write "X doesn't support / includes / defaults to…" about a system you didn't just probe.

**The producer is authoritative on what a field HOLDS — a declaration is not.** Any claim about a field's actual values ("this is a UUID", "that's always populated", "these two key spaces are disjoint", "a 0 here means it failed") must be verified by grepping where the field is ASSIGNED, not by reading a type, schema, or doc comment. Two failure modes drive this: a doc comment states the author's intent at writing time and drifts silently, and near-identical sibling interfaces coexist (`RawHistoryEntry` vs `ConversationHistoryEntry` vs an inline structural type — all three declare `id?: string` on the same conceptual row, with materially different semantics), so reading a plausible-looking declaration is not evidence you read the one in the path. Trace producer → wire → consumer and cite the assignment site. A second reviewer agreeing is not independent confirmation when it read the same declaration you did.

**A removal's KEEP list is a set of claims too.** In any removal or cleanup, "present and wired in code" is not "live at runtime" — a field can be read, forwarded, and schema-declared while never being populated (no write path, no UI, a downstream guard that silently skips it), so the half you exempted can be as dead as the half you cut. Trace WRITE → READ → external effect for every KEEP item with the same rigor you applied to the REMOVE items; "it's referenced in the code" is the start of the investigation, not the conclusion.

**An empty or sparse tool result is not evidence that the data is gone.** Default to "my query is wrong" — wrong filter field, out-of-range flag, wrong scope, finicky syntax — and enumerate why it could be returning nothing before blaming the store. "The query" includes your own command shape (`10-working-posture.md` § "Lossy steps are for known output shapes"). Railway-log specifics live in the `/tzurot-deployment` skill.

**Negative existence claims require an exhaustive search.** "We don't have X," "there's no way to do Y," and "that's not possible in this codebase" are claims about the ENTIRE codebase; a one-vocabulary grep cannot support them. Before stating one: search ≥3 vocabulary variants (your term, the domain's term, the library's term), sweep the generated declaration index (`pnpm ops xray --format md | grep -iE 'termA|termB|termC'` — regenerated from source, cannot be stale), and check for dormant scaffolding (`pnpm knip:dead`). If the sweep still finds nothing, state the claim WITH its evidence — "I searched A/B/C and found nothing" — which honestly invites correction. **The user's "I thought we had X" is a search order, not a debate prompt**: their vague memory has repeatedly beaten confident absence claims. **And closing or abandoning work on the strength of a negative-existence claim is an owner decision**: present the sweep evidence and let them rule — never unilaterally close a PR or investigation on "it can't be done."

**Completion claims require re-reading the scope definition.** Before declaring a theme, epic, or multi-part task "done"/"complete," re-open its scope artifact (theme file, plan, epic roadmap) and enumerate remaining items by name. "The last PR merged" is not "done" — the definition's own checklist being empty is. An overclaimed completion silently removes work from the finishing-first queue, which is strictly worse than leaving it visibly unfinished.

Prefer "the evidence shows X; the remaining candidates for why Y are A / B / C — here's how to narrow it" over "it was Z."

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances → List affected files → Justify exclusions.

**Positive-control the pattern before trusting its absence.** Run it against one
instance you KNOW is present and confirm it matches; if you cannot name a
known-present instance, the sweep has no floor and an empty result means
nothing. Trigger: before writing "the enumeration is N sites" into any PR body,
commit message, or backlog entry. This is not the 3-variant vocabulary rule
above — variants don't help when all of them share a broken boundary
assumption. Observed misses: `\bpersonalit(y|ies)\b` cannot match
`personality_name` (`_` is a word character, so there is no `\b`);
`.user.login=="claude"` matches nothing because the login is `claude[bot]`.
Each returned empty and read as "clean".

### Fix Recurring Failures Structurally

When a failure pattern surfaces — a missed verification step, a skimmed review, a wrong tool default, an incorrect assumption that recurs — the first response should be to prevent recurrence at the system level, not just promise to try harder next time. Ask three questions in order:

1. **Can a rule catch this?** Add to `.claude/rules/` if it's a hard constraint ("never X without Y", "always do Z before A"). Rules always load.
2. **Can a skill capture this procedurally?** Add to `.claude/skills/<skill>/SKILL.md` if it's a workflow step the skill should own. Skills load on invocation.
3. **Can a hook enforce it automatically?** Add to `.claude/hooks/` if the trigger is deterministic and the correction mechanical. Hooks fire without reliance on model attention.

**Promotion is atomic with deletion**: promoting a memory into a rule/skill/hook deletes the memory file, its `MEMORY.md` line, and any inbound `[[links]]` in the same action.

**A tool without a named decision-point trigger goes unused.** When building or adopting a tool, write down the moment it must be reached for ("before asserting X", "after every push") in the relevant rule/skill — a tool that exists only in a command-reference table gathers dust.

Scope the structural fix to the **class** of failure, not just the exact symptom. And don't over-expand — a one-line rule addition or a paragraph in a skill is usually enough.
