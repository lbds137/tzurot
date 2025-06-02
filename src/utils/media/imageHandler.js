/**
 * Utility for detecting, downloading, and handling image files
 *
 * This module provides functionality to:
 * - Detect image URLs (e.g., https://example.com/image.jpg)
 * - Download image files from external URLs
 * - Convert external URLs to Discord attachments
 */

const nodeFetch = require('node-fetch');
const { Readable } = require('stream');
const logger = require('../../logger');
const urlValidator = require('../urlValidator');

// Injectable timer functions for testability
let timerFunctions = {
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
};

/**
 * Configure timer functions (for testing)
 * @param {Object} customTimers - Custom timer implementations
 */
function configureTimers(customTimers) {
  timerFunctions = { ...timerFunctions, ...customTimers };
}

/**
 * Checks if a URL or filename has an image file extension
 * @param {string} urlOrFilename - The URL or filename to check
 * @returns {boolean} - True if the URL or filename has an image extension
 */
function hasImageExtension(urlOrFilename) {
  if (!urlOrFilename) return false;

  // If this appears to be a full URL, validate its format first
  if (urlOrFilename.startsWith('http://') || urlOrFilename.startsWith('https://')) {
    if (!urlValidator.isValidUrlFormat(urlOrFilename)) {
      return false;
    }
  } else {
    // For just filenames, we don't need URL validation
    logger.debug(`[ImageHandler] Checking image extension for filename: ${urlOrFilename}`);
  }

  return !!urlOrFilename.match(/\.(jpg|jpeg|png|gif|webp|bmp)(\?.*)?$/i);
}

/**
 * Validates that a URL points to an actual image file
 * @param {string} url - The URL to validate
 * @param {Object} options - Options for validation
 * @param {number} options.timeout - Timeout in ms (default: 5000)
 * @param {boolean} options.trustExtensions - Trust URLs with image extensions (default: true)
 * @returns {Promise<boolean>} - True if the URL points to an image file
 */
async function isImageUrl(url, options = {}) {
  const { timeout = 5000, trustExtensions = true } = options;

  // Check if URL is formatted correctly
  if (!urlValidator.isValidUrlFormat(url)) {
    return false;
  }

  // Trust URLs with image extensions if option is enabled
  if (trustExtensions && hasImageExtension(url)) {
    logger.debug(`[ImageHandler] URL has image extension, trusting without validation: ${url}`);
    return true;
  }

  // Validate by actually fetching the URL
  try {
    const controller = new AbortController();
    const timeoutId = timerFunctions.setTimeout(() => controller.abort(), timeout);

    const response = await nodeFetch(url, {
      method: 'HEAD', // Use HEAD to avoid downloading the entire file
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'image/jpeg,image/png,image/gif,image/webp,image/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    timerFunctions.clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`[ImageHandler] URL returned non-OK status: ${response.status} for ${url}`);
      return false;
    }

    // Check content type to ensure it's an image
    const contentType = response.headers.get('content-type');
    if (!contentType) {
      logger.warn(`[ImageHandler] URL has no content-type header: ${url}`);
      // Still accept it if it has a valid image extension
      return hasImageExtension(url);
    }

    // Accept both image/* and application/octet-stream (commonly used for binary files)
    if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      logger.warn(`[ImageHandler] URL does not point to image: ${contentType} for ${url}`);
      // Still accept it if it has a valid image extension and we're trusting extensions
      return trustExtensions && hasImageExtension(url);
    }

    return true;
  } catch (error) {
    logger.warn(`[ImageHandler] Error validating URL: ${error.message} for ${url}`);

    // Special case: if it has an image extension, trust it despite fetch errors
    if (hasImageExtension(url)) {
      logger.info(
        `[ImageHandler] URL appears to be image based on extension, accepting despite errors: ${url}`
      );
      return true;
    }

    return false;
  }
}

/**
 * Detects and extracts image URLs from a string
 * @param {string} content - The content to check for image URLs
 * @returns {Array<Object>} - Array of extracted image URLs and metadata, empty if none found
 */
function extractImageUrls(content) {
  if (!content || typeof content !== 'string') return [];

  // Match URLs that end with image file extensions
  const imageUrlRegex = /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|gif|webp|bmp)(\?[^\s"'<>]*)?/g;
  const matches = content.match(imageUrlRegex) || [];

  return matches.map(url => {
    // Extract filename from URL
    const parts = url.split('/');
    let filename = parts[parts.length - 1];

    // Remove query parameters from filename if present
    if (filename.includes('?')) {
      filename = filename.split('?')[0];
    }

    // Determine the file type based on domain
    let fileType = 'generic';
    // Use more generic categorization based on domain patterns
    if (url.includes('cdn.discordapp.com')) {
      fileType = 'discord';
    } else if (url.includes('files.')) {
      fileType = 'files';
    }

    return {
      url,
      filename,
      matchedPattern: fileType,
    };
  });
}

/**
 * Downloads an image file from a URL
 * @param {string} url - The URL of the image file to download
 * @returns {Promise<Object>} - Promise resolving to an object with buffer, filename, and contentType
 */
async function downloadImageFile(url) {
  logger.info(`[ImageHandler] Downloading image file from ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = timerFunctions.setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await nodeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'image/jpeg,image/png,image/gif,image/webp,image/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    timerFunctions.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download image file: ${response.status} ${response.statusText}`);
    }

    // Get content type and generate an appropriate filename if needed
    const contentType = response.headers.get('content-type') || 'image/jpeg';

    // Extract filename from URL or generate one
    let filename;
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];

    // Remove query parameters from lastSegment if present
    const cleanedSegment = lastSegment.includes('?') ? lastSegment.split('?')[0] : lastSegment;

    if (cleanedSegment && hasImageExtension(cleanedSegment)) {
      logger.debug(`[ImageHandler] Using filename from URL: ${cleanedSegment}`);
      filename = cleanedSegment;
    } else {
      // Generate a filename based on content type
      const extension = contentType.includes('png')
        ? 'png'
        : contentType.includes('gif')
          ? 'gif'
          : contentType.includes('webp')
            ? 'webp'
            : 'jpg'; // Default to jpg
      filename = `image_${Date.now()}.${extension}`;
      logger.debug(`[ImageHandler] Generated filename: ${filename} for URL: ${url}`);
    }

    // Read the response as an array buffer
    const buffer = await response.arrayBuffer();

    return {
      buffer,
      filename,
      contentType,
    };
  } catch (error) {
    logger.error(`[ImageHandler] Error downloading image file: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a Discord attachment object from a downloaded image file
 * @param {Object} imageFile - Object containing buffer, filename, and contentType
 * @returns {Object} - Discord.js compatible attachment object
 */
function createDiscordAttachment(imageFile) {
  // Convert ArrayBuffer to Buffer
  const nodeBuffer = Buffer.from(imageFile.buffer);

  // Create a readable stream from the buffer
  const stream = new Readable();
  stream.push(nodeBuffer);
  stream.push(null);

  return {
    attachment: stream,
    name: imageFile.filename,
    contentType: imageFile.contentType,
  };
}

/**
 * Processes a message to find image URLs and prepare attachments
 * @param {string} content - Message content to process
 * @returns {Promise<Object>} - Object with modified content and attachments
 */
async function processImageUrls(content) {
  if (!content || typeof content !== 'string') {
    return { content, attachments: [] };
  }

  // Extract image URLs
  const imageUrls = extractImageUrls(content);

  if (imageUrls.length === 0) {
    return { content, attachments: [] };
  }

  logger.info(`[ImageHandler] Found ${imageUrls.length} image URLs in message`);

  // For now, only process the first image URL
  // In the future, this could be extended to handle multiple files
  const imageUrl = imageUrls[0];

  try {
    // Download the image file
    const imageFile = await downloadImageFile(imageUrl.url);

    // Create a Discord attachment
    const attachment = createDiscordAttachment(imageFile);

    // Remove the entire [Image: URL] pattern or just the URL
    let modifiedContent = content;

    // First try to remove the [Image: URL] pattern
    const imagePattern = `[Image: ${imageUrl.url}]`;
    if (content.includes(imagePattern)) {
      modifiedContent = content.replace(imagePattern, '').trim();
    } else {
      // Fall back to just removing the URL
      modifiedContent = content.replace(imageUrl.url, '').trim();
    }

    return {
      content: modifiedContent,
      attachments: [attachment],
    };
  } catch (error) {
    logger.error(`[ImageHandler] Failed to process image URL: ${error.message}`);
    // Return original content with no attachments on error
    return { content, attachments: [] };
  }
}

module.exports = {
  hasImageExtension,
  isImageUrl,
  extractImageUrls,
  downloadImageFile,
  createDiscordAttachment,
  processImageUrls,
  configureTimers,
};
