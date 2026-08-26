import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { Queue, type Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { getConfig } from '@tzurot/common-types/config/config';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { registerProcessLifecycle } from '@tzurot/common-types/utils/processLifecycle';
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
import {
  invalidateChannelSettingsCache,
  clearAllChannelSettingsCache,
  confirmDelivery,
  healthCheck,
  stampUserActivity,
} from './utils/gatewayServiceCalls.js';
import { WebhookManager } from './utils/WebhookManager.js';
import { getServiceClient } from './utils/gatewayClients.js';
import type { ForwardedAuthorPersonalityResolver } from './utils/forwardedMessageUtils.js';
import type { MessageHandler } from './handlers/MessageHandler.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { handleCommandWithContext } from './handlers/commandDispatch.js';
import { redis as botRedis, closeRedis } from './redis.js';
import { armBootWatchdog } from './utils/bootWatchdog.js';
import { deployCommands } from './utils/deployCommands.js';
import { respondToInteractionDuringMaintenance } from './utils/maintenanceResponses.js';
import { ResultsListener } from './services/ResultsListener.js';
import { JobTracker } from './services/JobTracker.js';
import { JobFailureListener } from './services/JobFailureListener.js';
import { registerGuildMemberInfoReporter } from './services/GuildMemberInfoReporter.js';
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
import { HttpPersonalityLoader } from './services/HttpPersonalityLoader.js';
import { DenylistCache } from './services/DenylistCache.js';
import { DMCacheWarmer } from './services/DMCacheWarmer.js';
import { StartupDMPrewarmer } from './services/StartupDMPrewarmer.js';
import { registerServices } from './services/serviceRegistry.js';
import { registerShardLifecycleLogging } from './services/ShardLifecycleLogger.js';

// Processors
import {
  buildPersonalityChatPipeline,
  buildMultiTagStack,
  buildMessageHandler,
} from './composition.js';
import {
  startNotificationCacheCleanup,
  stopNotificationCacheCleanup,
} from './processors/notificationCache.js';
import { initVerificationCleanupService } from './services/VerificationCleanupService.js';
import { initErrorChannelReporter, reportError } from './observability/ErrorChannelReporter.js';
import { classifyErrorCode } from './observability/commandTelemetryClassify.js';
import {
  startVerificationCleanupScheduler,
  stopVerificationCleanupScheduler,
} from './services/VerificationCleanupScheduler.js';
import {
  startSecretRotationNagScheduler,
  stopSecretRotationNagScheduler,
} from './services/SecretRotationNagScheduler.js';
import {
  startReleaseFlagNagScheduler,
  stopReleaseFlagNagScheduler,
} from './services/ReleaseFlagNagScheduler.js';
import {
  startRetentionNagScheduler,
  stopRetentionNagScheduler,
} from './services/RetentionNagScheduler.js';
import {
  startExportSmokeScheduler,
  stopExportSmokeScheduler,
} from './services/ExportSmokeScheduler.js';
import {
  startNightlyDbSyncScheduler,
  stopNightlyDbSyncScheduler,
} from './services/NightlyDbSyncScheduler.js';
import {
  validateDiscordToken,
  validateRedisUrl,
  validateInternalServiceSecret,
  validateOutboundDmAllowlist,
  logGatewayHealthStatus,
} from './startup.js';
import { restoreBotPresence } from './commands/admin/presence.js';

// Initialize logger
const logger = createLogger('bot-client');
const envConfig = getConfig();

// Validate bot-client specific required env vars
validateDiscordToken();
validateInternalServiceSecret();
validateOutboundDmAllowlist();

// Configuration from environment
const config = {
  gatewayUrl: envConfig.GATEWAY_URL,
  discordToken: envConfig.DISCORD_TOKEN,
};

// Initialize Discord client
// Note: GuildMembers is a privileged intent requiring Discord Portal approval for 100+ servers.
// It's required because without it, message.member is null and we can't access user roles,
// display color, or join date for the AI context (activePersonaGuildInfo).
// Note: Partials.Channel + Message + User are all required for DM events to
// reliably fire after a process restart. Empirical diagnosis (raw-gateway
// listener, 2026-04-26): with only Partials.Channel, DM MESSAGE_CREATE
// packets reach the gateway listener but Discord.js silently drops them
// before MessageCreate fires. The DM channel↔user resolution path needs
// the user to be a partial when uncached (every fresh restart), and
// Message partial covers reference-resolution edge cases.
//
// Forward-protection: Partials.Message also means any future
// MESSAGE_UPDATE/DELETE handler must guard against partial Message
// objects (check `message.partial === true` and fetch before accessing
// `content`, `author`, etc.). MESSAGE_CREATE payloads are always
// complete per Discord protocol, so the create path is unaffected.
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
  // Disable all mention parsing from message content to prevent AI-generated
  // @everyone/@here/@role pings. Reply-pings (repliedUser) are unaffected.
  allowedMentions: { parse: [] },
});

/**
 * Services returned by the composition root
 */
interface Services {
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
function createDmWorkers(): { releaseDmWorker: Worker; retentionNotifyWorker: Worker } {
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

function createServices(): Services {
  // Composition Root. bot-client never touches Prisma — all DB-backed work
  // goes through the gateway's internal endpoints (HTTP), so there is no
  // PrismaClient here.

  // Initialize Redis for cache invalidation
  const cacheRedis = buildCacheRedis();

  // Core infrastructure
  const webhookManager = new WebhookManager(client);
  const responseOrderingService = new ResponseOrderingService();
  const jobTracker = new JobTracker(responseOrderingService);
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

  // Pub/sub invalidation drives the HTTP loader's cache tiers for routing.
  const cacheInvalidationService = new CacheInvalidationService(
    cacheRedis,
    routingPersonalityLoader
  );

  // Channel activation cache invalidation for horizontal scaling
  const channelActivationCacheInvalidationService = new ChannelActivationCacheInvalidationService(
    cacheRedis
  );

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

  // BullMQ Queue handle for authoritative job-state polling — boot-time
  // rehydration (MultiTagRecovery) and the coordinator's safety-timeout
  // last-chance re-poll. Constructed here so its lifecycle is visible to
  // the shutdown sequence below. Mirrors the existing BullMQ-config
  // pattern in JobFailureListener — same QUEUE_NAME + same ioredis
  // connection config derived from REDIS_URL.
  const multiTagStateQueue = new Queue(envConfig.QUEUE_NAME, {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL validated by validateRedisUrl() in buildCacheRedis() above
    connection: createBullMQRedisConfig(parseRedisUrl(envConfig.REDIS_URL!)),
  });

  const { releaseDmWorker, retentionNotifyWorker } = createDmWorkers();

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
    multiTagStateQueue,
    releaseDmWorker,
    retentionNotifyWorker,
    dmCacheWarmer,
  };
}

// These will be initialized in start()
let services: ReturnType<typeof createServices>;
let commandHandler: CommandHandler;

// Message handler - wrapped to handle async properly
client.on(Events.MessageCreate, message => {
  // Warm the DM channel cache for this user; see DMCacheWarmer.ts for why.
  if (!message.author.bot) {
    services.dmCacheWarmer.warm(message.author);
  }
  void (async () => {
    try {
      await services.messageHandler.handleMessage(message);
    } catch (error) {
      logger.error({ err: error }, 'Error in message handler');
    }
  })();
});

// Interaction handler for slash commands, modals, autocomplete, and component interactions
client.on(Events.InteractionCreate, interaction => {
  // Warm the DM channel cache for this user; see DMCacheWarmer.ts for why.
  services.dmCacheWarmer.warm(interaction.user);
  void (async () => {
    try {
      // Denylist check — applies to ALL interaction types (silent deny)
      if (!isBotOwner(interaction.user.id)) {
        const guildId = interaction.guildId ?? undefined;
        if (
          services.denylistCache.isBotDenied(interaction.user.id, guildId) ||
          (guildId !== undefined &&
            services.denylistCache.isUserGuildDenied(interaction.user.id, guildId)) ||
          (interaction.channelId !== null &&
            services.denylistCache.isChannelDenied(interaction.user.id, interaction.channelId))
        ) {
          return;
        }
      }

      // Maintenance gate — friendly ephemeral rejection instead of letting the
      // interaction reach the (503ing) gateway during a migration window. The
      // TTL-cached flag read stays well inside the 3-second ack budget; the
      // maintenance reply itself is the ack.
      if (await services.maintenanceFlag.isActive()) {
        await respondToInteractionDuringMaintenance(interaction);
        return;
      }

      if (interaction.isChatInputCommand()) {
        // Retention: pure-client commands (e.g. /help) render bot-side and never
        // reach the gateway, so stamp activity here for every chat-input command.
        // Fire-and-forget — the wrapper logs on failure and never throws; the
        // redundant stamp for gateway-reaching commands (which already stamp via
        // getOrCreateUser) is a harmless idempotent NOW-write. Not awaited: the
        // stamp must never delay or fail the 3-second ack path.
        void stampUserActivity(interaction.user.id).catch(() => {
          /* wrapper already logs; swallow so a rejection can't become unhandled */
        });

        // The dispatcher owns the whole chat-input path, including the
        // unknown-command reply when the lookup comes back empty.
        await handleCommandWithContext(
          interaction,
          commandHandler.getCommand(interaction.commandName)
        );
      } else if (interaction.isMessageContextMenuCommand()) {
        await commandHandler.handleContextMenuCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        await commandHandler.handleModalInteraction(interaction);
      } else if (interaction.isAutocomplete()) {
        await commandHandler.handleAutocomplete(interaction);
      } else if (interaction.isStringSelectMenu() || interaction.isButton()) {
        // Route component interactions to their commands based on customId prefix
        await commandHandler.handleComponentInteraction(interaction);
      }
    } catch (error) {
      logger.error({ err: error }, 'Error in interaction handler');
    }
  })();
});

// Ready event
client.once(Events.ClientReady, () => {
  logger.info({ botTag: client.user?.tag ?? 'unknown' }, 'Logged in');
  logger.info({ gatewayUrl: config.gatewayUrl }, 'Gateway URL configured');

  // Initialize verification message cleanup service and start scheduler
  initVerificationCleanupService(client);
  startVerificationCleanupScheduler();

  // Wire the owner-channel error reporter to the live client.
  initErrorChannelReporter(client);

  // Daily secret-rotation overdue check → owner-channel nag (weekly Redis
  // cooldown; see SecretRotationNagScheduler for the restart-cadence design).
  startSecretRotationNagScheduler(client, services.cacheRedis);

  // Daily check that the newest GitHub release isn't still prerelease-
  // flagged → owner-channel nag (same restart-friendly cadence). That flag
  // doubles as the release-DM announce gate, so a stuck flag silently kills
  // every DM until this catches it.
  startReleaseFlagNagScheduler(client, services.cacheRedis);

  // Daily retention purge-eligibility check → owner-channel nag (same
  // restart-friendly cadence; nothing purges automatically in Phase 2).
  startRetentionNagScheduler(client, services.cacheRedis);

  // Daily check, weekly real export-path smoke → owner-channel nag on
  // failure only (silent on a clean pass; see ExportSmokeScheduler).
  startExportSmokeScheduler(client, services.cacheRedis);

  // Daily REAL dev↔prod sync — silent when already in agreement, owner-channel
  // summary when rows moved. Its Redis cooldown gates the sync itself (not just
  // the post); see NightlyDbSyncScheduler for that inversion.
  startNightlyDbSyncScheduler(client, services.cacheRedis);

  // Restore saved bot presence from Redis
  void restoreBotPresence(client).catch(err => logger.warn({ err }, 'Failed to restore presence'));

  // Layer 1 of the post-deploy DM-silence fix: pre-populate Discord.js's
  // DM channel cache for recently active users. Fire-and-forget — bot is
  // fully operational without this; pre-warming runs in the background.
  // See StartupDMPrewarmer.ts and DMCacheWarmer.ts for the diagnosis chain.
  const startupPrewarmer = new StartupDMPrewarmer({
    client,
    warmer: services.dmCacheWarmer,
  });
  void startupPrewarmer.run();

  // Auto-leave denied guilds when bot is added.
  // Registered inside ClientReady to make the dependency on denylistCache hydration explicit
  // (hydration runs in start() before client.login(), but co-locating here is clearer).
  client.on(Events.GuildCreate, guild => {
    if (services.denylistCache.isBotDenied('', guild.id)) {
      logger.info({ guildId: guild.id, guildName: guild.name }, 'Leaving denied guild');
      void guild.leave().catch(err => {
        logger.error({ err, guildId: guild.id }, 'Failed to leave denied guild');
      });
    }
  });
});

// Event-driven refresh of stored guild membership (roles/colour/nickname), so
// <participants> stops re-rendering when a per-turn fetch misses someone.
registerGuildMemberInfoReporter(client);

// Error handling
client.on(Events.Error, error => {
  logger.error({ err: error }, 'Discord client error');
});

// Gateway shard lifecycle — without these, a dead websocket looks like a healthy, silent process.
registerShardLifecycleLogging(client, logger);

// unhandledRejection handling is registered by registerProcessLifecycle below
// (rejectionPolicy: 'log-and-live').

// Graceful shutdown — register for BOTH SIGTERM (Railway/orchestrator) and
// SIGINT (Ctrl+C in dev). Without SIGTERM handling, Railway's deploy lifecycle
// hard-kills the process before client.destroy() can close the Discord gateway
// session, leaving an orphaned shard that competes with the new instance until
// Discord's session timeout. The DM-silence symptom that originally motivated
// this fix was actually caused by missing Partials (see client instantiation
// comment), but clean gateway shutdown on deploy is correct independent
// behaviour and resolved its own latent issue.
// Pure dispose sequence — the re-entry guard, hard-exit backstop, and terminal
// exit semantics live in registerProcessLifecycle (common-types), which wraps
// this and also owns the handler registration below.
async function disposeBotClient(): Promise<void> {
  // Sequence the two shutdown steps:
  //   1. Stop accepting new results — close the door before draining.
  //   2. Mark pending multi-tag slot jobIds stale + tear down in-memory state.
  // Doing both concurrently leaves a small race window where a result could
  // still arrive between stop() returning and the coordinator clearing
  // entries; sequencing closes it. Best-effort: a failure here shouldn't
  // block the buffered-result delivery below, so it's caught and logged.
  try {
    await services.releaseDmWorker.close();
    await services.retentionNotifyWorker.close();
    await services.resultsListener.stop();
    await services.jobFailureListener.stop();
    await services.multiTagCoordinator.beginShutdown();
  } catch (err) {
    logger.error({ err }, 'Error during early shutdown sequence');
  }

  // Then deliver any buffered results — each result uses its own captured
  // deliverFn (multi-tag groups use their deliverGroup closure; single-
  // personality results use the per-jobId routing closure from handleResult).
  await services.responseOrderingService.shutdown().finally(async () => {
    services.jobTracker.cleanup();
    services.responseOrderingService.stopCleanup();
    services.webhookManager.destroy();
    stopNotificationCacheCleanup();
    stopVerificationCleanupScheduler();
    stopSecretRotationNagScheduler();
    stopReleaseFlagNagScheduler();
    stopRetentionNagScheduler();
    stopExportSmokeScheduler();
    stopNightlyDbSyncScheduler();
    // ioredis Redis#disconnect is synchronous (returns void) — kept outside
    // the awaited Promise.all because there's no Promise to await.
    services.cacheRedis.disconnect();

    // Await async cleanup with a bounded timeout so a hung resource can't
    // block shutdown. Without the await, voided promises returned ~immediately
    // and process.exit ran before Discord WebSocket close handshake / Redis
    // disconnect completed.
    //
    // This inner 5s deadline is deliberately SOFTER than (and nested inside)
    // the lifecycle wrapper's 10s hard-exit backstop: a hang here logs a
    // warning and lets dispose() return, so the process still reaches the
    // clean exit(0) path. The 10s backstop is the force-exit(1) of last
    // resort for hangs this race doesn't cover.
    const SHUTDOWN_TIMEOUT_MS = 5000;
    try {
      await Promise.race([
        Promise.all([
          services.cacheInvalidationService.unsubscribe(),
          services.channelActivationCacheInvalidationService.unsubscribe(),
          services.denylistCacheInvalidationService.unsubscribe(),
          services.multiTagStateQueue.close(),
          closeRedis(),
          client.destroy(),
        ]),
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () => reject(new Error(`Shutdown cleanup exceeded ${SHUTDOWN_TIMEOUT_MS}ms`)),
            SHUTDOWN_TIMEOUT_MS
          )
        ),
      ]);
      logger.info('Shutdown cleanup completed cleanly');
    } catch (error) {
      logger.warn({ err: error }, 'Shutdown cleanup did not complete cleanly');
    }
  });
}

// 'log-and-live' on rejections: a stray rejection in one Discord event handler
// should not sever every active session — the deliberate trade-off is that the
// process may run degraded rather than restart. Signals/exceptions still get
// the guarded, terminal shutdown (the helper replaces the old local
// `shutdownInitiated` guard and adds the hard-exit backstop).
registerProcessLifecycle({
  logger,
  dispose: disposeBotClient,
  rejectionPolicy: 'log-and-live',
  onUnhandledRejection: reason => {
    reportError({
      source: 'unhandled-rejection',
      errorCode: classifyErrorCode(reason),
      error: reason,
    });
  },
});

/**
 * Start listening for job results and handle delivery to Discord
 *
 * Results are routed through ResponseOrderingService to ensure responses
 * appear in the channel in the same order users sent their messages,
 * regardless of which model finishes first.
 */
async function startResultsListener(): Promise<void> {
  logger.info('Starting results listener...');
  await services.resultsListener.start(async (jobId, result) => {
    try {
      // Get context to know channel and timing
      const context = services.jobTracker.getContext(jobId);

      if (!context) {
        // Job not tracked (shouldn't happen in normal flow)
        logger.warn({ jobId }, 'Result for unknown job - delivering immediately');
        await services.messageHandler.handleJobResult(jobId, result);
        await confirmDelivery(jobId);
        return;
      }

      // Route through ordering service to maintain message order per channel
      await services.responseOrderingService.handleResult(
        context.channel.id,
        jobId,
        result,
        context.userMessageTime,
        async (jId, res) => {
          await services.messageHandler.handleJobResult(jId, res);
          await confirmDelivery(jId);
        }
      );
    } catch (error) {
      logger.error({ err: error, jobId }, 'Error delivering result to Discord');
    }
  });
  logger.info('Results listener started');

  // Failure listener subscribes to BullMQ QueueEvents and delivers a
  // synthesized failure result when an AI job ends without ever producing one
  // (multi-tag slots via the coordinator; single-tag jobs through the same
  // ordering-service + MessageHandler path the results listener above uses).
  // Placement after ResultsListener is stylistic — both subscribers are
  // independent and the ordering doesn't affect correctness.
  services.jobFailureListener.start();
}

/**
 * Subscribe to all cache invalidation events (personality, channel activation, denylist)
 */
async function subscribeToCacheInvalidation(): Promise<void> {
  await services.cacheInvalidationService.subscribe();
  logger.info('Subscribed to personality cache invalidation events');

  await services.channelActivationCacheInvalidationService.subscribe(event => {
    if (event.type === 'channel') {
      invalidateChannelSettingsCache(event.channelId);
      logger.debug({ channelId: event.channelId }, 'Invalidated channel settings cache');
    } else if (event.type === 'all') {
      clearAllChannelSettingsCache();
      logger.debug('Invalidated all channel activation caches');
    }
  });
  logger.info('Subscribed to channel activation cache invalidation events');

  await services.denylistCacheInvalidationService.subscribe(event => {
    if (event.type === 'all') {
      // Full reload — re-hydrate from gateway
      void services.denylistCache.hydrate().catch(err => {
        logger.error({ err }, 'Failed to re-hydrate denylist cache');
      });
      logger.info('Denylist cache full reload triggered');
    } else {
      // Incremental add/remove
      services.denylistCache.handleEvent(event);

      // If a guild was just denied, check if bot is in that guild and leave
      if (event.type === 'add' && event.entry.type === 'GUILD' && event.entry.scope === 'BOT') {
        const guild = client.guilds.cache.get(event.entry.discordId);
        if (guild !== undefined) {
          logger.info({ guildId: guild.id, guildName: guild.name }, 'Leaving newly denied guild');
          void guild.leave().catch(err => {
            logger.error({ err, guildId: guild.id }, 'Failed to leave newly denied guild');
          });
        }
      }
    }
  });
  logger.info('Subscribed to denylist cache invalidation events');
}

// Start the bot with explicit return type
async function start(): Promise<void> {
  try {
    const bootWatchdog = armBootWatchdog();
    logger.info('Starting Tzurot v3 Bot Client...');
    logger.info(
      {
        gatewayUrl: config.gatewayUrl,
      },
      'Configuration:'
    );

    // Auto-deploy commands if enabled
    if (envConfig.AUTO_DEPLOY_COMMANDS === 'true') {
      logger.info('Auto-deploying slash commands...');
      try {
        await deployCommands(true); // Always deploy globally in production
        logger.info('Slash commands deployed successfully');
      } catch (error) {
        logger.warn({ err: error }, 'Failed to deploy commands, but continuing startup...');
      }
    }
    // Marks "past the command-deploy step", not "deploy succeeded": it fires
    // the same way when auto-deploy is disabled or when deployCommands failed
    // and was caught above — the phase is a sequence position for the
    // deadline log, never a success claim.
    bootWatchdog.notePhase('commands-deployed');

    // Warn about deprecated env var (now controlled via config cascade)
    if (envConfig.AUTO_TRANSCRIBE_VOICE !== undefined) {
      logger.warn(
        {},
        'AUTO_TRANSCRIBE_VOICE env var is deprecated and ignored. ' +
          'Voice transcription is now controlled via admin config cascade (voiceTranscriptionEnabled).'
      );
    }

    // Initialize command handler
    logger.info('Loading slash commands...');
    commandHandler = new CommandHandler();
    await commandHandler.loadCommands();

    // Attach commands to client for access by commands like /help
    client.commands = commandHandler.getCommands();
    logger.info('Command handler initialized');
    bootWatchdog.notePhase('commands-loaded');

    // Create all services with full dependency injection
    logger.info('Initializing services with dependency injection...');
    services = createServices();
    logger.info('All services initialized');
    bootWatchdog.notePhase('services-initialized');

    // Hydrate denylist cache from gateway
    await services.denylistCache.hydrate();
    logger.info('Denylist cache hydrated');

    // Start notification cache cleanup timer
    startNotificationCacheCleanup();
    logger.info('Notification cache cleanup started');

    // Subscribe to all cache invalidation events (personality, persona, channel activation)
    await subscribeToCacheInvalidation();

    // Health check gateway
    logger.info('Checking gateway health...');
    const isHealthy = await healthCheck();
    logGatewayHealthStatus(isHealthy);
    bootWatchdog.notePhase('gateway-health-checked');

    // Login to Discord
    if (config.discordToken === undefined || config.discordToken.length === 0) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await client.login(config.discordToken);
    logger.info('Successfully logged in to Discord');
    bootWatchdog.notePhase('logged-in');

    // Recover any multi-tag fan-outs left in-flight by the previous bot
    // shutdown. Marks old jobIds stale, resubmits fresh jobs, and
    // rehydrates the coordinator's in-memory state. MUST run BEFORE
    // startResultsListener — the stale-set filter has to be in place
    // before any pre-restart result can arrive.
    //
    // **Defense in depth — overall timeout**: recovery makes Discord API
    // calls (channels.fetch / messages.fetch) per entry. If Discord's API
    // is degraded during a restart, those calls have no per-call timeout
    // and could hang indefinitely. Without an overall cap, startup would
    // stall and `startResultsListener` would never run — the bot would
    // accept Discord events but couldn't process AI results. 30s gives
    // recovery plenty of time even with 20+ entries under normal Discord
    // latency, and bounds the worst case under degraded conditions.
    const RECOVERY_TIMEOUT_MS = 30_000;
    try {
      const recoveryStats = await Promise.race([
        services.multiTagRecovery.run(),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Multi-tag recovery exceeded ${RECOVERY_TIMEOUT_MS}ms`)),
            RECOVERY_TIMEOUT_MS
          )
        ),
      ]);
      logger.info({ ...recoveryStats }, 'Multi-tag recovery finished');
    } catch (err) {
      // Conservatively enable the stale-check fast-path even on timeout.
      // If `recovery.run()` was mid-flight when the 30s deadline fired, it
      // keeps running in the background — its `noteRecoveryMarkedStale()`
      // call only happens at the end, AFTER the loop. Without this line,
      // `MessageHandler` would skip the isStale Redis check for every
      // result that arrives between now and whenever the background
      // recovery actually finishes, letting old-jobId results bypass the
      // stale filter. Worst case if there's nothing to filter: a few
      // wasted SISMEMBER calls against an empty SET. Cheap.
      services.multiTagCoordinator.noteRecoveryMarkedStale();
      logger.error(
        { err },
        'Multi-tag recovery failed — continuing startup; entries will retry next restart'
      );
    }

    // Start listening for job results (async delivery pattern)
    await startResultsListener();

    // Boot is complete once the results listener is up — cancel the deadline.
    bootWatchdog.disarm();
  } catch (error) {
    logger.error({ err: error }, 'Failed to start bot');
    process.exit(1);
  }
}

// Start the application
void start().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Failed to start application');
  process.exit(1);
});
