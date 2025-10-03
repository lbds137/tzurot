/**
 * Handles message routing, processing, and command dispatching
 */
const logger = require('../logger');
const { botPrefix, botConfig } = require('../../config');
const { messageTracker } = require('../messageTracker');
const referenceHandler = require('./referenceHandler');
const personalityHandler = require('./personalityHandler');
const messageTrackerHandler = require('./messageTrackerHandler');
const dmHandler = require('./dmHandler');
const webhookUserTracker = require('../utils/webhookUserTracker');
const channelUtils = require('../utils/channelUtils');
const {
  getActivePersonality,
  getActivatedPersonality,
  isAutoResponseEnabled,
} = require('../core/conversation');
const pluralkitMessageStore = require('../utils/pluralkitMessageStore').instance;
const { getCommandIntegrationAdapter } = require('../adapters/CommandIntegrationAdapter');
const { resolvePersonality } = require('../utils/aliasResolver');
const pluralkitReplyTracker = require('../utils/pluralkitReplyTracker');
const messageHandlerConfig = require('../config/MessageHandlerConfig');

/**
 * Get max alias word count from configuration
 * @returns {number} Max alias word count
 */
function getMaxAliasWordCount() {
  return messageHandlerConfig.getMaxAliasWordCount();
}

/**
 * Check if a message contains any personality mentions (without processing them)
 * @param {Object} message - Discord message object
 * @returns {Promise<boolean>} - Whether the message contains personality mentions
 */
async function checkForPersonalityMentions(message) {
  if (!message.content) return false;

  logger.debug(`[checkForPersonalityMentions] Checking message: "${message.content}"`);

  // Use configured mention character (@ for production, & for development)
  const mentionChar = botConfig.mentionChar;

  // Escape the mention character for regex safety
  const escapedMentionChar = mentionChar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const standardMentionRegex = new RegExp(
    `${escapedMentionChar}([\\w-]+)(?:[.,!?;:)"']|\\s|$)`,
    'gi'
  );
  let match;

  // Check for standard mentions
  while ((match = standardMentionRegex.exec(message.content)) !== null) {
    if (match[1] && match[1].trim()) {
      const cleanedName = match[1].trim().replace(/[.,!?;:)"']+$/, '');

      // Check if this is a valid personality (directly or as an alias)
      const personality = await resolvePersonality(cleanedName);

      if (personality) {
        return true; // Found a valid personality mention
      }
    }
  }

  // Check for multi-word mentions with spaces
  // Use a regex that captures up to the max alias word count but stops at natural boundaries
  // This handles mentions like "&angel dust" or even longer aliases
  const maxWords = getMaxAliasWordCount();
  logger.debug(`[checkForPersonalityMentions] Max alias word count: ${maxWords}`);
  const multiWordMentionRegex = new RegExp(
    `${escapedMentionChar}([^\\s${escapedMentionChar}\\n]+(?:\\s+[^\\s${escapedMentionChar}\\n]+){0,${maxWords - 1}})`,
    'gi'
  );
  logger.debug(`[checkForPersonalityMentions] Multi-word regex: ${multiWordMentionRegex}`);

  let multiWordMatch;
  while ((multiWordMatch = multiWordMentionRegex.exec(message.content)) !== null) {
    if (multiWordMatch[1] && multiWordMatch[1].trim()) {
      const capturedText = multiWordMatch[1].trim();
      logger.debug(`[checkForPersonalityMentions] Multi-word regex captured: "${capturedText}"`);

      // Remove any trailing punctuation
      const cleanedText = capturedText.replace(/[.,!?;:)"']+$/, '');

      // Split into words for combination testing
      const words = cleanedText.split(/\s+/);

      // Try combinations from longest to shortest
      // Support up to the current max alias word count
      const maxWordsToTry = Math.min(maxWords, words.length);

      for (let wordCount = maxWordsToTry; wordCount >= 1; wordCount--) {
        const potentialAlias = words.slice(0, wordCount).join(' ').trim();

        logger.debug(
          `[checkForPersonalityMentions] Checking multi-word alias: "${potentialAlias}"`
        );
        const personality = await resolvePersonality(potentialAlias);

        if (personality) {
          logger.debug(`[checkForPersonalityMentions] Found valid alias: "${potentialAlias}"`);
          return true; // Found a valid personality mention
        }
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
  logger.debug(
    `[MessageHandler] Received message: "${message.content}" from ${message.author.tag} (${message.author.id}), isBot: ${message.author.bot}, webhookId: ${message.webhookId}, hasReference: ${!!message.reference}`
  );

  try {
    // Global blacklist check - do this first before any other processing
    // Check the actual user ID, not webhook IDs
    let userIdToCheck = message.author.id;

    // For proxy systems like PluralKit, try to get the real user ID
    if (message.webhookId && webhookUserTracker.isProxySystemWebhook(message)) {
      const realUserId = webhookUserTracker.getRealUserId(message);
      if (realUserId) {
        userIdToCheck = realUserId;
      }
    }

    // Check if user is globally blacklisted
    try {
      const { getApplicationBootstrap } = require('../application/bootstrap/ApplicationBootstrap');
      const bootstrap = getApplicationBootstrap();

      if (bootstrap.initialized) {
        const blacklistService = bootstrap.getBlacklistService();
        const isBlacklisted = await blacklistService.isUserBlacklisted(userIdToCheck);

        if (isBlacklisted) {
          logger.info(
            `[MessageHandler] Ignoring message from globally blacklisted user: ${userIdToCheck}`
          );
          return; // Silent fail - no response to blacklisted users
        }
      }
    } catch (error) {
      // Don't let blacklist check failures prevent message processing
      logger.error('[MessageHandler] Error checking blacklist status:', error);
    }

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
        username: message.author.username,
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

          // Check if this might be a reply that lost its reference due to Pluralkit processing
          const pendingReply = pluralkitReplyTracker.findPendingReply(
            message.channel.id,
            message.content
          );

          if (pendingReply) {
            logger.info(
              `[MessageHandler] Found pending reply context for Pluralkit message from user ${pendingReply.userId}`
            );

            // Associate the webhook with the real user for authentication
            webhookUserTracker.associateWebhookWithUser(message.webhookId, pendingReply.userId);

            // Mark the original message as handled to prevent duplicate processing
            if (pendingReply.originalMessageId) {
              // Create a minimal message object with the required properties
              messageTrackerHandler.markMessageAsHandled({
                id: pendingReply.originalMessageId,
                channel: { id: message.channel.id },
              });
              logger.debug(
                `[MessageHandler] Marked original message ${pendingReply.originalMessageId} as handled`
              );
            }

            // Process this as a reply to the personality
            await personalityHandler.handlePersonalityInteraction(
              message,
              pendingReply.personality,
              null, // No mention trigger
              client
            );

            return; // Message was handled as a reply
          }
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
    logger.info(`[MessageHandler] Processing message reference...`);
    const referenceResult = await referenceHandler.handleMessageReference(
      message,
      (msg, personality, mention) =>
        personalityHandler.handlePersonalityInteraction(msg, personality, mention, client),
      client
    );
    logger.info(`[MessageHandler] Reference result: ${JSON.stringify(referenceResult)}`);

    // If the reference was processed successfully, return early
    if (referenceResult.processed) {
      logger.debug(`[MessageHandler] Message processed as reply to personality`);
      return;
    }

    // If this was a reply to a non-personality message, check if there's a mention
    // before skipping processing. This prevents autoresponse from triggering when
    // replying to other users, but allows mentions to be processed.
    // EXCEPTION: Don't filter if there's an activated personality in this channel
    if (referenceResult.wasReplyToNonPersonality) {
      logger.info(`[MessageHandler] Reply to non-personality detected, checking for mentions...`);

      // Check if this channel has an activated personality
      const hasActivatedPersonality = getActivatedPersonality(message.channel.id);
      logger.info(`[MessageHandler] Has activated personality: ${hasActivatedPersonality}`);

      // Check if the message contains a personality mention
      const hasMention = await checkForPersonalityMentions(message);
      logger.info(`[MessageHandler] Has mention: ${hasMention}`);

      // Only skip processing if there are no mentions AND no Discord links
      // AND no activated personality in this channel
      if (!hasMention && !referenceResult.containsMessageLinks && !hasActivatedPersonality) {
        logger.debug(`[MessageHandler] No mentions found in reply, skipping processing`);
        return;
      }

      logger.debug(`[MessageHandler] Mention found in reply, continuing to process...`);
    }

    // @mention personality triggering
    const mentionResult = await handleMentions(message, client);
    logger.debug(`[MessageHandler] handleMentions returned: ${mentionResult}`);
    if (mentionResult) {
      logger.debug(`[MessageHandler] Message processed as mention`);
      return; // Mention was handled
    }

    // Check for activated channel personality first - takes priority over active conversations
    const activatedChannelResult = await handleActivatedChannel(message, client);
    if (activatedChannelResult) {
      return; // Activated channel was handled
    }

    // Check for active conversation
    const activeConversationResult = await handleActiveConversation(message, client);
    if (activeConversationResult) {
      logger.debug(`[MessageHandler] Message processed as active conversation`);
      return; // Active conversation was handled
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
    // Use the command integration adapter (DDD system)
    const adapter = getCommandIntegrationAdapter();
    const result = await adapter.processCommand(message, command, args);

    logger.debug(
      `CommandIntegrationAdapter completed with result: ${result?.success ? 'success' : 'failure'}`
    );

    // Handle error responses from adapter
    if (!result.success && result.error) {
      await message.reply(`❌ ${result.error}`);
    }

    return true; // Command was handled
  } catch (error) {
    logger.error(`Error in command processing:`, error);
    await message.reply('❌ An error occurred while processing your command. Please try again.');
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
    logger.debug(
      `[handleMentions] Processing message: "${message.content}" from user ${message.author.id}`
    );

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
    const standardMentionRegex = new RegExp(
      `${escapedMentionChar}([\\w-]+)(?:[.,!?;:)"']|\\s|$)`,
      'gi'
    );
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
      logger.debug(
        `Found standard ${mentionChar}mention: ${mentionName}, checking if it's a valid personality`
      );

      // Check if this is a valid personality (directly or as an alias)
      const personality = await resolvePersonality(mentionName);

      if (personality) {
        logger.debug(
          `[MessageHandler] Found standard ${mentionChar}mention personality: ${mentionName} -> ${personality.fullName}`
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
      // Use the same improved regex as checkForPersonalityMentions
      // Captures up to the max alias word count but stops at natural boundaries
      const maxWords = getMaxAliasWordCount();
      const multiWordMentionRegex = new RegExp(
        `${escapedMentionChar}([^\\s${escapedMentionChar}\\n]+(?:\\s+[^\\s${escapedMentionChar}\\n]+){0,${maxWords - 1}})`,
        'gi'
      );

      let multiWordMatch;
      const processedMentions = new Set(); // Track processed mentions to avoid duplicates

      while ((multiWordMatch = multiWordMentionRegex.exec(message.content)) !== null) {
        if (multiWordMatch[1] && multiWordMatch[1].trim()) {
          const capturedText = multiWordMatch[1].trim();

          // Skip if we've already processed this exact text
          if (processedMentions.has(capturedText)) {
            continue;
          }
          processedMentions.add(capturedText);

          logger.debug(`[handleMentions] Multi-word regex captured: "${capturedText}"`);

          // Remove any trailing punctuation
          const cleanedText = capturedText.replace(/[.,!?;:)"']+$/, '');

          // Split into words for combination testing
          const words = cleanedText.split(/\s+/);

          // Skip if this is just a single word (already handled by standard regex)
          if (words.length === 1) {
            continue;
          }

          // IMPROVEMENT: Try combinations from longest to shortest to prioritize the most specific match
          // For example, match "&bambi prime" before "&bambi" when user types "&bambi prime hi" (in dev mode)

          // Support up to the current max alias word count
          const maxWordsToTry = Math.min(maxWords, words.length);

          // Try combinations from longest to shortest (2 or more words)
          for (let wordCount = maxWordsToTry; wordCount >= 2; wordCount--) {
            const mentionText = words.slice(0, wordCount).join(' ').trim();

            logger.debug(`[handleMentions] Trying mention combination: "${mentionText}"`);

            // Try as an alias
            const personality = await resolvePersonality(mentionText);

            if (personality) {
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
      }

      // After collecting all potential matches, sort by word count (descending)
      // This ensures we prioritize longer matches (e.g., "bambi prime" over "bambi")
      potentialMatches.sort((a, b) => b.wordCount - a.wordCount);

      // If we found any matches, use the one with the most words (longest match)
      if (potentialMatches.length > 0) {
        const bestMatch = potentialMatches[0];
        logger.info(
          `[MessageHandler] Selected best ${mentionChar}mention match: "${bestMatch.mentionText}" -> ${bestMatch.personality.fullName} (${bestMatch.wordCount} words)`
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
        logger.debug(
          `[handleMentions] Starting delayedProcessing for ${bestMatch.personality.fullName}`
        );
        await messageTrackerHandler.delayedProcessing(
          message,
          bestMatch.personality,
          bestMatch.mentionText,
          client,
          personalityHandler.handlePersonalityInteraction
        );

        logger.debug(
          `[handleMentions] delayedProcessing completed for ${bestMatch.personality.fullName}`
        );
        return true; // Mention was handled
      }
    }
  } catch (error) {
    logger.error(`[MessageHandler] Error processing mention:`, error);
    logger.error(`[MessageHandler] Error stack:`, error.stack);
  }

  logger.debug(`[handleMentions] No mention found or processed, returning false`);
  return false; // No mention was handled
}

/**
 * Handle active conversations
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client
 * @returns {Promise<boolean>} - Whether the active conversation was handled
 */
async function handleActiveConversation(message, client) {
  // Get the real user ID for PluralKit webhook messages
  const userId = webhookUserTracker.getRealUserId(message) || message.author.id;
  
  // Check if auto-response is enabled for this user
  const autoResponseEnabled = isAutoResponseEnabled(userId);

  logger.debug(
    `[MessageHandler] Checking for active conversation - User: ${userId}, ` +
      `Channel: ${message.channel.id}, isDM: ${message.channel.isDMBased()}, ` +
      `autoResponseEnabled: ${autoResponseEnabled} (message.author.id: ${message.author.id})`
  );

  // Check for active conversation
  const activePersonalityName = getActivePersonality(
    userId,
    message.channel.id,
    message.channel.isDMBased(),
    autoResponseEnabled
  );
  if (!activePersonalityName) {
    return false; // No active conversation
  }

  logger.info(`[MessageHandler] Found active conversation with: ${activePersonalityName}`);

  // First try to get personality directly by full name
  const personality = await resolvePersonality(activePersonalityName);

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
    logger.debug(`Activated personality ignoring command message: ${message.content}`);
    return false; // Let the command handler process this message
  }

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
  const personality = await resolvePersonality(activatedPersonalityName);

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

/**
 * Set authentication service for personality interactions
 * @param {Object} authService - Authentication service instance
 */
function setAuthService(authService) {
  personalityHandler.setAuthService(authService);
}

module.exports = {
  handleMessage,
  handleCommand,
  handleMentions,
  handleActiveConversation,
  handleActivatedChannel,
  checkForPersonalityMentions, // Exported for testing
  setAuthService,
};
