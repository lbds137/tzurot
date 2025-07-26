/**
 * Handles DM-specific message processing and interactions
 */
const logger = require('../logger');
const { getStandardizedUsername } = require('../webhookManager');
const { getActivePersonality } = require('../core/conversation');
const webhookUserTracker = require('../utils/webhookUserTracker');
const personalityHandler = require('./personalityHandler');
const { botPrefix } = require('../../config');
const { getApplicationBootstrap } = require('../application/bootstrap/ApplicationBootstrap');

/**
 * Get personality by name using DDD system
 * @param {string} name - Personality name
 * @returns {Promise<Object|null>} Personality object or null
 */
async function getPersonality(name) {
  const bootstrap = getApplicationBootstrap();
  const service = bootstrap.getPersonalityApplicationService();
  return await service.getPersonality(name);
}

/**
 * Check if user is NSFW verified using DDD authentication system
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Whether user is NSFW verified
 */
async function isNsfwVerified(userId) {
  try {
    const bootstrap = getApplicationBootstrap();
    const authService = bootstrap.getApplicationServices().authenticationService;
    const status = await authService.getAuthenticationStatus(userId);
    return status.isAuthenticated && status.user?.nsfwStatus?.verified;
  } catch (error) {
    logger.error('[dmHandler] Error checking NSFW verification:', error);
    return false;
  }
}

/**
 * Get personality by alias using DDD system
 * @param {string} alias - Personality alias
 * @returns {Promise<Object|null>} Personality object or null
 */
async function getPersonalityByAlias(alias) {
  // DDD system searches by name or alias in one method
  const bootstrap = getApplicationBootstrap();
  const service = bootstrap.getPersonalityApplicationService();
  return await service.getPersonality(alias);
}

/**
 * List personalities for a user using DDD system
 * @param {string} userId - User ID
 * @returns {Promise<Array<Object>>} Array of personalities
 */
async function listPersonalitiesForUser(userId) {
  const bootstrap = getApplicationBootstrap();
  const service = bootstrap.getPersonalityApplicationService();
  return await service.listPersonalitiesByOwner(userId);
}

/**
 * Handles replies to DM-formatted bot messages
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client instance
 * @param {Object} authManager - Auth manager instance
 * @returns {Promise<boolean>} - True if the message was handled as a DM reply, false otherwise
 */
async function handleDmReply(message, client) {
  if (!message.channel.isDMBased() || message.author.bot || !message.reference) {
    return false;
  }

  try {
    // Attempt to fetch the message being replied to
    const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);

    // Check if it's our bot's message
    if (repliedToMessage.author.id !== client.user.id) {
      return false;
    }

    // Check NSFW verification first before processing any personality interactions
    const shouldBypass = webhookUserTracker.shouldBypassNsfwVerification(message);
    const isVerified = shouldBypass ? true : await isNsfwVerified(message.author.id);

    if (!isVerified) {
      // User is not verified, prompt them to verify first
      logger.info(
        `[DmHandler] User ${message.author.id} attempted to use personalities without verification in DM reply`
      );
      try {
        await message.reply(
          '⚠️ **Age Verification Required**\n\n' +
            'To use AI personalities, you need to verify your age first.\n\n' +
            `Please run \`${botPrefix} verify\` in a channel marked as NSFW. ` +
            "This will verify that you meet Discord's age requirements for accessing NSFW content."
        );
      } catch (error) {
        logger.error(`[DmHandler] Error sending verification prompt: ${error.message}`);
        logger.debug(`[DmHandler] Error stack: ${error.stack || 'No stack available'}`);
      }
      return true; // We handled this message with the verification prompt
    }

    const content = repliedToMessage.content;
    // Pattern to match "**PersonalityName:** message content"
    // or "**PersonalityName | Suffix:** message content"
    // This works for both the first chunk and subsequent chunks
    const dmFormatMatch = content.match(/^\*\*([^:]+):\*\* /);

    // Even if we don't find a direct match, we should check if this is part of a multi-chunk message
    // where the user replied to a non-first chunk
    let isMultiChunkReply = false;
    let displayName = null;
    let personality = null;

    if (dmFormatMatch) {
      // Direct match - this is likely the first chunk or a single-chunk message
      displayName = dmFormatMatch[1];
      if (displayName && displayName.includes(' | ')) {
        // Extract just the personality name from "Name | Suffix" format
        displayName = displayName.split(' | ')[0];
        logger.info(`[DmHandler] Extracted base name from formatted DM message: ${displayName}`);
      }
      logger.info(
        `[DmHandler] Detected reply to formatted DM message for personality: ${displayName}`
      );
    } else {
      // No direct match - could be a continuation chunk that doesn't have the prefix
      // Look for the personality name in previous messages
      logger.info(
        `[DmHandler] Checking if this is a reply to a multi-chunk message without personality prefix`
      );

      try {
        // Get recent messages in this channel to find the personality name
        const recentMessages = await message.channel.messages.fetch({ limit: 10 });

        // Filter for bot messages that came before the replied-to message
        const earlierBotMessages = Array.from(recentMessages.values())
          .filter(
            msg =>
              msg.author.id === client.user.id &&
              new Date(msg.createdTimestamp) <= new Date(repliedToMessage.createdTimestamp) &&
              msg.id !== repliedToMessage.id
          )
          .sort((a, b) => b.createdTimestamp - a.createdTimestamp); // Sort by newest first

        // Look for a message with a personality prefix among these
        for (const earlierMsg of earlierBotMessages) {
          const prefixMatch = earlierMsg.content.match(/^\*\*([^:]+):\*\* /);
          if (prefixMatch) {
            const potentialName = prefixMatch[1];
            logger.info(
              `[DmHandler] Found potential personality name in earlier message: ${potentialName}`
            );

            // Check if the replied-to message was sent within a reasonable time
            // (typically within a minute or two for multi-chunk messages)
            const timeDiff = repliedToMessage.createdTimestamp - earlierMsg.createdTimestamp;
            if (timeDiff <= 120000) {
              // Within 2 minutes
              displayName = potentialName;
              if (displayName.includes(' | ')) {
                displayName = displayName.split(' | ')[0];
              }
              isMultiChunkReply = true;
              logger.info(
                `[DmHandler] Identified as a reply to chunk of multi-part message from: ${displayName}`
              );
              break;
            }
          }
        }
      } catch (lookupError) {
        logger.error(`[DmHandler] Error looking up previous messages: ${lookupError.message}`);
        logger.debug(
          `[DmHandler] Lookup error stack: ${lookupError.stack || 'No stack available'}`
        );
      }
    }

    // If we found a display name (either directly or from an earlier message)
    if (displayName) {
      // Attempt to find the personality by display name
      try {
        // Try to get personality by alias (global lookup)
        personality = await getPersonalityByAlias(displayName);

        if (personality) {
          logger.info(`[DmHandler] Found personality by alias: ${personality.fullName}`);
        }

        // If still not found, try by direct personality name
        if (!personality) {
          personality = await getPersonality(displayName);

          if (personality) {
            logger.info(`[DmHandler] Found personality directly by name: ${personality.fullName}`);
          }
        }

        // If still not found, try more flexible matching strategies
        if (!personality) {
          // Get all personalities for this user
          const personalities = await listPersonalitiesForUser(message.author.id);
          logger.info(
            `[DmHandler] Found ${personalities?.length || 0} personalities for user ${message.author.id}`
          );

          if (personalities && personalities.length > 0) {
            // Log first personality for debugging
            logger.debug(
              `[DmHandler] First personality: ${JSON.stringify({
                fullName: personalities[0].fullName,
                displayName: personalities[0].displayName,
              })}`
            );

            // Convert display name to lowercase for case-insensitive matching
            const displayNameLower = displayName.toLowerCase();

            // Try to find the personality using multiple matching approaches
            personality = personalities.find(p => {
              // Skip null or undefined display names
              if (!p || !p.fullName) return false;

              // Try direct match with display name
              if (p.displayName && p.displayName.toLowerCase() === displayNameLower) {
                logger.info(
                  `[DmHandler] Found personality by exact display name match: ${p.displayName}`
                );
                return true;
              }

              // Try prefix match with display name (e.g., "Lilith" matches "Lilith Tzel Shani")
              if (p.displayName && p.displayName.toLowerCase().startsWith(displayNameLower)) {
                logger.info(
                  `[DmHandler] Found personality by display name prefix match: ${p.displayName} matches prefix ${displayNameLower}`
                );
                return true;
              }

              // Try standardized username match
              const standardName = getStandardizedUsername(p).toLowerCase();
              if (standardName === displayNameLower) {
                logger.info(
                  `[DmHandler] Found personality by standardized name match: ${standardName}`
                );
                return true;
              }

              // Try matching first part of the full name (e.g., "lilith" matches "lilith-tzel-shani")
              const firstPart = p.fullName.split('-')[0].toLowerCase();
              if (firstPart === displayNameLower) {
                logger.info(
                  `[DmHandler] Found personality by first part of full name: ${firstPart}`
                );
                return true;
              }

              // Try by exact full name
              if (p.fullName.toLowerCase() === displayNameLower) {
                logger.info(
                  `[DmHandler] Found personality by exact full name match: ${p.fullName}`
                );
                return true;
              }

              return false;
            });
          }
        }
      } catch (lookupError) {
        logger.error(`[DmHandler] Error during personality lookup: ${lookupError.message}`);
        logger.debug(
          `[DmHandler] Lookup error stack: ${lookupError.stack || 'No stack available'}`
        );
      }

      // Debug log the match result
      if (personality) {
        logger.info(
          `[DmHandler] Found matching personality: ${personality.fullName} (${personality.displayName})`
        );
        if (isMultiChunkReply) {
          logger.info(`[DmHandler] This is a reply to a non-first chunk of a multi-part message`);
        }
      } else {
        logger.warn(`[DmHandler] No matching personality found for: ${displayName}`);
      }
    } else {
      logger.debug(
        `[DmHandler] No personality name found in replied message: ${content.substring(0, 50)}`
      );
    }

    if (personality) {
      // Handle this as a personality interaction
      await personalityHandler.handlePersonalityInteraction(message, personality, null, client);
      return true; // Message was handled
    }
  } catch (error) {
    logger.error(`[DmHandler] Error handling DM reply: ${error.message}`);
    logger.debug(`[DmHandler] Error stack: ${error.stack || 'No stack available'}`);
  }

  return false; // Message was not handled
}

/**
 * Handles direct messages that aren't replies
 * @param {Object} message - Discord message object
 * @param {Object} client - Discord.js client instance
 * @param {Object} authManager - Auth manager instance
 * @returns {Promise<boolean>} - True if the message was handled, false otherwise
 */
async function handleDirectMessage(message, client) {
  if (!message.channel.isDMBased() || message.author.bot) {
    return false;
  }

  // For all personality interactions, first check if the user is age-verified
  // For webhook users like PluralKit, we may need special handling

  // Check if this is a trusted proxy system that should bypass verification
  const shouldBypass = webhookUserTracker.shouldBypassNsfwVerification(message);

  // If we should bypass verification, treat as verified
  const isVerified = shouldBypass ? true : await isNsfwVerified(message.author.id);

  if (!isVerified) {
    // User is not verified, prompt them to verify first
    logger.info(
      `[DmHandler] User ${message.author.id} attempted to use personalities without verification in DM`
    );
    try {
      await message.reply(
        '⚠️ **Age Verification Required**\n\n' +
          'To use AI personalities, you need to verify your age first.\n\n' +
          `Please run \`${botPrefix} verify\` in a channel marked as NSFW. ` +
          "This will verify that you meet Discord's age requirements for accessing NSFW content."
      );
    } catch (error) {
      logger.error(`[DmHandler] Error sending verification prompt: ${error.message}`);
      logger.debug(`[DmHandler] Error stack: ${error.stack || 'No stack available'}`);
    }
    return true; // We handled this message with the verification prompt
  }

  // User is verified, continue with normal DM functionality
  // For DM channels, check for active conversations without requiring explicit mentions
  const activePersonalityName = getActivePersonality(message.author.id, message.channel.id, true);

  if (activePersonalityName) {
    logger.info(`[DmHandler] Using sticky personality in DM: ${activePersonalityName}`);

    // Get the personality data
    let personality = await getPersonality(activePersonalityName);
    if (!personality) {
      personality = await getPersonalityByAlias(activePersonalityName);
    }

    if (personality) {
      // No need for proxy handling in DMs (PluralKit doesn't work in DMs)
      // Just continue with the active personality
      await personalityHandler.handlePersonalityInteraction(message, personality, null, client);
      return true; // Message was handled
    }
  } else {
    // No active conversation in DM, prompt the user to summon a personality
    logger.info(`[DmHandler] No active conversation in DM, prompting user to summon a personality`);
    try {
      await message.reply(
        'To chat with a personality, please tag them with `@name` or reply to one of their messages.'
      );
    } catch (error) {
      logger.error(`[DmHandler] Error sending DM prompt: ${error.message}`);
      logger.debug(`[DmHandler] Error stack: ${error.stack || 'No stack available'}`);
    }
    return true; // Message was handled with the prompt
  }

  return false; // Message was not handled
}

module.exports = {
  handleDmReply,
  handleDirectMessage,
};
