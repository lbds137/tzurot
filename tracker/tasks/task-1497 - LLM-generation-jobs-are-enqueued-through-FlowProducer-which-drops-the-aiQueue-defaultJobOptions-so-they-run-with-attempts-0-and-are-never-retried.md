---
id: TASK-1497
title: >-
  LLM generation jobs are enqueued through FlowProducer, which drops the aiQueue
  defaultJobOptions, so they run with attempts 0 and are never retried
status: To Do
assignee: []
created_date: '2026-11-21T14:34:00Z'
labels:
  - area:api-gateway
  - size:M
  - state:ready
dependencies: []
priority: medium
ordinal: 1497000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Why: jobChainOrchestrator.ts (flowProducer.add, opts carry only jobId) enqueues every LLM generation job via FlowProducer. BullMQ FlowProducer applies defaultJobOptions only from add()'s queuesOptions argument (bullmq 5.81.5 flow-producer.js addNode: jobsOpts = queuesOpts[queueName].defaultJobOptions ?? {}), and Job defaults attempts to 0 (job.js). So the attempts: 3 / exponential backoff on aiQueue (services/api-gateway/src/queue.ts:57-61) never reaches LLM jobs. Code-read, not runtime-confirmed.

Effect: prose that assumes retries is false: queue.ts "Retry failed jobs up to 3 times", the LLMGenerationHandler header ("BullMQ retries are only used for transient infrastructure failures"), and AIJobProcessor releasing the idempotency lock "to allow BullMQ retries". Found while building TASK-1486, which therefore fails a failed key read loudly instead of retrying it.

What: decide whether LLM jobs should retry at all. Before enabling attempts, sweep every throw path out of AIJobProcessor/LLMGenerationHandler for spend: a throw after GenerationStep (usage log, persist/publish) would re-bill the model call on retry (04-discord.md spend-idempotent retries). Either pass attempts/backoff on the flow node with that sweep done, or correct the prose to say LLM jobs do not retry.

Acceptance: a runtime check (dev Redis job opts, or a component test through the real FlowProducer) shows the chosen attempts value, and the prose matches it.
<!-- SECTION:DESCRIPTION:END -->
