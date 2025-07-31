/**
 * Personality Interaction Handler Module
 *
 * This module handles all interactions with AI personalities, including:
 * - Processing user messages
 * - Handling NSFW and age verification requirements
 * - Processing references and media
 * - Managing conversation context
 * - Sending responses via webhooks
 */

const logger = require('../logger');
const { getAiResponse } = require('../aiService');
const webhookManager = require('../webhookManager');
const webhookUserTracker = require('../utils/webhookUserTracker');
const referenceHandler = require('./referenceHandler');
const { detectMedia } = require('../utils/media');
const { MARKERS } = require('../constants');
const {
  recordConversation,
  isAutoResponseEnabled,
  getPersonalityFromMessage,
} = require('../core/conversation');
const requestTracker = require('../utils/requestTracker');
// personalityAuth utility removed - using DDD authentication directly
const threadHandler = require('../utils/threadHandler');
const { botPrefix } = require('../../config');

// Injectable timer functions for testability
// Using the injectable pattern as documented in docs/core/TIMER_PATTERNS.md
const globalSetTimeout = setTimeout;
const globalClearTimeout = clearTimeout;
const globalSetInterval = setInterval;
const globalClearInterval = clearInterval;

let timerFunctions = {
  setTimeout: (callback, delay, ...args) => globalSetTimeout(callback, delay, ...args),
  clearTimeout: id => globalClearTimeout(id),
  setInterval: (callback, delay, ...args) => globalSetInterval(callback, delay, ...args),
  clearInterval: id => globalClearInterval(id),
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

// Injectable delay function for testability
let delayFn = ms => new Promise(resolve => timerFunctions.setTimeout(resolve, ms));

/**
 * Configure the delay function (for testing)
 * @param {Function} customDelay - Custom delay implementation
 */
function configureDelay(customDelay) {
  delayFn = customDelay;
}

/**
 * Set the authentication service (dependency injection)
 * @param {Object} authService - Authentication service instance
 */
function setAuthService(authService) {
  injectedAuthService = authService;
}

/**
 * Clear injected dependencies (for testing)
 */
function clearCache() {
  injectedAuthService = null;
}

/**
 * Check if user can interact with a personality using DDD authentication
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality object
 * @returns {Promise<Object>} Result with isAllowed and error message if applicable
 */
// Injected auth service to avoid circular dependencies
let injectedAuthService = null;

async function checkPersonalityAuth(message, personality) {
  try {
    // Use injected auth service or throw error if not set
    if (!injectedAuthService) {
      throw new Error('Authentication service not initialized. Call setAuthService() first.');
    }
    const authService = injectedAuthService;

    const webhookUserTracker = require('../utils/webhookUserTracker');

    // CRITICAL: Handle proxy systems (PluralKit) specially
    // If this is a proxy system webhook, use the specialized proxy authentication
    if (message.webhookId && webhookUserTracker.isProxySystemWebhook(message)) {
      logger.debug(
        `[PersonalityHandler] Detected proxy system webhook, using specialized authentication`
      );

      const proxyAuth = await webhookUserTracker.checkProxySystemAuthentication(message);

      if (!proxyAuth.isAuthenticated) {
        return {
          isAllowed: false,
          errorMessage: `Authentication required. Use \`${botPrefix} auth start\` to authenticate first.`,
          reason: 'auth_failed',
        };
      }

      // For proxy systems, we have the real user ID, so check access with DDD system
      const { AuthContext } = require('../domain/authentication/AuthContext');
      const { isChannelNSFW } = require('../utils/channelUtils');

      const channelType = message.channel.isDMBased?.()
        ? 'DM'
        : message.channel.isThread?.()
          ? 'THREAD'
          : 'GUILD';
      const authContext = new AuthContext({
        channelType,
        channelId: message.channel.id,
        isNsfwChannel: isChannelNSFW(message.channel),
        isProxyMessage: true,
        requestedPersonalityId: personality.name,
      });

      const result = await authService.checkPersonalityAccess(
        proxyAuth.userId,
        personality,
        authContext
      );

      if (!result.allowed) {
        return {
          isAllowed: false,
          errorMessage: result.reason || 'Authorization failed',
          reason: 'auth_failed',
        };
      }

      return {
        isAllowed: true,
        isProxySystem: true,
        isDM: message.channel.isDMBased?.() || false,
        realUserId: proxyAuth.userId,
      };
    }

    // For non-proxy messages, use standard DDD authentication
    const realUserId = webhookUserTracker.getRealUserId(message) || message.author.id;

    logger.debug(
      `[PersonalityHandler] Checking auth for realUserId: ${realUserId} (message.author.id: ${message.author.id})`
    );

    // Check personality access using DDD system
    const { AuthContext } = require('../domain/authentication/AuthContext');
    const { isChannelNSFW } = require('../utils/channelUtils');

    // Create auth context
    const channelType = message.channel.isDMBased?.()
      ? 'DM'
      : message.channel.isThread?.()
        ? 'THREAD'
        : 'GUILD';
    const authContext = new AuthContext({
      channelType,
      channelId: message.channel.id,
      isNsfwChannel: isChannelNSFW(message.channel),
      isProxyMessage: !!message.webhookId,
      requestedPersonalityId: personality.name,
    });

    const result = await authService.checkPersonalityAccess(realUserId, personality, authContext);

    if (!result.allowed) {
      return {
        isAllowed: false,
        errorMessage: result.reason || 'Authorization failed',
        reason: 'auth_failed',
      };
    }

    // Return success with context information
    return {
      isAllowed: true,
      isProxySystem: false,
      isDM: message.channel.isDMBased?.() || false,
    };
  } catch (error) {
    logger.error('[PersonalityHandler] Error checking personality auth:', error);
    return {
      isAllowed: false,
      errorMessage: 'An error occurred while checking authorization.',
      reason: 'error',
    };
  }
}

/**
 * Send authentication error message to user
 * @param {Object} message - Discord message object
 * @param {string} errorMessage - Error message to send
 */
async function sendAuthError(message, errorMessage) {
  try {
    await message.reply({
      content: errorMessage,
    });
  } catch (error) {
    logger.error('[PersonalityHandler] Error sending auth error message:', error);
  }
}

/**
 * Generate model usage indicator based on metadata
 * @param {Object} metadata - Response metadata from AI service
 * @returns {string} - Model indicator string or empty string
 */
function generateModelIndicator(metadata) {
  if (!metadata) {
    return '';
  }

  let indicator = '';
  if (metadata.fallback_model_used === true) {
    indicator = 'Fallback Model Used';
  } else if (metadata.is_premium === true) {
    indicator = 'Primary Model Used (Premium)';
  } else if (metadata.is_premium === false) {
    indicator = 'Primary Model Used (Free)';
  }

  return indicator ? `\n-# ${indicator}` : '';
}

/**
 * Start typing indicator for a channel
 * @param {Object} channel - Discord channel object
 * @returns {number} Interval ID for the typing indicator
 */
function startTypingIndicator(channel) {
  try {
    // Start typing
    channel.sendTyping().catch(error => {
      logger.warn(`[PersonalityHandler] Failed to start typing indicator: ${error.message}`);
    });

    // Set up interval for continuous typing (every 5 seconds)
    return timerFunctions.setInterval(() => {
      channel.sendTyping().catch(error => {
        logger.warn(`[PersonalityHandler] Failed to continue typing indicator: ${error.message}`);
      });
    }, 5000);
  } catch (error) {
    logger.warn(`[PersonalityHandler] Error setting up typing indicator: ${error.message}`);
    return null; // Return null if failed to set up the interval
  }
}

/**
 * Record conversation data for tracking
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {Object} result - Response result from webhook
 * @param {string} personalityName - Personality name
 * @param {boolean} [isDM=false] - Whether this is a DM channel
 * @param {boolean} [isMentionOnly=false] - Whether this conversation was initiated by a mention
 */
function recordConversationData(
  userId,
  channelId,
  result,
  personalityName,
  isDM = false,
  isMentionOnly = false
) {
  // Format message IDs for tracking
  const messageIds = Array.isArray(result.messageIds)
    ? result.messageIds
    : [result.messageIds].filter(Boolean);

  if (messageIds.length > 0) {
    // Record each message ID in our conversation tracker
    messageIds.forEach(messageId => {
      if (messageId) {
        recordConversation(userId, channelId, messageId, personalityName, isDM, isMentionOnly);
      }
    });
  } else {
    logger.warn(
      `[PersonalityHandler] No message IDs to record for conversation with ${personalityName}`
    );
  }
}

/**
 * Handle interaction with a personality
 * @param {Object} message - Discord message object
 * @param {Object} personality - Personality data
 * @param {string} [triggeringMention=null] - The specific @mention text that triggered this interaction
 * @param {Object} client - Discord client instance
 * @returns {Promise<void>} - Returns nothing
 */
async function handlePersonalityInteraction(
  message,
  personality,
  triggeringMention = null,
  client
) {
  let typingInterval;
  let requestKey;

  try {
    // Perform complete authentication check
    const authResult = await checkPersonalityAuth(message, personality);

    if (!authResult.isAllowed) {
      // Authentication failed - send error message and exit
      await sendAuthError(message, authResult.errorMessage);
      return; // Exit without processing the personality interaction
    }

    // Extract authentication results
    const { isProxySystem, isDM } = authResult;

    // Debug logging for proxy system detection
    if (message.webhookId) {
      logger.info(
        `[PersonalityHandler] Processing webhook message - webhookId: ${message.webhookId}, isProxySystem: ${isProxySystem}, author.username: "${message.author.username}"`
      );
    }

    // CRITICAL: Check autoresponse status NOW, not later
    // This prevents race conditions where autoresponse changes during processing
    const conversationUserId = webhookUserTracker.getRealUserId(message) || message.author.id;
    const autoResponseEnabledAtStart = isAutoResponseEnabled(conversationUserId);

    logger.debug(
      `[PersonalityHandler] Starting interaction - User: ${conversationUserId}, ` +
        `autoResponseEnabled: ${autoResponseEnabledAtStart}, triggeringMention: ${triggeringMention}`
    );

    // Flag to indicate if this message is a reply to a DM message with a personality prefix
    // This will help prevent duplicate personality prefixes in responses
    const isReplyToDMFormattedMessage =
      isDM && message.reference && triggeringMention === null ? true : false;

    // Track the request to prevent duplicates
    // For PluralKit messages, use the real user ID instead of the webhook author ID
    const trackerRealUserId = webhookUserTracker.getRealUserId(message);

    requestKey = requestTracker.trackRequest(
      trackerRealUserId || message.author.id,
      message.channel.id,
      personality.fullName
    );
    if (!requestKey) {
      return; // Don't process duplicate requests
    }

    // Show typing indicator
    typingInterval = startTypingIndicator(message.channel);

    // Check for image/audio attachments or URLs in text
    let messageContent = message.content || '';

    // Check if this message is a reply to another message or contains a message link
    let referencedMessageContent = null;
    let referencedMessageAuthor = null;
    let referencedMessageAuthorId = null; // Add author ID for self-reference detection
    let isReferencedMessageFromBot = false;
    let referencedImageUrl = null;
    let referencedAudioUrl = null;

    // Initialize reference personality variables at a higher scope so they're accessible later
    let referencedPersonalityInfo = null;
    let referencedWebhookName = null;
    let referencedMessageTimestamp = null; // Store the actual timestamp of the referenced message

    // Determine if this is an active personality context
    // It's active if it's NOT triggered by a mention (null triggeringMention means reply or active conversation)
    const hasActivePersonality = !triggeringMention;

    // First, handle direct replies
    if (message.reference && message.reference.messageId) {
      try {
        // Fetch the message being replied to
        const repliedToMessage = await message.channel.messages.fetch(message.reference.messageId);

        // Extract the content and author information
        if (repliedToMessage) {
          referencedMessageContent = repliedToMessage.content || '';
          referencedMessageAuthor = repliedToMessage.author?.username || 'another user';
          referencedMessageAuthorId = repliedToMessage.author?.id || null;
          isReferencedMessageFromBot = repliedToMessage.author?.bot || false;
          referencedMessageTimestamp = repliedToMessage.createdTimestamp; // Capture the actual timestamp

          // If it's a webhook, try to get personality name
          if (repliedToMessage.webhookId) {
            referencedWebhookName = repliedToMessage.author?.username || null;

            // Try to get the personality from webhook username or from our message map
            try {
              // Try to look up by message ID first
              const personalityName = await getPersonalityFromMessage(repliedToMessage.id, {
                webhookUsername: referencedWebhookName,
              });

              if (personalityName) {
                // For now, use the webhook username as display name if available,
                // otherwise extract from the personality name
                const displayName = referencedWebhookName || personalityName.split('-')[0];

                referencedPersonalityInfo = {
                  name: personalityName,
                  displayName: displayName,
                };

                logger.info(
                  `[PersonalityHandler] Identified referenced message as from personality: ${personalityName}`
                );
              }
            } catch (personalityLookupError) {
              logger.error(
                `[PersonalityHandler] Error looking up message personality: ${personalityLookupError.message}`
              );
            }
          }

          // Skip media attachments for personalities since they're redundant with text content
          // There are two ways to identify a personality message:
          // 1. It has a webhook ID and we found a personality name with lookups
          // 2. For DM channels, it's a bot message with the **Name:** prefix format
          const isPersonalityByLookup =
            repliedToMessage.webhookId && referencedPersonalityInfo?.name;
          const isDMPersonalityFormat =
            repliedToMessage.channel.isDMBased() &&
            repliedToMessage.author?.id === client.user.id &&
            repliedToMessage.content?.match(/^\*\*([^:]+):\*\* /);

          const isFromPersonality = isPersonalityByLookup || isDMPersonalityFormat;

          if (isDMPersonalityFormat && !referencedPersonalityInfo?.name) {
            // If we identified a DM personality format but didn't set referencedPersonalityInfo,
            // extract the personality name from the prefix
            const dmFormatMatch = repliedToMessage.content.match(/^\*\*([^:]+):\*\* /);
            if (dmFormatMatch && dmFormatMatch[1]) {
              const displayName = dmFormatMatch[1];
              const baseName = displayName.includes(' | ')
                ? displayName.split(' | ')[0]
                : displayName;
              logger.info(
                `[PersonalityHandler] Identified DM personality format message with display name: ${baseName}`
              );

              // For DM messages, we can use the display name from the message prefix
              // We don't have the full personality name, but that's okay for the AI context
              referencedPersonalityInfo = {
                name: baseName, // Using the display name since we don't have the full name
                displayName: baseName,
              };
              logger.info(`[PersonalityHandler] Using display name from DM message: ${baseName}`);
            }
          }

          // Process media attachments in the referenced message using the media handler
          if (repliedToMessage.attachments && repliedToMessage.attachments.size > 0) {
            // Use the extractMediaFromAttachments helper
            if (isFromPersonality) {
              logger.info(
                `[PersonalityHandler] Skipping media attachments for personality message from: ${referencedPersonalityInfo.name}`
              );
            } else {
              // Check for audio attachments first (priority over images)
              const audioAttachment = Array.from(repliedToMessage.attachments.values()).find(
                attachment =>
                  (attachment.contentType && attachment.contentType.startsWith('audio/')) ||
                  attachment.url?.endsWith('.mp3') ||
                  attachment.url?.endsWith('.wav') ||
                  attachment.url?.endsWith('.ogg')
              );

              if (audioAttachment) {
                // Add audio URL to the content
                referencedMessageContent += `\n[Audio: ${audioAttachment.url}]`;
                referencedAudioUrl = audioAttachment.url;
                logger.info(
                  `[PersonalityHandler] Referenced message contains audio: ${audioAttachment.url}`
                );
              } else {
                // Check for image attachments if no audio
                const imageAttachment = Array.from(repliedToMessage.attachments.values()).find(
                  attachment =>
                    attachment.contentType && attachment.contentType.startsWith('image/')
                );

                if (imageAttachment) {
                  // Add image URL to the content
                  referencedMessageContent += `\n[Image: ${imageAttachment.url}]`;
                  referencedImageUrl = imageAttachment.url;
                  logger.info(
                    `[PersonalityHandler] Referenced message contains an image: ${imageAttachment.url}`
                  );
                }
              }
            }
          }

          // Process embeds in the referenced message
          if (repliedToMessage.embeds && repliedToMessage.embeds.length > 0) {
            // Use the embed utils to parse embeds
            const embedUtils = require('../utils/embedUtils');

            // First, extract any Discord message links from the embeds
            const embedLinks = embedUtils.extractDiscordLinksFromEmbeds(repliedToMessage.embeds);
            if (embedLinks.length > 0) {
              logger.info(
                `[PersonalityHandler] Found ${embedLinks.length} Discord links in referenced message embeds`
              );
              // Add the first link to the message content so it can be processed later
              // We add it as plain text so the regex can find it
              referencedMessageContent += '\n' + embedLinks[0];
            }

            // Then parse the embeds to text
            referencedMessageContent += embedUtils.parseEmbedsToText(
              repliedToMessage.embeds,
              'referenced message'
            );

            // If we haven't found media yet and this isn't a personality message, extract media from embeds
            if (!isFromPersonality && !referencedImageUrl && !referencedAudioUrl) {
              const embedMedia = embedUtils.extractMediaFromEmbeds(repliedToMessage.embeds, true);

              if (embedMedia.hasAudio) {
                referencedAudioUrl = embedMedia.audioUrl;
                logger.info(
                  `[PersonalityHandler] Found audio in referenced message embed: ${referencedAudioUrl}`
                );
              } else if (embedMedia.hasImage) {
                referencedImageUrl = embedMedia.imageUrl;
                logger.info(
                  `[PersonalityHandler] Found image in referenced message embed: ${referencedImageUrl}`
                );
              }
            }
          }

          logger.info(
            `[PersonalityHandler] Found referenced message (reply) from ${referencedMessageAuthor}: "${referencedMessageContent.substring(0, 50)}${referencedMessageContent.length > 50 ? '...' : ''}"`
          );

          // Handle nested references if we have an active conversation or autoresponse
          // This ensures the personality can see the full conversation context
          if (
            repliedToMessage.reference &&
            (hasActivePersonality || isAutoResponseEnabled(message.author.id))
          ) {
            logger.info(
              `[PersonalityHandler] Detected nested reference in active conversation context`
            );

            try {
              // Fetch the nested referenced message
              const nestedReferencedMessage = await message.channel.messages.fetch(
                repliedToMessage.reference.messageId
              );

              if (nestedReferencedMessage) {
                // Add nested reference context to the referenced message content
                const nestedAuthor = nestedReferencedMessage.author?.username || 'another user';
                const nestedContent = nestedReferencedMessage.content || '[no content]';

                // Prepend the nested context to show the conversation flow
                referencedMessageContent = `[Earlier message from ${nestedAuthor}: "${nestedContent.substring(0, 100)}${nestedContent.length > 100 ? '...' : ''}"] ${referencedMessageContent}`;

                logger.info(
                  `[PersonalityHandler] Added nested reference context from ${nestedAuthor}`
                );
              }
            } catch (nestedError) {
              logger.warn(
                `[PersonalityHandler] Could not fetch nested reference: ${nestedError.message}`
              );
              // Continue without nested context
            }
          }
        }
      } catch (error) {
        logger.error(`[PersonalityHandler] Error fetching referenced message: ${error.message}`);
        // Continue without the referenced message if there's an error
      }
    }

    // Check if the referenced message contains Discord links that we should process
    // This handles the case where user replies to their own message containing a link
    if (referencedMessageContent && triggeringMention) {
      const referencedLinkResult = await referenceHandler.processMessageLinks(
        message,
        referencedMessageContent,
        referencedPersonalityInfo,
        isReferencedMessageFromBot,
        referencedWebhookName,
        triggeringMention,
        client,
        true // Process links when replying with a mention
      );

      if (referencedLinkResult.hasProcessedLink) {
        // Update the referenced message content with processed link
        referencedMessageContent = referencedLinkResult.messageContent;

        // If we found a Discord message link in the referenced message,
        // add its content to our context
        if (referencedLinkResult.referencedMessageContent) {
          referencedMessageContent +=
            '\n[Linked Message]: ' + referencedLinkResult.referencedMessageContent;

          // Update other reference info if found
          if (referencedLinkResult.referencedPersonalityInfo?.displayName) {
            referencedMessageContent +=
              ' (from ' + referencedLinkResult.referencedPersonalityInfo.displayName + ')';
          } else if (referencedLinkResult.referencedWebhookName) {
            referencedMessageContent +=
              ' (from ' + referencedLinkResult.referencedWebhookName + ')';
          } else if (
            referencedLinkResult.referencedMessageAuthor &&
            referencedLinkResult.referencedMessageAuthor !== 'another user'
          ) {
            referencedMessageContent +=
              ' (from ' + referencedLinkResult.referencedMessageAuthor + ')';
          }
        }

        logger.info(`[PersonalityHandler] Processed Discord link from referenced message`);
      }
    }

    // Use the reference handler to process message links in the current message
    logger.debug(
      `[PersonalityHandler] Calling processMessageLinks with messageContent: "${messageContent}", triggeringMention: "${triggeringMention}", hasActivePersonality: ${hasActivePersonality}`
    );
    const linkResult = await referenceHandler.processMessageLinks(
      message,
      messageContent,
      referencedPersonalityInfo,
      isReferencedMessageFromBot,
      referencedWebhookName,
      triggeringMention,
      client,
      hasActivePersonality
    );

    // Update variables with the processed results
    if (linkResult.hasProcessedLink) {
      logger.info(
        `[PersonalityHandler] ProcessMessageLinks returned with processed link - hasImage: ${!!linkResult.referencedImageUrl}, hasAudio: ${!!linkResult.referencedAudioUrl}`
      );
      messageContent = linkResult.messageContent;
      referencedMessageContent = linkResult.referencedMessageContent;
      referencedMessageAuthor = linkResult.referencedMessageAuthor;
      referencedMessageAuthorId = linkResult.referencedMessageAuthorId || null;
      isReferencedMessageFromBot = linkResult.isReferencedMessageFromBot;
      referencedPersonalityInfo = linkResult.referencedPersonalityInfo;
      referencedWebhookName = linkResult.referencedWebhookName;

      // Update media URLs from the linked message if they weren't already set
      if (linkResult.referencedAudioUrl && !referencedAudioUrl) {
        referencedAudioUrl = linkResult.referencedAudioUrl;
        logger.info(`[PersonalityHandler] Found audio in linked message: ${referencedAudioUrl}`);
      }
      if (linkResult.referencedImageUrl && !referencedImageUrl && !referencedAudioUrl) {
        // Only use image if no audio is present (audio takes priority)
        referencedImageUrl = linkResult.referencedImageUrl;
        logger.info(`[PersonalityHandler] Found image in linked message: ${referencedImageUrl}`);
      }
    } else {
      logger.debug(`[PersonalityHandler] ProcessMessageLinks did not process any links`);
    }

    // Get the user's display name and username
    const userDisplayName = message.member?.displayName || message.author?.username || 'User';
    const userUsername = message.author?.username || 'user';

    // For PluralKit or webhook messages, just use the display name to avoid redundancy
    // PluralKit names often include system tags like "Name | System"
    // IMPORTANT: Use webhookUserTracker for better Pluralkit detection
    const isWebhookMessage = message.webhookId && webhookUserTracker.isProxySystemWebhook(message);
    const formattedUserName = isWebhookMessage
      ? userDisplayName // Just use display name for PluralKit
      : `${userDisplayName} (${userUsername})`; // Include username for regular users

    // Process media in the message and referenced media using the media handler
    const mediaOptions = {
      referencedAudioUrl: referencedAudioUrl,
      referencedImageUrl: referencedImageUrl,
      personalityName: personality.displayName || personality.fullName,
      userName: formattedUserName,
    };

    logger.debug(
      `[PersonalityHandler] Calling detectMedia with referencedImageUrl: ${referencedImageUrl}, referencedAudioUrl: ${referencedAudioUrl}`
    );

    // The media handler will detect and process all media (message content, attachments, embeds)
    // and create multimodal content if needed
    const mediaResult = await detectMedia(message, messageContent, mediaOptions);

    // Update message content with processed result (could be string or multimodal array)
    messageContent = mediaResult.messageContent;

    // If we found referenced content, modify how we send to the AI service
    let finalMessageContent;
    if (referencedMessageContent) {
      // Already initialized with default values above, just add a debug log if they're null
      if (referencedPersonalityInfo === null && referencedWebhookName === null) {
        logger.debug(`[PersonalityHandler] No personality info found for referenced message`);
      }

      // Check if the referenced message is from the same personality we're replying as
      // AND it's in the same thread/channel and recent enough (within the past hour)
      // Use the actual timestamp from the fetched referenced message
      const referenceTimestamp = referencedMessageTimestamp || Date.now();

      // Add guards against any potential undefined/null values
      const samePersonality =
        referencedPersonalityInfo?.name &&
        personality?.fullName &&
        referencedPersonalityInfo.name === personality.fullName;

      const sameChannel =
        message?.channel?.id &&
        message?.reference?.channelId &&
        message.channel.id === message.reference.channelId;

      const isRecent = referenceTimestamp && Date.now() - referenceTimestamp < 24 * 60 * 60 * 1000;

      // Expanded logging to diagnose issues
      logger.debug(
        `[PersonalityHandler] Reference personality check: ${samePersonality ? 'SAME' : 'DIFFERENT'} (${referencedPersonalityInfo?.name} vs ${personality?.fullName})`
      );
      logger.debug(
        `[PersonalityHandler] Reference channel check: ${sameChannel ? 'SAME' : 'DIFFERENT'}`
      );
      logger.debug(
        `[PersonalityHandler] Reference recency check: ${isRecent ? 'RECENT' : 'OLD'} (${referenceTimestamp ? (() => {
          const minsAgo = Math.round((Date.now() - referenceTimestamp) / 1000 / 60);
          if (minsAgo < 60) return minsAgo + ' mins ago';
          const hoursAgo = Math.round(minsAgo / 60);
          return hoursAgo + ' hours ago';
        })() : 'unknown'})`
      );

      // Re-enable the same-personality optimization now that we've fixed the variable scope issues
      const isReferencingSamePersonality = samePersonality && sameChannel && isRecent;

      if (isReferencingSamePersonality) {
        logger.info(
          `[PersonalityHandler] Detected same-personality recent message in same channel - skipping reference context for ${personality.fullName}`
        );
        finalMessageContent = messageContent; // Just use the original content without the reference
      } else {
        // Get the user's name from message author (could be nickname or username)
        const userDisplayName =
          message.member?.displayName || message.author?.username || 'The user';

        // Format as a complex object with the reference information
        finalMessageContent = {
          messageContent: messageContent, // Original message content (text or multimodal array)
          userName: userDisplayName, // Add the user's display name or username
          userId: message.author?.id, // Add user ID for self-reference detection
          referencedMessage: {
            content: referencedMessageContent,
            author: referencedMessageAuthor,
            authorId: referencedMessageAuthorId, // Add author ID
            isFromBot: isReferencedMessageFromBot,
            personalityName: referencedPersonalityInfo?.name,
            personalityDisplayName: referencedPersonalityInfo?.displayName,
            webhookName: referencedWebhookName,
            // Include extracted media URLs from embeds
            imageUrl: referencedImageUrl,
            audioUrl: referencedAudioUrl,
          },
        };
      }
    } else {
      // No reference, use the original content
      finalMessageContent = messageContent;
    }

    // Get the AI response from the service
    // For webhook messages (PluralKit), use the real user ID for authentication
    // For regular messages, use the message author's ID
    const userId = webhookUserTracker.getRealUserId(message) || message.author?.id;
    logger.debug(`[PersonalityHandler] Using user ID for authentication: ${userId || 'none'} (message.author.id: ${message.author?.id})`);

    // Debug logging for proxy context
    if (message.webhookId) {
      logger.info(
        `[PersonalityHandler] Webhook message detected - webhookId: ${message.webhookId}, isProxySystem: ${isWebhookMessage}, userName: "${formattedUserName}", realUserId: ${userId}`
      );
    }

    const aiResponseData = await getAiResponse(personality.fullName, finalMessageContent, {
      userId: userId,
      channelId: message.channel.id,
      messageId: message.id, // Add message ID for better deduplication
      // Pass the original message object for webhook detection
      message: message,
      // Pass the user's formatted name for audio transcript prompts
      userName: formattedUserName,
      // Flag to indicate if this is a proxy system message (PluralKit, etc)
      isProxyMessage: isWebhookMessage || false,
      // Pass the disableContextMetadata flag if set on the personality configuration
      disableContextMetadata: personality.configuration?.disableContextMetadata || false,
    });

    // Clear typing indicator interval
    timerFunctions.clearInterval(typingInterval);
    typingInterval = null;

    // Extract content and metadata from the response
    const aiResponse = aiResponseData.content;
    const metadata = aiResponseData.metadata;

    // Check for BOT_ERROR_MESSAGE marker - these should come from the bot, not the personality
    if (
      aiResponse &&
      typeof aiResponse === 'string' &&
      aiResponse.startsWith(MARKERS.BOT_ERROR_MESSAGE)
    ) {
      // Extract the actual error message by removing the marker
      const errorMessage = aiResponse.replace(MARKERS.BOT_ERROR_MESSAGE, '').trim();
      logger.info(
        `[PersonalityHandler] Sending error message from bot instead of personality: ${errorMessage}`
      );

      // Send the message as the bot instead of through the webhook
      await message.reply(errorMessage);
      return; // Exit early - we've handled this message directly
    }

    // Add a small delay before sending any webhook message
    // This helps prevent the race condition between error messages and real responses
    await delayFn(500);

    // Process markdown-style image links if present
    // Pattern: [https://files.example.com/image.png](https://files.example.com/image.png)
    let processedResponse = aiResponse;
    if (typeof aiResponse === 'string') {
      // Regex to match markdown image links at the end of the message
      const markdownImageRegex = /\[([^\]]+\.(png|jpg|jpeg|gif|webp|bmp))\]\(\1\)$/i;
      const match = aiResponse.match(markdownImageRegex);

      if (match) {
        const imageUrl = match[1];
        logger.info(`[PersonalityHandler] Detected markdown image link: ${imageUrl}`);

        // Remove the markdown link from the response
        processedResponse = aiResponse.replace(markdownImageRegex, '').trim();

        // Add the image in the format that mediaHandler expects
        // This will trigger the image download and reupload
        processedResponse = `${processedResponse}\n[Image: ${imageUrl}]`;
        logger.debug(`[PersonalityHandler] Converted to media handler format`);
      }
    }

    // Send response and record conversation
    // Pass the original message to ensure we use the correct user's auth token
    // This ensures user authentication is preserved when replying to webhook messages

    // Detect thread and prepare webhook options
    const threadInfo = threadHandler.detectThread(message.channel);

    // Log thread info for debugging
    if (threadInfo.isThread) {
      const info = threadHandler.getThreadInfo(message.channel);
      logger.info(`[PersonalityHandler] Thread info: ${JSON.stringify(info)}`);
    }

    // Generate model indicator for the message
    const modelIndicator = generateModelIndicator(metadata);

    // Build webhook options with thread support
    const webhookOptions = threadHandler.buildThreadWebhookOptions(
      message.channel,
      trackerRealUserId || message.author?.id,
      threadInfo,
      isReplyToDMFormattedMessage
    );
    
    // Add model indicator to webhook options
    webhookOptions.modelIndicator = modelIndicator;

    // Send the response using appropriate method
    let result;
    if (threadInfo.isThread) {
      // Use thread-specific handling with fallback strategies
      result = await threadHandler.sendThreadMessage(
        webhookManager,
        message.channel,
        processedResponse,
        personality,
        webhookOptions,
        message
      );
    } else {
      // For non-thread channels, use the standard webhook approach
      result = await webhookManager.sendWebhookMessage(
        message.channel,
        processedResponse,
        personality,
        webhookOptions,
        message // Pass the original message for user authentication
      );
    }

    // Request tracking cleanup moved to finally block to ensure it always runs

    // Record this conversation with all message IDs
    // We already got conversationUserId earlier in the function

    // Use the autoresponse status from the START of the interaction
    // This prevents race conditions where autoresponse changes during processing

    // In guild channels (not DMs), conversations should ALWAYS be marked as mention-only
    // unless autoresponse is explicitly enabled. This prevents the bot from continuing
    // to respond to subsequent messages after:
    // 1. A mention (@personality)
    // 2. A reply to a personality message
    // 3. A reply to another user's message
    // Only DMs or autoresponse-enabled channels should have continuous conversations
    const isMentionOnly = !message.channel.isDMBased() && !autoResponseEnabledAtStart;

    logger.info(
      `[PersonalityHandler] Recording conversation - User: ${conversationUserId}, Channel: ${message.channel.id}, ` +
        `Personality: ${personality.fullName}, isDM: ${message.channel.isDMBased()}, ` +
        `autoResponseEnabled: ${autoResponseEnabledAtStart}, isMentionOnly: ${isMentionOnly}, ` +
        `triggeringMention: ${triggeringMention}`
    );

    recordConversationData(
      conversationUserId,
      message.channel.id,
      result,
      personality.fullName,
      message.channel.isDMBased(),
      isMentionOnly
    );
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
      logger.error(
        `Message content: ${
          typeof message.content === 'string'
            ? message.content.substring(0, 100) + '...'
            : 'Non-string content type or no content'
        }`
      );
    } catch (logError) {
      logger.error(`Error logging details: ${logError.message}`);
    }

    // Send error message to user
    message
      .reply('Sorry, I encountered an error while processing your message. Check logs for details.')
      .catch((replyError) => {
        logger.error(`[PersonalityHandler] Failed to send error message to user: ${replyError.message}`);
        logger.error(`[PersonalityHandler] Channel type: ${message.channel.type}, ID: ${message.channel.id}`);
      });
  } finally {
    // Clear typing indicator if it's still active
    if (typingInterval) {
      timerFunctions.clearInterval(typingInterval);
    }

    // CRITICAL: Always remove the request from tracking, even on error
    // This allows users to retry after failures (e.g., 500 errors from AI service)
    if (requestKey) {
      requestTracker.removeRequest(requestKey);
    }
  }
}

module.exports = {
  handlePersonalityInteraction,
  startTypingIndicator,
  recordConversationData,
  configureTimers,
  configureDelay,
  setAuthService,
  clearCache,
  checkPersonalityAuth, // Export for testing
  generateModelIndicator, // Export for testing
};
