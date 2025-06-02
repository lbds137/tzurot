const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('./logger');
const webhookManager = require('./webhookManager');
const errorHandler = require('./handlers/errorHandler');
const messageHandler = require('./handlers/messageHandler');
const pluralkitMessageStore = require('./utils/pluralkitMessageStore').instance;
const { botConfig } = require('../config');

// Initialize the bot with necessary intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction],
});

// Bot initialization function
async function initBot() {
  // Log startup information
  logger.info(`🤖 Starting ${botConfig.name} in ${botConfig.environment.toUpperCase()} mode`);
  logger.info(`📝 Using prefix: ${botConfig.prefix}`);
  logger.info(`🌍 Environment: ${botConfig.environment}`);

  // Make client available globally to avoid circular dependencies
  global.tzurotClient = client;

  // Patch client for error filtering
  errorHandler.patchClientForErrorFiltering(client);

  // Set up event handlers
  client.on('ready', async () => {
    logger.info(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('with multiple personalities', { type: 'PLAYING' });

    // Register webhook manager event listeners AFTER client is ready
    webhookManager.registerEventListeners(client);

    // Start a periodic queue cleaner to check for and remove any error messages
    // This is a very aggressive approach to ensure no error messages appear
    errorHandler.startQueueCleaner(client);
  });

  // Handle errors
  client.on('error', error => {
    logger.error('Discord client error:', error);
  });

  // Message handling
  client.on('messageCreate', async message => {
    logger.debug(
      `[Bot] Received messageCreate event for message ${message.id} from ${message.author?.tag || 'unknown'}`
    );
    await messageHandler.handleMessage(message, client);
  });

  // Track message deletions for PluralKit detection
  client.on('messageDelete', async message => {
    // Only track user message deletions (not bot messages)
    if (message.partial || !message.author || message.author.bot) {
      return;
    }

    // Mark the message as deleted in our store
    pluralkitMessageStore.markAsDeleted(message.id);
  });

  // Log in to Discord with environment-appropriate token
  await client.login(botConfig.token);
  return client;
}

module.exports = {
  initBot,
  client,
};
