import { Client, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { Redis } from 'ioredis';
import {
  createLogger,
  PersonalityService,
  CacheInvalidationService,
  UserService,
  PersonaResolver,
  PersonaCacheInvalidationService,
  ChannelActivationCacheInvalidationService,
  ConversationHistoryService,
  disconnectPrisma,
  getPrismaClient,
  getConfig,
} from '@tzurot/common-types';
import {
  GatewayClient,
  invalidateChannelActivationCache,
  clearAllChannelActivationCache,
} from './utils/GatewayClient.js';
import { WebhookManager } from './utils/WebhookManager.js';
import { MessageHandler } from './handlers/MessageHandler.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { closeRedis } from './redis.js';
import { deployCommands } from './utils/deployCommands.js';
import { ResultsListener } from './services/ResultsListener.js';
import { JobTracker } from './services/JobTracker.js';
import { ResponseOrderingService } from './services/ResponseOrderingService.js';
import { DiscordResponseSender } from './services/DiscordResponseSender.js';
import { MessageContextBuilder } from './services/MessageContextBuilder.js';
import { ConversationPersistence } from './services/ConversationPersistence.js';
import { VoiceTranscriptionService } from './services/VoiceTranscriptionService.js';
import { ReferenceEnrichmentService } from './services/ReferenceEnrichmentService.js';
import { ReplyResolutionService } from './services/ReplyResolutionService.js';
import { PersonalityMessageHandler } from './services/PersonalityMessageHandler.js';
import { PersonalityIdCache } from './services/PersonalityIdCache.js';
import { ExtendedContextResolver } from './services/ExtendedContextResolver.js';
import { registerServices } from './services/serviceRegistry.js';

// Processors
import { BotMessageFilter } from './processors/BotMessageFilter.js';
import { EmptyMessageFilter } from './processors/EmptyMessageFilter.js';
import { VoiceMessageProcessor } from './processors/VoiceMessageProcessor.js';
import { ReplyMessageProcessor } from './processors/ReplyMessageProcessor.js';
import { ActivatedChannelProcessor } from './processors/ActivatedChannelProcessor.js';
import { PersonalityMentionProcessor } from './processors/PersonalityMentionProcessor.js';
import { BotMentionProcessor } from './processors/BotMentionProcessor.js';
import { validateDiscordToken, validateRedisUrl, logGatewayHealthStatus } from './startup.js';
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

// Configuration from environment
const config = {
  gatewayUrl: envConfig.GATEWAY_URL,
  discordToken: envConfig.DISCORD_TOKEN,
};

// Initialize Discord client
// Note: GuildMembers is a privileged intent requiring Discord Portal approval for 100+ servers.
// It's required because without it, message.member is null and we can't access user roles,
// display color, or join date for the AI context (activePersonaGuildInfo).
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

/**
 * Services returned by the composition root
 */
interface Services {
  messageHandler: MessageHandler;
  gatewayClient: GatewayClient;
  jobTracker: JobTracker;
  resultsListener: ResultsListener;
  responseOrderingService: ResponseOrderingService;
  webhookManager: WebhookManager;
  personalityService: PersonalityService;
  personaResolver: PersonaResolver;
  cacheRedis: Redis;
  cacheInvalidationService: CacheInvalidationService;
  personaCacheInvalidationService: PersonaCacheInvalidationService;
  channelActivationCacheInvalidationService: ChannelActivationCacheInvalidationService;
}

/**
 * Composition Root
 *
 * This is where all dependencies are instantiated and wired together.
 * Full dependency injection - no service creates its own dependencies.
 */
function createServices(): Services {
  // Composition Root: Create Prisma client for dependency injection
  const prisma = getPrismaClient();
  logger.info('[Bot] Prisma client initialized');

  // Initialize Redis for cache invalidation
  validateRedisUrl();
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const cacheRedis = new Redis(envConfig.REDIS_URL!);
  cacheRedis.on('error', err => {
    logger.error({ err }, '[Bot] Cache Redis connection error');
  });
  logger.info('[Bot] Redis client initialized for cache invalidation');

  // Core infrastructure
  const gatewayClient = new GatewayClient(config.gatewayUrl);
  const webhookManager = new WebhookManager(client);
  const responseOrderingService = new ResponseOrderingService();
  const jobTracker = new JobTracker(responseOrderingService);
  const resultsListener = new ResultsListener();

  // Shared services (used by multiple processors)
  const personalityService = new PersonalityService(prisma);
  const conversationHistoryService = new ConversationHistoryService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);
  const personalityIdCache = new PersonalityIdCache(personalityService); // Optimizes name→ID lookups
  const userService = new UserService(prisma);

  // Persona resolution with proper cache invalidation via Redis pub/sub
  const personaResolver = new PersonaResolver(prisma, { enableCleanup: true });
  const personaCacheInvalidationService = new PersonaCacheInvalidationService(cacheRedis);

  // Channel activation cache invalidation for horizontal scaling
  const channelActivationCacheInvalidationService = new ChannelActivationCacheInvalidationService(
    cacheRedis
  );

  // Message handling services
  const responseSender = new DiscordResponseSender(webhookManager);
  const contextBuilder = new MessageContextBuilder(prisma, personaResolver);
  const persistence = new ConversationPersistence(prisma);
  const voiceTranscription = new VoiceTranscriptionService(gatewayClient);
  const referenceEnricher = new ReferenceEnrichmentService(userService, personaResolver);
  const replyResolver = new ReplyResolutionService(personalityIdCache);

  // Extended context resolver for fetching recent channel messages
  const extendedContextResolver = new ExtendedContextResolver(gatewayClient);

  // Personality message handler (used by multiple processors)
  const personalityHandler = new PersonalityMessageHandler(
    gatewayClient,
    jobTracker,
    contextBuilder,
    persistence,
    referenceEnricher,
    extendedContextResolver
  );

  // Create processor chain (order matters!)
  // 1. BotMessageFilter - Ignore bot messages
  // 2. EmptyMessageFilter - Ignore empty messages
  // 3. VoiceMessageProcessor - Transcribe voice messages (sets transcript for later processors)
  // 4. ReplyMessageProcessor - Handle replies to personality webhooks (HIGHEST PRIORITY)
  // 5. ActivatedChannelProcessor - Auto-respond in channels with activated personalities
  // 6. PersonalityMentionProcessor - Handle @personality mentions
  // 7. BotMentionProcessor - Handle @bot mentions
  const processors = [
    new BotMessageFilter(),
    new EmptyMessageFilter(),
    new VoiceMessageProcessor(voiceTranscription, personalityIdCache),
    new ReplyMessageProcessor(replyResolver, personalityHandler),
    new ActivatedChannelProcessor(gatewayClient, personalityIdCache, personalityHandler),
    new PersonalityMentionProcessor(personalityIdCache, personalityHandler),
    new BotMentionProcessor(),
  ];

  // Create MessageHandler with full dependency injection
  const messageHandler = new MessageHandler(processors, responseSender, persistence, jobTracker);

  // Register services for global access (used by slash commands)
  registerServices({
    jobTracker,
    webhookManager,
    gatewayClient,
    personalityService,
    conversationHistoryService,
    personaResolver,
    channelActivationCacheInvalidationService,
  });

  return {
    messageHandler,
    gatewayClient,
    jobTracker,
    resultsListener,
    responseOrderingService,
    webhookManager,
    personalityService,
    personaResolver,
    cacheRedis,
    cacheInvalidationService,
    personaCacheInvalidationService,
    channelActivationCacheInvalidationService,
  };
}

// These will be initialized in start()
let services: ReturnType<typeof createServices>;
let commandHandler: CommandHandler;

// Message handler - wrapped to handle async properly
client.on(Events.MessageCreate, message => {
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
  void (async () => {
    try {
      if (interaction.isChatInputCommand()) {
        // Get the command to determine its deferral mode
        const command = commandHandler.getCommand(interaction.commandName);
        if (command === undefined) {
          logger.warn({ commandName: interaction.commandName }, 'Unknown command');
          return;
        }

        // All commands use the typed context pattern with deferralMode metadata
        await handleCommandWithContext(interaction, command);
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
function getSubcommandPath(
  interaction: import('discord.js').ChatInputCommandInteraction
): string | null {
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
  interaction: import('discord.js').ChatInputCommandInteraction
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
  interaction: import('discord.js').ChatInputCommandInteraction,
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
  logger.info(`Logged in as ${client.user?.tag ?? 'unknown'}`);
  logger.info(`Gateway URL: ${config.gatewayUrl}`);
});

// Error handling
client.on(Events.Error, error => {
  logger.error({ err: error }, 'Discord client error');
});

process.on('unhandledRejection', error => {
  logger.error({ err: error }, 'Unhandled rejection');
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');

  // Stop accepting new results first to prevent race condition during shutdown
  void services.resultsListener.stop();

  // Then deliver any buffered results
  void services.responseOrderingService
    .shutdown(async (jobId, result) => {
      try {
        await services.messageHandler.handleJobResult(jobId, result);
        await services.gatewayClient.confirmDelivery(jobId);
      } catch (error) {
        logger.error({ err: error, jobId }, '[Bot] Error delivering buffered result on shutdown');
      }
    })
    .finally(() => {
      services.jobTracker.cleanup();
      services.responseOrderingService.stopCleanup();
      services.webhookManager.destroy();
      void services.cacheInvalidationService.unsubscribe();
      void services.personaCacheInvalidationService.unsubscribe();
      void services.channelActivationCacheInvalidationService.unsubscribe();
      services.personaResolver.stopCleanup();
      services.cacheRedis.disconnect();
      void closeRedis();
      void client.destroy();
      void disconnectPrisma();
      process.exit(0);
    });
});

/**
 * Verify database connection and log personality count
 */
async function verifyDatabaseConnection(): Promise<void> {
  logger.info('[Bot] Verifying database connection...');
  const tempPrisma = getPrismaClient();
  const tempPersonalityService = new PersonalityService(tempPrisma);
  const personalityList = await tempPersonalityService.loadAllPersonalities();
  logger.info(`[Bot] Found ${personalityList.length} personalities in database`);
}

/**
 * Start listening for job results and handle delivery to Discord
 *
 * Results are routed through ResponseOrderingService to ensure responses
 * appear in the channel in the same order users sent their messages,
 * regardless of which model finishes first.
 */
async function startResultsListener(): Promise<void> {
  logger.info('[Bot] Starting results listener...');
  await services.resultsListener.start(async (jobId, result) => {
    try {
      // Get context to know channel and timing
      const context = services.jobTracker.getContext(jobId);

      if (!context) {
        // Job not tracked (shouldn't happen in normal flow)
        logger.warn({ jobId }, '[Bot] Result for unknown job - delivering immediately');
        await services.messageHandler.handleJobResult(jobId, result);
        await services.gatewayClient.confirmDelivery(jobId);
        return;
      }

      // Route through ordering service to maintain message order per channel
      await services.responseOrderingService.handleResult(
        context.message.channel.id,
        jobId,
        result,
        context.userMessageTime,
        async (jId, res) => {
          await services.messageHandler.handleJobResult(jId, res);
          await services.gatewayClient.confirmDelivery(jId);
        }
      );
    } catch (error) {
      logger.error({ err: error, jobId }, '[Bot] Error delivering result to Discord');
    }
  });
  logger.info('[Bot] Results listener started');
}

/**
 * Subscribe to all cache invalidation events (personality, persona, channel activation)
 */
async function subscribeToCacheInvalidation(): Promise<void> {
  await services.cacheInvalidationService.subscribe();
  logger.info('[Bot] Subscribed to personality cache invalidation events');

  await services.personaCacheInvalidationService.subscribe(event => {
    if (event.type === 'user') {
      services.personaResolver.invalidateUserCache(event.discordId);
      logger.debug({ discordId: event.discordId }, '[Bot] Invalidated persona cache for user');
    } else if (event.type === 'all') {
      services.personaResolver.clearCache();
      logger.debug('[Bot] Invalidated all persona caches');
    }
  });
  logger.info('[Bot] Subscribed to persona cache invalidation events');

  await services.channelActivationCacheInvalidationService.subscribe(event => {
    if (event.type === 'channel') {
      invalidateChannelActivationCache(event.channelId);
      logger.debug({ channelId: event.channelId }, '[Bot] Invalidated channel activation cache');
    } else if (event.type === 'all') {
      clearAllChannelActivationCache();
      logger.debug('[Bot] Invalidated all channel activation caches');
    }
  });
  logger.info('[Bot] Subscribed to channel activation cache invalidation events');
}

// Start the bot with explicit return type
async function start(): Promise<void> {
  try {
    logger.info('[Bot] Starting Tzurot v3 Bot Client...');
    logger.info(
      {
        gatewayUrl: config.gatewayUrl,
      },
      '[Bot] Configuration:'
    );

    // Verify database connection
    await verifyDatabaseConnection();

    // Auto-deploy commands if enabled
    if (envConfig.AUTO_DEPLOY_COMMANDS === 'true') {
      logger.info('[Bot] Auto-deploying slash commands...');
      try {
        await deployCommands(true); // Always deploy globally in production
        logger.info('[Bot] Slash commands deployed successfully');
      } catch (error) {
        logger.warn({ err: error }, '[Bot] Failed to deploy commands, but continuing startup...');
      }
    }

    // Initialize command handler
    logger.info('[Bot] Loading slash commands...');
    commandHandler = new CommandHandler();
    await commandHandler.loadCommands();

    // Attach commands to client for access by commands like /help
    client.commands = commandHandler.getCommands();
    logger.info('[Bot] Command handler initialized');

    // Create all services with full dependency injection
    logger.info('[Bot] Initializing services with dependency injection...');
    services = createServices();
    logger.info('[Bot] All services initialized');

    // Subscribe to all cache invalidation events (personality, persona, channel activation)
    await subscribeToCacheInvalidation();

    // Health check gateway
    logger.info('[Bot] Checking gateway health...');
    const isHealthy = await services.gatewayClient.healthCheck();
    logGatewayHealthStatus(isHealthy);

    // Login to Discord
    if (config.discordToken === undefined || config.discordToken.length === 0) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await client.login(config.discordToken);
    logger.info('[Bot] Successfully logged in to Discord');

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
