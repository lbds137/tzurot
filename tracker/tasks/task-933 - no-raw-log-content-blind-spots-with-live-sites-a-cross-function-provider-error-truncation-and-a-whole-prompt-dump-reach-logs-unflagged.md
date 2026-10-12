---
id: TASK-933
title: >-
  no-raw-log-content blind spots with live sites: a cross-function
  provider-error truncation and a whole-prompt dump reach logs unflagged
status: To Do
assignee: []
created_date: '2026-09-10 21:08'
updated_date: '2026-10-12 22:48'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 931000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: the #2388 review found two live sites the new @tzurot/no-raw-log-content rule structurally cannot see, both inside its documented blind spots. (1) services/ai-worker/src/utils/apiErrorParser.ts (grep errorLogContextFromInfo) truncates technicalMessage, raw provider or API error text, at MAX_ERROR_MESSAGE_LENGTH in one function, and the result is spread into logger.error and diagnosticCollector.recordError at services/ai-worker/src/jobs/handlers/pipeline/steps/generationFailureResult.ts. That is cross-function flow, so the rule never sees the truncation, and the site carries neither a fix nor a justified disable, unlike the equivalent OpenRouterFetch.ts site. (2) services/ai-worker/src/services/prompt/PromptLogger.ts logs the full untruncated system prompt by plain concatenation in its if-branch. That shape has no slice, so the rule cannot see it; it is behind the NODE_ENV=development plus LOG_PROMPT_ASSEMBLY guard, a flag deployed boots refuse.
Fix shape: (1) decide whether provider error text counts as content. If not, add a justified disable at the truncation site, or route it through a named helper, so the decision is visible; if it does, log a digest plus length instead. (2) Leave the dump, but add a disable-style comment naming the guard, so a reader sees the sanctioned exception. Also decide whether the rule should gain a cross-function arm for helpers that return a truncation of their parameter.
Acceptance: both sites carry an explicit, reviewed disposition in code, and the rule doc names the remaining blind spots with a live example each.

## Merged from TASK-1135 (2026-10-12)

TASK-1135 (priority low): `@tzurot/no-raw-log-content` does not inspect `logger.child({...})` bindings. The rule matches the fields object of log-method calls (info/warn/error/debug and the Error sinks); a filename, truncation or response body bound into a child logger would ride every line that logger emits without a finding. Latent today: `git grep` for `.child(` in non-test services/packages code finds one site, services/ai-worker/src/services/AttachmentProcessor.ts (`logger.child({ requestId })`), which binds only an id. Surfaced by the TASK-1121 orchestrator. Fix: add `child()` as a log sink in the rule (same SinkPolicy as a log call), with a flagged case and a clean-id case in no-raw-log-content.test.ts. Acceptance: `logger.child({ name: attachment.name })` is a rawFilename finding; `logger.child({ requestId })` stays clean. (Hardening member (7) of this task.)

## Merged from TASK-1142 (2026-10-12)

TASK-1142 (priority medium, raises this task's priority to medium): claude-review round 3 on PR #2552 (TASK-1121), 2026-09-27. Also area:ai-worker for item 3.
- (8) packages/tooling/src/eslint/no-raw-log-content.ts `collectCall`: the contentPreview branch returns without walking its arguments, so `logger.info({ p: contentPreview(attachment.name, 20) })` yields no rawFilename finding and would log up to 20 raw chars of the filename stem. contentPreview only returns a value with NODE_ENV=development and LOG_CONTENT_PREVIEWS=true, so no prod leak today, but it is a gap in the rule's promise. Fix: inside contentPreview's subtree still run the filename check (a file-ish name read under contentPreview is rawFilename), with a test.
- (9) The filenameShape exemption is unconditional, so a bare template interpolation of the whole object at an Error sink passes lint and renders [object Object]; the documented Error-sink remedy is `filenameShape(name)?.extension`. Fix: at an Error sink, flag a filenameShape(...) call used directly in a template literal or string concatenation unless followed by `.extension` (or document and test the limit).
- (10) AudioTranscriptionJob.ts / ImageDescriptionJob.ts operationName renders '(.unknown)' when there is no extension (hard-coded dot plus fallback word); the no-extension branch is untested. Fix: render '(no extension)' with a test. UNVERIFIED, MAY ALREADY BE FIXED: on 2026-10-12 `git grep` for `(.unknown)` / `no extension` in those two job files found no hit; re-check the current operationName code before building.
- (11) Merge-gate claim scan on #2552: packages/common-types/src/utils/logContentPreview.ts `filenameShape` docblock (line 98 on 2026-10-12, still reads "so this never returns any part of the name itself") is false as written because the extension IS part of the name (review round 3 item 5). Reword to "never returns the stem" and state the extension caveat (a <=10-char alnum suffix passes through).
Acceptance: each of (8)-(11) has a failing-then-passing test where applicable; lint over all packages stays clean.
<!-- SECTION:DESCRIPTION:END -->

Hardening members added from the #2388 round-2 review (none has a live site today):
- (3) Exempt callees are matched by name only. A local function named contentPreview or contentDigest would pass as the sanctioned gate; the fix is resolving the binding to an import from logContentPreview.
- (4) idPrefix and urlPrefix accept any string. Nothing stops content from being passed through them. The fix is a branded Id or Url type, or a light shape check.
- (5) .substr(0, n) is not in the truncation set. A repo-wide grep found zero call sites.
- (6) Error sinks are recognized by the class name ending in Error. Every current custom error follows that convention; name the dependency in the rule's blind-spot doc.
- DISMISSED from the same review: the claim that getStringType and isTypeAssignableTo are internal TypeChecker API. Both are declared in the public typescript.d.ts of the installed TypeScript 6.0.3 (lines 6296 and 6343).
