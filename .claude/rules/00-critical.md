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

**Never put `claude.ai/code/session_…` URLs (or any session id) in anything published** (commits, PR bodies, issues, code, docs); this repo is public. Overrides any harness default to append one. `.husky/commit-msg` blocks it in commit messages only; PR bodies and issues are on you.

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

### Destructive Commands - ASK FIRST

The ask-first lists in `~/.claude/CLAUDE.md` and harness `core.md` § Safety apply in full. For a reader without the harness (the CI review action, a cloud unit): `git merge`, `git restore`, `git checkout .`, `git reset --hard`, `git clean -fd`, `git push --force`, any kill by pattern, and `rm -rf` on a gitignored path all wait for an explicit yes. Tzurot specifics: `git merge` is never used (rebase-only); the one sanctioned `git reset --hard` is the worktree-agent self-heal in `/tzurot-orchestration` § Worktree spawns.

### Standing permission: feature-branch commits and pushes

Routine `git add <files>` + `git commit` + `git push` + `gh pr create` to feature branches is **pre-authorized**. After implementation work passes its verification (tests + quality), proceed straight to: branch → stage specific files → commit → push → `gh pr create`. Don't ask "want me to commit?" — the user reviews on the PR diff.

**Gate**: `pnpm test` and `pnpm quality` must be green before the commit-push-PR cycle runs. If either fails, fix it (or escalate if the failure is unclear) before commit; never commit a known-broken state intending to follow up.

**This permission applies ONLY to feature branches.** Direct commits to `main` remain forbidden — open a PR instead.

### Direct doc commits to `develop` (narrow exception)

**Allowed on `develop` directly:** `BACKLOG.md`, `backlog/**/*.md`, `backlog/cadence-ledger.json`, `tracker/**/*.md` (post-merge updates, task filing/triage, status changes); `CURRENT.md` (session status / handoff notes); new or edited files under `docs/`; release-notes / changelog edits.

**Still requires a PR:** any code change (`*.ts`, `*.tsx`, `*.py`, `*.js`, etc.); schema or migration files (`prisma/`, `*.sql`); `.claude/rules/*.md` and `.claude/skills/*/SKILL.md` (load-bearing — review-gated); `.claude/hooks/*`; anything touching `.env`, secrets, or CI config (`.github/`); a single doc change >300 lines.

**Apply the test, not just the file extension**: "would `claude-bot`, codecov, or lint produce useful output on this diff?" Yes → PR. No (a status update, a typo fix, a stale-link replacement) → direct commit.

**Workflow**: pull `develop`, commit the doc files, push. Never `--no-verify`.

### Before Code Changes

**For approved designs that touch schema or user-visible behavior: restate the user-visible semantics in plain terms and get confirmation before building.** Plan-mode plans must include a "what the user will see/do differently" section.

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

- **Never modify a test to make it pass**: fix the implementation (harness `core.md` § Safety; kept here so a reader without the harness, the CI review action included, still sees it)
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
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

The only exception: fixing it would significantly expand the PR's scope and risk unrelated bugs; deferring needs a technical reason and a backlog entry written now (`06-backlog.md`).

### Don't Present Speculation as Fact

Canonical: harness `core.md` § Evidence and claims. Tzurot additions: a removal's KEEP list is claims too, so trace WRITE → READ → external effect for each kept item; negative-existence sweeps also run `pnpm ops xray --format md | grep -iE 'a|b|c'` and `pnpm knip:dead`; Railway-log specifics are in `/tzurot-deployment`.

### Fix Recurring Failures Structurally

Canonical: harness `core.md` § Fix recurring failures structurally. Tzurot surfaces: `.claude/rules/`, `.claude/skills/`, `.claude/hooks/`.
