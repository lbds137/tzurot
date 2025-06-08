/**
 * Avatar Routes
 *
 * HTTP endpoints for serving locally stored personality avatars.
 * Provides a safe way to serve avatars without exposing external URLs.
 */

const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const logger = require('../logger');
const url = require('url');

// Promisified fs methods
const stat = promisify(fs.stat);

// Configuration
const AVATAR_IMAGES_DIR = path.join(process.cwd(), 'data', 'avatars', 'images');
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
const CACHE_CONTROL_HEADER = 'public, max-age=86400'; // 24 hours

/**
 * Validate filename to prevent directory traversal attacks
 * @param {string} filename - The filename to validate
 * @returns {boolean} True if valid
 */
function isValidFilename(filename) {
  // Check for directory traversal attempts
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false;
  }

  // Check extension
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return false;
  }

  // Check filename pattern (personality-name-hash.ext)
  const validPattern = /^[a-z0-9-]+\.[a-z]+$/i;
  return validPattern.test(filename);
}

/**
 * Get MIME type from file extension
 * @param {string} filename - The filename
 * @returns {string} MIME type
 */
function getMimeType(filename) {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Parse filename from URL path
 * @param {string} urlPath - The URL path
 * @returns {string|null} Filename or null
 */
function parseFilename(urlPath) {
  // Remove /avatars/ prefix
  const match = urlPath.match(/^\/avatars\/([^/]+)$/);
  return match ? match[1] : null;
}

/**
 * Handler for serving avatar files
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function avatarFileHandler(req, res) {
  const parsedUrl = url.parse(req.url);
  const filename = parseFilename(parsedUrl.pathname);

  if (!filename) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  try {
    // Validate filename
    if (!isValidFilename(filename)) {
      logger.warn(`[AvatarRoute] Invalid filename requested: ${filename}`);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid filename' }));
      return;
    }

    // Build safe file path
    const filePath = path.join(AVATAR_IMAGES_DIR, filename);

    // Check if file exists
    try {
      const stats = await stat(filePath);

      if (!stats.isFile()) {
        logger.warn(`[AvatarRoute] Requested path is not a file: ${filename}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Avatar not found' }));
        return;
      }

      // Set appropriate headers
      res.writeHead(200, {
        'Content-Type': getMimeType(filename),
        'Content-Length': stats.size,
        'Cache-Control': CACHE_CONTROL_HEADER,
        'X-Content-Type-Options': 'nosniff',
      });

      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);

      fileStream.on('error', error => {
        logger.error(`[AvatarRoute] Error streaming file ${filename}:`, error);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Failed to stream avatar' }));
        }
      });
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info(`[AvatarRoute] Avatar not found: ${filename}`);
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Avatar not found' }));
        return;
      }
      throw error;
    }
  } catch (error) {
    logger.error(`[AvatarRoute] Error serving avatar ${filename}:`, error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
}

/**
 * Handler for avatar service health check
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function avatarHealthHandler(req, res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      message: 'Avatar service is running',
      allowedExtensions: ALLOWED_EXTENSIONS,
    })
  );
}

/**
 * General avatar handler that routes to specific handlers
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function avatarHandler(req, res) {
  const parsedUrl = url.parse(req.url);

  // If path is exactly /avatars or /avatars/, it's a health check
  if (parsedUrl.pathname === '/avatars' || parsedUrl.pathname === '/avatars/') {
    return avatarHealthHandler(req, res);
  }

  // Otherwise, try to serve a file
  return avatarFileHandler(req, res);
}

// Export routes in the expected format
module.exports = {
  routes: [
    // Match any path starting with /avatars
    { method: 'GET', path: '/avatars', handler: avatarHandler },
    { method: 'GET', path: '/avatars/', handler: avatarHandler },
    // Need to add dynamic route support to httpServer for /avatars/:filename
  ],
  // Export for testing
  isValidFilename,
  getMimeType,
  parseFilename,
};
