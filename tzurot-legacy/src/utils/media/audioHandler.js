/**
 * Utility for detecting, downloading, and handling audio files
 *
 * This module provides functionality to:
 * - Detect audio URLs (e.g., https://example.com/audio-file-name.mp3)
 * - Download audio files from external URLs
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
 * Checks if a URL or filename has an audio file extension
 * @param {string} urlOrFilename - The URL or filename to check
 * @returns {boolean} - True if the URL or filename has an audio extension
 */
function hasAudioExtension(urlOrFilename) {
  if (!urlOrFilename) return false;

  // If this appears to be a full URL, validate its format first
  if (urlOrFilename.startsWith('http://') || urlOrFilename.startsWith('https://')) {
    if (!urlValidator.isValidUrlFormat(urlOrFilename)) {
      return false;
    }
  } else {
    // For just filenames, we don't need URL validation
    logger.debug(`[AudioHandler] Checking audio extension for filename: ${urlOrFilename}`);
  }

  return !!urlOrFilename.match(/\.(mp3|wav|ogg|m4a|flac)(\?.*)?$/i);
}

/**
 * Validates that a URL points to an actual audio file
 * @param {string} url - The URL to validate
 * @param {Object} options - Options for validation
 * @param {number} options.timeout - Timeout in ms (default: 5000)
 * @param {boolean} options.trustExtensions - Trust URLs with audio extensions (default: true)
 * @returns {Promise<boolean>} - True if the URL points to an audio file
 */
async function isAudioUrl(url, options = {}) {
  const { timeout = 5000, trustExtensions = true } = options;

  // Check if URL is formatted correctly
  if (!urlValidator.isValidUrlFormat(url)) {
    return false;
  }

  // Trust URLs with audio extensions if option is enabled
  if (trustExtensions && hasAudioExtension(url)) {
    logger.debug(`[AudioHandler] URL has audio extension, trusting without validation: ${url}`);
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
        Accept: 'audio/mpeg,audio/ogg,audio/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    timerFunctions.clearTimeout(timeoutId);

    if (!response.ok) {
      logger.warn(`[AudioHandler] URL returned non-OK status: ${response.status} for ${url}`);
      return false;
    }

    // Check content type to ensure it's audio
    const contentType = response.headers.get('content-type');
    if (!contentType) {
      logger.warn(`[AudioHandler] URL has no content-type header: ${url}`);
      // Still accept it if it has a valid audio extension
      return hasAudioExtension(url);
    }

    // Accept both audio/* and application/octet-stream (commonly used for binary files)
    if (!contentType.startsWith('audio/') && contentType !== 'application/octet-stream') {
      logger.warn(`[AudioHandler] URL does not point to audio: ${contentType} for ${url}`);
      // Still accept it if it has a valid audio extension and we're trusting extensions
      return trustExtensions && hasAudioExtension(url);
    }

    return true;
  } catch (error) {
    logger.warn(`[AudioHandler] Error validating URL: ${error.message} for ${url}`);

    // Special case: if it has an audio extension, trust it despite fetch errors
    if (hasAudioExtension(url)) {
      logger.info(
        `[AudioHandler] URL appears to be audio based on extension, accepting despite errors: ${url}`
      );
      return true;
    }

    return false;
  }
}

/**
 * Detects and extracts audio URLs from a string
 * @param {string} content - The content to check for audio URLs
 * @returns {Array<Object>} - Array of extracted audio URLs and metadata, empty if none found
 */
function extractAudioUrls(content) {
  if (!content || typeof content !== 'string') return [];

  // Match URLs that end with .mp3, .wav, .ogg, etc. extension
  const audioUrlRegex = /https?:\/\/[^\s"'<>]+\.(mp3|wav|ogg|m4a|flac)(\?[^\s"'<>]*)?/g;
  const matches = content.match(audioUrlRegex) || [];

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
 * Downloads an audio file from a URL
 * @param {string} url - The URL of the audio file to download
 * @returns {Promise<Object>} - Promise resolving to an object with buffer, filename, and contentType
 */
async function downloadAudioFile(url) {
  logger.info(`[AudioHandler] Downloading audio file from ${url}`);

  try {
    const controller = new AbortController();
    const timeoutId = timerFunctions.setTimeout(() => controller.abort(), 30000); // 30 second timeout

    const response = await nodeFetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        Accept: 'audio/mpeg,audio/ogg,audio/*;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
    });

    timerFunctions.clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Failed to download audio file: ${response.status} ${response.statusText}`);
    }

    // Get content type and generate an appropriate filename if needed
    const contentType = response.headers.get('content-type') || 'audio/mpeg';

    // Extract filename from URL or generate one
    let filename;
    const urlObj = new URL(url);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean);
    const lastSegment = pathSegments[pathSegments.length - 1];

    // Remove query parameters from lastSegment if present
    const cleanedSegment = lastSegment.includes('?') ? lastSegment.split('?')[0] : lastSegment;

    if (cleanedSegment && hasAudioExtension(cleanedSegment)) {
      logger.debug(`[AudioHandler] Using filename from URL: ${cleanedSegment}`);
      filename = cleanedSegment;
    } else {
      // Generate a filename based on content type
      const extension = contentType.includes('ogg')
        ? 'ogg'
        : contentType.includes('wav')
          ? 'wav'
          : 'mp3'; // Default to mp3
      filename = `audio_${Date.now()}.${extension}`;
      logger.debug(`[AudioHandler] Generated filename: ${filename} for URL: ${url}`);
    }

    // Read the response as an array buffer
    const buffer = await response.arrayBuffer();

    return {
      buffer,
      filename,
      contentType,
    };
  } catch (error) {
    logger.error(`[AudioHandler] Error downloading audio file: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a Discord attachment object from a downloaded audio file
 * @param {Object} audioFile - Object containing buffer, filename, and contentType
 * @returns {Object} - Discord.js compatible attachment object
 */
function createDiscordAttachment(audioFile) {
  // Convert ArrayBuffer to Buffer
  const nodeBuffer = Buffer.from(audioFile.buffer);

  // Create a readable stream from the buffer
  const stream = new Readable();
  stream.push(nodeBuffer);
  stream.push(null);

  return {
    attachment: stream,
    name: audioFile.filename,
    contentType: audioFile.contentType,
  };
}

/**
 * Processes a message to find audio URLs and prepare attachments
 * @param {string} content - Message content to process
 * @returns {Promise<Object>} - Object with modified content and attachments
 */
async function processAudioUrls(content) {
  if (!content || typeof content !== 'string') {
    return { content, attachments: [] };
  }

  // Extract audio URLs
  const audioUrls = extractAudioUrls(content);

  if (audioUrls.length === 0) {
    return { content, attachments: [] };
  }

  logger.info(`[AudioHandler] Found ${audioUrls.length} audio URLs in message`);

  // For now, only process the first audio URL to avoid timeouts and large files
  // In the future, this could be extended to handle multiple files
  const audioUrl = audioUrls[0];

  try {
    // Download the audio file
    const audioFile = await downloadAudioFile(audioUrl.url);

    // Create a Discord attachment
    const attachment = createDiscordAttachment(audioFile);

    // Remove the entire [Audio: URL] pattern or just the URL
    let modifiedContent = content;

    // First try to remove the [Audio: URL] pattern
    const audioPattern = `[Audio: ${audioUrl.url}]`;
    if (content.includes(audioPattern)) {
      modifiedContent = content.replace(audioPattern, '').trim();
    } else {
      // Fall back to just removing the URL
      modifiedContent = content.replace(audioUrl.url, '').trim();
    }

    return {
      content: modifiedContent,
      attachments: [attachment],
    };
  } catch (error) {
    logger.error(`[AudioHandler] Failed to process audio URL: ${error.message}`);
    // Return original content with no attachments on error
    return { content, attachments: [] };
  }
}

module.exports = {
  hasAudioExtension,
  isAudioUrl,
  extractAudioUrls,
  downloadAudioFile,
  createDiscordAttachment,
  processAudioUrls,
  configureTimers,
};
