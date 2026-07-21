import {
  Client,
  GatewayIntentBits,
  Events,
  MessageFlags,
  Partials,
  type ChatInputCommandInteraction,
} from 'discord.js';
import { Queue, type Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { getConfig } from '@tzurot/common-types/config/config';
import { MaintenanceFlag } from '@tzurot/common-types/services/MaintenanceFlag';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { registerProcessLifecycle } from '@tzurot/common-types/utils/processLifecycle';
import { parseRedisUrl, createBullMQRedisConfig } from '@tzurot/common-types/utils/redis';
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
} from './utils/gatewayServiceCalls.js';
import { WebhookManager } from './utils/WebhookManager.js';
import { getServiceClient } from './utils/gatewayClients.js';
import type { MessageHandler } from './handlers/MessageHandler.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { redis as botRedis, closeRedis } from './redis.js';
import { deployCommands } from './utils/deployCommands.js';
import { respondToInteractionDuringMaintenance } from './utils/maintenanceResponses.js';
import { ResultsListener } from './services/ResultsListener.js';
import { JobTracker } from './services/JobTracker.js';
import { JobFailureListener } from './services/JobFailureListener.js';
import { setupReleaseDmWorker } from './services/releaseDm/setupReleaseDmWorker.js';
import { ResponseOrderingService } from './services/ResponseOrderingService.js';
import { DiscordResponseSender } from './services/DiscordResponseSender.js';
import { MessageContextBuilder } from './services/MessageContextBuilder.js';
import { ConversationPersistence } from './services/ConversationPersistence.js';
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
import {
  startVerificationCleanupScheduler,
  stopVerificationCleanupScheduler,
} from './services/VerificationCleanupScheduler.js';
import {
  startSecretRotationNagScheduler,
  stopSecretRotationNagScheduler,
} from './services/SecretRotationNagScheduler.js';
import {
  validateDiscordToken,
  validateRedisUrl,
  validateInternalServiceSecret,
  logGatewayHealthStatus,
} from './startup.js';
import { restoreBotPresence } from './commands/admin/presence.js';
import {
  createDeferredContext,
  createModalContext,
  createManualContext,
} from './utils/commandContext/index.js';

// Initialize logger
const logger = createLogger('bot-client');
const envConfig = getConfig();

// Validate bot-client specific required env vars
validateDiscordToken();
validateInternalServiceSecret();

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
}

/**
 * Build the cache-invalidation Redis client. Validates env, wires the error
 * handler, logs initialization. Extracted from `createServices` so its
 * non-null-assertion suppression doesn't bloat the main wiring body.
 */
function buildCacheRedis(): Redis {
  validateRedisUrl();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- REDIS_URL is validated by validateRedisUrl() above; TS can't narrow across the function boundary
  const cacheRedis = new Redis(envConfig.REDIS_URL!);
  cacheRedis.on('error', err => {
    logger.error({ err }, 'Cache Redis connection error');
  });
  logger.info('Redis client initialized for cache invalidation');
  return cacheRedis;
}

/**
 * Composition Root
 *
 * This is where all dependencies are instantiated and wired together.
 * Full dependency injection - no service creates its own dependencies.
 */
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

  // Denylist cache and invalidation service
  const denylistCache = new DenylistCache();
  const denylistCacheInvalidationService = new DenylistCacheInvalidationService(cacheRedis);

  // Maintenance-window gate (destructive-migration windows; `pnpm ops maintenance`).
  const maintenanceFlag = new MaintenanceFlag(cacheRedis);

  // DM channel cache warmer — pre-establishes Discord.js's internal channel
  // cache for any user we encounter, so subsequent plain-text DMs can be
  // resolved by MessageCreateAction.getChannel(). See DMCacheWarmer.ts for
  // the full diagnosis narrative.
  const dmCacheWarmer = new DMCacheWarmer();

  // Message handling services
  const responseSender = new DiscordResponseSender(webhookManager);
  const contextBuilder = new MessageContextBuilder(getServiceClient(), denylistCache);
  const persistence = new ConversationPersistence();
  const voiceTranscription = new VoiceTranscriptionService();
  const replyResolver = new ReplyResolutionService(routingPersonalityLoader);

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

  // Release-broadcast DM worker: consumes gateway-produced batches and sends
  // the DMs. Constructed here (not lazily) so shutdown ownership is explicit.
  const releaseDmWorker = setupReleaseDmWorker({ client });

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

  // Live failure routing: now that the coordinator exists, wire the
  // failure listener so it can route multi-tag slot failures through
  // `coordinator.handleJobResult` instead of falling through to the
  // single-tag-only `cancelJob` path.
  const jobFailureListener = new JobFailureListener(
    jobTracker,
    responseOrderingService,
    multiTagCoordinator
  );

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

  // Register services for global access (used by slash commands)
  registerServices({
    jobTracker,
    webhookManager,
    personalityService: routingPersonalityLoader,
    channelActivationCacheInvalidationService,
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
        // Get the command to determine its deferral mode
        const command = commandHandler.getCommand(interaction.commandName);
        if (command === undefined) {
          logger.warn({ commandName: interaction.commandName }, 'Unknown command');
          return;
        }

        // All commands use the typed context pattern with deferralMode metadata
        await handleCommandWithContext(interaction, command);
      } else if (interaction.isMessageContextMenuCommand()) {
        await commandHandler.handleContextMenuCommand(interaction);
      } else if (interaction.isModalSubmit()) {
        await commandHandler.handleInteraction(interaction);
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

/**
 * Get the subcommand path for looking up deferral mode overrides.
 * Returns 'group subcommand' for subcommand groups, or just 'subcommand' for simple subcommands.
 */
function getSubcommandPath(interaction: ChatInputCommandInteraction): string | null {
  try {
    const group = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand(false);

    if (group !== null && subcommand !== null) {
      return `${group} ${subcommand}`;
    }
    return subcommand;
  } catch {
    return null;
  }
}

/**
 * Resolve the effective deferral mode for a command/subcommand.
 *
 * Checks subcommandDeferralModes for overrides, falls back to deferralMode.
 */
function resolveEffectiveDeferralMode(
  command: import('./types.js').Command,
  interaction: ChatInputCommandInteraction
): import('./utils/commandContext/index.js').DeferralMode {
  const defaultMode = command.deferralMode ?? 'ephemeral';

  // Check for subcommand-level override
  if (command.subcommandDeferralModes !== undefined) {
    const subcommandPath = getSubcommandPath(interaction);
    if (subcommandPath !== null && subcommandPath in command.subcommandDeferralModes) {
      return command.subcommandDeferralModes[subcommandPath];
    }
  }

  return defaultMode;
}

/**
 * Handle a command using the typed context pattern.
 *
 * Commands declare their deferralMode via defineCommand(), and receive a
 * SafeCommandContext that doesn't expose deferReply() (for deferred modes),
 * preventing InteractionAlreadyReplied errors at compile time.
 *
 * For commands with mixed subcommand requirements, subcommandDeferralModes
 * allows per-subcommand overrides of the default deferral behavior.
 */
async function handleCommandWithContext(
  interaction: ChatInputCommandInteraction,
  command: import('./types.js').Command
): Promise<void> {
  // Resolve effective deferral mode (may be overridden per-subcommand)
  const effectiveMode = resolveEffectiveDeferralMode(command, interaction);

  // Type assertion: We dispatch the correct context type based on deferralMode,
  // but TypeScript can't narrow the execute function signature at compile time.
  // This is safe because we control both the context creation and the dispatch.
  type ContextExecute = (
    context: import('./utils/commandContext/index.js').SafeCommandContext
  ) => Promise<void>;
  const execute = command.execute as ContextExecute;

  switch (effectiveMode) {
    case 'ephemeral':
    case 'public': {
      // Defer appropriately
      const isEphemeral = effectiveMode === 'ephemeral';
      try {
        await interaction.deferReply({
          flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
        });
      } catch (deferError) {
        logger.error(
          { err: deferError, command: interaction.commandName },
          'Failed to defer interaction'
        );
        return;
      }
      // Create typed context (no deferReply method!)
      const context = createDeferredContext(interaction, isEphemeral);
      await execute(context);
      break;
    }

    case 'modal': {
      // Don't defer - command will show modal
      const context = createModalContext(interaction);
      await execute(context);
      break;
    }

    case 'none': {
      // Don't defer - command handles timing itself
      const context = createManualContext(interaction);
      await execute(context);
      break;
    }
  }
}

// Ready event
client.once(Events.ClientReady, () => {
  logger.info({ botTag: client.user?.tag ?? 'unknown' }, 'Logged in');
  logger.info({ gatewayUrl: config.gatewayUrl }, 'Gateway URL configured');

  // Initialize verification message cleanup service and start scheduler
  initVerificationCleanupService(client);
  startVerificationCleanupScheduler();

  // Daily secret-rotation overdue check → owner-channel nag (weekly Redis
  // cooldown; see SecretRotationNagScheduler for the restart-cadence design).
  startSecretRotationNagScheduler(client, services.cacheRedis);

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

// Error handling
client.on(Events.Error, error => {
  logger.error({ err: error }, 'Discord client error');
});

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

  // Failure listener subscribes to BullMQ QueueEvents and unblocks the channel
  // ordering queue when an AI job ends without producing a result. Placement
  // after ResultsListener is stylistic — both subscribers are independent and
  // the ordering doesn't affect correctness.
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

    // Create all services with full dependency injection
    logger.info('Initializing services with dependency injection...');
    services = createServices();
    logger.info('All services initialized');

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

    // Login to Discord
    if (config.discordToken === undefined || config.discordToken.length === 0) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await client.login(config.discordToken);
    logger.info('Successfully logged in to Discord');

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
