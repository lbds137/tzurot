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

### Before Code Changes

1. Read the ENTIRE file first
2. Never modify files you haven't read
3. Make ONLY the requested change

### Never Merge PRs Without User Approval

CI passing != merge approval. User must explicitly request merge.

## Testing

- **NEVER modify tests to make them pass** - fix the implementation
- **Coverage required**: 80% minimum, Codecov blocks PRs below threshold
- Run `pnpm test` before pushing - no exceptions
- Run `pnpm test:int` when changes affect: slash command options/structure, command file discovery, or service integration points. The `CommandHandler.int.test.ts` has **snapshot tests** that break on any command option change.

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

The only exception: if fixing the issue would significantly expand the scope of the PR and risk introducing unrelated bugs. In that case, create a backlog item — but still fix it in a follow-up, not "someday."

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

Scope the structural fix to the **class** of failure, not just the exact symptom. And don't over-expand — a one-line rule addition or a paragraph in a skill is usually enough.
