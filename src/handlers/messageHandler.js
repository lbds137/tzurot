/**
 * Handles message routing, processing, and command dispatching
 */
const logger = require('../logger');
const { botPrefix, botConfig } = require('../../config');
const { processCommand } = require('../commandLoader');
const { messageTracker } = require('../messageTracker');
const referenceHandler = require('./referenceHandler');
const personalityHandler = require('./personalityHandler');
const messageTrackerHandler = require('./messageTrackerHandler');
const dmHandler = require('./dmHandler');
const errorHandler = require('./errorHandler');
const webhookUserTracker = require('../utils/webhookUserTracker');
const _contentSimilarity = require('../utils/contentSimilarity');
const channelUtils = require('../utils/channelUtils');
const { getActivePersonality, getActivatedPersonality, isAutoResponseEnabled } = require('../conversationManager');
const { getPersonalityByAlias, getPersonality } = require('../personalityManager');
const pluralkitMessageStore = require('../utils/pluralkitMessageStore').instance;

/**
 * Check if a message contains any personality mentions (without processing them)
 * @param {Object} message - Discord message object  
 * @returns {boolean} - Whether the message contains personality mentions
 */
function checkForPersonalityMentions(message) {
  if (!message.content) return false;
  
  // Use configured mention character (@ for production, & for development)
  const mentionChar = botConfig.mentionChar;
  
  // Escape the mention character for regex safety
  const escapedMentionChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const standardMentionRegex = new RegExp(`${escapedMentionChar}([\\w-]+)(?:[.,!?;:)"']|\\s|$)`, 'gi');
  let match;
  
  // Check for standard mentions
  while ((match = standardMentionRegex.exec(message.content)) !== null) {
    if (match[1] && match[1].trim()) {
      const cleanedName = match[1].trim().replace(/[.,!?;:)"']+$/, '');
      
      // Check if this is a valid personality (directly or as an alias)
      let personality = getPersonality(cleanedName);
      if (!personality) {
        personality = getPersonalityByAlias(message.author.id, cleanedName);
      }
      
      if (personality) {
        return true; // Found a valid personality mention
      }
    }
  }
  
  // Check for multi-word mentions with spaces
  const multiWordMentionRegex = new RegExp(`${escapedMentionChar}([\\w\\s-]+?)(?=[.,!?;:)"']|\\s*$|\\s+[${escapedMentionChar}]|\\s+[^\\w\\s-])`, 'gi');
  let multiWordMatch;
  
  while ((multiWordMatch = multiWordMentionRegex.exec(message.content)) !== null) {
    if (multiWordMatch[1] && multiWordMatch[1].trim()) {
      const multiWordName = multiWordMatch[1].trim();
      
      // Skip if it's the same as a standard mention we already checked
      const standardMatch = standardMentionRegex.test(`${mentionChar}${multiWordName}`);
      if (standardMatch) continue;
      
      // Check if this multi-word mention is a valid personality alias
      const personality = getPersonalityByAlias(message.author.id, multiWordName);
      if (personality) {
        return true; // Found a valid multi-word personality mention
      }
    }
  }
  
  return false; // No personality mentions found
}

/**
 * Main message handler function
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client
 * @returns {Promise<void>}
 */
async function handleMessage(message, client) {
  try {
    // Ensure messageTrackerHandler is initialized (lazy initialization)
    messageTrackerHandler.ensureInitialized();

    // Store all user messages temporarily
    // This allows us to track the original user when PluralKit deletes and re-sends via webhook
    if (!message.author.bot && !message.webhookId) {
      pluralkitMessageStore.store(message.id, {
        userId: message.author.id,
        channelId: message.channel.id,
        content: message.content,
        guildId: message.guild?.id,
        username: message.author.username
      });
    }

    // If there was a message before this that was deleted,
    // and this is a webhook message, try to associate them
    if (message.webhookId) {
      // If this appears to be from a proxy system like Pluralkit,
      // we'll track it so we can bypass verification checks
      const isProxySystem = webhookUserTracker.isProxySystemWebhook(message);

      // Track this message in the channel's recent messages list
      messageTrackerHandler.trackMessageInChannel(message);

      // Mark webhook messages as already handled to prevent duplicate processing
      // when the original message is processed after delay
      if (isProxySystem) {
        messageTrackerHandler.markMessageAsHandled(message);
      }
    }

    // Check for replies to DM-formatted bot messages
    if (message.channel.isDMBased() && !message.author.bot && message.reference) {
      const dmReplyHandled = await dmHandler.handleDmReply(message, client);
      if (dmReplyHandled) {
        return; // Message was handled by DM reply handler
      }
    }

    // Only ignore messages from bots that aren't our webhooks
    if (message.author.bot) {
      // Handle our own bot's messages more strictly
      // Identify these by the bot's own client ID
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

        }

        logger.debug(`This is my own message with ID ${message.id} - returning immediately`);
        return; // Always ignore our own bot messages completely
      }

      if (message.webhookId) {
        // Log webhook ID for debugging
        logger.debug(
          `Received message from webhook: ${message.webhookId}, content: ${message.content.substring(0, 20)}...`
        );

        // Filter webhook messages for errors
        if (errorHandler.filterWebhookMessage(message)) {
          return; // Message was filtered
        }

        // Check if this is our own bot's webhook (not a proxy system like PluralKit)
        // Our bot's webhooks have applicationId matching our bot's user ID
        const isOurBotWebhook = message.applicationId === client.user.id;

        if (isOurBotWebhook) {
          // This is one of our own webhooks, which means it's a personality webhook we created
          // We should NEVER process these messages, as that would create an echo effect
          // where the bot responds to its own webhook messages
          logger.info(
            `[MessageHandler] Ignoring message from our own webhook (${message.webhookId}): ${message.author.username}`
          );
          return;
        }

        // Check if this is a proxy system webhook (like PluralKit)
        const isProxySystem = webhookUserTracker.isProxySystemWebhook(message);
        
        if (isProxySystem) {
          // This is a proxy system webhook (PluralKit, Tupperbox, etc.)
          // We should process these messages normally as they represent real users
          logger.debug(`Processing proxy system webhook message from: ${message.author.username}`);
          // Continue processing - don't return here
        } else {
          // This is some other webhook we don't recognize
          logger.debug(`Ignoring unknown webhook message: ${message.webhookId}`);
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
      return handleCommand(message);
    }

    // Reply-based conversation continuation
    // Use the reference handler module to process the message reference
    const referenceResult = await referenceHandler.handleMessageReference(
      message,
      (msg, personality, mention) =>
        personalityHandler.handlePersonalityInteraction(msg, personality, mention, client),
      client
    );

    // If the reference was processed successfully, return early
    if (referenceResult.processed) {
      return;
    }
    
    // If this was a reply to a non-personality message, check if there's a mention
    // before skipping processing. This prevents autoresponse from triggering when 
    // replying to other users, but allows mentions to be processed.
    // EXCEPTION: Don't filter if there's an activated personality in this channel
    if (referenceResult.wasReplyToNonPersonality) {
      // Check if this channel has an activated personality
      const hasActivatedPersonality = getActivatedPersonality(message.channel.id);
      
      // Check if the message contains a personality mention
      const hasMention = checkForPersonalityMentions(message);
      
      // Only skip processing if there are no mentions AND no Discord links
      // AND no activated personality in this channel
      if (!hasMention && !referenceResult.containsMessageLinks && !hasActivatedPersonality) {
        return;
      }
    }

    // @mention personality triggering
    const mentionResult = await handleMentions(message, client);
    if (mentionResult) {
      return; // Mention was handled
    }

    // Check for active conversation
    const activeConversationResult = await handleActiveConversation(message, client);
    if (activeConversationResult) {
      return; // Active conversation was handled
    }

    // Check for activated channel personality
    const activatedChannelResult = await handleActivatedChannel(message, client);
    if (activatedChannelResult) {
      return; // Activated channel was handled
    }

    // Handle DM-specific behavior for "sticky" conversations
    if (message.channel.isDMBased() && !message.author.bot) {
      await dmHandler.handleDirectMessage(message, client);
    }
  } catch (error) {
    logger.error(`[MessageHandler] Error handling message:`, error);
  }
}

/**
 * Handle command processing
 * @param {Object} message - Discord message object
 * @returns {Promise<boolean>} - Whether the command was handled
 */
async function handleCommand(message) {
  logger.info(`Command detected from user ${message.author.tag} with ID ${message.id}`);
  logger.debug(`Message content: ${message.content}`);

  // Check for duplicate message processing
  if (!messageTracker.track(message.id, 'command')) {
    logger.warn(`Prevented duplicate command processing for message ${message.id}`);
    return true; // Command was "handled" (prevented duplicate)
  }

  // Remove prefix and trim leading space
  const content = message.content.startsWith(botPrefix + ' ')
    ? message.content.slice(botPrefix.length + 1)
    : '';

  const args = content.trim().split(/ +/);
  const command = args.shift()?.toLowerCase() || 'help'; // Default to help if no command

  logger.debug(
    `Calling processCommand with ID ${message.id}, command=${command}, args=${args.join(',')}`
  );

  try {
    // Process the command
    const result = await processCommand(message, command, args);
    logger.debug(`processCommand completed with result: ${result ? 'success' : 'null/undefined'}`);
    return true; // Command was handled
  } catch (error) {
    logger.error(`Error in processCommand:`, error);
    return false; // Command had an error
  }
}

/**
 * Handle mentions in messages
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client
 * @returns {Promise<boolean>} - Whether the mention was handled
 */
async function handleMentions(message, client) {
  try {
    // IMPROVEMENT: Check for both standard mentions and multi-word mentions
    // And prioritize the longest match to handle cases like &bambi vs &bambi prime
    // Use configured mention character (@ for production, & for development)
    const mentionChar = botConfig.mentionChar;

    // We'll store all potential matches and their personalities in this array
    const potentialMatches = [];

    // First gather all standard mentions (without spaces) - use global flag to find all
    // Improved regex to handle mentions at the end of messages with punctuation
    // Escape the mention character for regex safety
    const escapedMentionChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const standardMentionRegex = new RegExp(`${escapedMentionChar}([\\w-]+)(?:[.,!?;:)"']|\\s|$)`, 'gi');
    let standardMentionMatch;
    const standardMentions = [];

    // Find all standard mentions in the message
    while ((standardMentionMatch = standardMentionRegex.exec(message.content)) !== null) {
      if (standardMentionMatch[1] && standardMentionMatch[1].trim()) {
        // Remove any trailing punctuation that might have been captured
        const cleanedName = standardMentionMatch[1].trim().replace(/[.,!?;:)"']+$/, '');
        standardMentions.push(cleanedName);
      }
    }

    // Check each standard mention
    for (const mentionName of standardMentions) {
      logger.debug(`Found standard ${mentionChar}mention: ${mentionName}, checking if it's a valid personality`);

      // Check if this is a valid personality (directly or as an alias)
      let personality = getPersonality(mentionName);
      if (!personality) {
        personality = getPersonalityByAlias(message.author.id, mentionName);
      }

      if (personality) {
        logger.debug(
          `Found standard ${mentionChar}mention personality: ${mentionName} -> ${personality.fullName}`
        );
        potentialMatches.push({
          mentionText: mentionName,
          personality: personality,
          wordCount: 1, // Single word
        });
      }
    }

    // Now check for mentions with spaces - whether or not we found standard mentions
    if (message.content && message.content.includes(mentionChar)) {
      // Improved regex to match multi-word mentions
      // This captures &word1 word2 word3 patterns more precisely
      // Limited to a maximum of 4 words to avoid capturing too much text
      // Updated to handle mentions at the end of messages with or without punctuation
      const mentionWithSpacesRegex = new RegExp(`${escapedMentionChar}([^\\s${escapedMentionChar}\\n]+(?:\\s+[^\\s${escapedMentionChar}\\n]+){0,4})(?:[.,!?;:)"']|\\s|$)`, 'g');
      let spacedMentionMatch;
      const mentionsWithSpaces = [];

      // Find all potential mentions with spaces
      while ((spacedMentionMatch = mentionWithSpacesRegex.exec(message.content)) !== null) {
        if (spacedMentionMatch[1] && spacedMentionMatch[1].trim()) {
          mentionsWithSpaces.push(spacedMentionMatch[1].trim());
        }
      }

      // Try each potential multi-word mention
      for (const rawMentionText of mentionsWithSpaces) {
        logger.debug(`Processing potential multi-word ${mentionChar}mention: "${rawMentionText}"`);

        // Skip if this is just a single word (already handled by standard regex)
        if (!rawMentionText.includes(' ')) {
          logger.debug(`Skipping "${rawMentionText}" - single word, already checked`);
          continue;
        }

        // Remove any trailing punctuation that might have been captured
        const cleanedMentionText = rawMentionText.replace(/[.,!?;:)"']+$/, '').trim();

        // Split the cleaned text into words
        const words = cleanedMentionText.split(/\s+/);

        // IMPROVEMENT: Try combinations from longest to shortest to prioritize the most specific match
        // For example, match "&bambi prime" before "&bambi" when user types "&bambi prime hi" (in dev mode)

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

          // Try as an alias for this user, then as a global alias
          let personality = getPersonalityByAlias(message.author.id, mentionText);

          if (!personality) {
            // If not found for this user, try as a global alias
            personality = getPersonalityByAlias(null, mentionText);
          }

          if (personality) {
            // Count the number of words in this match
            const wordCount = mentionText.split(/\s+/).length;

            logger.info(
              `Found multi-word ${mentionChar}mention: "${mentionText}" -> ${personality.fullName} (${wordCount} words)`
            );

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
        logger.info(
          `Selected best ${mentionChar}mention match: "${bestMatch.mentionText}" -> ${bestMatch.personality.fullName} (${bestMatch.wordCount} words)`
        );

        // If there were multiple matches, log them for debugging
        if (potentialMatches.length > 1) {
          logger.debug(`Chose the longest match from ${potentialMatches.length} options:`);
          potentialMatches.forEach(match => {
            logger.debug(
              `- ${match.mentionText} (${match.wordCount} words) -> ${match.personality.fullName}`
            );
          });
        }

        // Skip delay for DMs (PluralKit doesn't work in DMs)
        if (message.channel.isDMBased()) {
          // Process DM messages immediately
          await personalityHandler.handlePersonalityInteraction(
            message,
            bestMatch.personality,
            bestMatch.mentionText,
            client
          );
          return true; // Mention was handled
        }

        // For server channels, implement the delay for PluralKit proxy handling
        // Use the delayedProcessing helper for consistent handling
        await messageTrackerHandler.delayedProcessing(
          message,
          bestMatch.personality,
          bestMatch.mentionText,
          client,
          personalityHandler.handlePersonalityInteraction
        );

        return true; // Mention was handled
      }
    }
  } catch (error) {
    logger.error(`[MessageHandler] Error processing mention:`, error);
  }

  return false; // No mention was handled
}

/**
 * Handle active conversations
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client
 * @returns {Promise<boolean>} - Whether the active conversation was handled
 */
async function handleActiveConversation(message, client) {
  // Check if auto-response is enabled for this user
  const autoResponseEnabled = isAutoResponseEnabled(message.author.id);
  
  logger.info(
    `[MessageHandler] Checking for active conversation - User: ${message.author.id}, ` +
    `Channel: ${message.channel.id}, isDM: ${message.channel.isDMBased()}, ` +
    `autoResponseEnabled: ${autoResponseEnabled}`
  );
  
  // Check for active conversation
  const activePersonalityName = getActivePersonality(
    message.author.id, 
    message.channel.id,
    message.channel.isDMBased(),
    autoResponseEnabled
  );
  if (!activePersonalityName) {
    return false; // No active conversation
  }

  logger.info(`[MessageHandler] Found active conversation with: ${activePersonalityName}`);

  // First try to get personality directly by full name
  let personality = getPersonality(activePersonalityName);

  // If not found as direct name, try it as an alias
  if (!personality) {
    personality = getPersonalityByAlias(message.author.id, activePersonalityName);
  }

  logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

  if (!personality) {
    return false; // Personality not found
  }

  // Skip delay for DMs (PluralKit doesn't work in DMs)
  if (message.channel.isDMBased()) {
    // Process DM messages immediately
    await personalityHandler.handlePersonalityInteraction(message, personality, null, client);
    return true; // Active conversation was handled
  }

  // For server channels, implement the delay for PluralKit proxy handling
  await messageTrackerHandler.delayedProcessing(
    message,
    personality,
    null,
    client,
    personalityHandler.handlePersonalityInteraction
  );

  return true; // Active conversation was handled
}

/**
 * Handle activated channel personalities
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client
 * @returns {Promise<boolean>} - Whether the activated channel was handled
 */
async function handleActivatedChannel(message, client) {
  // Check for activated channel personality
  const activatedPersonalityName = getActivatedPersonality(message.channel.id);
  if (!activatedPersonalityName) {
    return false; // No activated personality in this channel
  }

  logger.debug(`Found activated personality in channel: ${activatedPersonalityName}`);

  // Check if this message is a command - activated personalities should ignore commands
  // Modified check to ensure we catch any command format that would be processed by the processCommand function
  const isCommand = message.content.startsWith(botPrefix);

  if (isCommand) {
    logger.info(`Activated personality ignoring command message: ${message.content}`);
    return false; // Let the command handler process this message
  }

  // Not a command, continue with personality response

  // SAFETY CHECK: Only allow activated personalities in DMs or NSFW channels
  const isDM = message.channel.isDMBased();
  const isNSFW = channelUtils.isChannelNSFW(message.channel);

  if (!isDM && !isNSFW) {
    // Not a DM and not marked as NSFW - inform the user but only if they haven't been notified recently
    const restrictionKey = `nsfw-restriction-${message.channel.id}`;
    const lastNotificationTime = personalityHandler.activeRequests.get(restrictionKey) || 0;
    const currentTime = Date.now();

    // Only show the message once every hour to avoid spam
    if (currentTime - lastNotificationTime > 3600000) {
      // 1 hour in milliseconds
      await message.channel
        .send(
          '⚠️ For safety and compliance reasons, personalities can only be used in Direct Messages or channels marked as NSFW. This channel needs to be marked as NSFW in the channel settings to use activated personalities.'
        )
        .catch(error => {
          logger.error(`[MessageHandler] Failed to send NSFW restriction notice: ${error.message}`);
        });

      // Update the last notification time
      personalityHandler.activeRequests.set(restrictionKey, currentTime);
    }

    return true; // Message was "handled" by sending the restriction notice
  }

  // First try to get personality directly by full name
  let personality = getPersonality(activatedPersonalityName);

  // If not found as direct name, try it as an alias
  if (!personality) {
    personality = getPersonalityByAlias(message.author.id, activatedPersonalityName);
  }

  logger.debug(`Personality lookup result: ${personality ? personality.fullName : 'null'}`);

  if (!personality) {
    return false; // Personality not found
  }

  // Handle through the delayed processing function for consistent handling
  await messageTrackerHandler.delayedProcessing(
    message,
    personality,
    null,
    client,
    personalityHandler.handlePersonalityInteraction
  );

  return true; // Activated channel was handled
}

module.exports = {
  handleMessage,
  handleCommand,
  handleMentions,
  handleActiveConversation,
  handleActivatedChannel,
};
