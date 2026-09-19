---
id: TASK-856
title: >-
  Verify whether .gitguardian.yaml ignored_paths apply to the GitHub App check
  at all
status: To Do
assignee: []
created_date: '2026-09-01 18:52'
labels:
  - 'area:ci'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 856000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: on PR 2288 the GitGuardian check failed with "1 secret uncovered" on packages/identity/src/personality/PersonalityService.test.ts. The finding was a false positive — a test fixture using the canonical RFC-4122 example UUID matched the Coveo API Key detector. The bot comment names the file and line, so the trigger is not in doubt. The literal is deliberately not repeated here: writing it into this file would add a fresh occurrence to a diff and re-trigger the very detector this task is about. See ADMIN_SETTINGS_SINGLETON_ID in packages/common-types/src/schemas/api/adminSettings.ts for a value one digit away from it.

THIS WILL RECUR, which is the real reason to resolve it rather than absorb it. That RFC example UUID block is already the repo-wide fixture convention: the same 550e8400-e29b-41d4-a716-4466554400NN family appears in adminSettings.ts as a production constant and across roughly ten common-types test files. Those are all pre-existing, so the App never scanned them — it diffs the PR, not the tree. Every future PR that adds one more fixture in that family is a candidate for the same red check, and the exclusion in .gitguardian.yaml will appear to have covered it every time.

The part that needs verifying: .gitguardian.yaml at the repo root lists **/*.test.ts under secret.ignored_paths, and the flagged file IS a .test.ts. The exclusion did not fire. The likely explanation is that the file configures the ggshield CLI (its own header links ggshield-docs/configuration) while the GitHub App check scans from dashboard-side policy and never reads the repo file — but that is a hypothesis from one observation, not a verified fact, and it should not be written down as settled until someone checks the dashboard or the App docs.

Why it matters: the config file reads as though test files are excluded from secret scanning. If it does nothing for the PR check, every contributor gets false confidence, and the next fixture that trips a detector blocks a merge with no obvious cause. The failure mode is a red check nobody can explain, which is how checks get bypassed.

The reason it went unnoticed until now is simply that no test fixture had previously matched a detector — the exclusion was never exercised, so its silence read as success.

Fix shape, in order: (1) confirm from the GitGuardian dashboard or App docs whether repo-level ignored_paths are honored by the App check; (2) if they are not, either move the exclusions into the dashboard policy where they will actually apply, or delete the misleading ignored_paths block and replace it with a comment saying where exclusions really live; (3) if they ARE honored, work out why this path did not match.

RESOLVED FOR PR 2288, NOT FOR THE REPO: the owner manually ignored the incident in the GitGuardian dashboard on 2026-09-01 to unblock the PR. That is the correct unblock and this task must not be read as arguing against it — an owner clearing a confirmed false positive is not the same act as leaving a misleading config in place. The underlying question is untouched by it: the dashboard ignore covers one occurrence, so the next test fixture that matches any detector fails the same way, with the same repo config still appearing to have excluded it. Do not close this task on the strength of that ignore.

Acceptance: it is established, with a cite, whether the GitHub App honors .gitguardian.yaml ignored_paths; the repo file either works or no longer claims to; and the answer is recorded where the next person hitting a false positive will find it.
<!-- SECTION:DESCRIPTION:END -->

## Comments

<!-- COMMENTS:BEGIN -->
created: 2026-09-18 19:20
---
SECOND OCCURRENCE, and it confirms the task description's prediction rather than resolving it. PR #2454 failed the GitGuardian check with "5 secrets uncovered", every one a synthetic fixture the PR itself added to test log redaction: four Generic High Entropy Secret hits in packages/common-types/src/utils/logSanitizer.test.ts and one classified Discord Oauth2 Keys in services/api-gateway/src/middleware/requestLogger.test.ts. All five files are .test.ts, which .gitguardian.yaml claims to exclude, and the exclusion again did not fire. That is a second independent data point for the hypothesis in the description, still short of the dashboard or App-docs cite the acceptance asks for.

New information this occurrence adds, beyond a repeat: the trigger is not limited to the RFC UUID family the description analysed. Any high-entropy fixture will do, and a credential-shaped PREFIX is enough on its own — the Discord Oauth2 classification came from a plain 32-character alphanumeric string. So the exposure is wider than one fixture family, and any PR writing a realistic-looking secret into a test is a candidate.

Unblocked WITHOUT a dashboard ignore this time, which is the difference from PR 2288: the fixtures were rewritten to the repo convention already visible in ten other test files (test-secret, webhook-test-secret, TEST-FIXTURE-...-not-a-real-token) using low-entropy self-describing values. That is a better unblock than an incident dismissal because it leaves the detector strict and needs no per-occurrence owner action, and it cost one worker round. The redaction under test keys off the field NAME, never the value, so the rename weakened no assertion.

The owner cleared the five incidents from the dashboard afterwards (2026-09-18). That was HOUSEKEEPING, not the unblock, and the distinction is this task's whole point: the check went green because the fixtures were rewritten, and the flagged commit was rewritten out of the branch before anything merged, so the incidents were already moot when they were cleared. Do not read this occurrence as evidence that dashboard dismissal is the remedy — the paragraph above still stands.

The practical lesson worth carrying into specs: telling a worker to use a "realistic secret-shaped value" in a fixture is what caused this. The repo convention is the opposite, and the convention is right.
---
<!-- COMMENTS:END -->
