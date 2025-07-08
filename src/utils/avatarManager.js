/**
 * Avatar Manager
 *
 * Handles avatar URL validation, caching, and pre-loading for Discord webhooks.
 * This module ensures avatar URLs are accessible and properly formatted before use.
 */

const fetch = require('node-fetch');
const logger = require('../logger');
const errorTracker = require('./errorTracker');
const urlValidator = require('./urlValidator');

// Cache to track avatar URLs we've already warmed up
const avatarWarmupCache = new Set();

// Domains that are known to be reliable and don't need warmup
const SKIP_WARMUP_DOMAINS = [
  'i.imgur.com',
  'imgur.com',
  'media.discordapp.net',
  'cdn.discordapp.com',
];

// Injectable timer functions for testability
let schedulerFn = setTimeout;
let clearSchedulerFn = clearTimeout;

// Function to override timers for testing
function setTimerFunctions(scheduler, clearScheduler) {
  schedulerFn = scheduler;
  clearSchedulerFn = clearScheduler;
}

/**
 * Validate if an avatar URL is accessible and correctly formatted
 * @param {string} avatarUrl - The URL to validate
 * @returns {Promise<boolean>} - True if the avatar URL is valid
 */
async function validateAvatarUrl(avatarUrl) {
  if (!avatarUrl) return false;

  // Check if URL is correctly formatted
  if (!urlValidator.isValidUrlFormat(avatarUrl)) {
    return false;
  }

  // Handle Discord CDN URLs specially - they're always valid without checking
  if (
    urlValidator.isTrustedDomain(avatarUrl, [
      'cdn.discordapp.com',
      'discord.com/assets',
      'media.discordapp.net',
    ])
  ) {
    logger.info(`[AvatarManager] Discord CDN URL detected, skipping validation: ${avatarUrl}`);
    return true;
  }

  try {
    // Use the enhanced URL validator
    const isValidImage = await urlValidator.isImageUrl(avatarUrl, {
      timeout: 5000,
      trustExtensions: true,
    });

    if (!isValidImage) {
      logger.warn(
        `[AvatarManager] Invalid avatar URL: ${avatarUrl}, does not point to a valid image`
      );

      // Track this validation error for debugging
      errorTracker.trackError(new Error(`Invalid avatar URL: ${avatarUrl}`), {
        category: errorTracker.ErrorCategory.AVATAR,
        operation: 'validateAvatarUrl',
        metadata: {
          url: avatarUrl,
          urlParts: new URL(avatarUrl),
        },
        isCritical: false,
      });
    }

    return isValidImage;
  } catch (error) {
    // Record the error with our error tracker
    errorTracker.trackError(error, {
      category: errorTracker.ErrorCategory.AVATAR,
      operation: 'validateAvatarUrl',
      metadata: {
        url: avatarUrl,
      },
      isCritical: false,
    });

    logger.warn(`[AvatarManager] Error validating avatar URL: ${error.message} for ${avatarUrl}`);

    // Special case: if it has an image extension, trust it despite fetch errors
    if (urlValidator.hasImageExtension(avatarUrl)) {
      logger.info(
        `[AvatarManager] URL appears to be an image based on extension, accepting despite errors: ${avatarUrl}`
      );
      return true;
    }

    return false;
  }
}

/**
 * Get a valid avatar URL
 * @param {string} avatarUrl - The original avatar URL to try
 * @returns {Promise<string|null>} - A valid avatar URL or null
 */
async function getValidAvatarUrl(avatarUrl) {
  // If no URL provided, return null
  if (!avatarUrl) {
    logger.debug(`[AvatarManager] No avatar URL provided, returning null`);
    return null;
  }

  // Check if the URL is valid
  const isValid = await validateAvatarUrl(avatarUrl);

  if (isValid) {
    return avatarUrl;
  } else {
    logger.info(`[AvatarManager] Invalid avatar URL: ${avatarUrl}, returning null`);
    return null;
  }
}

/**
 * Pre-load an avatar URL to ensure Discord caches it
 * This helps with the issue where avatars don't show on first message
 * @param {string} avatarUrl - The URL of the avatar to pre-load
 * @param {number} [retryCount=1] - Number of retries if warmup fails (internal parameter)
 * @returns {Promise<string|null>} - The warmed up avatar URL or null
 */
async function warmupAvatarUrl(avatarUrl, retryCount = 1) {
  // Skip if null or already warmed up
  if (!avatarUrl) {
    logger.debug(`[AvatarManager] No avatar URL to warm up, returning null`);
    return null;
  }

  if (avatarWarmupCache.has(avatarUrl)) {
    logger.debug(`[AvatarManager] Avatar URL already warmed up: ${avatarUrl}`);
    return avatarUrl;
  }

  logger.info(`[AvatarManager] Warming up avatar URL: ${avatarUrl}`);

  // Handle Discord CDN URLs specially - they're always valid and don't need warmup
  if (avatarUrl.includes('cdn.discordapp.com') || avatarUrl.includes('discord.com/assets')) {
    logger.info(`[AvatarManager] Discord CDN URL detected, skipping warmup: ${avatarUrl}`);
    avatarWarmupCache.add(avatarUrl);
    return avatarUrl;
  }

  // Skip warmup for specific known domains that are likely to block direct fetches
  const urlObj = new URL(avatarUrl);
  if (SKIP_WARMUP_DOMAINS.some(domain => urlObj.hostname.includes(domain))) {
    logger.info(
      `[AvatarManager] Known reliable domain detected (${urlObj.hostname}), skipping warmup for: ${avatarUrl}`
    );

    // Trust URLs with image extensions without validation
    if (avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
      avatarWarmupCache.add(avatarUrl);
      return avatarUrl;
    }
  }

  try {
    // First ensure the avatar URL is valid
    const validUrl = await getValidAvatarUrl(avatarUrl);

    // If we got null, it means the original URL was invalid
    if (validUrl === null) {
      return null; // Don't bother warming up an invalid URL
    }

    // Make a GET request to ensure Discord caches the image
    // Use a timeout to prevent hanging on bad URLs
    const controller = new AbortController();
    const timeoutId = schedulerFn(() => controller.abort(), 5000);

    const response = await fetch(validUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://discord.com/',
        'Cache-Control': 'no-cache',
      },
    });

    clearSchedulerFn(timeoutId);

    if (!response.ok) {
      logger.warn(`[AvatarManager] Avatar URL returned non-OK status: ${response.status}`);

      // If it's a known domain and has an image extension, consider it valid
      // despite the response error (might be anti-hotlinking measures)
      if (
        SKIP_WARMUP_DOMAINS.some(domain => urlObj.hostname.includes(domain)) &&
        avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)
      ) {
        logger.info(
          `[AvatarManager] Likely valid image despite error response, accepting: ${avatarUrl}`
        );
        avatarWarmupCache.add(avatarUrl);
        return avatarUrl;
      }

      throw new Error(`Failed to warm up avatar: ${response.status} ${response.statusText}`);
    }

    // Check content type to ensure it's an image or a generic binary file
    const contentType = response.headers.get('content-type');
    // Log the content type for debugging purposes
    logger.debug(`[AvatarManager] Avatar URL content type: ${contentType} for ${avatarUrl}`);

    // Skip this check for application/octet-stream as it's a generic binary content type often used for images
    if (
      contentType &&
      !contentType.startsWith('image/') &&
      contentType !== 'application/octet-stream'
    ) {
      logger.warn(
        `[AvatarManager] Avatar URL has non-image content type: ${contentType} for ${avatarUrl}`
      );
      // Don't reject here, just log a warning - the image extension or reader check will validate further
    }

    // Read a small chunk of the response to ensure it's properly loaded
    try {
      // Check if response body has a getReader method (streams API)
      if (response.body && typeof response.body.getReader === 'function') {
        // Modern streams approach
        const reader = response.body.getReader();
        const { done, value } = await reader.read();
        reader.cancel();

        if (done || !value || value.length === 0) {
          logger.warn(`[AvatarManager] Avatar URL returned an empty response: ${avatarUrl}`);
          throw new Error('Empty response from avatar URL');
        }

        logger.debug(`[AvatarManager] Avatar loaded (${value.length} bytes) using streams API`);
      } else {
        // Fallback: try to use buffer/arrayBuffer approach
        // This handles older node-fetch versions or environments without streams support

        // Try arrayBuffer first (more modern)
        if (typeof response.arrayBuffer === 'function') {
          const buffer = await response.arrayBuffer();
          if (!buffer || buffer.byteLength === 0) {
            logger.warn(`[AvatarManager] Avatar URL returned an empty arrayBuffer: ${avatarUrl}`);
            throw new Error('Empty arrayBuffer from avatar URL');
          }
          logger.debug(
            `[AvatarManager] Avatar loaded (${buffer.byteLength} bytes) using arrayBuffer`
          );
        }
        // Fall back to text/blob or just trust the status
        else if (typeof response.text === 'function') {
          const text = await response.text();
          if (!text || text.length === 0) {
            logger.warn(`[AvatarManager] Avatar URL returned an empty response: ${avatarUrl}`);
            throw new Error('Empty text response from avatar URL');
          }
          logger.debug(`[AvatarManager] Avatar loaded (${text.length} chars) using text`);
        } else {
          // If we can't read the body at all, just trust the OK status
          logger.debug(`[AvatarManager] Avatar URL responded OK, trusting without body check`);
        }
      }
    } catch (readError) {
      // Some environments might have issues reading the body, but if we got an OK response,
      // we can generally trust that the image is valid
      logger.debug(
        `[AvatarManager] Couldn't read response body, but got OK status: ${readError.message}`
      );
    }

    // Mark this URL as warmed up
    avatarWarmupCache.add(avatarUrl);
    logger.info(`[AvatarManager] Successfully warmed up avatar URL: ${avatarUrl}`);
    return avatarUrl;
  } catch (error) {
    // Special handling for AbortError (timeout)
    if (error.name === 'AbortError') {
      logger.warn(`[AvatarManager] Avatar warmup timed out for: ${avatarUrl}`);

      // If it has an image extension, trust it despite the timeout
      if (avatarUrl.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i)) {
        logger.info(
          `[AvatarManager] URL appears to be an image based on extension, accepting despite timeout: ${avatarUrl}`
        );
        avatarWarmupCache.add(avatarUrl);
        return avatarUrl;
      }
    }

    // Log the error but don't fail completely - we might want to use the URL anyway
    logger.warn(`[AvatarManager] Error warming up avatar URL: ${error.message} for ${avatarUrl}`);

    // If we've already validated the URL, we might still want to use it
    const isValid = await validateAvatarUrl(avatarUrl);
    if (isValid) {
      logger.info(
        `[AvatarManager] URL is still valid despite warmup error, accepting: ${avatarUrl}`
      );
      avatarWarmupCache.add(avatarUrl);
      return avatarUrl;
    }

    // If retries are allowed and we haven't exceeded them, try again
    if (retryCount > 0) {
      logger.info(
        `[AvatarManager] Retrying avatar warmup for: ${avatarUrl} (${retryCount} retries left)`
      );
      return warmupAvatarUrl(avatarUrl, retryCount - 1);
    }

    return null;
  }
}

/**
 * Pre-load a personality's avatar
 * Helper function to ensure Discord caches the avatar before first use
 * @param {Object} personality - The personality object with avatarUrl
 * @param {string} [userId] - Optional Discord user ID for user-specific authentication
 */
async function preloadPersonalityAvatar(personality, userId = null) {
  if (!personality) {
    logger.error(`[AvatarManager] Cannot preload avatar: personality object is null or undefined`);
    return;
  }

  // Check for avatar URL in DDD structure
  let currentAvatarUrl = personality.profile?.avatarUrl || personality.avatarUrl;

  if (!currentAvatarUrl) {
    logger.warn(
      `[AvatarManager] Cannot preload avatar: avatarUrl is not set for ${personality.fullName || 'unknown personality'}`
    );

    // Attempt to fetch avatar URL using profile info fetcher with user auth
    if (personality.fullName) {
      try {
        // Import here to avoid circular dependencies
        const { getProfileAvatarUrl } = require('../profileInfoFetcher');

        // Pass the user ID for authentication
        const fetchedAvatarUrl = await getProfileAvatarUrl(personality.fullName, userId);

        if (fetchedAvatarUrl) {
          logger.info(
            `[AvatarManager] Successfully fetched avatar URL with user auth (${userId ? 'user-specific' : 'default'}): ${fetchedAvatarUrl}`
          );
          // Set in both places for compatibility during migration
          if (personality.profile) {
            personality.profile.avatarUrl = fetchedAvatarUrl;
          }
          personality.avatarUrl = fetchedAvatarUrl;
          // Update the current URL for warmup
          currentAvatarUrl = fetchedAvatarUrl;
        } else {
          // Set a fallback avatar URL rather than simply returning
          if (personality.profile) {
            personality.profile.avatarUrl = null;
          }
          personality.avatarUrl = null;
          logger.info(
            `[AvatarManager] Set null avatar URL for ${personality.fullName || 'unknown personality'}`
          );
          return;
        }
      } catch (fetchError) {
        logger.error(`[AvatarManager] Error fetching avatar URL: ${fetchError.message}`);
        if (personality.profile) {
          personality.profile.avatarUrl = null;
        }
        personality.avatarUrl = null;
        return;
      }
    } else {
      // Set a fallback avatar URL rather than simply returning
      if (personality.profile) {
        personality.profile.avatarUrl = null;
      }
      personality.avatarUrl = null;
      logger.info(
        `[AvatarManager] Set null avatar URL for ${personality.fullName || 'unknown personality'}`
      );
      return;
    }
  }

  logger.info(
    `[AvatarManager] Pre-loading avatar for ${personality.fullName || 'unknown personality'}: ${currentAvatarUrl}`
  );

  // Try to warm up the avatar URL
  const warmedUrl = await warmupAvatarUrl(currentAvatarUrl);

  if (warmedUrl) {
    logger.info(
      `[AvatarManager] Successfully pre-loaded avatar for ${personality.fullName || 'unknown personality'}`
    );
  } else {
    logger.warn(
      `[AvatarManager] Failed to pre-load avatar for ${personality.fullName || 'unknown personality'}`
    );
    // Set to null to prevent using an invalid URL
    if (personality.profile) {
      personality.profile.avatarUrl = null;
    }
    personality.avatarUrl = null;
  }
}

/**
 * Clear the avatar warmup cache
 * Useful for testing or when avatar URLs have changed
 */
function clearAvatarCache() {
  avatarWarmupCache.clear();
  logger.info('[AvatarManager] Avatar warmup cache cleared');
}

/**
 * Get the size of the avatar cache
 * @returns {number} Number of cached avatar URLs
 */
function getAvatarCacheSize() {
  return avatarWarmupCache.size;
}

/**
 * Check if an avatar URL is in the cache
 * @param {string} avatarUrl - URL to check
 * @returns {boolean} True if URL is cached
 */
function isAvatarCached(avatarUrl) {
  return avatarWarmupCache.has(avatarUrl);
}

module.exports = {
  validateAvatarUrl,
  getValidAvatarUrl,
  warmupAvatarUrl,
  preloadPersonalityAvatar,
  clearAvatarCache,
  getAvatarCacheSize,
  isAvatarCached,
  setTimerFunctions,
};
