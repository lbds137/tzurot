import { Client, GatewayIntentBits, Events } from 'discord.js';
import { createLogger, PersonalityService, disconnectPrisma } from '@tzurot/common-types';
import { GatewayClient } from './gateway/client.js';
import { WebhookManager } from './webhooks/manager.js';
import { MessageHandler } from './handlers/messageHandler.js';

// Initialize logger
const logger = createLogger('bot-client');

// Configuration from environment
const config = {
  gatewayUrl: process.env.GATEWAY_URL ?? 'http://localhost:3000',
  discordToken: process.env.DISCORD_TOKEN
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
const webhookManager = new WebhookManager();

// These will be initialized in start()
let messageHandler: MessageHandler;

// Message handler - wrapped to handle async properly
client.on(Events.MessageCreate, (message) => {
  void (async () => {
    try {
      await messageHandler.handleMessage(message);
    } catch (error) {
      logger.error(error, 'Error in message handler');
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
  logger.error(error, 'Discord client error');
});

process.on('unhandledRejection', (error) => {
  logger.error(error, 'Unhandled rejection');
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down...');
  webhookManager.destroy();
  void client.destroy();
  void disconnectPrisma();
  process.exit(0);
});

// Start the bot with explicit return type
async function start(): Promise<void> {
  try {
    logger.info('[Bot] Starting Tzurot v3 Bot Client...');
    logger.info('[Bot] Configuration:', {
      gatewayUrl: config.gatewayUrl
    });

    // Load personalities from PostgreSQL
    logger.info('[Bot] Loading personalities from database...');
    const personalityService = new PersonalityService();
    const personalityList = await personalityService.loadAllPersonalities();

    // Convert array to Map for MessageHandler
    const personalities = new Map();
    for (const personality of personalityList) {
      personalities.set(personality.name.toLowerCase(), personality);
    }

    logger.info(`[Bot] Loaded ${personalities.size} personalities from PostgreSQL`);

    // Initialize message handler
    messageHandler = new MessageHandler(gatewayClient, webhookManager, personalities);

    // Health check gateway
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
    logger.error(error, 'Failed to start bot');
    process.exit(1);
  }
}

// Start the application
void start().catch((error: unknown) => {
  logger.fatal(error, 'Failed to start application');
  process.exit(1);
});