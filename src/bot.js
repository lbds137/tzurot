const { Client, GatewayIntentBits, Partials } = require('discord.js');
const { getAiResponse } = require('./aiService');
const webhookManager = require('./webhookManager');
const { getStandardizedUsername } = require('./webhookManager');
const { getPersonalityByAlias, getPersonality } = require('./personalityManager');
const { PermissionFlagsBits } = require('discord.js');
const {
  recordConversation,
  getActivePersonality,
  getPersonalityFromMessage,
  getActivatedPersonality,
} = require('./conversationManager');
const { processCommand } = require('./commands');
const { botPrefix } = require('../config');
const logger = require('./logger');
const { MARKERS, ERROR_MESSAGES } = require('./constants');
const { messageTracker } = require('./messageTracker');

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

// CRITICAL: Patch the Discord.js client to filter out error messages
// This intercepts webhook messages containing error patterns before they're processed
const originalEmit = client.emit;

// Override the emit function to intercept webhook messages
client.emit = function (event, ...args) {
  // Only intercept messageCreate events from webhooks
  if (event === 'messageCreate') {
    const message = args[0];

    // Filter webhook messages with error content
    if (message.webhookId && message.content) {
      // Check if message contains any error patterns
      if (ERROR_MESSAGES.some(pattern => message.content.includes(pattern))) {
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
    startQueueCleaner(client);
  });

  // Handle errors
  client.on('error', error => {
    logger.error('Discord client error:', error);
  });

  // Message handling
  client.on('messageCreate', async message => {
    // Check for replies to DM-formatted bot messages
    if (message.channel.isDMBased() && !message.author.bot && message.reference) {
      try {
        // Attempt to fetch the message being replied to
        const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
        
        // Check if it's our bot's message
        if (repliedToMessage.author.id === client.user.id) {
          const content = repliedToMessage.content;
          // Pattern to match "**PersonalityName:** message content" 
          // or "**PersonalityName | Suffix:** message content"
          // This works for both the first chunk and subsequent chunks
          const dmFormatMatch = content.match(/^\*\*([^:]+):\*\* /);
          
          // Even if we don't find a direct match, we should check if this is part of a multi-chunk message
          // where the user replied to a non-first chunk
          let isMultiChunkReply = false;
          let displayName = null;
          
          if (dmFormatMatch) {
            // Direct match - this is likely the first chunk or a single-chunk message
            displayName = dmFormatMatch[1];
            if (displayName && displayName.includes(' | ')) {
              // Extract just the personality name from "Name | Suffix" format
              displayName = displayName.split(' | ')[0];
              logger.info(`[Bot] Extracted base name from formatted DM message: ${displayName}`);
            }
            logger.info(`[Bot] Detected reply to formatted DM message for personality: ${displayName}`);
          } else {
            // No direct match - could be a continuation chunk that doesn't have the prefix
            // Look for the personality name in previous messages
            logger.info(`[Bot] Checking if this is a reply to a multi-chunk message without personality prefix`);
            
            try {
              // Get recent messages in this channel to find the personality name
              const recentMessages = await message.channel.messages.fetch({ limit: 10 });
              
              // Filter for bot messages that came before the replied-to message
              const earlierBotMessages = recentMessages.filter(msg => 
                msg.author.id === client.user.id && 
                new Date(msg.createdTimestamp) <= new Date(repliedToMessage.createdTimestamp) &&
                msg.id !== repliedToMessage.id
              ).sort((a, b) => b.createdTimestamp - a.createdTimestamp); // Sort by newest first
              
              // Look for a message with a personality prefix among these
              for (const earlierMsg of earlierBotMessages.values()) {
                const prefixMatch = earlierMsg.content.match(/^\*\*([^:]+):\*\* /);
                if (prefixMatch) {
                  const potentialName = prefixMatch[1];
                  logger.info(`[Bot] Found potential personality name in earlier message: ${potentialName}`);
                  
                  // Check if the replied-to message was sent within a reasonable time
                  // (typically within a minute or two for multi-chunk messages)
                  const timeDiff = repliedToMessage.createdTimestamp - earlierMsg.createdTimestamp;
                  if (timeDiff <= 120000) { // Within 2 minutes
                    displayName = potentialName;
                    if (displayName.includes(' | ')) {
                      displayName = displayName.split(' | ')[0];
                    }
                    isMultiChunkReply = true;
                    logger.info(`[Bot] Identified as a reply to chunk of multi-part message from: ${displayName}`);
                    break;
                  }
                }
              }
            } catch (lookupError) {
              logger.error(`[Bot] Error looking up previous messages: ${lookupError.message}`);
            }
          }
          
          // If we found a display name (either directly or from an earlier message)
          if (displayName) {
            // Attempt to find the personality by display name
            const { getPersonalityByAlias, getPersonality } = require('./personalityManager');
            let personality = getPersonalityByAlias(message.author.id, displayName);
            
            // If not found by alias, try by the display name directly
            if (!personality) {
              // Get all personalities for this user
              const { listPersonalitiesForUser } = require('./personalityManager');
              // listPersonalitiesForUser only takes userId parameter
              const personalities = listPersonalitiesForUser(message.author.id);
              logger.info(`[Bot] Found ${personalities?.length || 0} personalities for user ${message.author.id}`);
              if (personalities?.length > 0) {
                logger.debug(`[Bot] First personality: ${JSON.stringify({
                  fullName: personalities[0].fullName,
                  displayName: personalities[0].displayName
                })}`);
              }
              
              // Find by display name match (in DMs we use plain display name without suffix)
              // listPersonalitiesForUser returns an array directly, not an object with a 'personalities' property
              // Use case-insensitive comparison for better matching
              const displayNameLower = displayName.toLowerCase();
              personality = personalities.find(p => 
                p.displayName?.toLowerCase() === displayNameLower || 
                p.displayName?.toLowerCase().startsWith(displayNameLower) || // Check if display name starts with the extracted name
                getStandardizedUsername(p).toLowerCase() === displayNameLower || 
                p.fullName?.split('-')[0] === displayNameLower // Check first part of full name
              );
              
              // Debug log the match result
              if (personality) {
                logger.info(`[Bot] Found matching personality: ${personality.fullName} (${personality.displayName})`);
                if (isMultiChunkReply) {
                  logger.info(`[Bot] This is a reply to a non-first chunk of a multi-part message`);
                }
              } else {
                logger.warn(`[Bot] No matching personality found for: ${displayName}`);
              }
            }
            
            if (personality) {
              // Handle this as a personality interaction
              await handlePersonalityInteraction(message, personality);
              return; // Skip further processing
            }
          } else {
            logger.debug(`[Bot] No personality name found in replied message: ${content.substring(0, 50)}`);
          }
        }
      } catch (error) {
        logger.error(`[Bot] Error handling DM reply: ${error.message}`);
        // Continue with normal message processing if there's an error
      }
    }
    
    // Only ignore messages from bots that aren't our webhooks
    if (message.author.bot) {
      // CRITICAL: More aggressive handling of our own bot's messages
      // We need to identify these by the bot's own client ID
      if (message.author.id === client.user.id) {
        // Check for duplicate bot message
        if (!messageTracker.track(message.id, 'bot-message')) {
          return; // Skip processing if message is already tracked
        }

        // Log detailed embed info for better debugging
        if (message.embeds && message.embeds.length > 0) {
          const embedInfo = message.embeds.map(embed => ({
            title: embed.title,
            description: embed.description?.substring(0, 50),
            fields:
              embed.fields?.map(f => ({
                name: f.name,
                value: f.value?.substring(0, 30) + (f.value?.length > 30 ? '...' : ''),
              })) || [],
            hasThumbnail: !!embed.thumbnail,
            thumbnailUrl:
              embed.thumbnail?.url?.substring(0, 50) +
              (embed.thumbnail?.url?.length > 50 ? '...' : ''),
          }));
          logger.debug(
            `Message ${message.id} has ${message.embeds.length} embeds - DETAILED INFO: ${JSON.stringify(embedInfo, null, 2)}`
          );

          // CRITICAL FIX: Detect INCOMPLETE Personality Added embeds
          // The first embed appears before we have the display name and avatar
          if (message.embeds[0].title === 'Personality Added') {
            // Check if this embed has incomplete information (missing display name or avatar)
            const isIncompleteEmbed =
              message.embeds[0].fields?.some(
                field =>
                  field.name === 'Display Name' &&
                  (field.value === 'Not set' ||
                    field.value.includes('-ba-et-') ||
                    field.value.includes('-zeevat-'))
              ) || !message.embeds[0].thumbnail; // No avatar/thumbnail

            if (isIncompleteEmbed) {
              logger.warn(
                `🚨 DETECTED INCOMPLETE EMBED: Found incomplete "Personality Added" embed - attempting to delete`
              );

              // Try to delete this embed to prevent confusion
              try {
                await message.delete();
                logger.info(`✅ Successfully deleted incomplete embed message ID ${message.id}`);
                return; // Skip further processing
              } catch (deleteError) {
                logger.error(`❌ Error deleting incomplete embed:`, deleteError);
                // Continue with normal handling if deletion fails
              }
            } else {
              logger.info(
                `✅ GOOD EMBED: This "Personality Added" embed appears to be complete with display name and avatar`
              );
            }
          }

          // Update global embed timestamp regardless of deletion
          // This helps us track when embeds were sent
          global.lastEmbedTime = Date.now();
        }

        logger.debug(`This is my own message with ID ${message.id} - returning immediately`);
        return; // Always ignore our own bot messages completely
      }

      if (message.webhookId) {
        // Log webhook ID for debugging
        logger.debug(
          `Received message from webhook: ${message.webhookId}, content: ${message.content.substring(0, 20)}...`
        );

        // HARD FILTER: Ignore ANY message with error content
        // This is a very strict filter to ensure we don't process ANY error messages
        if (message.content && ERROR_MESSAGES.some(pattern => message.content.includes(pattern))) {
          logger.warn(`Blocking error message: ${message.webhookId}`);
          logger.warn(`Message content matches error pattern: ${message.content.substring(0, 50)}...`);
          return; // CRITICAL: Completely ignore this message
        }

        // Check if the webhook ID is one created by us
        const isOwnWebhook =
          message.author &&
          message.author.username &&
          typeof message.author.username === 'string' &&
          message.content;

        if (isOwnWebhook) {
          // Check if there's an activated personality in this channel
          const activatedPersonality = getActivatedPersonality(message.channel.id);
          
          if (activatedPersonality) {
            // This is a webhook from one of our activated personalities - ignore it to prevent infinite loops
            logger.debug(`Ignoring own webhook message from activated personality: ${message.author.username} in channel ${message.channel.id}`);
            return;
          }
          
          // For non-activated channels, process webhook messages normally
          logger.debug(`Processing own webhook message from: ${message.author.username}`);
        } else {
          // This is not our webhook, ignore it
          logger.debug(`Ignoring webhook message - not from our system: ${message.webhookId}`);
          return;
        }
      } else {
        // This is a normal bot, not a webhook or our own bot message
        logger.debug(`Ignoring non-webhook bot message from: ${message.author.tag}`);
        return;
      }
    }

    // Command handling - ensure the prefix is followed by a space
    if (message.content.startsWith(botPrefix + ' ') || message.content === botPrefix) {
      logger.info(`Command detected from user ${message.author.tag} with ID ${message.id}`);
      logger.debug(`Message content: ${message.content}`);

      // Check for duplicate message processing
      if (!messageTracker.track(message.id, 'command')) {
        logger.warn(`Prevented duplicate command processing for message ${message.id}`);
        return;
      }

      // Remove prefix and trim leading space
      const content = message.content.startsWith(botPrefix + ' ')
        ? message.content.slice(botPrefix.length + 1)
        : '';

      const args = content.trim().split(/ +/);
      const command = args.shift()?.toLowerCase() || 'help'; // Default to help if no command

      logger.debug(`Calling processCommand with ID ${message.id}, command=${command}, args=${args.join(',')}`);

      try {
        // Process the command
        const result = await processCommand(message, command, args);
        logger.debug(`processCommand completed with result: ${result ? 'success' : 'null/undefined'}`);
      } catch (error) {
        logger.error(`Error in processCommand:`, error);
      }
      return;
    }

    // Reply-based conversation continuation
    if (message.reference) {
      logger.debug(`Detected reply from ${message.author.tag} to message ID: ${message.reference.messageId}`);
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);
        logger.debug(`Fetched referenced message. Webhook ID: ${referencedMessage.webhookId || 'none'}`);

        // Check if the referenced message was from one of our personalities
        logger.debug(`Reply detected to message ${referencedMessage.id} with webhookId: ${referencedMessage.webhookId || 'none'}`);

        if (referencedMessage.webhookId) {
          logger.debug(`Looking up personality for message ID: ${referencedMessage.id}`);
          // Pass the webhook username as a fallback for finding personalities
          const webhookUsername = referencedMessage.author
            ? referencedMessage.author.username
            : null;
          logger.debug(`Webhook username: ${webhookUsername || 'unknown'}`);

          // Log webhook details for debugging
          if (referencedMessage.author && referencedMessage.author.bot) {
            logger.debug(
              `Referenced message is from bot: ${JSON.stringify({
                username: referencedMessage.author.username,
                id: referencedMessage.author.id,
                webhookId: referencedMessage.webhookId,
              })}`
            );
          }

          const personalityName = getPersonalityFromMessage(referencedMessage.id, {
            webhookUsername,
          });
          logger.debug(`Personality lookup result: ${personalityName || 'null'}`);

          if (personalityName) {
            logger.debug(`Found personality name: ${personalityName}, looking up personality details`);

            // First try to get personality directly as it could be a full name
            let personality = getPersonality(personalityName);

            // If not found as direct name, try it as an alias
            if (!personality) {
              personality = getPersonalityByAlias(personalityName);
            }

            logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

            if (personality) {
              // Process the message with this personality
              logger.debug(`Processing reply with personality: ${personality.fullName} from user ${message.author.id}`);
              // Since this is a reply, not a direct @mention, pass null for triggeringMention
              // IMPORTANT: Use message.author.id to ensure the replying user's ID is used
              // This ensures authentication context is preserved correctly
              await handlePersonalityInteraction(message, personality, null);
              return;
            } else {
              logger.debug(`No personality data found for name/alias: ${personalityName}`);
            }
          } else {
            logger.debug(`No personality found for message ID: ${referencedMessage.id}`);
          }
        } else {
          logger.debug(`Referenced message is not from a webhook: ${referencedMessage.author?.tag || 'unknown author'}`);
        }
      } catch (error) {
        logger.error('Error handling message reference:', error);
      }
    }

    // @mention personality triggering
    try {
      // IMPROVEMENT: Check for both standard @mentions and multi-word @mentions
      // And prioritize the longest match to handle cases like @bambi vs @bambi prime

      // We'll store all potential matches and their personalities in this array
      const potentialMatches = [];

      // First gather standard @mentions (without spaces)
      const standardMentionMatch = message.content ? message.content.match(/@([\w-]+)/i) : null;

      if (standardMentionMatch && standardMentionMatch[1]) {
        const mentionName = standardMentionMatch[1];
        logger.debug(`Found standard @mention: ${mentionName}, checking if it's a valid personality`);

        // Check if this is a valid personality (directly or as an alias)
        let personality = getPersonality(mentionName);
        if (!personality) {
          personality = getPersonalityByAlias(mentionName);
        }

        if (personality) {
          logger.debug(`Found standard @mention personality: ${mentionName} -> ${personality.fullName}`);
          potentialMatches.push({
            mentionText: mentionName,
            personality: personality,
            wordCount: 1, // Single word
          });
        }
      }

      // Now check for mentions with spaces - whether or not we found standard mentions
      if (message.content && message.content.includes('@')) {
        // Improved regex to match multi-word mentions
        // This captures @word1 word2 word3 patterns more precisely
        // Limited to a maximum of 4 words to avoid capturing too much text
        const mentionWithSpacesRegex = /@([^\s@\n]+(?:\s+[^\s@\n.,!?;:()"']+){0,4})/g;
        let spacedMentionMatch;
        const mentionsWithSpaces = [];

        // Find all potential @mentions with spaces
        while ((spacedMentionMatch = mentionWithSpacesRegex.exec(message.content)) !== null) {
          if (spacedMentionMatch[1] && spacedMentionMatch[1].trim()) {
            mentionsWithSpaces.push(spacedMentionMatch[1].trim());
          }
        }

        // Try each potential multi-word mention
        for (const rawMentionText of mentionsWithSpaces) {
          logger.debug(`Processing potential multi-word @mention: "${rawMentionText}"`);

          // Skip if this is just a single word (already handled by standard regex)
          if (!rawMentionText.includes(' ')) {
            logger.debug(`Skipping "${rawMentionText}" - single word, already checked`);
            continue;
          }

          // Split the raw text into words
          const words = rawMentionText.split(/\s+/);

          // IMPROVEMENT: Try combinations from longest to shortest to prioritize the most specific match
          // For example, match "@bambi prime" before "@bambi" when user types "@bambi prime hi"

          // Determine maximum number of words to try (up to 4 or the actual number of words, whichever is less)
          const maxWords = Math.min(4, words.length);

          // Create array of combinations from longest to shortest
          const combinations = [];
          for (let i = maxWords; i >= 2; i--) {
            combinations.push(words.slice(0, i).join(' '));
          }

          // Remove any empty combinations (shouldn't happen, but just in case)
          const validCombinations = combinations.filter(c => c.trim() !== '');

          logger.debug(`Trying word combinations in order: ${JSON.stringify(validCombinations)}`);

          // Try each combination, from longest (most specific) to shortest
          for (const mentionText of validCombinations) {
            logger.debug(`Trying mention combination: "${mentionText}"`);

            // Try as an alias
            const personality = getPersonalityByAlias(mentionText);

            if (personality) {
              // Count the number of words in this match
              const wordCount = mentionText.split(/\s+/).length;

              logger.info(`Found multi-word @mention: "${mentionText}" -> ${personality.fullName} (${wordCount} words)`);

              // Add to potential matches
              potentialMatches.push({
                mentionText: mentionText,
                personality: personality,
                wordCount: wordCount,
              });

              // We don't break here - we want to find all possible matches and pick the longest
            }
          }
        }

        // After collecting all potential matches, sort by word count (descending)
        // This ensures we prioritize longer matches (e.g., "bambi prime" over "bambi")
        potentialMatches.sort((a, b) => b.wordCount - a.wordCount);

        // If we found any matches, use the one with the most words (longest match)
        if (potentialMatches.length > 0) {
          const bestMatch = potentialMatches[0];
          logger.info(`Selected best @mention match: "${bestMatch.mentionText}" -> ${bestMatch.personality.fullName} (${bestMatch.wordCount} words)`);

          // If there were multiple matches, log them for debugging
          if (potentialMatches.length > 1) {
            logger.debug(`Chose the longest match from ${potentialMatches.length} options:`);
            potentialMatches.forEach(match => {
              logger.debug(`- ${match.mentionText} (${match.wordCount} words) -> ${match.personality.fullName}`);
            });
          }

          // Handle the interaction with the best matching personality
          await handlePersonalityInteraction(message, bestMatch.personality, bestMatch.mentionText);
          return;
        }
      }
    } catch (error) {
      logger.error(`Error processing mention:`, error);
    }

    // Check for active conversation
    const activePersonalityName = getActivePersonality(message.author.id, message.channel.id);
    if (activePersonalityName) {
      logger.debug(`Found active conversation with: ${activePersonalityName}`);

      // First try to get personality directly by full name
      let personality = getPersonality(activePersonalityName);

      // If not found as direct name, try it as an alias
      if (!personality) {
        personality = getPersonalityByAlias(activePersonalityName);
      }

      logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

      if (personality) {
        // Process the message with this personality
        // Since this is not a direct @mention, pass null for triggeringMention
        await handlePersonalityInteraction(message, personality, null);
        return;
      }
    }

    // Check for activated channel personality
    const activatedPersonalityName = getActivatedPersonality(message.channel.id);
    if (activatedPersonalityName) {
      logger.debug(`Found activated personality in channel: ${activatedPersonalityName}`);
      
      // Check if this message is a command - activated personalities should ignore commands
      // Modified check to ensure we catch any command format that would be processed by the processCommand function
      const isCommand = message.content.startsWith(botPrefix);
      
      if (isCommand) {
        logger.info(`Activated personality ignoring command message: ${message.content}`);
      } else {
        // Not a command, continue with personality response
        
        // First try to get personality directly by full name
        let personality = getPersonality(activatedPersonalityName);

        // If not found as direct name, try it as an alias
        if (!personality) {
          personality = getPersonalityByAlias(activatedPersonalityName);
        }

        logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

        if (personality) {
          // Process the message with this personality
          // Since this is not a direct @mention, pass null for triggeringMention
          await handlePersonalityInteraction(message, personality, null);
        }
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
 * Tracks requests to prevent duplicates
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} personalityName - Personality name
 * @returns {string} Request key
 */
function trackRequest(userId, channelId, personalityName) {
  const requestKey = `${userId}-${channelId}-${personalityName}`;

  // Don't process duplicate requests
  if (activeRequests.has(requestKey)) {
    return false;
  }

  // Mark this request as active with timestamp
  activeRequests.set(requestKey, Date.now());
  return requestKey;
}

/**
 * Manages typing indicator for long-running requests
 * @param {Object} channel - Discord channel object
 * @returns {NodeJS.Timeout} Interval ID for clearing later
 */
function startTypingIndicator(channel) {
  // Show initial typing indicator
  channel.sendTyping();

  // Keep typing indicator active for long-running requests
  return setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 9000);
}

/**
 * Records conversation data based on the response format
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {Object} result - Response result from webhook
 * @param {string} personalityName - Personality name
 */
function recordConversationData(userId, channelId, result, personalityName) {
  if (!result) return;

  // Check if it's the new format with messageIds array or old format
  if (result.messageIds && result.messageIds.length > 0) {
    // New format - array of message IDs
    recordConversation(userId, channelId, result.messageIds, personalityName);
  } else if (result.message && result.message.id) {
    // New format - single message
    recordConversation(userId, channelId, result.message.id, personalityName);
  } else if (result.id) {
    // Old format - direct message object
    recordConversation(userId, channelId, result.id, personalityName);
  }
}

/**
 * Handle interaction with a personality
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality data
 * @param {string} [triggeringMention=null] - The specific @mention text that triggered this interaction
 */
async function handlePersonalityInteraction(message, personality, triggeringMention = null) {
  let typingInterval;

  try {
    // Track the request to prevent duplicates
    const requestKey = trackRequest(message.author.id, message.channel.id, personality.fullName);
    if (!requestKey) {
      return; // Don't process duplicate requests
    }

    // Show typing indicator
    typingInterval = startTypingIndicator(message.channel);

    try {
      // Check for image/audio attachments or URLs in text
      let messageContent = message.content;
      let imageUrl = null;
      let audioUrl = null;
      let hasFoundImage = false;
      let hasFoundAudio = false;

      // Don't remove @mentions from the message
      if (message.content) {
        messageContent = message.content;

        // Regular expressions to match common image URLs
        const imageUrlRegex = /https?:\/\/\S+\.(jpg|jpeg|png|gif|webp)(\?\S*)?/i;
        const discordCdnRegex = /https?:\/\/cdn\.discordapp\.com\/\S+/i;

        // Regular expressions to match common audio URLs
        const audioUrlRegex = /https?:\/\/\S+\.(mp3|wav|ogg)(\?\S*)?/i;

        // First check for audio URLs (prioritize audio over images per API limitation)
        const audioMatch = messageContent.match(audioUrlRegex);

        if (audioMatch && audioMatch[0]) {
          audioUrl = audioMatch[0];
          logger.info(`[Bot] Found audio URL in message content: ${audioUrl}`);
          hasFoundAudio = true;

          // Remove the URL from the message content to avoid repetition
          messageContent = messageContent.replace(audioUrl, '').trim();
        } else {
          // If no audio URL was found, check for image URLs
          const imageMatch =
            messageContent.match(imageUrlRegex) || messageContent.match(discordCdnRegex);

          if (imageMatch && imageMatch[0]) {
            imageUrl = imageMatch[0];
            logger.info(`[Bot] Found image URL in message content: ${imageUrl}`);
            hasFoundImage = true;

            // Remove the URL from the message content to avoid repetition
            messageContent = messageContent.replace(imageUrl, '').trim();
          }
        }
      }

      // If we didn't find any media URL, check for attachments
      if (!hasFoundImage && !hasFoundAudio && message.attachments && message.attachments.size > 0) {
        logger.info(`[Bot] Message has ${message.attachments.size} attachments, checking for media`);

        // First check for audio attachments (prioritize audio over images per API limitation)
        const audioAttachments = message.attachments.filter(attachment => {
          // Check content type (if available)
          if (attachment.contentType && attachment.contentType.startsWith('audio/')) {
            return true;
          }

          // Check file extension as fallback
          const url = attachment.url || '';
          return url.endsWith('.mp3') || url.endsWith('.wav') || url.endsWith('.ogg');
        });

        if (audioAttachments.size > 0) {
          // Get the URL from the first audio attachment
          audioUrl = Array.from(audioAttachments.values())[0].url;
          hasFoundAudio = true;

          // If there are more audio files, log a warning
          if (audioAttachments.size > 1) {
            logger.warn(`[Bot] Ignoring ${audioAttachments.size - 1} additional audio files - API only supports one media per request`);
          }
        } else {
          // If no audio attachments were found, check for image attachments
          const imageAttachments = message.attachments.filter(
            attachment => attachment.contentType && attachment.contentType.startsWith('image/')
          );

          if (imageAttachments.size > 0) {
            // Get the URL from the first image attachment
            imageUrl = Array.from(imageAttachments.values())[0].url;
            hasFoundImage = true;

            // If there are more images, log a warning
            if (imageAttachments.size > 1) {
              logger.warn(`[Bot] Ignoring ${imageAttachments.size - 1} additional images - API only supports one media per request`);
            }
          }
        }
      }

      // If we found media (either via URL or attachment), create multimodal content
      if (hasFoundImage || hasFoundAudio) {
        // Create a multimodal content array
        const multimodalContent = [];

        // Add the text content if it exists
        if (messageContent) {
          multimodalContent.push({
            type: 'text',
            text: messageContent,
          });
        } else {
          // Default prompt based on media type
          if (hasFoundAudio) {
            multimodalContent.push({
              type: 'text',
              text: 'Please transcribe and respond to this audio message',
            });
          } else if (hasFoundImage) {
            multimodalContent.push({
              type: 'text',
              text: "What's in this image?",
            });
          }
        }

        // Add the media content - prioritize audio over image if both are present
        // (per API limitation: only one media type is processed, with audio taking precedence)
        if (hasFoundAudio) {
          logger.info(`[Bot] Processing audio with URL: ${audioUrl}`);
          multimodalContent.push({
            type: 'audio_url',
            audio_url: {
              url: audioUrl,
            },
          });
          logger.debug(`[Bot] Added audio to multimodal content: ${audioUrl}`);

          // If we also found an image, log that we're ignoring it due to API limitation
          if (hasFoundImage) {
            logger.warn(`[Bot] Ignoring image (${imageUrl}) - API only processes one media type per request, and audio takes precedence`);
          }
        } else if (hasFoundImage) {
          logger.info(`[Bot] Processing image with URL: ${imageUrl}`);
          multimodalContent.push({
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          });
          logger.debug(`[Bot] Added image to multimodal content: ${imageUrl}`);
        }

        // Replace the message content with the multimodal array
        messageContent = multimodalContent;
        logger.info(`[Bot] Created multimodal content with ${multimodalContent.length} items`);
      }

      // Check if this message is a reply to another message or contains a message link
      let referencedMessageContent = null;
      let referencedMessageAuthor = null;
      let isReferencedMessageFromBot = false;
      
      // First, handle direct replies
      if (message.reference && message.reference.messageId) {
        try {
          // Fetch the message being replied to
          const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);
          
          // Extract the content and author information
          if (repliedToMessage) {
            referencedMessageContent = repliedToMessage.content || '';
            referencedMessageAuthor = repliedToMessage.author?.username || 'another user';
            isReferencedMessageFromBot = repliedToMessage.author?.bot || false;
            
            // Check for media attachments in the referenced message
            if (repliedToMessage.attachments && repliedToMessage.attachments.size > 0) {
              const attachments = Array.from(repliedToMessage.attachments.values());
              
              // Check for image attachments
              const imageAttachment = attachments.find(
                attachment => attachment.contentType && attachment.contentType.startsWith('image/')
              );
              
              if (imageAttachment) {
                // Add image URL to the content 
                referencedMessageContent += `\n[Image: ${imageAttachment.url}]`;
                logger.info(`[Bot] Referenced message contains an image: ${imageAttachment.url}`);
              }
              
              // Check for audio attachments
              const audioAttachment = attachments.find(
                attachment => (attachment.contentType && attachment.contentType.startsWith('audio/')) ||
                attachment.url?.endsWith('.mp3') || 
                attachment.url?.endsWith('.wav') || 
                attachment.url?.endsWith('.ogg')
              );
              
              if (audioAttachment) {
                // Add audio URL to the content
                referencedMessageContent += `\n[Audio: ${audioAttachment.url}]`;
                logger.info(`[Bot] Referenced message contains audio: ${audioAttachment.url}`);
              }
            }
            
            logger.info(`[Bot] Found referenced message (reply) from ${referencedMessageAuthor}: "${referencedMessageContent.substring(0, 50)}${referencedMessageContent.length > 50 ? '...' : ''}"`);
          }
        } catch (error) {
          logger.error(`[Bot] Error fetching referenced message: ${error.message}`);
          // Continue without the referenced message if there's an error
        }
      } 
      // Next, check for message links in the content
      else if (typeof messageContent === 'string') {
        // Look for Discord message links in the format https://discord.com/channels/server_id/channel_id/message_id
        const messageLinkRegex = /https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)/;
        const messageLinkMatch = messageContent.match(messageLinkRegex);
        
        // If we have multiple links, only process the first one
        if (messageLinkMatch) {
          logger.info(`[Bot] Found message link in content: ${messageLinkMatch[0]}`);
          
          // Check if there are multiple links (log for info purposes)
          const allLinks = [...messageContent.matchAll(new RegExp(messageLinkRegex, 'g'))];
          if (allLinks.length > 1) {
            logger.info(`[Bot] Multiple message links found (${allLinks.length}), processing only the first one`);
          }
          
          try {
            // Extract channel and message IDs from the first link
            const linkedGuildId = messageLinkMatch[1];
            const linkedChannelId = messageLinkMatch[2];
            const linkedMessageId = messageLinkMatch[3];
            
            // Remove the message link from the content
            messageContent = messageContent.replace(messageLinkMatch[0], '').trim();
            
            // Try to get the channel
            const guild = client.guilds.cache.get(linkedGuildId);
            if (guild) {
              const linkedChannel = guild.channels.cache.get(linkedChannelId);
              if (linkedChannel && linkedChannel.isTextBased()) {
                // Fetch the message from the channel
                const linkedMessage = await linkedChannel.messages.fetch(linkedMessageId);
                
                if (linkedMessage) {
                  // Extract content and author information
                  referencedMessageContent = linkedMessage.content || '';
                  referencedMessageAuthor = linkedMessage.author?.username || 'another user';
                  isReferencedMessageFromBot = linkedMessage.author?.bot || false;
                  
                  // Check for media attachments in the linked message
                  if (linkedMessage.attachments && linkedMessage.attachments.size > 0) {
                    const attachments = Array.from(linkedMessage.attachments.values());
                    
                    // Check for image attachments
                    const imageAttachment = attachments.find(
                      attachment => attachment.contentType && attachment.contentType.startsWith('image/')
                    );
                    
                    if (imageAttachment) {
                      // Add image URL to the content
                      referencedMessageContent += `\n[Image: ${imageAttachment.url}]`;
                      logger.info(`[Bot] Linked message contains an image: ${imageAttachment.url}`);
                    }
                    
                    // Check for audio attachments
                    const audioAttachment = attachments.find(
                      attachment => (attachment.contentType && attachment.contentType.startsWith('audio/')) ||
                      attachment.url?.endsWith('.mp3') || 
                      attachment.url?.endsWith('.wav') || 
                      attachment.url?.endsWith('.ogg')
                    );
                    
                    if (audioAttachment) {
                      // Add audio URL to the content
                      referencedMessageContent += `\n[Audio: ${audioAttachment.url}]`;
                      logger.info(`[Bot] Linked message contains audio: ${audioAttachment.url}`);
                    }
                  }
                  
                  logger.info(`[Bot] Found referenced message (link) from ${referencedMessageAuthor}: "${referencedMessageContent.substring(0, 50)}${referencedMessageContent.length > 50 ? '...' : ''}"`);
                }
              }
            }
          } catch (error) {
            logger.error(`[Bot] Error fetching linked message: ${error.message}`);
            // Continue without the referenced message if there's an error
          }
        }
      }
      
      // If we found referenced content, modify how we send to the AI service
      let finalMessageContent;
      if (referencedMessageContent) {
        // Format as a complex object with the reference information
        finalMessageContent = {
          messageContent: messageContent, // Original message content (text or multimodal array)
          referencedMessage: {
            content: referencedMessageContent,
            author: referencedMessageAuthor,
            isFromBot: isReferencedMessageFromBot
          }
        };
      } else {
        // No reference, use the original content
        finalMessageContent = messageContent;
      }
      
      // Get the AI response from the service
      // Always use the message author's user ID for proper authentication
      // This ensures that when replying to a webhook, we use the replying user's auth token
      const userId = message.author?.id;
      logger.debug(`[Bot] Using user ID for authentication: ${userId || 'none'}`);
      
      const aiResponse = await getAiResponse(personality.fullName, finalMessageContent, {
        userId: userId,
        channelId: message.channel.id,
      });

      // Clear typing indicator interval
      clearInterval(typingInterval);
      typingInterval = null;

      // Check for special marker that tells us to completely ignore this response
      if (aiResponse === MARKERS.HARD_BLOCKED_RESPONSE) {
        return; // Necessary return to exit early when receiving blocked response
      }
      
      // Check for BOT_ERROR_MESSAGE marker - these should come from the bot, not the personality
      if (aiResponse && typeof aiResponse === 'string' && aiResponse.startsWith(MARKERS.BOT_ERROR_MESSAGE)) {
        // Extract the actual error message by removing the marker
        const errorMessage = aiResponse.replace(MARKERS.BOT_ERROR_MESSAGE, '').trim();
        logger.info(`[Bot] Sending error message from bot instead of personality: ${errorMessage}`);
        
        // Send the message as the bot instead of through the webhook
        await message.reply(errorMessage);
        return; // Exit early - we've handled this message directly
      }

      // Add a small delay before sending any webhook message
      // This helps prevent the race condition between error messages and real responses
      await new Promise(resolve => setTimeout(resolve, 500));

      // Send response and record conversation
      // CRITICAL: We must pass the original message to ensure we use the correct user's auth token
      // This ensures user authentication is preserved when replying to webhook messages
      
      // Prepare options with thread information if needed
      const webhookOptions = {
        // Include user ID in options for enhanced tracking
        userId: message.author?.id,
        // If the message is in a thread, explicitly pass the threadId to ensure
        // webhooks respond in the correct thread context
        threadId: message.channel.isThread() ? message.channel.id : undefined
      };
      
      const result = await webhookManager.sendWebhookMessage(
        message.channel,
        aiResponse,
        personality,
        webhookOptions,
        message // Pass the original message for user authentication
      );

      // Clean up active request tracking
      activeRequests.delete(requestKey);

      // Record this conversation with all message IDs
      recordConversationData(message.author.id, message.channel.id, result, personality.fullName);
    } catch (error) {
      // Clear typing indicator if there's an error
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      // Clean up active request tracking
      activeRequests.delete(requestKey);

      // Let outer catch block handle this error
      throw error;
    }
  } catch (error) {
    // Enhanced error logging with full error details
    logger.error(`Error in personality interaction: ${error.message || 'No message'}`);
    logger.error(`Error type: ${error.name || 'Unknown'}`);
    logger.error(`Error stack: ${error.stack || 'No stack trace'}`);
    
    if (error.response) {
      logger.error(`API Response error: ${JSON.stringify(error.response.data || {})}`);
    }
    
    if (error.request) {
      logger.error(`Request that caused error: ${JSON.stringify(error.request || {})}`);
    }
    
    // Log the personality data that was being used
    try {
      logger.error(`Personality being used: ${personality ? personality.fullName : 'Unknown'}`);
      logger.error(`Message content: ${typeof messageContent === 'string' ? 
        messageContent.substring(0, 100) + '...' : 
        'Non-string content type: ' + typeof messageContent}`);
    } catch (logError) {
      logger.error(`Error logging details: ${logError.message}`);
    }

    // Send error message to user
    message.reply('Sorry, I encountered an error while processing your message. Check logs for details.').catch(() => {});
  } finally {
    // Clear typing indicator if it's still active
    if (typingInterval) {
      clearInterval(typingInterval);
    }
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
    // Using structured logging for queue cleaning
    try {
      // Get all channels the bot has access to, excluding already identified inaccessible ones
      const channels = Array.from(client.channels.cache.values()).filter(
        channel => !inaccessibleChannels.has(channel.id)
      );

      // Only process text channels with proper permissions
      const textChannels = channels.filter(
        channel =>
          channel.isTextBased() &&
          !channel.isDMBased() &&
          // Skip permission check for DM channels
          (channel.isDMBased() ||
            // For guild channels, verify we have the necessary permissions
            (channel.guild &&
              channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ViewChannel) &&
              channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ReadMessageHistory) &&
              channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageMessages)))
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
          const webhookMessages = messages.filter(
            msg =>
              msg.webhookId &&
              msg.author?.username && // Must have a username
              msg.content &&
              ERROR_MESSAGES.some(pattern => msg.content.includes(pattern))
          );

          // Delete any found error messages
          for (const errorMsg of webhookMessages.values()) {
            if (errorMsg.deletable) {
              logger.warn(
                `[QueueCleaner] CRITICAL: Deleting error message in channel ${channel.name || channel.id} from ${errorMsg.author?.username}: ${errorMsg.content.substring(0, 30)}...`
              );
              try {
                await errorMsg.delete();
                logger.info(`[QueueCleaner] Successfully deleted error message`);
              } catch (deleteError) {
                logger.error(`[QueueCleaner] Failed to delete message:`, deleteError.message);
              }
            }
          }
        } catch (channelError) {
          // Mark this channel as inaccessible to avoid future attempts
          if (
            channelError.message.includes('Missing Access') ||
            channelError.message.includes('Missing Permissions')
          ) {
            inaccessibleChannels.add(channel.id);
            logger.warn(
              `[QueueCleaner] Marked channel ${channel.id} as inaccessible due to permissions`
            );
          } else {
            // Log other errors but don't mark the channel as inaccessible
            logger.error(
              `[QueueCleaner] Error processing channel ${channel.id}:`,
              channelError.message
            );
          }
        }
      }

      // Clean up old entries once per hour
      if (Math.random() < 0.01) {
        // ~1% chance each run
        logger.debug(`[QueueCleaner] Performing maintenance cleanup`);

        // Clean up lastCleanedTime for channels not seen in a while
        const now = Date.now();
        for (const [channelId, timestamp] of lastCleanedTime.entries()) {
          if (now - timestamp > 60 * 60 * 1000) {
            // 1 hour
            lastCleanedTime.delete(channelId);
          }
        }

        // Reset active channels list occasionally to adapt to changing activity
        if (Math.random() < 0.1) {
          // 10% chance during maintenance
          logger.debug(`[QueueCleaner] Resetting active channels list`);
          activeChannels.clear();
        }
      }
    } catch (error) {
      // Silently fail
      logger.error('[QueueCleaner] Unhandled error:', error);
    }
  }, 7000); // Check every 7 seconds
}

module.exports = { initBot, client };