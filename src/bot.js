const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getAiResponse } = require('./aiService');
const { sendWebhookMessage } = require('./webhookManager');
const { getPersonalityByAlias, registerPersonality } = require('./personalityManager');
const { recordConversation, getActivePersonality, getPersonalityFromMessage, clearConversation } = require('./conversationManager');

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
  client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setActivity('with multiple personalities', { type: 'PLAYING' });
    
    // Register some example personalities for testing
    registerPersonality('SYSTEM', 'example-personality', {
      displayName: 'Example',
      avatarUrl: 'https://i.imgur.com/your-example-avatar.png',
      description: 'An example personality for testing'
    });
  });

  // Handle errors
  client.on('error', error => {
    console.error('Discord client error:', error);
  });
  
  // Message handling
  client.on('messageCreate', async message => {
    // Ignore messages from bots to prevent loops
    if (message.author.bot) return;
    
    // Command handling
    if (message.content.startsWith(process.env.PREFIX)) {
      const args = message.content.slice(process.env.PREFIX.length).trim().split(/ +/);
      const command = args.shift().toLowerCase();
      
      // Handle commands (we'll implement these later)
      if (command === 'ping') {
        message.reply('Pong! Tzurot is operational.');
      }
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
    // Delete the original message? (Optional, as you mentioned you want to keep it)
    // await message.delete().catch(e => console.error('Could not delete message:', e));
    
    // Get AI response
    const aiResponse = await getAiResponse(personality.fullName, message.content);
    
    // Send the response via webhook
    const sentMessage = await sendWebhookMessage(
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