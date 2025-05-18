const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getAiResponse, isErrorResponse, registerProblematicPersonality, 
  knownProblematicPersonalities, runtimeProblematicPersonalities } = require('./aiService');
const webhookManager = require('./webhookManager');
const { getPersonalityByAlias, getPersonality, registerPersonality } = require('./personalityManager');
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

// CRITICAL: Patch the Discord.js client to filter out error messages
// This intercepts webhook messages containing error patterns before they're processed
const originalEmit = client.emit;

// Common error patterns that should be blocked
const ERROR_PATTERNS = [
  "I'm having trouble connecting",
  "ERROR_MESSAGE_PREFIX:",
  "trouble connecting to my brain",
  "technical issue",
  "Error ID:",
  "issue with my configuration",
  "issue with my response system",
  "momentary lapse", 
  "try again later",
  "HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY",
  "Please try again"
];

// Override the emit function to intercept webhook messages
client.emit = function(event, ...args) {
  // Only intercept messageCreate events from webhooks
  if (event === 'messageCreate') {
    const message = args[0];
    
    // Filter webhook messages with error content
    if (message.webhookId && message.content) {
      // Check if message contains any error patterns
      if (ERROR_PATTERNS.some(pattern => message.content.includes(pattern))) {
        // Try to delete the message if possible (silent fail)
        if (message.deletable) {
          message.delete().catch(() => {});
        }
        
        // Block this event from being processed
        return false;
      }
    }
  }
  
  // For all other events, process normally
  return originalEmit.apply(this, [event, ...args]);
};

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
    
    // Start a periodic queue cleaner to check for and remove any error messages
    // This is a very aggressive approach to ensure no error messages appear
    startQueueCleaner(client);
  });

  // Handle errors
  client.on('error', error => {
    console.error('Discord client error:', error);
  });
  
  // Track all webhooks created by us to prevent filtering our own messages
  const ownWebhookIds = new Set();
  
  // Message handling
  client.on('messageCreate', async message => {
    // Only ignore messages from bots that aren't our webhooks
    if (message.author.bot) {
      if (message.webhookId) {
        // Log webhook ID for debugging
        console.log(`[Bot] Received message from webhook: ${message.webhookId}, content: ${message.content.substring(0, 20)}...`);
        
        // HARD FILTER: Ignore ANY message with error content
        // This is a very strict filter to ensure we don't process ANY error messages
        if (message.content && (
            message.content.includes("I'm having trouble connecting") ||
            message.content.includes("ERROR_MESSAGE_PREFIX:") ||
            message.content.includes("trouble connecting to my brain") ||
            message.content.includes("technical issue") ||
            message.content.includes("Error ID:") ||
            message.content.startsWith("I'm experiencing") ||
            message.content.includes("HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY") ||
            message.content.includes("issue with my configuration") ||
            message.content.includes("issue with my response system") ||
            message.content.includes("momentary lapse") ||
            message.content.includes("try again later") ||
            message.content.includes("connection") && message.content.includes("unstable") ||
            message.content.includes("unable to formulate") ||
            message.content.includes("Please try again")
          )) {
          console.log(`[Bot] Blocking error message: ${message.webhookId}`);
          console.log(`[Bot] Message content matches error pattern: ${message.content.substring(0, 50)}...`);
          return;  // CRITICAL: Completely ignore this message
        }
        
        // Check if the webhook ID is one created by us
        const isOwnWebhook = message.author && 
                           message.author.username && 
                           typeof message.author.username === 'string' &&
                           message.content;
        
        if (isOwnWebhook) {
          // Don't return - process these messages normally
          console.log(`[Bot] Processing own webhook message from: ${message.author.username}`);
        } else {
          // This is not our webhook, ignore it
          console.log(`[Bot] Ignoring webhook message - not from our system: ${message.webhookId}`);
          return;
        }
      } else {
        // This is a normal bot, not a webhook, so ignore it
        console.log(`[Bot] Ignoring non-webhook bot message from: ${message.author.tag}`);
        return;
      }
    }
    

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
          
          // Log webhook details for debugging
          if (referencedMessage.author && referencedMessage.author.bot) {
            console.log(`[Reply Handler] Referenced message is from bot: ${JSON.stringify({
              username: referencedMessage.author.username,
              id: referencedMessage.author.id,
              webhookId: referencedMessage.webhookId
            })}`);
          }
          
          const personalityName = getPersonalityFromMessage(referencedMessage.id, { webhookUsername });
          console.log(`[Reply Handler] Personality lookup result: ${personalityName || 'null'}`);
          
          if (personalityName) {
            console.log(`[Reply Handler] Found personality name: ${personalityName}, looking up personality details`);
            
            // First try to get personality directly as it could be a full name
            let personality = getPersonality(personalityName);
            
            // If not found as direct name, try it as an alias
            if (!personality) {
                personality = getPersonalityByAlias(personalityName);
            }
            
            console.log(`[Reply Handler] Personality lookup result: ${personality ? personality.fullName : 'null'}`);
            
            if (personality) {
              // Process the message with this personality
              console.log(`[Reply Handler] Processing reply with personality: ${personality.fullName}`);
              await handlePersonalityInteraction(message, personality);
              return;
            } else {
              console.log(`[Reply Handler] No personality data found for name/alias: ${personalityName}`);
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
    try {
      // Updated regex to match word characters AND hyphens, allowing names like "ha-shem"
      const mentionMatch = message.content ? message.content.match(/@([\w-]+)/i) : null;
      if (mentionMatch && mentionMatch[1]) {
        const mentionName = mentionMatch[1];
        console.log(`[Mention Handler] Found @mention: ${mentionName}, looking up personality`);
        
        // First try to get personality directly by full name
        let personality = getPersonality(mentionName);
        
        // If not found as direct name, try it as an alias
        if (!personality) {
            personality = getPersonalityByAlias(mentionName);
        }
        
        console.log(`[Mention Handler] Personality lookup result: ${personality ? personality.fullName : 'null'}`);
        
        if (personality) {
          // Process the message with this personality
          await handlePersonalityInteraction(message, personality);
          return;
        }
      }
    } catch (error) {
      console.error(`[Mention Handler] Error processing mention:`, error);
    }

    // Check for active conversation
    const activePersonalityName = getActivePersonality(message.author.id, message.channel.id);
    if (activePersonalityName) {
      console.log(`[Active Conv Handler] Found active conversation with: ${activePersonalityName}`);
      
      // First try to get personality directly by full name
      let personality = getPersonality(activePersonalityName);
      
      // If not found as direct name, try it as an alias
      if (!personality) {
          personality = getPersonalityByAlias(activePersonalityName);
      }
      
      console.log(`[Active Conv Handler] Personality lookup result: ${personality ? personality.fullName : 'null'}`);

      if (personality) {
        // Process the message with this personality
        await handlePersonalityInteraction(message, personality);
        return;
      }
    }

    // Check for activated channel personality
    const activatedPersonalityName = getActivatedPersonality(message.channel.id);
    if (activatedPersonalityName) {
      console.log(`[Channel Activation Handler] Found activated personality in channel: ${activatedPersonalityName}`);
      
      // First try to get personality directly by full name
      let personality = getPersonality(activatedPersonalityName);
      
      // If not found as direct name, try it as an alias
      if (!personality) {
          personality = getPersonalityByAlias(activatedPersonalityName);
      }
      
      console.log(`[Channel Activation Handler] Personality lookup result: ${personality ? personality.fullName : 'null'}`);

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

// Simple map to track active requests and prevent duplicates
const activeRequests = new Map();

/**
 * Handle interaction with a personality
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality data
 */
async function handlePersonalityInteraction(message, personality) {
  // Minimize console logging during personality interaction
  const originalConsoleLog = console.log;
  const originalConsoleDebug = console.debug;
  console.debug = () => {};
  console.log = (msg, ...args) => {
    // Only log critical errors
    if (typeof msg === 'string' && msg.includes('Error')) {
      originalConsoleLog(msg, ...args);
    }
  };
  try {
    // Create a unique key for this user+channel+personality combination
    const requestKey = `${message.author.id}-${message.channel.id}-${personality.fullName}`;
    
    // Don't process duplicate requests
    if (activeRequests.has(requestKey)) {
      return;
    }
    
    // Mark this request as active with timestamp
    activeRequests.set(requestKey, Date.now());
    
    // Show typing indicator
    message.channel.sendTyping();
    
    // Keep typing indicator active for long-running requests
    const typingInterval = setInterval(() => {
      message.channel.sendTyping().catch(() => {});
    }, 9000);
    
    try {
      // Get the AI response from the service
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
      
      // Check for special marker that tells us to completely ignore this response
      if (aiResponse === "HARD_BLOCKED_RESPONSE_DO_NOT_DISPLAY") {
        return; // Exit without sending ANY message
      }
      
      // Add a small delay before sending any webhook message
      // This helps prevent the race condition between error messages and real responses
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Minimize console output for webhook operations
      const originalConsoleLog = console.log;
      console.log = () => {}; // Temporarily disable all logging
      
      // Send response and record conversation
      const result = await webhookManager.sendWebhookMessage(
          message.channel,
          aiResponse,
          personality
      );
      
      // Restore logging
      console.log = originalConsoleLog;
      
      // Clean up active request tracking
      activeRequests.delete(`${message.author.id}-${message.channel.id}-${personality.fullName}`);
    
      // Record this conversation with all message IDs
      if (result) {
        // Check if it's the new format with messageIds array or old format
        if (result.messageIds && result.messageIds.length > 0) {
          // New format - array of message IDs
          recordConversation(
              message.author.id,
              message.channel.id,
              result.messageIds,
              personality.fullName
          );
        } else if (result.message && result.message.id) {
          // New format - single message
          recordConversation(
              message.author.id,
              message.channel.id,
              result.message.id,
              personality.fullName
          );
        } else if (result.id) {
          // Old format - direct message object
          recordConversation(
              message.author.id,
              message.channel.id,
              result.id,
              personality.fullName
          );
        }
      }
    } catch (error) {
      // Clear typing indicator if there's an error
      clearInterval(typingInterval);
      
      // Clean up active request tracking
      const interactionKey = `${message.author.id}-${message.channel.id}-${personality.fullName}`;
      if (activeRequests.has(interactionKey)) {
        activeRequests.delete(interactionKey);
      }
      
      throw error; // Re-throw to be handled by outer catch
    } finally {
      console.log = originalConsoleLog; // Restore logging
    }
  } catch (error) {
    console.error('Error in personality interaction:', error.message);

    // Clean up active request tracking if not done already
    const interactionKey = `${message.author.id}-${message.channel.id}-${personality.fullName}`;
    if (activeRequests.has(interactionKey)) {
      activeRequests.delete(interactionKey);
    }

    // Send error message to user
    message.reply('Sorry, I encountered an error while processing your message.').catch(() => {});
  } finally {
    // Restore console functions
    console.log = originalConsoleLog;
    console.debug = originalConsoleDebug;
  }
}

/**
 * Start a periodic queue cleaner to check for and remove any error messages
 * This is an aggressive approach to catch any error messages that slip through
 * other mechanisms
 * @param {Object} client - Discord.js client instance
 */
function startQueueCleaner(client) {
  // Track channels we've attempted but don't have access to
  const inaccessibleChannels = new Set();
  
  // Track the last cleaned time for each channel to avoid constant cleaning
  const lastCleanedTime = new Map();
  
  // Store channels where we've found recent activity
  const activeChannels = new Set();

  // Check for error messages periodically
  setInterval(async () => {
    // Disable console output during queue cleaning
    const originalConsoleLog = console.log;
    console.log = () => {}; // Temporarily disable logging
    try {
      // Get all channels the bot has access to, excluding already identified inaccessible ones
      const channels = Array.from(client.channels.cache.values())
        .filter(channel => !inaccessibleChannels.has(channel.id));
      
      // Only process text channels with proper permissions
      const textChannels = channels.filter(channel => 
        channel.isTextBased() && 
        !channel.isDMBased() && 
        (
          // Skip permission check for DM channels
          channel.isDMBased() || 
          // For guild channels, verify we have the necessary permissions
          (channel.guild && 
           channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ViewChannel) &&
           channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ReadMessageHistory) &&
           channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages))
        )
      );
      
      // Prioritize channels with recent activity
      const channelsToCheck = [...activeChannels]
        .filter(id => {
          const channel = client.channels.cache.get(id);
          return channel && textChannels.includes(channel);
        })
        .map(id => client.channels.cache.get(id))
        .concat(textChannels.filter(channel => !activeChannels.has(channel.id)));
      
      // If we have too many channels, just check a subset to avoid rate limits
      const channelsToProcess = channelsToCheck.slice(0, 10);
      
      // No logging needed here
      
      for (const channel of channelsToProcess) {
        try {
          // Skip if we've checked this channel very recently (less than 5 seconds ago)
          const lastCleaned = lastCleanedTime.get(channel.id) || 0;
          if (Date.now() - lastCleaned < 5000) {
            continue;
          }
          
          // Fetch only the most recent messages
          const messages = await channel.messages.fetch({ limit: 5 });
          
          // Update active channels based on recent messages
          if (messages.size > 0) {
            activeChannels.add(channel.id);
          }
          
          // Track that we've checked this channel
          lastCleanedTime.set(channel.id, Date.now());
          
          // Filter for webhook messages that might be errors, and only from our webhooks
          const webhookMessages = messages.filter(msg => 
            msg.webhookId && 
            msg.author?.username && // Must have a username
            msg.content && (
              msg.content.includes("I'm having trouble connecting") ||
              msg.content.includes("ERROR_MESSAGE_PREFIX:") ||
              msg.content.includes("trouble connecting to my brain") ||
              msg.content.includes("technical issue") ||
              msg.content.includes("Error ID:") ||
              msg.content.includes("issue with my configuration") ||
              msg.content.includes("issue with my response system") ||
              msg.content.includes("momentary lapse") ||
              msg.content.includes("try again later") ||
              msg.content.includes("unable to formulate") ||
              msg.content.includes("Please try again") ||
              (msg.content.includes("connection") && msg.content.includes("unstable"))
            )
          );
          
          // Delete any found error messages
          for (const errorMsg of webhookMessages.values()) {
            if (errorMsg.deletable) {
              console.log(`[QueueCleaner] CRITICAL: Deleting error message in channel ${channel.name || channel.id} from ${errorMsg.author?.username}: ${errorMsg.content.substring(0, 30)}...`);
              try {
                await errorMsg.delete();
                console.log(`[QueueCleaner] Successfully deleted error message`);
              } catch (deleteError) {
                console.error(`[QueueCleaner] Failed to delete message:`, deleteError.message);
              }
            }
          }
        } catch (channelError) {
          // Mark this channel as inaccessible to avoid future attempts
          if (channelError.message.includes('Missing Access') || 
              channelError.message.includes('Missing Permissions')) {
            inaccessibleChannels.add(channel.id);
            console.log(`[QueueCleaner] Marked channel ${channel.id} as inaccessible due to permissions`);
          } else {
            // Log other errors but don't mark the channel as inaccessible
            console.error(`[QueueCleaner] Error processing channel ${channel.id}:`, channelError.message);
          }
        }
      }
      
      // Clean up old entries once per hour
      if (Math.random() < 0.01) { // ~1% chance each run
        console.log(`[QueueCleaner] Performing maintenance cleanup`);
        
        // Clean up lastCleanedTime for channels not seen in a while
        const now = Date.now();
        for (const [channelId, timestamp] of lastCleanedTime.entries()) {
          if (now - timestamp > 60 * 60 * 1000) { // 1 hour
            lastCleanedTime.delete(channelId);
          }
        }
        
        // Reset active channels list occasionally to adapt to changing activity
        if (Math.random() < 0.1) { // 10% chance during maintenance
          console.log(`[QueueCleaner] Resetting active channels list`);
          activeChannels.clear();
        }
      }
    } catch (error) {
      // Silently fail
    } finally {
      // Restore console output
      console.log = originalConsoleLog;
    }
  }, 7000); // Check every 7 seconds
}

module.exports = { initBot, client };