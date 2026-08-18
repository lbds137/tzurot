---
id: TASK-652
title: No verified way to read prod or dev Redis from the ops CLI
status: To Do
assignee: []
created_date: '2026-08-18 02:51'
labels:
  - 'area:tooling'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: high
ordinal: 652000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: pnpm ops run injects only DATABASE_URL -- its own --help says "Run a command with Railway DATABASE_URL injected". REDIS_URL therefore falls through to the local .env, so every Redis probe run through it silently reads localhost:6379 instead of the target environment. An empty local Redis returns a clean, plausible, completely wrong answer.

This produced a false headline claim in PR #2134 (merged), its commit message, CURRENT.md, and backlog/now.md: "prod openrouter:models returns EXISTS 0 / TTL -2". That observation was never made. It went unnoticed for hours and was caught only by accident -- the same probe reported DEV empty seconds after dev api-gateway logs showed the key being written, which made the instrument the suspect instead of the data.

Fix shape: either extend ops run to inject REDIS_URL for the selected environment (check how the service reads it -- Railway service-scoped variables may need railway run --service), or add a first-class ops command for Redis inspection (key, TTL, size, sample) that resolves the URL the same way the services do. Whichever lands, it must print a host fingerprint (host:port only, never credentials) so a wrong-instance read is visible in the output rather than inferred.

Acceptance: a documented command reads a key from prod and from dev Redis and proves it reached the right instance by printing the host; running it against a key known to exist returns that key. Positive-control it -- an absent-key result is only meaningful once a known-present key has been read through the same path.
<!-- SECTION:DESCRIPTION:END -->
