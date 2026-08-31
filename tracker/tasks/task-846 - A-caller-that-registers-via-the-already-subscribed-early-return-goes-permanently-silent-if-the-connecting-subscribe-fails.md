---
id: TASK-846
title: >-
  A caller that registers via the already-subscribed early return goes
  permanently silent if the connecting subscribe fails
status: To Do
assignee: []
created_date: '2026-08-31 21:07'
labels:
  - 'area:cache-invalidation'
  - 'size:M'
  - 'state:ready'
dependencies: []
priority: medium
ordinal: 846000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: raised by claude-review on PR 2281 (finding 2, informational) and verified by the orchestrator against the code that PR touches. Pre-existing, not introduced there.

Mechanism. BaseCacheInvalidationService.subscribe assigns this.subscriber synchronously from redis.duplicate(), then awaits subscriber.subscribe(channel). A second caller arriving during that await takes the already-subscribed early-return path: it pushes its callback and its promise RESOLVES successfully, so it believes it is subscribed. If the first caller connection then fails, its catch removes only its own callback and nulls this.subscriber. The second caller callback survives in this.callbacks with no live subscriber underneath it, isSubscribed() reports false, and nothing re-establishes a connection. That caller silently never receives another invalidation event.

The PR 2281 test named "removes the failed caller by identity, not position" already demonstrates the state; its inline comment notes that a fresh caller is needed to wire delivery back up.

Why this needs design rather than a quick fix: the second caller promise has ALREADY resolved, so it cannot be retroactively rejected. Candidate shapes, none obviously right: (a) the failing invocation re-attempts a connection when this.callbacks is non-empty after its own cleanup; (b) the early-return path awaits the in-flight connection attempt instead of resolving optimistically, so a failure propagates to every waiting caller; (c) leave the behavior and document it, on the grounds that every current call site subscribes exactly once at startup and a failure there is fatal anyway.

Option (b) is the most correct and the most invasive: it changes the early-return path from synchronous to awaiting a shared in-flight promise.

Blast radius today is small and should be stated honestly: all three call sites (bot-client/src/index.ts, ai-worker/src/cacheInvalidation.ts, api-gateway/src/index.ts) subscribe once during startup, so two concurrent subscribe calls on one instance is not a shape we currently produce. Verify those call sites before scoping, cites drift.

Acceptance: a decision recorded among (a)/(b)/(c); if (a) or (b), a test in which the early-return caller either receives events after the other caller connection fails, or observes the failure itself.
<!-- SECTION:DESCRIPTION:END -->
