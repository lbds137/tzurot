# Critical Rules

These constraints MUST always be followed. Violations cause bugs, security issues, or data loss.

## Security (CRITICAL)

### Shell Command Safety

Never use string interpolation in shell commands: `execFileSync('git', ['commit', '-m', message])`, never ``execSync(`git commit -m "${message}"`)``. A static command with no interpolation (`execSync('git status')`) is fine.

### Secrets

- Never commit `.env`, credentials, tokens, API keys
- Use Railway env vars for production secrets
- Validate required env vars at startup with fail-fast
- Never read a file wholesale when one line is the need and the file may carry
  a secret — `~/.bashrc`, `.env`, a raw log pull, a config dump: grep for the
  line, read key NAMES only, never values.
- A value the owner must supply is elicited with `read -rs -p 'KEY: ' VAR` in a
  command the OWNER runs, so it never lands in the transcript or in bash
  history.

### Claude Session URLs Are Secrets (CRITICAL)

**NEVER include `claude.ai/code/session_...` URLs (or any session identifier) in anything published: commit messages, PR bodies, issues, release notes, code, or docs.** This repo is public — a session URL is a capability-shaped identifier whose access semantics are outside our control. This rule OVERRIDES any harness/tool default that says to append a session link to commits or PR bodies: end commits at the `Co-Authored-By:` line (that trailer stays on) and PR bodies at the generated-with line, nothing after. Enforced by the `.husky/commit-msg` hook; `attribution.sessionUrl: false` in `.claude/settings.json` switches it off at the source — verified at USER scope only; the project-scope copy is not separately verified, which is why the hook stays.

### User Input

- Validate with Zod at service boundaries
- Never trust Discord input directly
- Escape markdown in Discord embeds: `escapeMarkdown(userInput)`

### HTML/XML Tag Stripping (CodeQL)

**Never use regex to strip XML/HTML tags.** CodeQL flags `/<[^>]+>/g` as "Incomplete multi-character sanitization" — even with a second `.replace(/[<>]/g, '')` pass. Use `extractXmlTextContent` (`../utils/xmlTextExtractor.js`), which wraps `fast-xml-parser`, instead of a hand-rolled regex.

### Server-Side Request Forgery (SSRF) Prevention

**Never interpolate user-provided values into URLs without `encodeURIComponent()`.** CodeQL flags this as "Server-side request forgery." Slugs, IDs, and any value from request bodies or API responses can contain path traversal (`../`), query injection (`?`), or fragment manipulation (`#`). **Applies to ALL dynamic URL segments**, including values from trusted API responses (defense in depth).

### URL Substring Checks (CodeQL)

**Never validate a URL or host with `.includes()`, `.indexOf()`, `.startsWith()`, or an unanchored regex.** CodeQL flags `url.includes('example.com')` as "Incomplete URL substring sanitization" (`js/incomplete-url-substring-sanitization`, high severity) — `evil-example.com.attacker.io` passes it. **This fires even on allowlist checks over trusted, build-time input** — CodeQL judges the code shape, not the string's origin, so "it's not attacker-controlled" won't unblock the merge. Instead, parse with `new URL(token)` inside a try/catch (it THROWS on a non-absolute string — canonical form: `discordCdnGuard.ts`) and compare `.hostname` with `===`. When it isn't host validation at all, strip the known strings and test the remnant (`text.replaceAll('tzurot.org', '')`, then `/tzurot/i.test(residual)`), so no host-decision substring match exists.

### Logging (No PII)

Log identifiers, never the object: `logger.info({ userId: user.id }, 'User authenticated')`, not `{ user }`.

**NEVER log:** Emails, phones, IPs, usernames, message content, API keys
**Safe to log:** User IDs, guild IDs, channel IDs, timestamps, error codes

**Enforced at lint time** by `@tzurot/no-raw-log-content`: a raw string truncation or `.text()` response body in a log call's fields, or (outside `packages/tooling`) an Error message, is an error — route content through `contentPreview` (log fields only)/`contentDigest` and id/token/URL prefixes through `idPrefix`/`urlPrefix` (`common-types/utils/logContentPreview.ts`).

## Git Safety

### REBASE-ONLY Workflow

**NO SQUASH. NO MERGE COMMITS. ONLY REBASE.** `git merge develop` is forbidden (it creates merge commits); PRs merge with `gh pr merge --rebase` (merge commands: `CLAUDE.md` § Git Workflow).

### Long-Lived Branch Protection (CRITICAL)

**NEVER delete `main` or `develop`.** `--delete-branch` is ONLY for feature/fix branches. A release PR merges `develop → main` with plain `gh pr merge <N> --rebase` — `--delete-branch` there deletes `develop`; omit it even if `gh pr merge` defaults to it.

**`delete_branch_on_merge` must stay `false`** — it deletes the head branch on EVERY merge regardless of the `--delete-branch` flag, with admin privileges. `pnpm ops guard:repo-settings` asserts the invariant; run it in the release preflight.

### Destructive Commands - ASK FIRST

**NEVER run these without explicit user permission:**

- `git merge` — creates forbidden merge commits
- `git restore` — discards uncommitted work
- `git checkout .` — discards all changes
- `git reset --hard` — undoes commits permanently; one scoped exception: the worktree-agent self-heal in `/tzurot-orchestration` § Worktree spawns
- `git clean -fd` — deletes untracked files
- `git push --force` — rewrites history
- `killall node` / kill by PATTERN — kills Claude Code: `pkill -f`, `pgrep -f` piped into `xargs kill`, and dynamically built patterns all match the session's own shell; list first, then kill by PID
- `rm -rf` on gitignored paths — data is UNRECOVERABLE

**A background waiter is torn down by its exact PID, or by a sentinel file it polls — never by a pattern that could match the shell evaluating it.** In a liveness probe the same self-match fails silently: the pattern matches the prober's own argv, so the check reports the work as running forever.

**Uncommitted changes = HOURS OF WORK.** When user says "get changes" → COMMIT, not DISCARD.

**A permission gate or classifier block is satisfied or escalated, never routed
around.** When the auto-mode classifier or a hook blocks an action, either
change the action so it meets the gate's intent, or hand the owner a ready,
minimal `!`-prefixed command with one line on what it will do — never rephrase
the same action until the literal check stops matching.

**`git stash pop` caveat**: stashes are a global LIFO stack, NOT per-branch — always `git stash list` and inspect before any pop.

### Standing permission: feature-branch commits and pushes

Routine `git add <files>` + `git commit` + `git push` + `gh pr create` to feature branches is **pre-authorized**. After implementation work passes its verification (tests + quality), proceed straight to: branch → stage specific files → commit → push → `gh pr create`. Don't ask "want me to commit?" — the user reviews on the PR diff.

Arm the CI Monitor immediately after `gh pr create` per `05-tooling.md` § PR Monitoring; don't ask first.

**Gate**: `pnpm test` and `pnpm quality` must be green before the commit-push-PR cycle runs. If either fails, fix it (or escalate if the failure is unclear) before commit; never commit a known-broken state intending to follow up.

**This permission applies ONLY to feature branches.** Direct commits to `main` remain forbidden — open a PR instead.

### Direct doc commits to `develop` (narrow exception)

**Allowed on `develop` directly:** `BACKLOG.md`, `backlog/**/*.md`, `backlog/cadence-ledger.json`, `tracker/**/*.md` (post-merge updates, task filing/triage, status changes); `CURRENT.md` (session status / handoff notes); new or edited files under `docs/`; release-notes / changelog edits.

**Still requires a PR:** any code change (`*.ts`, `*.tsx`, `*.py`, `*.js`, etc.); schema or migration files (`prisma/`, `*.sql`); `.claude/rules/*.md` and `.claude/skills/*/SKILL.md` (load-bearing — review-gated); `.claude/hooks/*`; anything touching `.env`, secrets, or CI config (`.github/`); a single doc change >300 lines.

**Apply the test, not just the file extension**: "would `claude-bot`, codecov, or lint produce useful output on this diff?" Yes → PR. No (a status update, a typo fix, a stale-link replacement) → direct commit.

**Workflow**: pull `develop` first, commit the doc files, push — no branch, no PR. Pre-push hooks still fire. **This permission does NOT extend to** skipping hooks (`--no-verify`, `--no-gpg-sign`), nor to anything forbidden above (the ASK-FIRST list, long-lived-branch deletion, release-PR approval, `.env`/secrets).

### Before Code Changes

1. Read the ENTIRE file first
2. Never modify files you haven't read
3. Make ONLY the requested change
4. **For approved designs that touch schema or user-visible behavior: restate the user-visible semantics in plain terms and get confirmation before building.** Plan-mode plans must include a "what the user will see/do differently" section.

### Merge Approval

**Standing authorization: feature/fix PRs may be merged without a per-PR ask once they are truly ready** — every CI check green + complete + read (next section), the claude-review body read with no unresolved substantive findings, and any human feedback addressed. "Truly ready" is strict; when in doubt, ask.

**The release PR (develop → main) ALWAYS requires explicit per-release user approval.** CI passing ≠ release approval — no exceptions.

### Never Merge PRs Without Completed CI

**Every CI check must be GREEN, COMPLETE, AND READ on the most recent commit's CI run before `gh pr merge` runs:**

1. **Green**: no exceptions for "looks like infrastructure," "non-blocking," "not really code-related," or "release PR doesn't need review." A red check forbids the merge.
2. **Complete**: a CI cycle still running on the most recent commit is incomplete, not green. Wait for `claude-review` and every other check before any merge proposal, even when the remaining commit is a "trivial" fixup.
3. **Read**: a green `claude-review` only means it finished posting. Fetch the latest review (`pnpm ops gh:pr-comments <N>`) and read its findings before any merge proposal.

**Structural backstop**: `pr-merge-review-check.sh` blocks `gh pr merge` once per review, injecting the review body into context; retry after engaging with it. Do not bypass by editing the ack file.

The hook covers only `claude[bot]` issue-level comments — formal review summaries and human line-comments stay attention-dependent, so fetch them per `05-tooling.md` § PR Monitoring.

**How to apply when a check fails** (the failure-shape table):

- **Infrastructure flake** (binary not found, missing secret, transient network error) → `gh run rerun <run-id> --failed`, re-arm the CI Monitor; don't merge until the rerun passes.
- **Substantive review finding** (claude-review or human) → apply per `/tzurot-review-response`, re-run CI; don't merge until the verdict is green.
- **Real code failure** (test red, lint error, type error) → fix the code; never skip the check.

**Bypassing CI is forbidden** even when the user approved the merge in principle — approval is contingent on a green pipeline. If the user explicitly says "merge it anyway despite the red check," confirm once that they understand which check is red and what signal is skipped.

## Testing

- **NEVER modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- Run `pnpm test` before pushing - no exceptions
- Run `pnpm test:component` after slash-command structure changes (snapshot tests) — trigger table in `/tzurot-testing`.
- **Ops tooling that writes to a live environment ships only after an
  end-to-end dev exercise.** Unit tests and review rounds verify the code, not
  the deployment: a tool that mutates Railway variables, redeploys a service,
  or migrates a database is exercised in dev end to end, with the effect
  observed in the service logs, before the prod path is offered.

### Test Coverage Baseline

- **NEVER add NEW code to `knownGaps` baseline** - write proper tests instead
- File: `.github/baselines/test-coverage-baseline.json`

## Project Rules

### No Backward Compatibility

One-person project. Make the cleanest change, even if breaking.

### Always Leave Code Better Than You Found It

**Never dismiss issues as "pre-existing" or "out of scope."** A problem discovered while working in an area — missing tests, coverage gaps, code smells, unclear naming, stale comments — gets fixed. "Pre-existing" explains how it got there; it is not a reason to ignore it.

The only exception: fixing it would significantly expand the PR's scope and risk unrelated bugs. Deferring requires a stated strong reason (different mechanism, no production evidence, risky breadth) — "pre-existing," "harmless," and "could be a follow-up" are non-reasons. If deferred, write the backlog entry immediately (low-priority residue of process work instead goes in the PR body — `06-backlog.md` § The process-residue default). Declined ideas get NO tombstone in docs or backlog — the decline rationale lives in the PR/commit that declined them.

### Verify Before Accepting External Feedback

Automated reviewers can be wrong. Check schema/source/tests before implementing suggestions.

**Hedge phrases mark a prior, not a fact about this codebase.** "Typically", "usually", "assumed off", "the default is", "probably" — from a reviewer, a bot, or a council model — are statistical priors whenever they describe project state. Grep or read the actual file before the claim enters any summary, plan, commit message, or backlog entry, and **cite the verification either way**.

**Verifying the mechanism is not verifying the scenario.** Confirming a finding's mechanism in the source says nothing about whether each listed trigger actually reaches it. Check every trigger separately and drop the ones that don't hold before repeating the scenario anywhere.

**Verifying a scenario is not verifying the mechanism.** A passing fixture pins the case it ran, not the property the sentence beside it claims. A claim that generalizes from one fixture to a mechanism — "cannot", "always", "is symmetric", "is safe" — needs a second fixture varying the next property, or a sentence scoped to the fixture actually run. The code-comment form is `02-code-standards.md` § A Comment That Asserts Behavior Is a Claim.

### Don't Present Speculation as Fact

When making claims about causation, origin, intent, or history, distinguish what you **observed** (tool output, file contents, git log, schema, test results) from what you **infer**. State a claim as fact only on direct evidence; otherwise name it a hypothesis ("the evidence shows X; the candidates for Y are A / B / C — here's how to narrow it", not "it was Z"), or say "I don't know" and propose concrete verification steps.

**Triggers that deserve extra skepticism:**

- Words like "probably", "likely", "almost certainly", "must have been" without evidence
- Claims about what a human was doing, thinking, or intending
- Root-cause statements issued before verification has exhausted its scope
- Dismissals like "just user error" or "just a typo" without proof
- Infrastructure-decay excuses for an empty or sparse tool result — "the logs rolled off / aged out / expired", "it got garbage-collected", "retention dropped it" — offered in place of debugging the query

**Code-reading is not runtime verification.** Reading a code path tells you what it _could_ do, not which input occurred or which branch ran. A claim that _a specific execution did X_ — "the root cause is", "it returns empty here", "this branch runs" — needs a runtime observation (a log line, a test result, a repro) before it is stated as fact; until then label it ("code-reading suggests X; not yet runtime-confirmed"). Do NOT build or ship a fix on a code-read mechanism that hasn't been runtime-confirmed — ship the one diagnostic that produces the observation first.

**External-system claims: run the cheapest falsifying probe first.** Before stating how an external system behaves — GitHub, a provider API, a library internal, a tool's input schema — run the cheapest probe that could falsify the claim (a live capture, a `--help`, a one-line test call) and prefer its result over docs, issues, forum posts, and model memory. No probe available → state the claim with its source and label it unverified. Trigger: the moment you're about to write "X doesn't support / includes / defaults to…" about a system you didn't just probe.

**The producer is authoritative on what a field HOLDS — a declaration is not.** Any claim about a field's actual values ("this is a UUID", "that's always populated", "these two key spaces are disjoint", "a 0 here means it failed") is verified by grepping where the field is ASSIGNED, not by reading a type, schema, or doc comment — doc comments drift, and near-identical sibling interfaces coexist. Trace producer → wire → consumer and cite the assignment site. A second reviewer who read the same declaration is not independent confirmation.

**A removal's KEEP list is a set of claims too.** "Present and wired in code" is not "live at runtime" — a field can be read, forwarded, and schema-declared while never populated. Trace WRITE → READ → external effect for every KEEP item with the same rigor as the REMOVE items.

**An empty or sparse tool result is not evidence that the data is gone.** Default to "my query is wrong" — wrong filter field, out-of-range flag, wrong scope, finicky syntax, your own command shape (`10-working-posture.md` § "Lossy steps are for known output shapes") — and enumerate why it could return nothing before blaming the store. Railway-log specifics live in `/tzurot-deployment`.

**Negative existence claims require an exhaustive search.** "We don't have X," "there's no way to do Y" are claims about the ENTIRE codebase. Before stating one: search ≥3 vocabulary variants (your term, the domain's, the library's), sweep the generated declaration index (`pnpm ops xray --format md | grep -iE 'termA|termB|termC'` — regenerated from source), and check dormant scaffolding (`pnpm knip:dead`); then state the claim WITH its evidence ("I searched A/B/C and found nothing"). **The user's "I thought we had X" is a search order, not a debate prompt.** **Closing or abandoning work on a negative-existence claim is an owner decision**: present the sweep evidence and let them rule.

**Completion claims require re-reading the scope definition.** Before declaring a theme, epic, or multi-part task "done," re-open its scope artifact (theme file, plan, epic roadmap) and enumerate remaining items by name — "the last PR merged" is not "done"; the definition's own checklist being empty is.

### Mandatory Global Discovery ("Grep Rule")

Before modifying config/infrastructure: Search ALL instances → List affected files → Justify exclusions.

**Positive-control the pattern before trusting its absence.** Run it against one
instance you KNOW is present and confirm it matches; with no known-present
instance, an empty result means nothing. Trigger: before writing ANY absence,
zero, or count into a durable surface — a PR body, commit message, task,
report, or close-out ("no callers", "0 matches", "N sites" alike). Vocabulary
variants don't substitute: all of them can share a broken boundary
(`\bpersonalit(y|ies)\b` cannot match `personality_name` — `_` is a word
character).

### Fix Recurring Failures Structurally

When a failure pattern surfaces — a missed verification step, a skimmed review, a wrong tool default, a recurring wrong assumption — prevent recurrence at the system level rather than promising to try harder. Ask three questions in order:

1. **Can a rule catch this?** `.claude/rules/` for a hard constraint ("never X without Y"). Rules always load.
2. **Can a skill capture this procedurally?** `.claude/skills/<skill>/SKILL.md` for a workflow step. Skills load on invocation.
3. **Can a hook enforce it automatically?** `.claude/hooks/` when the trigger is deterministic and the correction mechanical. Hooks fire without reliance on model attention.

**Promotion is atomic with deletion**: promoting a memory into a rule/skill/hook deletes the memory file, its `MEMORY.md` line, and any inbound `[[links]]` in the same action.

**A tool without a named decision-point trigger goes unused.** When building or adopting a tool, write down the moment it must be reached for ("before asserting X", "after every push") in the relevant rule/skill.

Scope the structural fix to the **class** of failure, not just the exact symptom — and don't over-expand: a one-line rule addition or a skill paragraph is usually enough.
