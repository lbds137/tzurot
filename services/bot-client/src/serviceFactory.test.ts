/**
 * serviceFactory composition-root tests.
 *
 * `createServices` wires two same-typed `Redis` clients (`botRedis` and
 * `cacheRedis`) that TypeScript cannot tell apart structurally — a swap
 * compiles cleanly and silently erases in-flight job delivery targets on
 * restart (TASK-821). Every assertion here distinguishes the two clients by
 * object identity (never `expect.any(Object)`), and pins the other seams a
 * silent wiring regression could slip through: the Discord `client` thread,
 * `JobFailureListener`'s positional constructor, `registerServices`'s exact
 * key set, and the full `Services` return shape.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Client } from 'discord.js';

// Sentinel objects, identity-distinguishable, defined via vi.hoisted so the
// hoisted vi.mock() factories below (which run before this file's own
// top-level statements) can reference them.
const S = vi.hoisted(() => ({
  client: { __sentinel: 'client' } as any,
  botRedis: { __sentinel: 'botRedis' } as any,
  cacheRedis: { __sentinel: 'cacheRedis' } as any,
  serviceClient: { __sentinel: 'serviceClient' } as any,
  webhookManager: { __sentinel: 'webhookManager' } as any,
  responseOrderingService: { __sentinel: 'responseOrderingService' } as any,
  resultsListener: { __sentinel: 'resultsListener' } as any,
  routingPersonalityLoader: { __sentinel: 'routingPersonalityLoader' } as any,
  denylistCache: { __sentinel: 'denylistCache' } as any,
  maintenanceFlag: { __sentinel: 'maintenanceFlag' } as any,
  dmCacheWarmer: { __sentinel: 'dmCacheWarmer' } as any,
  responseSender: { __sentinel: 'responseSender' } as any,
  replyResolver: {
    __sentinel: 'replyResolver',
    resolveFromReferencedMessage: vi.fn(),
  } as any,
  contextBuilder: { __sentinel: 'contextBuilder' } as any,
  voiceTranscription: { __sentinel: 'voiceTranscription' } as any,
  persistence: { __sentinel: 'persistence' } as any,
  slotDelivery: { __sentinel: 'slotDelivery' } as any,
  personalityChatManager: { __sentinel: 'personalityChatManager' } as any,
  personalityHandler: { __sentinel: 'personalityHandler' } as any,
  multiTagStateQueue: { __sentinel: 'multiTagStateQueue' } as any,
  releaseDmWorker: { __sentinel: 'releaseDmWorker' } as any,
  retentionNotifyWorker: { __sentinel: 'retentionNotifyWorker' } as any,
  multiTagCoordinator: { __sentinel: 'multiTagCoordinator' } as any,
  multiTagPersistence: { __sentinel: 'multiTagPersistence' } as any,
  multiTagRecovery: { __sentinel: 'multiTagRecovery' } as any,
  messageHandler: { __sentinel: 'messageHandler' } as any,
  jobFailureListener: { __sentinel: 'jobFailureListener' } as any,
  cacheInvalidationService: { __sentinel: 'cacheInvalidationService' } as any,
  channelActivationCacheInvalidationService: {
    __sentinel: 'channelActivationCacheInvalidationService',
  } as any,
  denylistCacheInvalidationService: { __sentinel: 'denylistCacheInvalidationService' } as any,
  jobTracker: { __sentinel: 'jobTracker' } as any,
  singleJobRecovery: { __sentinel: 'singleJobRecovery' } as any,
}));

vi.mock('@tzurot/common-types/config/config', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/config/config')>(
    '@tzurot/common-types/config/config'
  );
  return {
    ...actual,
    getConfig: vi.fn(() => ({
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_NAME: 'test-queue',
    })),
  };
});

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

vi.mock('./startup.js', () => ({
  validateRedisUrl: vi.fn(),
}));

vi.mock('./redis.js', () => ({
  redis: S.botRedis,
}));

vi.mock('@tzurot/common-types/utils/redis', () => ({
  parseRedisUrl: vi.fn(() => ({})),
  createBullMQRedisConfig: vi.fn(() => ({})),
  createIORedisClient: vi.fn(() => S.cacheRedis),
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn(function () {
    return S.multiTagStateQueue;
  }),
}));

vi.mock('@tzurot/common-types/services/MaintenanceFlag', () => ({
  MaintenanceFlag: vi.fn(function () {
    return S.maintenanceFlag;
  }),
}));

vi.mock('@tzurot/cache-invalidation', () => ({
  CacheInvalidationService: vi.fn(function () {
    return S.cacheInvalidationService;
  }),
  ChannelActivationCacheInvalidationService: vi.fn(function () {
    return S.channelActivationCacheInvalidationService;
  }),
  DenylistCacheInvalidationService: vi.fn(function () {
    return S.denylistCacheInvalidationService;
  }),
}));

vi.mock('./utils/WebhookManager.js', () => ({
  WebhookManager: vi.fn(function () {
    return S.webhookManager;
  }),
}));

vi.mock('./utils/gatewayClients.js', () => ({
  getServiceClient: vi.fn(() => S.serviceClient),
}));

vi.mock('./services/ResultsListener.js', () => ({
  ResultsListener: vi.fn(function () {
    return S.resultsListener;
  }),
}));

vi.mock('./services/JobFailureListener.js', () => ({
  JobFailureListener: vi.fn(function () {
    return S.jobFailureListener;
  }),
}));

vi.mock('./services/releaseDm/setupReleaseDmWorker.js', () => ({
  setupReleaseDmWorker: vi.fn(() => S.releaseDmWorker),
}));

vi.mock('./services/retentionNotice/setupRetentionNotifyWorker.js', () => ({
  setupRetentionNotifyWorker: vi.fn(() => S.retentionNotifyWorker),
}));

vi.mock('./services/ResponseOrderingService.js', () => ({
  ResponseOrderingService: vi.fn(function () {
    return S.responseOrderingService;
  }),
}));

vi.mock('./services/DiscordResponseSender.js', () => ({
  DiscordResponseSender: vi.fn(function () {
    return S.responseSender;
  }),
}));

vi.mock('./services/MessageContextBuilder.js', () => ({
  MessageContextBuilder: vi.fn(function () {
    return S.contextBuilder;
  }),
}));

vi.mock('./services/ConversationPersistence.js', () => ({
  ConversationPersistence: vi.fn(function () {
    return S.persistence;
  }),
}));

vi.mock('./services/VoiceTranscriptionService.js', () => ({
  VoiceTranscriptionService: vi.fn(function () {
    return S.voiceTranscription;
  }),
}));

vi.mock('./services/ReplyResolutionService.js', () => ({
  ReplyResolutionService: vi.fn(function () {
    return S.replyResolver;
  }),
}));

vi.mock('./services/SlotDeliveryService.js', () => ({
  SlotDeliveryService: vi.fn(function () {
    return S.slotDelivery;
  }),
}));

vi.mock('./services/HttpPersonalityLoader.js', () => ({
  HttpPersonalityLoader: vi.fn(function () {
    return S.routingPersonalityLoader;
  }),
}));

vi.mock('./services/DenylistCache.js', () => ({
  DenylistCache: vi.fn(function () {
    return S.denylistCache;
  }),
}));

vi.mock('./services/DMCacheWarmer.js', () => ({
  DMCacheWarmer: vi.fn(function () {
    return S.dmCacheWarmer;
  }),
}));

vi.mock('./services/serviceRegistry.js', () => ({
  registerServices: vi.fn(),
}));

vi.mock('./composition.js', () => ({
  buildPersonalityChatPipeline: vi.fn(() => ({
    personalityChatManager: S.personalityChatManager,
    personalityHandler: S.personalityHandler,
  })),
  buildMultiTagStack: vi.fn(() => ({
    coordinator: S.multiTagCoordinator,
    persistence: S.multiTagPersistence,
    recovery: S.multiTagRecovery,
  })),
  buildJobTrackingStack: vi.fn(() => ({
    jobTracker: S.jobTracker,
    singleJobRecovery: S.singleJobRecovery,
  })),
  buildMessageHandler: vi.fn(() => S.messageHandler),
}));

import { createServices } from './serviceFactory.js';
import { WebhookManager } from './utils/WebhookManager.js';
import { JobFailureListener } from './services/JobFailureListener.js';
import { setupReleaseDmWorker } from './services/releaseDm/setupReleaseDmWorker.js';
import { setupRetentionNotifyWorker } from './services/retentionNotice/setupRetentionNotifyWorker.js';
import { registerServices } from './services/serviceRegistry.js';
import {
  buildPersonalityChatPipeline,
  buildMultiTagStack,
  buildJobTrackingStack,
  buildMessageHandler,
} from './composition.js';
import {
  CacheInvalidationService,
  ChannelActivationCacheInvalidationService,
  DenylistCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';

describe('createServices', () => {
  let services: ReturnType<typeof createServices>;

  beforeEach(() => {
    vi.clearAllMocks();
    services = createServices(S.client as Client);
  });

  it('wires botRedis (never cacheRedis) into the job-tracking and multi-tag stacks', () => {
    const jobTrackingArgs = vi.mocked(buildJobTrackingStack).mock.calls[0][0];
    expect(jobTrackingArgs.redis).toBe(S.botRedis);
    expect(jobTrackingArgs.redis).not.toBe(S.cacheRedis);

    const multiTagArgs = vi.mocked(buildMultiTagStack).mock.calls[0][0];
    expect(multiTagArgs.redis).toBe(S.botRedis);
    expect(multiTagArgs.redis).not.toBe(S.cacheRedis);
  });

  it('wires cacheRedis (never botRedis) into every cache-invalidation constructor', () => {
    const cacheInvalidationArgs = vi.mocked(CacheInvalidationService).mock.calls[0];
    expect(cacheInvalidationArgs[0]).toBe(S.cacheRedis);
    expect(cacheInvalidationArgs[0]).not.toBe(S.botRedis);
    expect(cacheInvalidationArgs[1]).toBe(S.routingPersonalityLoader);

    const channelActivationArgs = vi.mocked(ChannelActivationCacheInvalidationService).mock
      .calls[0];
    expect(channelActivationArgs[0]).toBe(S.cacheRedis);
    expect(channelActivationArgs[0]).not.toBe(S.botRedis);

    const denylistInvalidationArgs = vi.mocked(DenylistCacheInvalidationService).mock.calls[0];
    expect(denylistInvalidationArgs[0]).toBe(S.cacheRedis);
    expect(denylistInvalidationArgs[0]).not.toBe(S.botRedis);

    const maintenanceFlagArgs = vi.mocked(MaintenanceFlag).mock.calls[0];
    expect(maintenanceFlagArgs[0]).toBe(S.cacheRedis);
    expect(maintenanceFlagArgs[0]).not.toBe(S.botRedis);
  });

  it('threads the Discord client into every collaborator that needs it', () => {
    expect(vi.mocked(WebhookManager)).toHaveBeenCalledWith(S.client);
    expect(vi.mocked(setupReleaseDmWorker)).toHaveBeenCalledWith({ client: S.client });
    expect(vi.mocked(setupRetentionNotifyWorker)).toHaveBeenCalledWith({ client: S.client });
    expect(vi.mocked(buildJobTrackingStack).mock.calls[0][0].discordClient).toBe(S.client);
    expect(vi.mocked(buildMultiTagStack).mock.calls[0][0].discordClient).toBe(S.client);
    expect(vi.mocked(buildMessageHandler).mock.calls[0][0].client).toBe(S.client);
  });

  it('constructs JobFailureListener with its four collaborators in the exact position order', () => {
    // Positional constructor: (jobTracker, responseOrderingService, multiTagCoordinator, messageHandler).
    // Asserting each position individually (not just toHaveBeenCalledWith) means
    // swapping any adjacent pair reddens this test.
    const args = vi.mocked(JobFailureListener).mock.calls[0];
    expect(args[0]).toBe(S.jobTracker);
    expect(args[1]).toBe(S.responseOrderingService);
    expect(args[2]).toBe(S.multiTagCoordinator);
    expect(args[3]).toBe(S.messageHandler);
  });

  it('registers exactly the six keys serviceRegistry needs, each bound to the right collaborator', () => {
    expect(vi.mocked(registerServices)).toHaveBeenCalledTimes(1);
    const call = vi.mocked(registerServices).mock.calls[0][0];

    expect(Object.keys(call).sort()).toEqual(
      [
        'jobTracker',
        'webhookManager',
        'personalityService',
        'messageContextBuilder',
        'conversationPersistence',
        'denylistCache',
      ].sort()
    );
    expect(call.jobTracker).toBe(S.jobTracker);
    expect(call.webhookManager).toBe(S.webhookManager);
    expect(call.personalityService).toBe(S.routingPersonalityLoader);
    expect(call.messageContextBuilder).toBe(S.contextBuilder);
    expect(call.conversationPersistence).toBe(S.persistence);
    expect(call.denylistCache).toBe(S.denylistCache);
  });

  it('returns every Services key bound to the collaborator that produced it', () => {
    expect(services.messageHandler).toBe(S.messageHandler);
    expect(services.jobTracker).toBe(S.jobTracker);
    expect(services.resultsListener).toBe(S.resultsListener);
    expect(services.jobFailureListener).toBe(S.jobFailureListener);
    expect(services.responseOrderingService).toBe(S.responseOrderingService);
    expect(services.webhookManager).toBe(S.webhookManager);
    expect(services.cacheRedis).toBe(S.cacheRedis);
    expect(services.cacheInvalidationService).toBe(S.cacheInvalidationService);
    expect(services.channelActivationCacheInvalidationService).toBe(
      S.channelActivationCacheInvalidationService
    );
    expect(services.denylistCache).toBe(S.denylistCache);
    expect(services.denylistCacheInvalidationService).toBe(S.denylistCacheInvalidationService);
    expect(services.dmCacheWarmer).toBe(S.dmCacheWarmer);
    expect(services.maintenanceFlag).toBe(S.maintenanceFlag);
    expect(services.multiTagCoordinator).toBe(S.multiTagCoordinator);
    expect(services.multiTagPersistence).toBe(S.multiTagPersistence);
    expect(services.multiTagRecovery).toBe(S.multiTagRecovery);
    expect(services.singleJobRecovery).toBe(S.singleJobRecovery);
    expect(services.multiTagStateQueue).toBe(S.multiTagStateQueue);
    expect(services.releaseDmWorker).toBe(S.releaseDmWorker);
    expect(services.retentionNotifyWorker).toBe(S.retentionNotifyWorker);
  });

  it('threads the composition-built stateQueue, multi-tag coordinator, and maintenanceFlag into their consumers', () => {
    expect(vi.mocked(buildMultiTagStack).mock.calls[0][0].stateQueue).toBe(S.multiTagStateQueue);
    expect(vi.mocked(buildMessageHandler).mock.calls[0][0].coordinator).toBe(S.multiTagCoordinator);
    expect(vi.mocked(buildMessageHandler).mock.calls[0][0].maintenanceFlag).toBe(S.maintenanceFlag);
  });

  it('passes the personality chat pipeline output into buildMessageHandler', () => {
    expect(vi.mocked(buildPersonalityChatPipeline)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(buildMessageHandler).mock.calls[0][0].personalityHandler).toBe(
      S.personalityHandler
    );
  });
});
