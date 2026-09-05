import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { registerProcessLifecycle } from '@tzurot/common-types/utils/processLifecycle';
import {
  invalidateChannelSettingsCache,
  clearAllChannelSettingsCache,
  confirmDelivery,
  healthCheck,
  stampUserActivity,
} from './utils/gatewayServiceCalls.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { handleCommandWithContext } from './handlers/commandDispatch.js';
import { closeRedis, redis } from './redis.js';
import { armBootWatchdog } from './utils/bootWatchdog.js';
import { deployCommands } from './utils/deployCommands.js';
import { shouldAutoRegisterCommands } from './utils/commandRegistrationGate.js';
import { respondToInteractionDuringMaintenance } from './utils/maintenanceResponses.js';
import { deliverJobResult, type JobResultDeliveryDeps } from './services/deliverJobResult.js';
import { registerGuildMemberInfoReporter } from './services/GuildMemberInfoReporter.js';
import { runBootRecovery } from './services/bootRecovery.js';
import { isInteractionDenied } from './processors/interactionDenylistGate.js';
import { getThreadParentId } from './utils/discordChannelTypes.js';
import { StartupDMPrewarmer } from './services/StartupDMPrewarmer.js';
import { registerShardLifecycleLogging } from './services/ShardLifecycleLogger.js';
import {
  buildWatchdogSelfHealExit,
  type LifecycleShutdown,
} from './services/watchdogSelfHealExit.js';
import { startGatewayWatchdog } from './services/GatewayWatchdog.js';
import { createServices } from './serviceFactory.js';

// Processors
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
      if (
        isInteractionDenied(services.denylistCache, {
          userId: interaction.user.id,
          guildId: interaction.guildId,
          channelId: interaction.channelId,
          parentChannelId: getThreadParentId(interaction.channel),
        })
      ) {
        return;
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
// Filled in from registerProcessLifecycle's return below. A holder rather than
// a direct reference because the watchdog is wired here, earlier in this module
// than the lifecycle is registered, so the self-heal exit reads the shutdown
// when it fires instead of receiving it at wiring time.
const lifecycle: { shutdown?: LifecycleShutdown } = {};
// Liveness watchdog: catches a wedged gateway the platform has no healthcheck for.
// exit routes through the ONE shutdown path so a self-heal and a concurrent
// SIGTERM cannot each run dispose with a guard blind to the other; the
// watchdog's non-zero code rides along because the platform restarts only on
// failure, unlike graceful shutdown's own success path, which exits 0.
const gatewayWatchdog = startGatewayWatchdog(client, logger, {
  alertWebhookUrl: envConfig.WATCHDOG_ALERT_WEBHOOK_URL,
  environment: envConfig.NODE_ENV,
  exit: buildWatchdogSelfHealExit({ logger, getShutdown: () => lifecycle.shutdown }),
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
    gatewayWatchdog.stop();
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
lifecycle.shutdown = registerProcessLifecycle({
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
}).shutdown;

/**
 * Start listening for job results and handle delivery to Discord
 *
 * Results are routed through ResponseOrderingService to ensure responses
 * appear in the channel in the same order users sent their messages,
 * regardless of which model finishes first.
 */
async function startResultsListener(): Promise<void> {
  logger.info('Starting results listener...');
  // The disposition gate itself lives in `deliverJobResult` (with its own
  // tests): only a `'delivered'` verdict may confirm the gateway row, because
  // confirming a dropped result files a success record over a silent loss.
  // The arrow keeps `handleJobResult` bound to its MessageHandler instance;
  // passing the method reference unbound would lose `this`.
  const delivery: JobResultDeliveryDeps = {
    handleJobResult: (jId, res) => services.messageHandler.handleJobResult(jId, res),
    confirmDelivery,
  };

  await services.resultsListener.start(async (jobId, result) => {
    try {
      // Get context to know channel and timing
      const context = services.jobTracker.getContext(jobId);

      if (!context) {
        // Job not tracked here — it may still be owned by the multi-tag
        // coordinator or covered by a late-result recovery marker, so hand it
        // to the handler and let IT report what happened.
        logger.warn({ jobId }, 'Result for unknown job - delivering immediately');
        await deliverJobResult(delivery, jobId, result);
        return;
      }

      // Route through ordering service to maintain message order per channel
      await services.responseOrderingService.handleResult(
        context.channel.id,
        jobId,
        result,
        context.userMessageTime,
        async (jId, res) => {
          await deliverJobResult(delivery, jId, res);
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

    // Register slash commands on boot — on Railway only, and only when the set changed
    if (shouldAutoRegisterCommands(envConfig)) {
      logger.info('Auto-registering slash commands...');
      try {
        await deployCommands(true, redis); // Always deploy globally in production
        logger.info('Slash commands deployed successfully');
      } catch (error) {
        logger.warn({ err: error }, 'Failed to deploy commands, but continuing startup...');
      }
    } else {
      logger.info(
        'Slash-command auto-registration is off outside Railway (RAILWAY_ENVIRONMENT_NAME unset or empty) — use pnpm deploy-commands to register from a shell'
      );
    }
    // Marks "past the command-deploy step", not "deploy succeeded": it fires
    // the same way when registration is off (local run) or when deployCommands failed
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
    services = createServices(client);
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

    // Recover work left in-flight by the previous bot shutdown. BOTH passes
    // MUST run BEFORE startResultsListener: multi-tag needs its stale-set
    // filter in place before any pre-restart result arrives, and single-job
    // needs the tracker context to exist before one does — a result landing
    // in that gap is dropped as an unknown job, which is the failure the
    // single-job pass exists to prevent. `runBootRecovery` owns the shared
    // timeout rationale.
    const multiTagStats = await runBootRecovery('Multi-tag recovery', () =>
      services.multiTagRecovery.run()
    );
    if (multiTagStats === null) {
      // Conservatively enable the stale-check fast-path even on timeout.
      // If `recovery.run()` was mid-flight when the deadline fired, it keeps
      // running in the background — its `noteRecoveryMarkedStale()` call only
      // happens at the end, AFTER the loop. Without this line,
      // `MessageHandler` would skip the isStale Redis check for every result
      // that arrives between now and whenever the background recovery
      // actually finishes, letting old-jobId results bypass the stale filter.
      // Worst case if there's nothing to filter: a few wasted SISMEMBER calls
      // against an empty SET. Cheap.
      services.multiTagCoordinator.noteRecoveryMarkedStale();
    }

    // The single-job pass needs no such compensation: unrecovered entries
    // keep their Redis context and TTL, so the next restart retries them.
    //
    // The two passes run in SERIES deliberately, not to save a `Promise.all`.
    // Each is already sequential internally because every entry costs up to
    // two Discord API calls and a boot after a heavy-traffic shutdown could
    // otherwise burst into a rate limit; overlapping the passes doubles that
    // peak pressure at exactly the moment the concern is sharpest. The
    // latency it would buy is headroom we do not need — roughly 60s worst
    // case against `BOOT_DEADLINE_MS`.
    await runBootRecovery('Single-job recovery', () => services.singleJobRecovery.run());

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
