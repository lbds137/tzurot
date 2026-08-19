---
id: TASK-675
title: CI discards turbo cache every run; persisting it is blocked on TASK-136
status: To Do
assignee: []
created_date: '2026-08-19 03:02'
labels:
  - 'area:ci'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 675000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: owner asked whether lint can be split and parallelised in CI. Measured the critical path first, and the answer changed the target.

MEASURED, run 32207113666 (all job/step figures from the GitHub API, not estimated):
- Job wall-clock: lint 274s, component-integration-tests 230s, unit-tests(bot-client) 166s, docker-build-smoke(ai-worker) 114s, unit-tests(packages) 110s, build 74s, mutation-tests 40s.
- lint step breakdown: Run linter 98s, typecheck:spec 34s, hook probes 29s, Build packages 22s, cpd 12s, then ~16 guards at 1-9s each. Setup (checkout to build) is ~51s of the 274s.

WHY NOT THE OBVIOUS SPLITS:
- Run linter is ALREADY parallel -- pnpm run lint is turbo run lint, which fans out across packages. Splitting it into a CI matrix pays ~51s setup per leg to parallelise work that is already parallel. Net loss.
- Splitting the lint JOB is possible (its ~20 steps are sequential) but the ceiling is 44s: lint is 274s and the next constraint is component-integration-tests at 230s, so anything below 230s is invisible. A 2-way split captures all 44s; a 3-way captures nothing more.
- And claude-review, which is merge-blocking, ran 3m44s to 9m07s across seven cycles the same day -- frequently EXCEEDING lint. On those runs a lint saving buys zero on time-to-mergeable.
- A split also costs a second change: check-gate-parity.ts parses "the CI lint job" specifically to prove the CI checks and the pnpm quality chain have not drifted, so the guard must be taught about any new job.

THE ACTUAL FINDING: turbo.json declares cache: true with per-task inputs, and CI persists NOTHING. No actions/cache, no TURBO_TOKEN, no .turbo restore. Every run is a cold cache recomputing from scratch. In the lint job alone that is ~154s of cacheable turbo work (linter 98 + typecheck:spec 34 + build 22), and it would help every job that runs Build packages -- mutation-tests and all six unit-test cells do.

BLOCKED ON TASK-136, and this is the important half. That task documents an ALREADY-KNOWN incomplete inputs declaration: test-utils resolves common-types through a tsconfig paths alias rather than a package edge, so its typecheck:spec inputs do not include common-types source and turbo can replay a stale pass. Today that window is MASKED by the cold cache -- nothing is ever replayed, so it cannot bite. Persisting the cache converts a documented theoretical gap into a live one, and typecheck:spec is 34s of precisely what we would be caching.

TASK-136 promote-when reads "a spurious typecheck:spec CI pass is observed, OR opportunistically alongside the next turbo.json input change". Enabling a persistent cache IS that trigger. Do TASK-136 first.

The general form of the risk: a wrong or incomplete inputs list produces SILENTLY SKIPPED work that reports as success -- strictly worse than slow work, and the same stale-artifact-reads-as-success class as the common-types rebuild incident. Before enabling, audit every task inputs list in turbo.json against what it actually reads, not just test-utils.

Fix shape: actions/cache keyed on the lockfile plus turbo hash inputs, restoring .turbo. GitHub-native, no third-party service, no code leaves the org -- deliberately NOT Vercel remote caching, which is an external-service and privacy decision the owner has not been asked for.

Acceptance: TASK-136 closed first; every turbo task inputs list audited against its real reads; a cache-hit run and a cache-cold run on the same commit produce identical results for lint, typecheck:spec and build; the measured wall-clock change is stated rather than assumed, including the honest note that it may be invisible behind claude-review.

## COUNCIL PASS BEFORE BUILDING (owner, 2026-08-19)

Owner: "it might be worth council time whenever we work on it." Agreed, and
this is a good fit for it rather than a reflex: the decision is a design call
with a SILENT failure mode (a wrong `inputs` list skips work and reports
success), it trades correctness against wall-clock, and the alternatives —
GitHub-native `actions/cache` vs Vercel remote caching vs per-tool caches like
eslint `--cache` — have different privacy and dependency profiles that are
worth an outside read.

WHAT TO PUT IN FRONT OF THE COUNCIL, and what to keep OUT. The council skill's
own rule is that a pass run on a false premise wastes the whole pass, so hand
it the MEASURED numbers in this task (they came from the GitHub API, not from
estimation) rather than a paraphrase, and state plainly that:
  - the linter is already parallel, so "parallelise it" is not the question;
  - the job-split ceiling is 44s and is frequently invisible behind
    claude-review, so wall-clock is a weak motivator;
  - the real question is whether persisting the cache is SAFE given a known
    incomplete `inputs` declaration, not whether it is faster.

Framed that way the question is genuinely open and worth outside input. Framed
as "how do we speed up CI" it invites a generic answer we already know.

Ask it specifically: what invalidation-correctness checks should gate turning
on a persistent monorepo build cache, given one documented incomplete input
declaration already exists? A good answer names how to detect the class, not
just how to fix the one instance.
<!-- SECTION:DESCRIPTION:END -->
