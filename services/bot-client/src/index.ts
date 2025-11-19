import { Client, GatewayIntentBits, Events } from 'discord.js';
import { Redis } from 'ioredis';
import {
  createLogger,
  PersonalityService,
  CacheInvalidationService,
  UserService,
  disconnectPrisma,
  getPrismaClient,
  getConfig,
} from '@tzurot/common-types';
import { GatewayClient } from './utils/GatewayClient.js';
import { WebhookManager } from './utils/WebhookManager.js';
import { MessageHandler } from './handlers/MessageHandler.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { closeRedis } from './redis.js';
import { deployCommands } from './utils/deployCommands.js';
import { ResultsListener } from './services/ResultsListener.js';
import { JobTracker } from './services/JobTracker.js';
import { DiscordResponseSender } from './services/DiscordResponseSender.js';
import { MessageContextBuilder } from './services/MessageContextBuilder.js';
import { ConversationPersistence } from './services/ConversationPersistence.js';
import { VoiceTranscriptionService } from './services/VoiceTranscriptionService.js';
import { ReferenceEnrichmentService } from './services/ReferenceEnrichmentService.js';
import { ReplyResolutionService } from './services/ReplyResolutionService.js';
import { PersonalityMessageHandler } from './services/PersonalityMessageHandler.js';

// Processors
import { BotMessageFilter } from './processors/BotMessageFilter.js';
import { EmptyMessageFilter } from './processors/EmptyMessageFilter.js';
import { VoiceMessageProcessor } from './processors/VoiceMessageProcessor.js';
import { ReplyMessageProcessor } from './processors/ReplyMessageProcessor.js';
import { PersonalityMentionProcessor } from './processors/PersonalityMentionProcessor.js';
import { BotMentionProcessor } from './processors/BotMentionProcessor.js';

// Initialize logger
const logger = createLogger('bot-client');
const envConfig = getConfig();

// Validate bot-client specific required env vars
if (envConfig.DISCORD_TOKEN === undefined || envConfig.DISCORD_TOKEN.length === 0) {
  logger.error({}, 'DISCORD_TOKEN is required for bot-client');
  process.exit(1);
}

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
  webhookManager: WebhookManager;
  personalityService: PersonalityService;
  cacheRedis: Redis;
  cacheInvalidationService: CacheInvalidationService;
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
  const cacheRedis = new Redis(envConfig.REDIS_URL ?? 'redis://localhost:6379');
  cacheRedis.on('error', (err) => {
    logger.error({ err }, '[Bot] Cache Redis connection error');
  });
  logger.info('[Bot] Redis client initialized for cache invalidation');

  // Core infrastructure
  const gatewayClient = new GatewayClient(config.gatewayUrl);
  const webhookManager = new WebhookManager(client);
  const jobTracker = new JobTracker();
  const resultsListener = new ResultsListener();

  // Shared services (used by multiple processors)
  const personalityService = new PersonalityService(prisma);
  const cacheInvalidationService = new CacheInvalidationService(cacheRedis, personalityService);
  const userService = new UserService(prisma);

  // Message handling services
  const responseSender = new DiscordResponseSender(webhookManager);
  const contextBuilder = new MessageContextBuilder(prisma);
  const persistence = new ConversationPersistence(prisma);
  const voiceTranscription = new VoiceTranscriptionService(gatewayClient);
  const referenceEnricher = new ReferenceEnrichmentService(userService);
  const replyResolver = new ReplyResolutionService(personalityService);

  // Personality message handler (used by multiple processors)
  const personalityHandler = new PersonalityMessageHandler(
    gatewayClient,
    jobTracker,
    contextBuilder,
    persistence,
    referenceEnricher
  );

  // Create processor chain (order matters!)
  const processors = [
    new BotMessageFilter(),
    new EmptyMessageFilter(),
    new VoiceMessageProcessor(voiceTranscription, personalityService),
    new ReplyMessageProcessor(replyResolver, personalityHandler),
    new PersonalityMentionProcessor(personalityService, personalityHandler),
    new BotMentionProcessor(personalityService, personalityHandler),
  ];

  // Create MessageHandler with full dependency injection
  const messageHandler = new MessageHandler(
    processors,
    responseSender,
    persistence,
    jobTracker
  );

  return {
    messageHandler,
    gatewayClient,
    jobTracker,
    resultsListener,
    webhookManager,
    personalityService,
    cacheRedis,
    cacheInvalidationService,
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

// Interaction handler for slash commands and modals
client.on(Events.InteractionCreate, interaction => {
  void (async () => {
    try {
      if (interaction.isChatInputCommand() || interaction.isModalSubmit()) {
        await commandHandler.handleInteraction(interaction);
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
  services.jobTracker.cleanup();
  void services.resultsListener.stop();
  services.webhookManager.destroy();
  void services.cacheInvalidationService.unsubscribe();
  services.cacheRedis.disconnect();
  void closeRedis();
  void client.destroy();
  void disconnectPrisma();
  process.exit(0);
});

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

    // Verify we can connect to database
    logger.info('[Bot] Verifying database connection...');
    const tempPrisma = getPrismaClient();
    const tempPersonalityService = new PersonalityService(tempPrisma);
    const personalityList = await tempPersonalityService.loadAllPersonalities();
    logger.info(`[Bot] Found ${personalityList.length} personalities in database`);

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

    // Subscribe to cache invalidation events
    await services.cacheInvalidationService.subscribe();
    logger.info('[Bot] Subscribed to personality cache invalidation events');

    // Health check gateway
    logger.info('[Bot] Checking gateway health...');
    const isHealthy = await services.gatewayClient.healthCheck();
    if (!isHealthy) {
      logger.warn({}, '[Bot] Gateway health check failed, but continuing...');
    } else {
      logger.info('[Bot] Gateway is healthy');
    }

    // Login to Discord
    if (config.discordToken === undefined || config.discordToken.length === 0) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await client.login(config.discordToken);
    logger.info('[Bot] Successfully logged in to Discord');

    // Start listening for job results (async delivery pattern)
    logger.info('[Bot] Starting results listener...');
    await services.resultsListener.start(async (jobId, result) => {
      try {
        // Handle result - MessageHandler gets context from JobTracker
        await services.messageHandler.handleJobResult(jobId, result);

        // Confirm delivery to api-gateway (best-effort, non-blocking)
        await services.gatewayClient.confirmDelivery(jobId);
      } catch (error) {
        logger.error({ err: error, jobId }, '[Bot] Error delivering result to Discord');
      }
    });
    logger.info('[Bot] Results listener started');
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
