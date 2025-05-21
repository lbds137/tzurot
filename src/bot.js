const { Client, GatewayIntentBits, Partials } = require('discord.js');
const logger = require('./logger');
const webhookManager = require('./webhookManager');
const { messageTracker } = require('./messageTracker');
const errorHandler = require('./handlers/errorHandler');
const personalityHandler = require('./handlers/personalityHandler');
const messageHandler = require('./handlers/messageHandler');

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
  // Make client available globally to avoid circular dependencies
  global.tzurotClient = client;

  // Patch client for error filtering
  errorHandler.patchClientForErrorFiltering(client);

  // Patch the Discord Message.prototype.reply method
  const { Message } = require('discord.js');
  const originalReply = Message.prototype.reply;

  // Replace the original reply method with our patched version
  Message.prototype.reply = async function patchedReply(options) {
    // Create a unique signature for this reply
    const optionsSignature = typeof options === 'string'
      ? options.substring(0, 20)
      : options.content
        ? options.content.substring(0, 20)
        : options.embeds && options.embeds.length > 0
          ? options.embeds[0].title || 'embed'
          : 'unknown';
          
    // Check if this operation is a duplicate
    if (!messageTracker.trackOperation(this.channel.id, 'reply', optionsSignature)) {
      // Return a dummy response to maintain API compatibility
      return {
        id: `prevented-dupe-${Date.now()}`,
        content: typeof options === 'string' ? options : options.content || '',
        isDuplicate: true,
      };
    }
    
    // Call the original reply method
    return originalReply.apply(this, arguments);
  };

  // Patch the TextChannel.prototype.send method
  const { TextChannel } = require('discord.js');
  const originalSend = TextChannel.prototype.send;

  // Replace the original send method with our patched version
  TextChannel.prototype.send = async function patchedSend(options) {
    logger.debug(
      `Channel.send called with options: ${JSON.stringify({
        channelId: this.id,
        options:
          typeof options === 'string'
            ? { content: options.substring(0, 30) + '...' }
            : {
                content: options.content?.substring(0, 30) + '...',
                hasEmbeds: !!options.embeds?.length,
                embedTitle: options.embeds?.[0]?.title,
              },
      })}`
    );

    // Create a unique signature for this send operation
    const optionsSignature = typeof options === 'string'
      ? options.substring(0, 20)
      : options.content
        ? options.content.substring(0, 20)
        : options.embeds && options.embeds.length > 0
          ? options.embeds[0].title || 'embed'
          : 'unknown';
          
    // Check if this operation is a duplicate
    if (!messageTracker.trackOperation(this.id, 'send', optionsSignature)) {
      // Return a dummy response to maintain API compatibility
      return {
        id: `prevented-dupe-${Date.now()}`,
        content: typeof options === 'string' ? options : options.content || '',
        isDuplicate: true,
      };
    }

    // Call the original send method
    return originalSend.apply(this, arguments);
  };

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
    await messageHandler.handleMessage(message, client);
  });

  // Log in to Discord
  await client.login(process.env.DISCORD_TOKEN);
  return client;
}

module.exports = { 
  initBot, 
  client
};