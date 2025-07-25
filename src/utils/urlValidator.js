/**
 * Utility for validating URLs and checking if they point to images
 *
 * TODO: Future improvements
 * - Add caching of validation results to avoid repeated validations
 * - Implement image format detection for better validation
 * - Add support for image dimension checking
 * - Consider adding content hash verification for sensitive resources
 * - Improve the efficiency of validation by using HEAD requests when possible
 */
const nodeFetch = require('node-fetch');
const logger = require('../logger');

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: (callback, delay, ...args) => setTimeout(callback, delay, ...args),
  clearTimeout: id => clearTimeout(id),
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

/**
 * Validates if a URL is properly formatted
 * @param {string} url - The URL to validate
 * @returns {boolean} - True if the URL is valid, false otherwise
 */
function isValidUrlFormat(url) {
  if (!url) return false;

  try {
    new URL(url); // Will throw if URL is invalid
    return true;
  } catch (error) {
    // Log URL validation failure for debugging - helps track URL format issues
    logger.warn(
      `[UrlValidator] Invalid URL format: ${url}. Validation error: ${error.message || 'Unknown URL error'}`
    );
    return false;
  }
}

/**
 * Checks if a URL belongs to a known trusted domain
 * @param {string} url - The URL to check
 * @param {Array<string>} trustedDomains - List of trusted domains
 * @returns {boolean} - True if the URL is from a trusted domain
 */
function isTrustedDomain(url, trustedDomains = []) {
  if (!isValidUrlFormat(url)) return false;
  if (!trustedDomains || !Array.isArray(trustedDomains) || trustedDomains.length === 0)
    return false;

  const urlObj = new URL(url);
  return trustedDomains.some(domain => urlObj.hostname.includes(domain));
}

/**
 * Checks if a URL has an image file extension
 * @param {string} url - The URL to check
 * @returns {boolean} - True if the URL has an image extension
 */
function hasImageExtension(url) {
  if (!isValidUrlFormat(url)) return false;

  return !!url.match(/\.(png|jpg|jpeg|gif|webp)(\?.*)?$/i);
}

/**
 * Validates that a URL points to an actual image
 * @param {string} url - The URL to validate
 * @param {Object} options - Options for validation
 * @param {number} options.timeout - Timeout in ms (default: 5000)
 * @param {boolean} options.trustExtensions - Trust URLs with image extensions
 * @param {Array<string>} options.trustedDomains - List of domains to trust without validation
 * @returns {Promise<boolean>} - True if the URL points to an image
 */
async function isImageUrl(url, options = {}) {
  const { timeout = 5000, trustExtensions = true, trustedDomains: _trustedDomains } = options;

  // Check if URL is formatted correctly
  if (!isValidUrlFormat(url)) {
    return false;
  }

  // Trust URLs with image extensions if option is enabled
  if (trustExtensions && hasImageExtension(url)) {
    logger.debug(`[UrlValidator] URL has image extension, trusting without validation: ${url}`);
    return true;
  }

  // Trusted domains list - no need to validate these
  const defaultTrustedDomains = [
    'cdn.discordapp.com',
    'discord.com/assets',
    'media.discordapp.net',
  ];

  // Use provided trusted domains or defaults
  const domainsToCheck = options.trustedDomains || defaultTrustedDomains;

  // Skip validation for trusted domains
  if (isTrustedDomain(url, domainsToCheck)) {
    logger.debug(`[UrlValidator] URL is from trusted domain, skipping validation: ${url}`);
    return true;
  }

  // Validate by actually fetching the URL
  try {
    const controller = new AbortController();
    const timeoutId = timerFunctions.setTimeout(() => controller.abort(), timeout);

    const response = await nodeFetch(url, {
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

    timerFunctions.clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`[UrlValidator] URL returned non-OK status: ${response.status} for ${url}`);
      return false;
    }

    // Check content type to ensure it's an image or binary data
    const contentType = response.headers.get('content-type');
    if (!contentType) {
      logger.warn(`[UrlValidator] URL has no content-type header: ${url}`);
      return false;
    }

    // Accept both image/* and application/octet-stream (commonly used for binary files like images)
    if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      logger.warn(`[UrlValidator] URL does not point to an image: ${contentType} for ${url}`);
      return false;
    }

    // Try to read a small amount of data to check if it's readable
    try {
      const reader = response.body.getReader();
      const { done, value } = await reader.read();
      reader.cancel();

      if (done || !value || value.length === 0) {
        logger.warn(`[UrlValidator] URL returned an empty response: ${url}`);
        return false;
      }

      return true;
    } catch (readError) {
      logger.warn(`[UrlValidator] Error reading response body: ${readError.message}`);
      return false;
    }
  } catch (error) {
    logger.warn(`[UrlValidator] Error validating URL: ${error.message} for ${url}`);

    // Special case: if it has an image extension, trust it despite fetch errors
    if (hasImageExtension(url)) {
      logger.info(
        `[UrlValidator] URL appears to be an image based on extension, accepting despite errors: ${url}`
      );
      return true;
    }

    return false;
  }
}

module.exports = {
  isValidUrlFormat,
  isTrustedDomain,
  hasImageExtension,
  isImageUrl,
  configureTimers,
};
