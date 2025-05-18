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
  // Make client available globally to avoid circular dependencies
  global.tzurotClient = client;
  
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
    if (message.author.bot) {
      // Debug: log the bot messages we're ignoring to make sure we're not filtering our own webhooks
      if (message.webhookId) {
        console.log(`[Bot] Ignoring message from webhook: ${message.webhookId}, content: ${message.content.substring(0, 20)}...`);
      }
      return;
    }
    
    console.log(`[Bot] Processing message from ${message.author.tag}, id: ${message.id}, isReply: ${!!message.reference}`);

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
      console.log(`[Reply Handler] Detected reply from ${message.author.tag} to message ID: ${message.reference.messageId}`);
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        console.log(`[Reply Handler] Fetched referenced message. Webhook ID: ${referencedMessage.webhookId || 'none'}`);
        
        // Check if the referenced message was from one of our personalities
        console.log(`[Reply Handler] Reply detected to message ${referencedMessage.id} with webhookId: ${referencedMessage.webhookId || 'none'}`);
        
        if (referencedMessage.webhookId) {
          console.log(`[Reply Handler] Looking up personality for message ID: ${referencedMessage.id}`);
          // Pass the webhook username as a fallback for finding personalities
          const webhookUsername = referencedMessage.author ? referencedMessage.author.username : null;
          console.log(`[Reply Handler] Webhook username: ${webhookUsername || 'unknown'}`);
          const personalityName = getPersonalityFromMessage(referencedMessage.id, { webhookUsername });
          console.log(`[Reply Handler] Personality lookup result: ${personalityName || 'null'}`);
          
          if (personalityName) {
            console.log(`[Reply Handler] Found personality name: ${personalityName}, looking up personality details`);
            const personality = getPersonalityByAlias(personalityName);
            console.log(`[Reply Handler] Personality lookup result: ${personality ? personality.fullName : 'null'}`);
            
            if (personality) {
              // Process the message with this personality
              console.log(`[Reply Handler] Processing reply with personality: ${personality.fullName}`);
              await handlePersonalityInteraction(message, personality);
              return;
            } else {
              console.log(`[Reply Handler] No personality data found for alias: ${personalityName}`);
            }
          } else {
            console.log(`[Reply Handler] No personality found for message ID: ${referencedMessage.id}`);
          }
        } else {
          console.log(`[Reply Handler] Referenced message is not from a webhook: ${referencedMessage.author?.tag || 'unknown author'}`);
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
    // Start typing indicator to show the bot is processing
    message.channel.sendTyping();
    
    // Set typing interval - Discord's typing status only lasts 10 seconds
    // so we need to repeatedly send it for longer conversations
    const typingInterval = setInterval(() => {
      message.channel.sendTyping()
        .catch(err => console.warn('Error sending typing indicator:', err));
    }, 9000); // Send typing indicator every 9 seconds
    
    try {
      // Get AI response with user and channel context
      console.log(`Getting AI response from ${personality.fullName} for ${message.author.tag}`);
      const aiResponse = await getAiResponse(
          personality.fullName,
          message.content,
          {
            userId: message.author.id,
            channelId: message.channel.id
          }
      );
  
      // Clear typing indicator interval
      clearInterval(typingInterval);
  
      // Send the response via webhook - use the function directly from the module
      console.log(`[Bot] Sending webhook message as personality: ${personality.fullName}`);
      const result = await webhookManager.sendWebhookMessage(
          message.channel,
          aiResponse,
          personality
      );
      console.log(`[Bot] Webhook result type: ${typeof result}, has messageIds: ${result && result.messageIds ? 'yes' : 'no'}`);
      if (result && result.messageIds) {
        console.log(`[Bot] Got ${result.messageIds.length} message IDs from webhook`);
      }
  
      // Record this conversation with all message IDs
      if (result) {
        console.log(`[Bot] Recording conversation with result format:`, {
          hasMessageIds: !!(result.messageIds && result.messageIds.length),
          hasSingleMessage: !!(result.message && result.message.id),
          hasDirectId: !!result.id
        });
        
        // Check if it's the new format with messageIds array or old format
        if (result.messageIds && result.messageIds.length > 0) {
          // New format - array of message IDs
          console.log(`Recording ${result.messageIds.length} message IDs: ${result.messageIds.join(', ')}`);
          recordConversation(
              message.author.id,
              message.channel.id,
              result.messageIds,
              personality.fullName
          );
          console.log(`Recorded ${result.messageIds.length} message IDs for conversation`);
        } else if (result.message && result.message.id) {
          // New format - single message
          console.log(`Recording single message ID: ${result.message.id}`);
          recordConversation(
              message.author.id,
              message.channel.id,
              result.message.id,
              personality.fullName
          );
        } else if (result.id) {
          // Old format - direct message object
          console.log(`Recording direct message ID: ${result.id}`);
          recordConversation(
              message.author.id,
              message.channel.id,
              result.id,
              personality.fullName
          );
        } else {
          console.warn(`Unexpected result format, cannot record conversation: ${JSON.stringify(result)}`);
        }
      } else {
        console.warn('No result returned from webhook, cannot record conversation');
      }
    } catch (error) {
      // Clear typing indicator if there's an error
      clearInterval(typingInterval);
      throw error; // Re-throw to be handled by outer catch
    }
  } catch (error) {
    console.error('Error in personality interaction:', error);

    // Send error message to user
    message.reply('Sorry, I encountered an error while processing your message.').catch(e => {
      console.error('Could not send error reply:', e);
    });
  }
}

module.exports = { initBot, client };