/**
 * Avatar Storage Manager
 *
 * Handles local storage of personality avatars with lazy loading and checksum tracking.
 * Downloads avatars from AI service on-demand and serves them locally to avoid
 * potential domain blocking issues.
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch');
const logger = require('../logger');
const urlValidator = require('./urlValidator');
const { avatarConfig, getAvatarUrl } = require('../../config');

// Storage paths
const AVATAR_BASE_DIR = path.join(process.cwd(), 'data', 'avatars');
const AVATAR_IMAGES_DIR = path.join(AVATAR_BASE_DIR, 'images');
const METADATA_FILE = path.join(AVATAR_BASE_DIR, 'metadata.json');

// Cache for metadata to avoid repeated file reads
let metadataCache = null;
let metadataDirty = false;

// Configuration - merge with config from main config file
const config = {
  ...avatarConfig,
  checksumAlgorithm: 'md5',
};

// Injectable timer functions for testability
let setTimeoutFn = globalThis.setTimeout || setTimeout;
let clearTimeoutFn = globalThis.clearTimeout || clearTimeout;

/**
 * Override timer functions for testing
 * @param {Object} timers - Timer functions to use
 */
function setTimerFunctions(timers) {
  if (timers.setTimeout) setTimeoutFn = timers.setTimeout;
  if (timers.clearTimeout) clearTimeoutFn = timers.clearTimeout;
}

/**
 * Initialize the avatar storage system
 * Ensures directories exist and loads metadata
 */
async function initialize() {
  try {
    // Create directories if they don't exist
    await fs.mkdir(AVATAR_IMAGES_DIR, { recursive: true });

    // Load metadata if it exists
    try {
      const data = await fs.readFile(METADATA_FILE, 'utf8');
      // Handle empty files gracefully
      if (!data || data.trim() === '') {
        logger.info('[AvatarStorage] Found empty metadata file, initializing with empty object');
        metadataCache = {};
        metadataDirty = true;
        await saveMetadata();
      } else {
        metadataCache = JSON.parse(data);
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist, create empty metadata
        metadataCache = {};
        metadataDirty = true;
        await saveMetadata();
      } else if (error instanceof SyntaxError) {
        // Handle JSON parse errors (including empty files)
        logger.warn(
          '[AvatarStorage] Invalid JSON in metadata file, reinitializing:',
          error.message
        );
        metadataCache = {};
        metadataDirty = true;
        await saveMetadata();
      } else {
        throw error;
      }
    }

    logger.info('[AvatarStorage] Initialized avatar storage system');
  } catch (error) {
    logger.error('[AvatarStorage] Failed to initialize:', error);
    throw error;
  }
}

/**
 * Save metadata to disk
 */
async function saveMetadata() {
  if (!metadataDirty && metadataCache !== null) return;

  try {
    await fs.writeFile(METADATA_FILE, JSON.stringify(metadataCache, null, 2));
    metadataDirty = false;
  } catch (error) {
    logger.error('[AvatarStorage] Failed to save metadata:', error);
    throw error;
  }
}

/**
 * Generate a safe filename for a personality
 * @param {string} personalityName - The personality name
 * @param {string} extension - File extension
 * @returns {string} Safe filename
 */
function generateFilename(personalityName, extension = '.png') {
  // Create a hash of the personality name to avoid filesystem issues
  const hash = crypto.createHash('md5').update(personalityName).digest('hex');
  const safeName = personalityName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return `${safeName}-${hash.substring(0, 8)}${extension}`;
}

/**
 * Calculate checksum of a buffer
 * @param {Buffer} buffer - The data to checksum
 * @returns {string} Hex checksum
 */
function calculateChecksum(buffer) {
  return crypto.createHash(config.checksumAlgorithm).update(buffer).digest('hex');
}

/**
 * Download an avatar from a URL
 * @param {string} url - The avatar URL
 * @param {string} personalityName - The personality name
 * @returns {Promise<{buffer: Buffer, extension: string, checksum: string}>}
 */
async function downloadAvatar(url, personalityName) {
  try {
    logger.info(`[AvatarStorage] Downloading avatar for ${personalityName} from ${url}`);

    // Validate URL
    if (!urlValidator.isValidUrlFormat(url)) {
      throw new Error('Invalid avatar URL');
    }

    // Download the image
    const controller = new AbortController();
    const timeout = setTimeoutFn(() => controller.abort(), config.downloadTimeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'TzurotBot/1.0',
        },
      });

      clearTimeoutFn(timeout);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check content type
      const contentType = response.headers.get('content-type') || '';

      // For application/octet-stream or missing content-type, check URL extension
      const isGenericBinary = contentType === 'application/octet-stream' || !contentType;
      const urlPath = new URL(url).pathname;
      const urlExt = path.extname(urlPath).toLowerCase();

      // If content type is generic binary, validate by URL extension
      if (isGenericBinary) {
        if (!config.allowedExtensions.includes(urlExt)) {
          throw new Error(`Invalid file extension: ${urlExt}`);
        }
      } else if (!contentType.startsWith('image/')) {
        // If it's not generic binary and not an image type, reject
        throw new Error(`Invalid content type: ${contentType}`);
      }

      // Get file extension from content type or URL
      let extension = '.png'; // default

      // If generic binary, use URL extension
      if (isGenericBinary && config.allowedExtensions.includes(urlExt)) {
        extension = urlExt;
      } else if (contentType.includes('jpeg') || contentType.includes('jpg')) {
        extension = '.jpg';
      } else if (contentType.includes('gif')) {
        extension = '.gif';
      } else if (contentType.includes('webp')) {
        extension = '.webp';
      } else if (config.allowedExtensions.includes(urlExt)) {
        // Fall back to URL extension if content type doesn't match known types
        extension = urlExt;
      }

      // Download to buffer
      const buffer = await response.buffer();

      // Check file size
      if (buffer.length > config.maxFileSize) {
        throw new Error(`File too large: ${buffer.length} bytes`);
      }

      // Calculate checksum
      const checksum = calculateChecksum(buffer);

      return { buffer, extension, checksum };
    } finally {
      clearTimeoutFn(timeout);
    }
  } catch (error) {
    logger.error(`[AvatarStorage] Failed to download avatar for ${personalityName}:`, error);
    throw error;
  }
}

/**
 * Get local avatar URL for a personality
 * Downloads the avatar if not already stored or if checksum changed
 * @param {string} personalityName - The personality name
 * @param {string} remoteUrl - The remote avatar URL
 * @returns {Promise<string|null>} Local URL or null if failed
 */
async function getLocalAvatarUrl(personalityName, remoteUrl) {
  if (!remoteUrl) return null;

  try {
    // Ensure initialized
    if (!metadataCache) {
      await initialize();
    }

    const metadata = metadataCache[personalityName];

    // Check if we already have this avatar
    if (metadata && metadata.originalUrl === remoteUrl && metadata.localFilename) {
      // Check if file exists
      const filePath = path.join(AVATAR_IMAGES_DIR, metadata.localFilename);
      try {
        await fs.access(filePath);
        // File exists, return local URL
        return getAvatarUrl(metadata.localFilename);
      } catch (error) {
        // File doesn't exist, need to re-download
        logger.warn(`[AvatarStorage] Avatar file missing for ${personalityName}, re-downloading`);
      }
    }

    // Download the avatar
    const { buffer, extension, checksum } = await downloadAvatar(remoteUrl, personalityName);

    // Check if checksum matches existing
    if (metadata && metadata.checksum === checksum) {
      logger.info(`[AvatarStorage] Avatar unchanged for ${personalityName} (checksum match)`);
      return getAvatarUrl(metadata.localFilename);
    }

    // Save the new avatar
    const filename = generateFilename(personalityName, extension);
    const filePath = path.join(AVATAR_IMAGES_DIR, filename);

    await fs.writeFile(filePath, buffer);

    // Update metadata
    metadataCache[personalityName] = {
      originalUrl: remoteUrl,
      localFilename: filename,
      checksum,
      downloadedAt: new Date().toISOString(),
      lastChecked: new Date().toISOString(),
    };
    metadataDirty = true;
    await saveMetadata();

    logger.info(`[AvatarStorage] Saved avatar for ${personalityName} as ${filename}`);

    return getAvatarUrl(filename);
  } catch (error) {
    logger.error(`[AvatarStorage] Failed to get local avatar for ${personalityName}:`, error);
    return null;
  }
}

/**
 * Check if an avatar needs updating based on checksum
 * @param {string} personalityName - The personality name
 * @param {string} remoteUrl - The remote avatar URL
 * @returns {Promise<boolean>} True if avatar needs updating
 */
async function needsUpdate(personalityName, remoteUrl) {
  if (!remoteUrl) return false;

  try {
    // Ensure initialized
    if (!metadataCache) {
      await initialize();
    }

    const metadata = metadataCache[personalityName];

    // If no metadata or URL changed, needs update
    if (!metadata || metadata.originalUrl !== remoteUrl) {
      return true;
    }

    // Download to check checksum
    const { checksum } = await downloadAvatar(remoteUrl, personalityName);

    // Update last checked time
    metadata.lastChecked = new Date().toISOString();
    metadataDirty = true;

    return checksum !== metadata.checksum;
  } catch (error) {
    logger.error(
      `[AvatarStorage] Failed to check if avatar needs update for ${personalityName}:`,
      error
    );
    return false;
  }
}

/**
 * Clean up avatar for a personality
 * @param {string} personalityName - The personality name
 */
async function cleanupAvatar(personalityName) {
  try {
    const metadata = metadataCache[personalityName];
    if (metadata && metadata.localFilename) {
      const filePath = path.join(AVATAR_IMAGES_DIR, metadata.localFilename);
      try {
        await fs.unlink(filePath);
        logger.info(`[AvatarStorage] Deleted avatar file for ${personalityName}`);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    }

    delete metadataCache[personalityName];
    metadataDirty = true;
    await saveMetadata();
  } catch (error) {
    logger.error(`[AvatarStorage] Failed to cleanup avatar for ${personalityName}:`, error);
  }
}

/**
 * Get avatar metadata
 * @param {string} personalityName - The personality name
 * @returns {Object|null} Metadata or null
 */
function getMetadata(personalityName) {
  return metadataCache ? metadataCache[personalityName] || null : null;
}

/**
 * Set configuration options
 * @param {Object} options - Configuration options
 */
function configure(options) {
  Object.assign(config, options);
}

/**
 * Reset module state (for testing)
 */
function reset() {
  metadataCache = null;
  metadataDirty = false;
}

module.exports = {
  initialize,
  getLocalAvatarUrl,
  needsUpdate,
  cleanupAvatar,
  getMetadata,
  configure,
  generateFilename,
  calculateChecksum,
  setTimerFunctions,
  reset,
};
