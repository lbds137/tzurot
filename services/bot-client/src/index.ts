import { Client, GatewayIntentBits, Events } from 'discord.js';
import { createLogger, PersonalityService, disconnectPrisma, getConfig } from '@tzurot/common-types';
import { GatewayClient } from './gateway/GatewayClient.js';
import { WebhookManager } from './webhooks/WebhookManager.js';
import { MessageHandler } from './handlers/MessageHandler.js';
import { CommandHandler } from './handlers/CommandHandler.js';
import { closeRedis } from './redis.js';
import { deployCommands } from './utils/deployCommands.js';

// Initialize logger
const logger = createLogger('bot-client');
const envConfig = getConfig();

// Validate bot-client specific required env vars
if (!envConfig.DISCORD_TOKEN) {
  logger.error('DISCORD_TOKEN is required for bot-client');
  process.exit(1);
}

// Configuration from environment
const config = {
  gatewayUrl: envConfig.GATEWAY_URL,
  discordToken: envConfig.DISCORD_TOKEN
};

// Initialize Discord client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages,
  ]
});

// Initialize services
const gatewayClient = new GatewayClient(config.gatewayUrl);
const webhookManager = new WebhookManager(client);

// These will be initialized in start()
let messageHandler: MessageHandler;
let commandHandler: CommandHandler;

// Message handler - wrapped to handle async properly
client.on(Events.MessageCreate, (message) => {
  void (async () => {
    try {
      await messageHandler.handleMessage(message);
    } catch (error) {
      logger.error({ err: error }, 'Error in message handler');
    }
  })();
});

// Interaction handler for slash commands
client.on(Events.InteractionCreate, (interaction) => {
  void (async () => {
    try {
      if (interaction.isChatInputCommand()) {
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
client.on(Events.Error, (error) => {
  logger.error({ err: error }, 'Discord client error');
});

process.on('unhandledRejection', (error) => {
  logger.error({ err: error }, 'Unhandled rejection');
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  webhookManager.destroy();
  void closeRedis();
  void client.destroy();
  void disconnectPrisma();
  process.exit(0);
});

// Start the bot with explicit return type
async function start(): Promise<void> {
  try {
    logger.info('[Bot] Starting Tzurot v3 Bot Client...');
    logger.info({
      gatewayUrl: config.gatewayUrl
    }, '[Bot] Configuration:');

    // Verify we can connect to database
    logger.info('[Bot] Verifying database connection...');
    const personalityService = new PersonalityService();
    const personalityList = await personalityService.loadAllPersonalities();
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

    // Initialize message handler (personalities loaded on-demand with caching)
    logger.info('[Bot] Initializing message handler...');
    messageHandler = new MessageHandler(gatewayClient, webhookManager);
    logger.info('[Bot] Message handler initialized');

    // Health check gateway
    logger.info('[Bot] Checking gateway health...');
    const isHealthy = await gatewayClient.healthCheck();
    if (!isHealthy) {
      logger.warn('[Bot] Gateway health check failed, but continuing...');
    } else {
      logger.info('[Bot] Gateway is healthy');
    }

    // Login to Discord
    if (config.discordToken === undefined || config.discordToken.length === 0) {
      throw new Error('DISCORD_TOKEN environment variable is required');
    }

    await client.login(config.discordToken);
    logger.info('[Bot] Successfully logged in to Discord');

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