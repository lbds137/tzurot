---
id: TASK-122
title: 'Narrow pre-commit codegen-routes trigger to skip *.test.ts'
status: To Do
assignee: []
created_date: '2026-05-24 00:00'
labels:
  - 'area:common-types'
  - 'area:tooling'
  - 'area:clients'
dependencies: []
ordinal: 122000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Narrow pre-commit codegen-routes trigger to skip `*.test.ts`

**Why:** `.husky/pre-commit` regenerates and stages the `_generated/` client files whenever any file under `packages/common-types/src/routes/` is staged — including test files. Test edits trigger a no-op regen and re-stage of unchanged files, adding minor noise to the diff. **Fix shape**: tighten the grep to `'^packages/common-types/src/routes/.*\.ts$' | grep -v '\.test\.ts$'`. **Why deferred**: noise is mild (the regen is fast and the file content doesn't change so `git add` is a no-op on unchanged content), and the simpler trigger is easier to reason about. **Promote when**: a contributor complains about regen noise on test-only edits, OR when the codegen tool gains side effects that make running it on every routes/ edit costly. Surfaced 2026-05-24 by PR #1090 round 1 claude-bot review. **UPGRADED 2026-06-24 — confirmed stale-path bug (bigger than the test-skip):** the trigger greps `^packages/common-types/src/routes/`, a directory that no longer exists — the routes-package refactor moved `ROUTE_MANIFEST` to `packages/clients/src/routes/manifest.ts`, so the grep NEVER matches and the pre-commit codegen auto-regen is silently DEAD (editing the manifest no longer regenerates/stages `_generated/`; CI's `codegen-drift` gate is the only remaining backstop — friction, not data loss). The `git add` stage path (`packages/common-types/src/clients/_generated/`) and the `packages/tooling/src/codegen/routes.ts:4` docstring ("Reads ROUTE_MANIFEST from @tzurot/common-types") are stale the same way. **Revised fix shape**: (1) repoint the trigger grep + the `git add` stage path to `packages/clients/...` (verify the real `_generated/` dir); (2) fix the codegen docstring; (3) THEN add the `'^packages/clients/src/routes/.*\.ts$' | grep -v '\.test\.ts$'` skip; (4) verify by staging a manifest edit and confirming the regen fires. Not "cheap" — a real (CI-backstopped) latent bug; deferred from beta.137 PR4 for this reason. Deferred 2026-05-24.
<!-- SECTION:DESCRIPTION:END -->
