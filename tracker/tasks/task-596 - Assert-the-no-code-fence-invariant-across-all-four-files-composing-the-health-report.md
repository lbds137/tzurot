---
id: TASK-596
title: >-
  Assert the no-code-fence invariant across all four files composing the health
  report
status: To Do
assignee: []
created_date: '2026-08-13 23:10'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 596000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: health-webhook-post.ts chunks with splitMessageByLines, which deliberately does NOT rebalance code fences across chunk boundaries (splitMessage does). The safety justification for that choice lives in a code comment naming two files - health.ts and health-extras.ts - as fence-free. But health-report.txt is the full stdout of pnpm ops health, which per weekly-audit.yml also concatenates formatAdvisoriesReport (advisories.ts) and formatRepoSettingsReport (check-repo-settings.ts). All four are fence-free today, verified during review, so there is no live bug. The problem is that the invariant is REMEMBERED rather than enforced: if any of the four later grows a fenced block - someone pasting a gh api error body or a JSON snippet into a finding message is the realistic path - a fenced block split across two chunks renders as broken markdown in the channel and nothing flags it.

What: a lightweight test that reads the four report-composing source files and asserts zero triple-backtick occurrences, with a comment naming why the assertion exists and pointing at the splitMessageByLines lack of fence rebalancing. Chosen over widening the code comment to name four files, because that just makes the remembered invariant a longer sentence; the test makes drift trip CI. Derive the file list rather than hardcoding it if a cheap derivation exists, since a fifth contributor added later inherits the same gap - if no derivation is cheap, hardcode but assert the list length so adding a contributor forces a look.

Rider worth folding in if convenient: retryDelayMs reads only the HTTP Retry-After header. Discord also carries retry_after in the JSON body of a 429, and neither form has been probed against a live 429 from the webhook-execute endpoint. Not a defect - an absent or malformed header falls through the Number.isFinite guard to the 1s default without throwing or hanging - but if a real 429 capture is ever obtained it settles both this and the wait=true ordering claim, which is likewise documented rather than probed.

Acceptance: adding a triple-backtick fence to any of the four report-composing files fails a test, and the failure message explains the chunker constraint rather than just reporting a count mismatch.

Source: 2026-08-13 claude-review round 6 on the health-webhook chunking PR, findings 1 and 2.
<!-- SECTION:DESCRIPTION:END -->
