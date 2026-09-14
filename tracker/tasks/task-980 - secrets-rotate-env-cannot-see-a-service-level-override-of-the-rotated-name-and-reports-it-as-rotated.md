---
id: TASK-980
title: >-
  secrets:rotate-env cannot see a service-level override of the rotated name,
  and reports it as rotated
status: To Do
assignee: []
created_date: '2026-09-14 18:22'
labels:
  - 'area:tooling'
  - 'size:S'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 976000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: computeAffectedServices (packages/tooling/src/secrets/rotate-env-context.ts) derives the inheriting set from each service NAME list, and Railway returns a MERGED per-service view. A service carrying its OWN service-level override of the rotated name is therefore indistinguishable from one that merely inherits the shared value: both simply have the name in their list. Such a service gets redeployed and reported as rotated while it keeps running its unchanged local value. The failure is silent - no error, just a wrong rotation summary and a ledger stamp that overstates what happened. The code carries this as an explicit hedged comment rather than a claim; this task is the disposition for that hedge.

PROBED 2026-09-14 (Opus, dev project token, read-only): the variables query takes only projectId, environmentId, serviceId and unrendered - and unrendered controls TEMPLATE rendering, not merge scoping. So there is NO query flag that separates inherited from overridden, and the name list alone can never answer the question. Confirmed by introspecting the query args.

DETECTION IS POSSIBLE BY VALUE COMPARISON, and it was demonstrated: read the shared-tier value and each services value for the same name and compare. Identical means inherited; different means a service-level override. Measured on dev the same day: all three inheritors of INTERNAL_SERVICE_SECRET - api-gateway, bot-client, ai-worker - match the shared value exactly, so NO override exists today and the risk is future drift rather than a live defect. The comparison was done over SHA-256 digests so no value was printed; keep that discipline in any implementation, and do not write a digest of a live secret into a durable surface either.

Fix shape: in computeAffectedServices, or a sibling, compare digests rather than names for the rotated key. On a mismatch, WARN loudly and name the service - the operator needs to know that service will keep its old value - and consider refusing on prod. Cost is one extra value read per inheriting service, which expands the value-read surface the module deliberately minimizes, so the design call is whether the check runs always or only under a flag. readRailwayVariableValue already exists and is the right reader.

Acceptance: a service whose value differs from the shared tier is named in the output rather than silently counted as rotated; no secret value or digest reaches stdout, a log, an error message, or a committed file; the hedged comment in computeAffectedServices is replaced by a cite of the shipped check.
<!-- SECTION:DESCRIPTION:END -->
