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
const { recordConversation, isAutoResponseEnabled } = require('../conversationManager');
const requestTracker = require('../utils/requestTracker');
const personalityAuth = require('../utils/personalityAuth');
const threadHandler = require('../utils/threadHandler');

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

// Injectable delay function for testability
let delayFn = (ms) => new Promise(resolve => timerFunctions.setTimeout(resolve, ms));

/**
 * Configure the delay function (for testing)
 * @param {Function} customDelay - Custom delay implementation
 */
function configureDelay(customDelay) {
  delayFn = customDelay;
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
    // Perform complete authentication check
    const authResult = await personalityAuth.checkPersonalityAuth(message, personality);
    
    if (!authResult.isAllowed) {
      // Authentication failed - send error message and exit
      await personalityAuth.sendAuthError(
        message,
        authResult.errorMessage,
        authResult.reason
      );
      return; // Exit without processing the personality interaction
    }
    
    // Extract authentication results
    const { isProxySystem, isDM } = authResult;

    // Flag to indicate if this message is a reply to a DM message with a personality prefix
    // This will help prevent duplicate personality prefixes in responses
    const isReplyToDMFormattedMessage =
      isDM && message.reference && triggeringMention === null ? true : false;

    // Track the request to prevent duplicates
    // For PluralKit messages, use the real user ID instead of the webhook author ID
    const trackerRealUserId = webhookUserTracker.getRealUserId(message);
    
    const requestKey = requestTracker.trackRequest(trackerRealUserId || message.author.id, message.channel.id, personality.fullName);
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
          
          // Handle nested references if we have an active conversation or autoresponse
          // This ensures the personality can see the full conversation context
          if (repliedToMessage.reference && (hasActivePersonality || isAutoResponseEnabled(message.author.id))) {
            logger.info(
              `[PersonalityHandler] Detected nested reference in active conversation context`
            );
            
            try {
              // Fetch the nested referenced message
              const nestedReferencedMessage = await message.channel.messages.fetch(repliedToMessage.reference.messageId);
              
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
              logger.warn(`[PersonalityHandler] Could not fetch nested reference: ${nestedError.message}`);
              // Continue without nested context
            }
          }
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
    const isWebhookMessage = isProxySystem;
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
    timerFunctions.clearInterval(typingInterval);
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
    await delayFn(500);

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
    
    // Build webhook options with thread support
    const webhookOptions = threadHandler.buildThreadWebhookOptions(
      message.channel,
      trackerRealUserId || message.author?.id,
      threadInfo,
      isReplyToDMFormattedMessage
    );

    // Send the response using appropriate method
    let result;
    if (threadInfo.isThread) {
      // Use thread-specific handling with fallback strategies
      result = await threadHandler.sendThreadMessage(
        webhookManager,
        message.channel,
        aiResponse,
        personality,
        webhookOptions,
        message
      );
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
    requestTracker.removeRequest(requestKey);

    // Record this conversation with all message IDs
    // For PluralKit messages, get the real user ID instead of the webhook author ID
    const conversationUserId = webhookUserTracker.getRealUserId(message) || message.author.id;
    
    // Check if autoresponse is enabled for this user
    const autoResponseEnabled = isAutoResponseEnabled(conversationUserId);
    
    // Check if this was triggered by a mention (in guild channels only)
    // Also treat replies to other users as mention-only to prevent autoresponse loops
    const isReplyToOtherUser = message.reference && referencedMessageAuthorId && referencedMessageAuthorId !== message.author.id;
    
    // If autoresponse is enabled, don't mark as mention-only (allow conversation to continue)
    // Otherwise, mark as mention-only if it was triggered by a mention or reply to another user
    const isMentionOnly = !message.channel.isDMBased() && 
                          !autoResponseEnabled && 
                          (triggeringMention !== null || isReplyToOtherUser);
    
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
      .catch(() => {});
  } finally {
    // Clear typing indicator if it's still active
    if (typingInterval) {
      timerFunctions.clearInterval(typingInterval);
    }
  }
}

module.exports = {
  handlePersonalityInteraction,
  startTypingIndicator,
  recordConversationData,
  configureTimers,
  configureDelay,
};
