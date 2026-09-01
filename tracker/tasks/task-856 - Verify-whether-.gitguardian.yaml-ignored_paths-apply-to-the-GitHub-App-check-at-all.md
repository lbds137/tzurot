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
