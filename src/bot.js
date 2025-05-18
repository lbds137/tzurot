const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getAiResponse } = require('./aiService');
const webhookManager = require('./webhookManager');
const { getPersonalityByAlias, registerPersonality } = require('./personalityManager');
const { PermissionFlagsBits } = require('discord.js');
const { recordConversation, getActivePersonality, getPersonalityFromMessage, clearConversation,
  activatePersonality, deactivatePersonality, getActivatedPersonality,
  enableAutoResponse, disableAutoResponse, isAutoResponseEnabled } = require('./conversationManager');
const { processCommand } = require('./commands');
const { botPrefix } = require('../config');

// Initialize the bot with necessary intents and partials
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.Reaction
  ]
});

// Bot initialization function
async function initBot() {
  // Set up event handlers
  client.on('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('with multiple personalities', { type: 'PLAYING' });

    // Register webhook manager event listeners AFTER client is ready
    webhookManager.registerEventListeners(client);

    // Register a default personality for testing (if needed)
    try {
      await registerPersonality('SYSTEM', 'lilith-tzel-shani', {
        description: 'System test personality'
      });
      console.log('Test personality registered');
    } catch (error) {
      console.error('Error registering test personality:', error);
    }
  });

  // Handle errors
  client.on('error', error => {
    console.error('Discord client error:', error);
  });
  
  // Message handling
  client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent loops
    if (message.author.bot) return;

    // Command handling - ensure the prefix is followed by a space
    if (message.content.startsWith(botPrefix + ' ') || message.content === botPrefix) {
      // Remove prefix and trim leading space
      const content = message.content.startsWith(botPrefix + ' ') ?
          message.content.slice(botPrefix.length + 1) :
          '';

      const args = content.trim().split(/ +/);
      const command = args.shift()?.toLowerCase() || 'help'; // Default to help if no command

      // Process the command only once
      await processCommand(message, command, args);
      return;
    }
    
    // Reply-based conversation continuation
    if (message.reference) {
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        
        // Check if the referenced message was from one of our personalities
        if (referencedMessage.webhookId) {
          const personalityName = getPersonalityFromMessage(referencedMessage.id);
          
          if (personalityName) {
            const personality = getPersonalityByAlias(personalityName);
            
            if (personality) {
              // Process the message with this personality
              await handlePersonalityInteraction(message, personality);
              return;
            }
          }
        }
      } catch (error) {
        console.error('Error handling message reference:', error);
      }
    }
    
    // @mention personality triggering
    const mentionMatch = message.content.match(/@(\w+)/i);
    if (mentionMatch) {
      const alias = mentionMatch[1];
      const personality = getPersonalityByAlias(alias);
      
      if (personality) {
        // Process the message with this personality
        await handlePersonalityInteraction(message, personality);
        return;
      }
    }

    // Check for active conversation
    const activePersonalityName = getActivePersonality(message.author.id, message.channel.id);
    if (activePersonalityName) {
      const personality = getPersonalityByAlias(activePersonalityName);

      if (personality) {
        // Process the message with this personality
        await handlePersonalityInteraction(message, personality);
        return;
      }
    }

    // Check for activated channel personality
    const activatedPersonalityName = getActivatedPersonality(message.channel.id);
    if (activatedPersonalityName) {
      const personality = getPersonalityByAlias(activatedPersonalityName);

      if (personality) {
        // Process the message with this personality
        await handlePersonalityInteraction(message, personality);
        return;
      }
    }
  });

  // Log in to Discord
  await client.login(process.env.DISCORD_TOKEN);
  return client;
}

/**
 * Handle interaction with a personality
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality data
 */
async function handlePersonalityInteraction(message, personality) {
  try {
    // Get AI response with user and channel context
    const aiResponse = await getAiResponse(
        personality.fullName,
        message.content,
        {
          userId: message.author.id,
          channelId: message.channel.id
        }
    );

    // Send the response via webhook - use the function directly from the module
    const sentMessage = await webhookManager.sendWebhookMessage(
        message.channel,
        aiResponse,
        personality
    );

    // Record this conversation
    recordConversation(
        message.author.id,
        message.channel.id,
        sentMessage.id,
        personality.fullName
    );
  } catch (error) {
    console.error('Error in personality interaction:', error);

    // Send error message to user
    message.reply('Sorry, I encountered an error while processing your message.').catch(e => {
      console.error('Could not send error reply:', e);
    });
  }
}

module.exports = { initBot, client };