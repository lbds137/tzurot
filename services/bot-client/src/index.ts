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
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages,
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

// Commands that should NOT use ephemeral deferral (visible to everyone)
const NON_EPHEMERAL_COMMANDS = new Set(['character chat']);

// Commands that should NOT be deferred because they show a modal
// Modal must be shown as the FIRST response to an interaction (cannot defer first)
const MODAL_COMMANDS = new Set([
  'wallet set',
  'me profile create',
  'me profile edit',
  'me profile override-set',
  'character create',
]);

// Interaction handler for slash commands, modals, autocomplete, and component interactions
client.on(Events.InteractionCreate, interaction => {
  void (async () => {
    try {
      if (interaction.isChatInputCommand()) {
        // Build full command name for checking against sets
        const subcommand = interaction.options.getSubcommand(false);
        const subcommandGroup = interaction.options.getSubcommandGroup(false);
        let fullCommand = interaction.commandName;
        if (subcommandGroup !== null && subcommandGroup.length > 0) {
          fullCommand += ` ${subcommandGroup}`;
        }
        if (subcommand !== null && subcommand.length > 0) {
          fullCommand += ` ${subcommand}`;
        }

        // Skip deferral for commands that show modals
        // Modal must be the FIRST response to an interaction
        if (!MODAL_COMMANDS.has(fullCommand)) {
          // CRITICAL: Defer IMMEDIATELY to avoid 3-second Discord timeout
          // Do this BEFORE any routing logic or async operations
          const isEphemeral = !NON_EPHEMERAL_COMMANDS.has(fullCommand);

          try {
            await interaction.deferReply({
              flags: isEphemeral ? MessageFlags.Ephemeral : undefined,
            });
          } catch (deferError) {
            // If defer fails, the interaction already expired - nothing we can do
            logger.error({ err: deferError, command: fullCommand }, 'Failed to defer interaction');
            return;
          }
        }

        // Now route to command handler
        await commandHandler.handleInteraction(interaction);
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
