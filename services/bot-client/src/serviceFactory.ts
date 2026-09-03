import type { Client } from 'discord.js';
import { Queue, type Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { getConfig } from '@tzurot/common-types/config/config';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  parseRedisUrl,
  createBullMQRedisConfig,
  createIORedisClient,
} from '@tzurot/common-types/utils/redis';
import {
  CacheInvalidationService,
  ChannelActivationCacheInvalidationService,
  DenylistCacheInvalidationService,
} from '@tzurot/cache-invalidation';
import { WebhookManager } from './utils/WebhookManager.js';
import { getServiceClient } from './utils/gatewayClients.js';
import type { ForwardedAuthorPersonalityResolver } from './utils/forwardedMessageUtils.js';
import type { MessageHandler } from './handlers/MessageHandler.js';
import { ResultsListener } from './services/ResultsListener.js';
import type { JobTracker } from './services/JobTracker.js';
import { JobFailureListener } from './services/JobFailureListener.js';
import { setupReleaseDmWorker } from './services/releaseDm/setupReleaseDmWorker.js';
import { setupRetentionNotifyWorker } from './services/retentionNotice/setupRetentionNotifyWorker.js';
import { ResponseOrderingService } from './services/ResponseOrderingService.js';
import { DiscordResponseSender } from './services/DiscordResponseSender.js';
import { MessageContextBuilder } from './services/MessageContextBuilder.js';
import {
  ConversationPersistence,
  type ConversationPersistenceDeps,
} from './services/ConversationPersistence.js';
import { VoiceTranscriptionService } from './services/VoiceTranscriptionService.js';
import { ReplyResolutionService } from './services/ReplyResolutionService.js';
import { SlotDeliveryService } from './services/SlotDeliveryService.js';
import { type MultiTagCoordinator } from './services/MultiTagCoordinator.js';
import type { MultiTagPersistence } from './services/MultiTagPersistence.js';
import type { MultiTagRecovery } from './services/MultiTagRecovery.js';
import type { SingleJobRecovery } from './services/SingleJobRecovery.js';
import { HttpPersonalityLoader } from './services/HttpPersonalityLoader.js';
import { DenylistCache } from './services/DenylistCache.js';
import { DMCacheWarmer } from './services/DMCacheWarmer.js';
import { registerServices } from './services/serviceRegistry.js';
import { redis as botRedis } from './redis.js';

// Processors
import {
  buildPersonalityChatPipeline,
  buildMultiTagStack,
  buildJobTrackingStack,
  buildMessageHandler,
} from './composition.js';
import { validateRedisUrl } from './startup.js';

const logger = createLogger('bot-client');
const envConfig = getConfig();

/**
 * Services returned by the composition root
 */
export interface Services {
  messageHandler: MessageHandler;
  jobTracker: JobTracker;
  resultsListener: ResultsListener;
  jobFailureListener: JobFailureListener;
  responseOrderingService: ResponseOrderingService;
  webhookManager: WebhookManager;
  cacheRedis: Redis;
  cacheInvalidationService: CacheInvalidationService;
  channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
  denylistCache: DenylistCache;
  denylistCacheInvalidationService: DenylistCacheInvalidationService;
  dmCacheWarmer: DMCacheWarmer;
  /** Maintenance-window gate — checked at both Discord front doors. */
  maintenanceFlag: MaintenanceFlag;
  multiTagCoordinator: MultiTagCoordinator;
  multiTagPersistence: MultiTagPersistence;
  multiTagRecovery: MultiTagRecovery;
  /**
   * Boot-time re-adoption of single-personality jobs left in flight by the
   * previous process. The single-tag counterpart to `multiTagRecovery`; both
   * must run before the results listener attaches.
   */
  singleJobRecovery: SingleJobRecovery;
  /**
   * BullMQ Queue handle for polling authoritative job state: used by
   * MultiTagRecovery (jobs in flight at the previous process's shutdown)
   * and by MultiTagCoordinator's safety-timeout last-chance re-poll.
   * Owned by the composition root; closed in the shutdown sequence.
   */
  multiTagStateQueue: Queue;
  /**
   * Release-broadcast DM worker (bot-client's only BullMQ consumer) —
   * delivers gateway-produced broadcast batches as user DMs. Closed FIRST
   * in shutdown so no DM send straddles the process teardown.
   */
  releaseDmWorker: Worker;
  retentionNotifyWorker: Worker;
}

/**
 * Build the cache-invalidation Redis client. Validates env, wires the error
 * handler, logs initialization. Extracted from `createServices` so its
 * non-null-assertion suppression doesn't bloat the main wiring body.
 */
function buildCacheRedis(): Redis {
  validateRedisUrl();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL is validated by validateRedisUrl() above; TS can't narrow across the function boundary
  const cacheRedis = createIORedisClient(envConfig.REDIS_URL!, 'BotClientCacheRedis', logger);
  logger.info('Redis client initialized for cache invalidation');
  return cacheRedis;
}

/**
 * Composition Root
 *
 * This is where all dependencies are instantiated and wired together.
 * Full dependency injection - no service creates its own dependencies.
 */
/** Denylist cache + its pub/sub invalidation — built together, used together. */
function createDenylistServices(cacheRedis: Redis): {
  denylistCache: DenylistCache;
  denylistCacheInvalidationService: DenylistCacheInvalidationService;
} {
  return {
    denylistCache: new DenylistCache(),
    denylistCacheInvalidationService: new DenylistCacheInvalidationService(cacheRedis),
  };
}

/**
 * The two gateway-fed DM workers (release broadcast + retention notice) —
 * constructed eagerly, together, so shutdown ownership is explicit.
 */
function createDmWorkers(client: Client): {
  releaseDmWorker: Worker;
  retentionNotifyWorker: Worker;
} {
  return {
    releaseDmWorker: setupReleaseDmWorker({ client }),
    retentionNotifyWorker: setupRetentionNotifyWorker({ client }),
  };
}

/**
 * Collaborators ConversationPersistence cannot build for itself.
 *
 * Extracted from `createServices` rather than inlined there because that
 * function is at its `max-lines-per-function` ceiling, and the rule is to move
 * code out rather than compress the reasoning that explains it.
 */
function buildPersistenceDeps(replyResolver: ReplyResolutionService): ConversationPersistenceDeps {
  return {
    resolveForwardedAuthorPersonalityId: buildForwardedAuthorResolver(replyResolver),
  };
}

/**
 * The single definition of "which of OUR personalities authored this forwarded
 * message's original?".
 *
 * Two consumers resolve forward attribution — the persistence path (a forward
 * the bot processed) and the extended-context fetch path (a forward it only
 * ever saw in the fetch window) — and they must not drift, because this
 * function carries the access-control semantics of the attribution.
 *
 * Access control keys off the FORWARDER, who is who the attribution is shown
 * to — resolving with anyone else's id could name a character they cannot
 * otherwise see. The original arrives already fetched, so this takes the
 * post-fetch entry point rather than the reply-shaped one that would re-fetch
 * against the wrong channel.
 */
function buildForwardedAuthorResolver(
  replyResolver: ReplyResolutionService
): ForwardedAuthorPersonalityResolver {
  return async (original, viewerId, isDM) =>
    (await replyResolver.resolveFromReferencedMessage(original, viewerId, isDM))?.id;
}

/**
 * Extracted from `createServices` for the same reason as
 * {@link buildPersistenceDeps}: that function sits at its
 * `max-lines-per-function` ceiling, so collaborators it can't build inline move
 * out rather than having their reasoning compressed.
 */
function buildContextBuilder(
  denylistCache: DenylistCache,
  replyResolver: ReplyResolutionService
): MessageContextBuilder {
  return new MessageContextBuilder(
    getServiceClient(),
    denylistCache,
    buildForwardedAuthorResolver(replyResolver)
  );
}

/**
 * The two pub/sub cache-invalidation subscribers built over the cache Redis
 * client: personality-tier invalidation (which drives the HTTP loader's
 * positive/negative caches) and channel-activation invalidation (needed for
 * horizontal scaling). Grouped for the same reason `createDenylistServices`
 * is — one client, one concern, one line at the call site.
 */
function buildInvalidationServices(
  cacheRedis: Redis,
  routingPersonalityLoader: HttpPersonalityLoader
): {
  cacheInvalidationService: CacheInvalidationService;
  channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
} {
  return {
    cacheInvalidationService: new CacheInvalidationService(cacheRedis, routingPersonalityLoader),
    channelActivationCacheInvalidationService: new ChannelActivationCacheInvalidationService(
      cacheRedis
    ),
  };
}

/**
 * BullMQ Queue handle for authoritative job-state polling — boot-time
 * rehydration (MultiTagRecovery) and the coordinator's safety-timeout
 * last-chance re-poll. Its lifecycle is owned by the composition root and it
 * is closed in the shutdown sequence. Mirrors the existing BullMQ-config
 * pattern in JobFailureListener — same QUEUE_NAME + same ioredis connection
 * config derived from REDIS_URL. Extracted alongside `buildCacheRedis` so its
 * non-null-assertion suppression doesn't bloat the main wiring body.
 */
function buildStateQueue(): Queue {
  return new Queue(envConfig.QUEUE_NAME, {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL validated by validateRedisUrl() in buildCacheRedis() above
    connection: createBullMQRedisConfig(parseRedisUrl(envConfig.REDIS_URL!)),
  });
}

export function createServices(client: Client): Services {
  // Composition Root. bot-client never touches Prisma — all DB-backed work
  // goes through the gateway's internal endpoints (HTTP), so there is no
  // PrismaClient here.

  // Initialize Redis for cache invalidation
  const cacheRedis = buildCacheRedis();

  // Core infrastructure
  const webhookManager = new WebhookManager(client);
  const responseOrderingService = new ResponseOrderingService();
  const resultsListener = new ResultsListener();
  // jobFailureListener is constructed AFTER the multi-tag coordinator below
  // — it needs the coordinator to route live multi-tag slot failures
  // through `handleJobResult` instead of leaving them to the 10-min safety
  // timeout. See its module-level docstring for the dual-routing story.

  // Routing-read loader: personality resolution for routing (mention parsing,
  // reply resolution, activation, multi-tag recovery, /chat) goes
  // through the gateway's internal endpoint with positive/negative caching
  // instead of direct Prisma.
  const routingPersonalityLoader = new HttpPersonalityLoader();

  // Job tracking + its restart-recovery stack. The tracker's slots are
  // in-memory, so without the Redis mirror wired in here a restart erases
  // every in-flight single-personality job's delivery target and its result
  // is dropped on arrival (TASK-821). `botRedis` (not `cacheRedis`): durable
  // bot state, the same client MultiTagPersistence uses.
  const { jobTracker, singleJobRecovery } = buildJobTrackingStack({
    redis: botRedis,
    orderingService: responseOrderingService,
    personalityService: routingPersonalityLoader,
    discordClient: client,
  });

  const { cacheInvalidationService, channelActivationCacheInvalidationService } =
    buildInvalidationServices(cacheRedis, routingPersonalityLoader);

  const { denylistCache, denylistCacheInvalidationService } = createDenylistServices(cacheRedis);

  // Maintenance-window gate (destructive-migration windows; `pnpm ops maintenance`).
  const maintenanceFlag = new MaintenanceFlag(cacheRedis);

  // DM channel cache warmer — pre-establishes Discord.js's internal channel
  // cache for any user we encounter, so subsequent plain-text DMs can be
  // resolved by MessageCreateAction.getChannel(). See DMCacheWarmer.ts for
  // the full diagnosis narrative.
  const dmCacheWarmer = new DMCacheWarmer();

  // Message handling services
  const responseSender = new DiscordResponseSender(webhookManager);
  // Constructed BEFORE both consumers of forward attribution (the context
  // builder and persistence): a forwarded message's quote is attributed by
  // resolving the message it points at, and this is the service that knows how
  // to map that back to a personality.
  const replyResolver = new ReplyResolutionService(routingPersonalityLoader);
  const contextBuilder = buildContextBuilder(denylistCache, replyResolver);
  const voiceTranscription = new VoiceTranscriptionService();
  const persistence = new ConversationPersistence(buildPersistenceDeps(replyResolver));

  // Shared per-slot delivery (MessageHandler, MultiTagCoordinator, and the
  // chat pipeline's in-character error delivery). Built before the pipeline.
  const slotDelivery = new SlotDeliveryService({ responseSender, persistence });

  // Personality chat pipeline (manager + Discord-shape adapter).
  const { personalityChatManager, personalityHandler } = buildPersonalityChatPipeline({
    contextBuilder,
    persistence,
    denylistCache,
    jobTracker,
    slotDelivery,
  });

  const multiTagStateQueue = buildStateQueue();

  const { releaseDmWorker, retentionNotifyWorker } = createDmWorkers(client);

  // Multi-tag stack: coordinator + Redis persistence + recovery service.
  // Persistence is shared with DMSessionProcessor (backfill sentinel).
  // Recovery's `run()` is invoked later in start() AFTER `client.login()`.
  const {
    coordinator: multiTagCoordinator,
    persistence: multiTagPersistence,
    recovery: multiTagRecovery,
  } = buildMultiTagStack({
    redis: botRedis,
    chatManager: personalityChatManager,
    jobTracker,
    orderingService: responseOrderingService,
    slotDelivery,
    personalityService: routingPersonalityLoader,
    discordClient: client,
    stateQueue: multiTagStateQueue,
  });

  // Message-handling stack: processor chain (order matters) + MessageHandler.
  const messageHandler = buildMessageHandler({
    denylistCache,
    voiceTranscription,
    personalityLoader: routingPersonalityLoader,
    replyResolver,
    personalityHandler,
    multiTagPersistence,
    responseSender,
    persistence,
    jobTracker,
    slotDelivery,
    coordinator: multiTagCoordinator,
    personalityService: routingPersonalityLoader,
    client,
    maintenanceFlag,
  });

  // Live failure routing: now that both the coordinator and messageHandler
  // exist, wire the failure listener so it can route multi-tag slot failures
  // through `coordinator.handleJobResult`, and single-tag (legacy) failures
  // through `messageHandler.handleJobResult`, instead of leaving either kind
  // of hard failure silent to the user.
  const jobFailureListener = new JobFailureListener(
    jobTracker,
    responseOrderingService,
    multiTagCoordinator,
    messageHandler
  );

  // Register services for global access (used by slash commands)
  registerServices({
    jobTracker,
    webhookManager,
    personalityService: routingPersonalityLoader,
    messageContextBuilder: contextBuilder,
    conversationPersistence: persistence,
    denylistCache,
  });

  return {
    messageHandler,
    jobTracker,
    resultsListener,
    jobFailureListener,
    responseOrderingService,
    webhookManager,
    cacheRedis,
    cacheInvalidationService,
    channelActivationCacheInvalidationService,
    denylistCache,
    denylistCacheInvalidationService,
    maintenanceFlag,
    multiTagCoordinator,
    multiTagPersistence,
    multiTagRecovery,
    singleJobRecovery,
    multiTagStateQueue,
    releaseDmWorker,
    retentionNotifyWorker,
    dmCacheWarmer,
  };
}
