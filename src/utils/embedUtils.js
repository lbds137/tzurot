/**
 * Utilities for handling Discord embeds
 * 
 * This module contains functions for:
 * - Converting embed objects to text representations
 * - Extracting media URLs from embeds
 * - Processing embed content for AI messages
 */

const logger = require('../logger');

/**
 * Helper function to parse Discord embeds into text representation
 * @param {Array} embeds - Array of Discord embed objects
 * @param {string} source - Source description for logging (e.g., "referenced message", "linked message")
 * @returns {string} Formatted text representation of the embeds
 */
function parseEmbedsToText(embeds, source) {
  if (!embeds || !embeds.length) return '';
  
  logger.info(`[EmbedUtils] ${source} contains ${embeds.length} embeds`);
  let embedContent = '';
  
  embeds.forEach(embed => {
    // Add title if available
    if (embed.title) {
      embedContent += `\n[Embed Title: ${embed.title}]`;
    }
    
    // Add description if available
    if (embed.description) {
      embedContent += `\n[Embed Description: ${embed.description}]`;
    }
    
    // Add fields if available
    if (embed.fields && embed.fields.length > 0) {
      embed.fields.forEach(field => {
        embedContent += `\n[Embed Field - ${field.name}: ${field.value}]`;
      });
    }
    
    // Add image if available
    if (embed.image && embed.image.url) {
      embedContent += `\n[Embed Image: ${embed.image.url}]`;
    }
    
    // Add thumbnail if available
    if (embed.thumbnail && embed.thumbnail.url) {
      embedContent += `\n[Embed Thumbnail: ${embed.thumbnail.url}]`;
    }
    
    // Add footer if available
    if (embed.footer && embed.footer.text) {
      embedContent += `\n[Embed Footer: ${embed.footer.text}]`;
    }
  });
  
  if (embedContent) {
    logger.debug(`[EmbedUtils] Added embed content from ${source}: ${embedContent.substring(0, 100)}...`);
  }
  
  return embedContent;
}

/**
 * Extracts media URLs from Discord embeds
 * @param {Array} embeds - Array of Discord embed objects
 * @param {boolean} prioritizeAudio - Whether to prioritize audio over images
 * @returns {Object} Object containing extracted audio and image URLs
 */
function extractMediaFromEmbeds(embeds, prioritizeAudio = true) {
  if (!embeds || !embeds.length) {
    return { 
      audioUrl: null, 
      imageUrl: null, 
      hasAudio: false, 
      hasImage: false 
    };
  }
  
  let audioUrl = null;
  let imageUrl = null;
  let hasAudio = false;
  let hasImage = false;
  
  // Function to extract audio URLs from text
  const extractAudioUrl = (text) => {
    if (!text) return null;
    const audioUrlRegex = /https?:\/\/\S+\.(mp3|wav|ogg|m4a)(\?\S*)?/i;
    const match = text.match(audioUrlRegex);
    return match ? match[0] : null;
  };
  
  // First check for audio if prioritizing audio
  if (prioritizeAudio) {
    // Loop through embeds to find audio URLs
    for (const embed of embeds) {
      // Check description for audio URL
      if (embed.description) {
        const foundAudioUrl = extractAudioUrl(embed.description);
        if (foundAudioUrl) {
          audioUrl = foundAudioUrl;
          hasAudio = true;
          logger.info(`[EmbedUtils] Found audio URL in embed description: ${audioUrl}`);
          break;
        }
      }
      
      // Check fields for audio URL
      if (embed.fields && embed.fields.length > 0) {
        let foundAudio = false;
        for (const field of embed.fields) {
          const foundAudioUrl = extractAudioUrl(field.value);
          if (foundAudioUrl) {
            audioUrl = foundAudioUrl;
            hasAudio = true;
            logger.info(`[EmbedUtils] Found audio URL in embed field '${field.name}': ${audioUrl}`);
            foundAudio = true;
            break;
          }
        }
        if (foundAudio) break;
      }
    }
  }
  
  // If no audio was found or we're not prioritizing audio, check for images
  if (!hasAudio || !prioritizeAudio) {
    for (const embed of embeds) {
      // Check for image
      if (embed.image && embed.image.url) {
        imageUrl = embed.image.url;
        hasImage = true;
        logger.info(`[EmbedUtils] Found image in embed: ${imageUrl}`);
        break;
      }
      
      // Check for thumbnail if no image
      if (embed.thumbnail && embed.thumbnail.url) {
        imageUrl = embed.thumbnail.url;
        hasImage = true;
        logger.info(`[EmbedUtils] Found thumbnail in embed: ${imageUrl}`);
        break;
      }
    }
  }
  
  return {
    audioUrl,
    imageUrl,
    hasAudio,
    hasImage
  };
}

/**
 * Checks if a Discord embed contains a personality message (DM format)
 * @param {Object} embed - Discord embed object
 * @returns {Object|null} Personality info if detected, null otherwise
 */
function detectPersonalityInEmbed(embed) {
  // Check if this looks like a personality message in DM format
  if (embed && embed.description && typeof embed.description === 'string') {
    // Look for **Name:** prefix pattern
    const dmFormatMatch = embed.description.match(/^\*\*([^:]+):\*\* /);
    if (dmFormatMatch && dmFormatMatch[1]) {
      const displayName = dmFormatMatch[1];
      const baseName = displayName.includes(' | ') ? displayName.split(' | ')[0] : displayName;
      logger.info(`[EmbedUtils] Detected personality in embed with display name: ${baseName}`);
      
      return {
        name: baseName, // Using display name since we don't have the full name
        displayName: baseName
      };
    }
  }
  
  return null;
}

module.exports = {
  parseEmbedsToText,
  extractMediaFromEmbeds,
  detectPersonalityInEmbed
};