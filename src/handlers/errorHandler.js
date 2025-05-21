/**
 * Handles error filtering and message cleanup
 */
const logger = require('../logger');
const { ERROR_MESSAGES } = require('../constants');
const { PermissionFlagsBits } = require('discord.js');

/**
 * Patches the Discord.js client to filter out error messages
 * This intercepts webhook messages containing error patterns before they're processed
 * @param {Object} client - Discord.js client instance
 * @returns {Object} - The patched client
 */
function patchClientForErrorFiltering(client) {
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

  return client;
}

/**
 * Checks if a message contains error patterns
 * @param {Object} message - Discord message object
 * @returns {boolean} - True if the message contains error patterns
 */
function hasErrorPatterns(message) {
  if (!message || !message.content) return false;
  return ERROR_MESSAGES.some(pattern => message.content.includes(pattern));
}

/**
 * Filters webhook messages for errors
 * @param {Object} message - Discord message object
 * @returns {boolean} - True if the message should be blocked
 */
function filterWebhookMessage(message) {
  // If this isn't a webhook message, don't filter it
  if (!message.webhookId) return false;

  // Check for error patterns
  if (message.content && ERROR_MESSAGES.some(pattern => message.content.includes(pattern))) {
    logger.warn(`[ErrorHandler] Blocking error message: ${message.webhookId}`);
    logger.warn(
      `[ErrorHandler] Message content matches error pattern: ${message.content.substring(0, 50)}...`
    );

    // Try to delete the message if possible
    if (message.deletable) {
      message.delete().catch(error => {
        logger.error(`[ErrorHandler] Failed to delete error message: ${error.message}`);
      });
    }

    return true; // Block this message
  }

  return false; // Don't block this message
}

/**
 * Checks if an embed is incomplete
 * @param {Object} message - Discord message object
 * @returns {Promise<boolean>} - True if an incomplete embed was detected and deleted
 */
async function detectAndDeleteIncompleteEmbed(message) {
  if (!message.embeds || message.embeds.length === 0) {
    return false;
  }

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
        `🚨 [ErrorHandler] DETECTED INCOMPLETE EMBED: Found incomplete "Personality Added" embed - attempting to delete`
      );

      // Try to delete this embed to prevent confusion
      try {
        await message.delete();
        logger.info(
          `✅ [ErrorHandler] Successfully deleted incomplete embed message ID ${message.id}`
        );
        return true; // Embed was detected and deleted
      } catch (deleteError) {
        logger.error(`❌ [ErrorHandler] Error deleting incomplete embed:`, deleteError);
      }
    } else {
      logger.info(
        `✅ [ErrorHandler] GOOD EMBED: This "Personality Added" embed appears to be complete with display name and avatar`
      );
    }

    // Update global embed timestamp regardless of deletion
    // This helps us track when embeds were sent
    global.lastEmbedTime = Date.now();
  }

  return false; // No incomplete embeds detected or deletion failed
}

/**
 * Start a periodic queue cleaner to check for and remove any error messages
 * This is an aggressive approach to catch any error messages that slip through
 * other mechanisms
 * @param {Object} client - Discord.js client instance
 * @returns {NodeJS.Timeout} - The interval ID
 */
function startQueueCleaner(client) {
  // Track channels we've attempted but don't have access to
  const inaccessibleChannels = new Set();

  // Track the last cleaned time for each channel to avoid constant cleaning
  const lastCleanedTime = new Map();

  // Store channels where we've found recent activity
  const activeChannels = new Set();

  // Check for error messages periodically
  const interval = setInterval(async () => {
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

  return interval;
}

module.exports = {
  patchClientForErrorFiltering,
  hasErrorPatterns,
  filterWebhookMessage,
  detectAndDeleteIncompleteEmbed,
  startQueueCleaner,
};
