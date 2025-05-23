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
const channelUtils = require('../utils/channelUtils');
const webhookUserTracker = require('../utils/webhookUserTracker');
const referenceHandler = require('./referenceHandler');
const { detectMedia } = require('../utils/media');
const { MARKERS } = require('../constants');
const { recordConversation } = require('../conversationManager');

// Import activeRequests map and trackRequest function from bot.js
// These are used to prevent duplicate requests
const activeRequests = new Map();

/**
 * Track a request to prevent duplicates
 * @param {string} userId - User ID
 * @param {string} channelId - Channel ID
 * @param {string} personalityName - Personality name
 * @returns {string|null} Request key if successful, null if duplicate
 */
function trackRequest(userId, channelId, personalityName) {
  const requestKey = `${userId}-${channelId}-${personalityName}`;

  // Check if this request is already in progress
  if (activeRequests.has(requestKey)) {
    logger.info(`[PersonalityHandler] Ignoring duplicate request: ${requestKey}`);
    return null;
  }

  // Track this request
  activeRequests.set(requestKey, Date.now());
  return requestKey;
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
    return setInterval(() => {
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
function recordConversationData(userId, channelId, result, personalityName, isDM = false, isMentionOnly = false) {
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

  try {
    // SAFETY CHECK: Only allow personalities to operate in DMs or NSFW channels
    const isDM = message.channel.isDMBased();
    const isNSFW = channelUtils.isChannelNSFW(message.channel);

    if (!isDM && !isNSFW) {
      // Not a DM and not marked as NSFW - inform the user and exit
      await message
        .reply({
          content:
            '⚠️ For safety and compliance reasons, personalities can only be used in Direct Messages or channels marked as NSFW. Please either chat with me in DMs or ask a server admin to mark this channel as NSFW in the channel settings.',
          ephemeral: true, // Make the message only visible to the user when possible
        })
        .catch(error => {
          logger.error(
            `[PersonalityHandler] Failed to send NSFW restriction notice: ${error.message}`
          );
        });
      return; // Exit without processing the personality interaction
    }

    // Flag to indicate if this message is a reply to a DM message with a personality prefix
    // This will help prevent duplicate personality prefixes in responses
    const isReplyToDMFormattedMessage =
      isDM && message.reference && triggeringMention === null ? true : false;

    const auth = require('../auth');
    
    // Check if this is a proxy system message (like PluralKit)
    let authUserId = message.author.id;
    let _authUsername = message.author.username;
    let _isProxySystem = false;
    
    if (webhookUserTracker.isProxySystemWebhook(message)) {
      _isProxySystem = true;
      // For PluralKit messages, we need to check the real user's authentication
      const proxyAuth = webhookUserTracker.checkProxySystemAuthentication(message);
      
      if (!proxyAuth.isAuthenticated) {
        logger.info(
          `[PersonalityHandler] PluralKit user attempted to use personalities without authentication`
        );
        await message
          .reply(
            '⚠️ **Authentication Required for PluralKit Users**\n\n' +
              'To use AI personalities through PluralKit, the original Discord user must authenticate first.\n\n' +
              'Please send `!tz auth start` directly (not through PluralKit) to begin setting up your account.'
          )
          .catch(error => {
            logger.error(`[PersonalityHandler] Failed to send PluralKit auth notice: ${error.message}`);
          });
        return; // Exit without processing the personality interaction
      }
      
      // Use the real user ID for further checks
      authUserId = proxyAuth.userId;
      _authUsername = proxyAuth.username || _authUsername;
      logger.info(`[PersonalityHandler] PluralKit message authenticated for user ${authUserId}`);
    } else {
      // Regular non-proxy message - check authentication normally
      if (!auth.hasValidToken(message.author.id)) {
        logger.info(
          `[PersonalityHandler] User ${message.author.id} attempted to use personalities without authentication in ${isDM ? 'DM' : 'server channel'}`
        );
        await message
          .reply(
            '⚠️ **Authentication Required**\n\n' +
              'To use AI personalities, you need to authenticate first.\n\n' +
              'Please run `!tz auth start` to begin setting up your account.'
          )
          .catch(error => {
            logger.error(`[PersonalityHandler] Failed to send authentication notice: ${error.message}`);
          });
        return; // Exit without processing the personality interaction
      }
    }

    // Then check age verification for ALL personality interactions (both DM and server channels)
    // For proxy systems, check the real user's verification status
    let isVerified = auth.isNsfwVerified(authUserId);

    // NEW: Automatically verify users who send messages in NSFW channels
    if (!isVerified && isNSFW && !isDM) {
      // User is in an NSFW channel but not verified - verify them automatically
      logger.info(
        `[PersonalityHandler] Auto-verifying user ${authUserId} in NSFW channel ${message.channel.id}`
      );
      
      const verificationSuccess = await auth.storeNsfwVerification(authUserId, true);
      if (verificationSuccess) {
        logger.info(
          `[PersonalityHandler] Successfully auto-verified user ${authUserId} in NSFW channel`
        );
        isVerified = true; // Update the verification status
      } else {
        logger.error(
          `[PersonalityHandler] Failed to auto-verify user ${authUserId} in NSFW channel`
        );
      }
    }

    if (!isVerified) {
      // User is not verified, prompt them to verify first
      logger.info(
        `[PersonalityHandler] User ${authUserId} attempted to use personalities without verification in ${isDM ? 'DM' : 'server channel'}`
      );
      await message
        .reply(
          '⚠️ **Age Verification Required**\n\n' +
            'To use AI personalities, you need to verify your age first.\n\n' +
            'Please run `!tz verify` in a channel marked as NSFW. ' +
            "This will verify that you meet Discord's age requirements for accessing NSFW content."
        )
        .catch(error => {
          logger.error(`[PersonalityHandler] Failed to send verification notice: ${error.message}`);
        });
      return; // Exit without processing the personality interaction
    }

    // Track the request to prevent duplicates
    // For PluralKit messages, use the real user ID instead of the webhook author ID
    const trackerRealUserId = webhookUserTracker.getRealUserId(message);
    
    const requestKey = trackRequest(trackerRealUserId || message.author.id, message.channel.id, personality.fullName);
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
              const { getPersonalityFromMessage } = require('../conversationManager');
              const personalityManager = require('../personalityManager');

              // Try to look up by message ID first
              const personalityName = getPersonalityFromMessage(repliedToMessage.id, {
                webhookUsername: referencedWebhookName,
              });

              if (personalityName) {
                // Get display name for the personality if available
                try {
                  // Use the listPersonalitiesForUser function which returns all personalities
                  const allPersonalities = personalityManager.listPersonalitiesForUser();

                  // Find the matching personality by name
                  const personalityData = allPersonalities.find(
                    p => p.fullName === personalityName
                  );

                  if (personalityData) {
                    referencedPersonalityInfo = {
                      name: personalityName,
                      displayName: personalityData.displayName,
                    };

                    logger.info(
                      `[PersonalityHandler] Identified referenced message as from personality: ${personalityName}`
                    );
                  } else {
                    // If we can't find the personality data, just use the name
                    referencedPersonalityInfo = {
                      name: personalityName,
                      displayName: personalityName.split('-')[0], // Simple extraction of first part of name
                    };
                    logger.info(
                      `[PersonalityHandler] Using simple name extraction for personality: ${personalityName}`
                    );
                  }
                } catch (personalityLookupError) {
                  logger.error(
                    `[PersonalityHandler] Error looking up personality data: ${personalityLookupError.message}`
                  );
                  // Still set the name even if we couldn't get full data
                  referencedPersonalityInfo = {
                    name: personalityName,
                    displayName: personalityName.split('-')[0], // Simple extraction of first part of name
                  };
                }
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

              // Try to find the full personality name from the display name
              const personalityManager = require('../personalityManager');
              const allPersonalities = personalityManager.listPersonalitiesForUser();
              const matchingPersonality = allPersonalities.find(
                p => p.displayName && p.displayName.toLowerCase() === baseName.toLowerCase()
              );

              if (matchingPersonality) {
                // Found the full personality data
                referencedPersonalityInfo = {
                  name: matchingPersonality.fullName,
                  displayName: matchingPersonality.displayName,
                };
                logger.info(
                  `[PersonalityHandler] Found full personality data for DM message: ${matchingPersonality.fullName}`
                );
              } else {
                // Fallback to just using the display name
                referencedPersonalityInfo = {
                  name: baseName, // Using the display name since we don't have the full name
                  displayName: baseName,
                };
                logger.warn(
                  `[PersonalityHandler] Could not find full personality data for display name: ${baseName}`
                );
              }
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
              logger.info(`[PersonalityHandler] Found ${embedLinks.length} Discord links in referenced message embeds`);
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
        }
      } catch (error) {
        logger.error(`[PersonalityHandler] Error fetching referenced message: ${error.message}`);
        // Continue without the referenced message if there's an error
      }
    }

    // Determine if this is an active personality context
    // It's active if it's NOT triggered by a mention (null triggeringMention means reply or active conversation)
    const hasActivePersonality = !triggeringMention;
    
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
          referencedMessageContent += '\n[Linked Message]: ' + referencedLinkResult.referencedMessageContent;
          
          // Update other reference info if found
          if (referencedLinkResult.referencedPersonalityInfo?.displayName) {
            referencedMessageContent += ' (from ' + referencedLinkResult.referencedPersonalityInfo.displayName + ')';
          } else if (referencedLinkResult.referencedWebhookName) {
            referencedMessageContent += ' (from ' + referencedLinkResult.referencedWebhookName + ')';
          } else if (referencedLinkResult.referencedMessageAuthor && referencedLinkResult.referencedMessageAuthor !== 'another user') {
            referencedMessageContent += ' (from ' + referencedLinkResult.referencedMessageAuthor + ')';
          }
        }
        
        logger.info(
          `[PersonalityHandler] Processed Discord link from referenced message`
        );
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
        logger.info(
          `[PersonalityHandler] Found audio in linked message: ${referencedAudioUrl}`
        );
      }
      if (linkResult.referencedImageUrl && !referencedImageUrl && !referencedAudioUrl) {
        // Only use image if no audio is present (audio takes priority)
        referencedImageUrl = linkResult.referencedImageUrl;
        logger.info(
          `[PersonalityHandler] Found image in linked message: ${referencedImageUrl}`
        );
      }
    } else {
      logger.debug(
        `[PersonalityHandler] ProcessMessageLinks did not process any links`
      );
    }

    // Get the user's display name and username
    const userDisplayName = message.member?.displayName || message.author?.username || 'User';
    const userUsername = message.author?.username || 'user';
    
    // For PluralKit or webhook messages, just use the display name to avoid redundancy
    // PluralKit names often include system tags like "Name | System"
    const isWebhookMessage = !!(message.webhookId && webhookUserTracker.isProxySystemWebhook(message));
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

      const isRecent = referenceTimestamp && Date.now() - referenceTimestamp < 60 * 60 * 1000;

      // Expanded logging to diagnose issues
      logger.debug(
        `[PersonalityHandler] Reference personality check: ${samePersonality ? 'SAME' : 'DIFFERENT'} (${referencedPersonalityInfo?.name} vs ${personality?.fullName})`
      );
      logger.debug(
        `[PersonalityHandler] Reference channel check: ${sameChannel ? 'SAME' : 'DIFFERENT'}`
      );
      logger.debug(
        `[PersonalityHandler] Reference recency check: ${isRecent ? 'RECENT' : 'OLD'} (${referenceTimestamp ? Math.round((Date.now() - referenceTimestamp) / 1000 / 60) + ' mins ago' : 'unknown'})`
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
    // Always use the message author's user ID for proper authentication
    // This ensures that when replying to a webhook, we use the replying user's auth token
    const userId = message.author?.id;
    logger.debug(`[PersonalityHandler] Using user ID for authentication: ${userId || 'none'}`);

    const aiResponse = await getAiResponse(personality.fullName, finalMessageContent, {
      userId: userId,
      channelId: message.channel.id,
      // Pass the original message object for webhook detection
      message: message,
      // Pass the user's formatted name for audio transcript prompts
      userName: formattedUserName,
      // Flag to indicate if this is a proxy system message (PluralKit, etc)
      isProxyMessage: isWebhookMessage,
    });

    // Clear typing indicator interval
    clearInterval(typingInterval);
    typingInterval = null;

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
    await new Promise(resolve => setTimeout(resolve, 500));

    // Send response and record conversation
    // Pass the original message to ensure we use the correct user's auth token
    // This ensures user authentication is preserved when replying to webhook messages

    // Prepare options with thread information if needed
    const isThread = message.channel.isThread();

    // Add detailed logging about channel properties to diagnose thread issues
    logger.info(
      `[PersonalityHandler] Channel type: ${message.channel.type}, ID: ${message.channel.id}`
    );
    logger.info(`[PersonalityHandler] isThread check returns: ${isThread}`);
    logger.info(
      `[PersonalityHandler] Channel properties: ${JSON.stringify({
        isThread: isThread,
        type: message.channel.type,
        name: message.channel.name,
        parentId: message.channel.parentId,
        hasParent: !!message.channel.parent,
        isTextBased: message.channel.isTextBased(),
        isVoiceBased: message.channel.isVoiceBased?.(),
        isDMBased: message.channel.isDMBased?.(),
      })}`
    );

    // Log detailed thread information for debugging
    if (isThread) {
      logger.info(
        `[PersonalityHandler] @Mention in Thread detected! Thread ID: ${message.channel.id}`
      );
      if (message.channel.parent) {
        logger.info(
          `[PersonalityHandler] Parent channel ID: ${message.channel.parent.id}, Name: ${message.channel.parent.name}`
        );
        logger.info(`[PersonalityHandler] Parent channel type: ${message.channel.parent.type}`);
      } else {
        logger.warn(`[PersonalityHandler] Thread parent unavailable - this might cause issues!`);
      }
    }

    // Force thread detection for certain channel types
    let forcedThread = false;
    if (
      message.channel.type === 'GUILD_PUBLIC_THREAD' ||
      message.channel.type === 'GUILD_PRIVATE_THREAD' ||
      message.channel.type === 'PUBLIC_THREAD' ||
      message.channel.type === 'PRIVATE_THREAD' ||
      message.channel.type === 'FORUM'
    ) {
      logger.info(
        `[PersonalityHandler] Forcing thread mode for channel type: ${message.channel.type}`
      );
      forcedThread = true;
    }

    // Combine native thread detection with forced detection
    const finalIsThread = isThread || forcedThread;

    const webhookOptions = {
      // Include user ID in options for enhanced tracking
      // For PluralKit messages, use the real user ID instead of the webhook author ID
      userId: trackerRealUserId || message.author?.id,
      // If the message is in a thread, explicitly pass the threadId to ensure
      // webhooks respond in the correct thread context
      threadId: finalIsThread ? message.channel.id : undefined,
      // Add channel type information for better handling
      channelType: message.channel.type,
      // Add special forum flag
      isForum:
        message.channel.type === 'FORUM' ||
        (message.channel.parent && message.channel.parent.type === 'FORUM'),
      // Flag to indicate this is a reply to a DM message with personality prefix already included
      isReplyToDMFormattedMessage: isReplyToDMFormattedMessage,
    };

    // Extra validation for thread handling
    if (finalIsThread && !webhookOptions.threadId) {
      logger.error(
        `[PersonalityHandler] Error: Thread detected but threadId is not set in webhookOptions`
      );
      // Force set the threadId from the channel
      webhookOptions.threadId = message.channel.id;
    }

    // Log if the thread detection was forced
    if (forcedThread && !isThread) {
      logger.info(
        `[PersonalityHandler] Thread detection was forced based on channel type, native isThread() returned false`
      );
    }

    // Extra logging to ensure webhook options are correct
    logger.info(`[PersonalityHandler] Final webhook options: ${JSON.stringify(webhookOptions)}`);

    // For forum channel threads, add special handling
    if (webhookOptions.isForum) {
      logger.info(`[PersonalityHandler] Forum channel detected - adding special forum handling`);
      webhookOptions.forum = true;
      webhookOptions.forumThreadId = message.channel.id;
    }

    let result;

    // For threads, try our direct thread implementation first as it's the most reliable approach
    if (finalIsThread) {
      logger.info(
        `[PersonalityHandler] Thread message detected - using priority sendDirectThreadMessage implementation`
      );

      try {
        // First, try our specialized direct thread message function
        result = await webhookManager.sendDirectThreadMessage(
          message.channel,
          aiResponse,
          personality,
          webhookOptions
        );

        logger.info(
          `[PersonalityHandler] Direct thread message sent successfully with ID: ${result.messageIds?.[0] || 'unknown'}`
        );
      } catch (threadError) {
        logger.error(
          `[PersonalityHandler] Direct thread message approach failed: ${threadError.message}`
        );
        logger.info(`[PersonalityHandler] Falling back to standard webhook approach for thread`);

        // Fallback to regular webhook approach
        try {
          result = await webhookManager.sendWebhookMessage(
            message.channel,
            aiResponse,
            personality,
            webhookOptions,
            message // Pass the original message for user authentication
          );
        } catch (webhookError) {
          logger.error(
            `[PersonalityHandler] Both thread delivery approaches failed! Error: ${webhookError.message}`
          );

          // Final fallback - use the channel's send method directly
          try {
            logger.info(`[PersonalityHandler] Attempting last resort direct channel.send`);
            const formattedContent = `**${personality.displayName || personality.fullName}:** ${aiResponse}`;
            const directMessage = await message.channel.send(formattedContent);

            // Create a result object mimicking webhook result
            result = {
              message: directMessage,
              messageIds: [directMessage.id],
              isEmergencyFallback: true,
            };

            logger.info(
              `[PersonalityHandler] Emergency direct send succeeded: ${directMessage.id}`
            );
          } catch (finalError) {
            logger.error(
              `[PersonalityHandler] ALL message delivery methods failed: ${finalError.message}`
            );
            throw finalError; // Re-throw the error if all approaches fail
          }
        }
      }
    } else {
      // For non-thread channels, use the standard webhook approach
      result = await webhookManager.sendWebhookMessage(
        message.channel,
        aiResponse,
        personality,
        webhookOptions,
        message // Pass the original message for user authentication
      );
    }

    // Clean up active request tracking
    activeRequests.delete(requestKey);

    // Record this conversation with all message IDs
    // Check if this was triggered by a mention (in guild channels only)
    const isMentionOnly = !message.channel.isDMBased() && triggeringMention !== null;
    
    // For PluralKit messages, get the real user ID instead of the webhook author ID
    const conversationUserId = webhookUserTracker.getRealUserId(message);
    
    recordConversationData(
      conversationUserId || message.author.id, // Use real user ID if available, otherwise fall back to author ID
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
      .catch(() => {});
  } finally {
    // Clear typing indicator if it's still active
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

module.exports = {
  handlePersonalityInteraction,
  trackRequest,
  startTypingIndicator,
  recordConversationData,
  activeRequests,
};
