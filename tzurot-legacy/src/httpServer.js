/**
 * General HTTP Server for Tzurot
 *
 * This module provides a modular HTTP server that can handle various endpoints
 * including health checks, webhooks, and future HTTP-based integrations.
 */

const http = require('http');
const logger = require('./logger');

/**
 * Route registry to store endpoint handlers
 */
const routes = new Map();

/**
 * Register a route handler
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - URL path
 * @param {Function} handler - Async function to handle the request
 */
function registerRoute(method, path, handler) {
  const routeKey = `${method.toUpperCase()}:${path}`;
  routes.set(routeKey, handler);
  logger.info(`[HTTPServer] Registered route: ${routeKey}`);
}

/**
 * Register multiple routes from a module
 * @param {Object} routeModule - Module exporting routes array
 */
function registerRoutes(routeModule) {
  if (routeModule.routes && Array.isArray(routeModule.routes)) {
    routeModule.routes.forEach(({ method, path, handler }) => {
      registerRoute(method, path, handler);
    });
  }
}

/**
 * Main request handler
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function handleRequest(req, res) {
  // Log all incoming requests for debugging Railway connectivity
  const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  logger.info(`[HTTPServer] Incoming request: ${req.method} ${req.url} from ${clientIP}`);

  const routeKey = `${req.method}:${req.url}`;
  let handler = routes.get(routeKey);

  // Set CORS headers for all responses
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, X-Hub-Signature-256, X-GitHub-Event'
  );

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // If no exact match, check for prefix matches (for dynamic routes)
  if (!handler) {
    // Check if any route is a prefix match
    for (const [key, value] of routes.entries()) {
      const [method, path] = key.split(':');
      if (req.method === method && req.url.startsWith(path)) {
        // Special case: root path should only match exactly
        if (path === '/' && req.url !== '/') {
          continue;
        }
        handler = value;
        logger.debug(`[HTTPServer] Prefix match found: ${key} for ${req.url}`);
        break;
      }
    }
  }

  if (handler) {
    try {
      await handler(req, res);
    } catch (error) {
      logger.error(`[HTTPServer] Error handling ${routeKey}:`, error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal Server Error', message: error.message }));
    }
  } else {
    // No matching route found
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found', path: req.url }));
  }
}

/**
 * Create and start the HTTP server
 * @param {number} port - Port number for the server
 * @param {Object} context - Shared context (e.g., Discord client)
 * @returns {http.Server} HTTP server instance
 */
function createHTTPServer(port = 3000, context = {}) {
  // Store context for routes to access
  global.httpServerContext = context;

  // Load route modules
  try {
    const healthRoutes = require('./routes/health');
    registerRoutes(healthRoutes);
  } catch (error) {
    logger.warn('[HTTPServer] Health routes not found, skipping');
  }

  try {
    const webhookRoutes = require('./routes/webhooks');
    registerRoutes(webhookRoutes);
  } catch (error) {
    logger.warn('[HTTPServer] Webhook routes not found, skipping');
  }

  try {
    const avatarRoutes = require('./routes/avatars');
    registerRoutes(avatarRoutes);
  } catch (error) {
    logger.warn('[HTTPServer] Avatar routes not found, skipping');
  }

  // Create the server
  const server = http.createServer(handleRequest);

  server.on('error', error => {
    logger.error(`[HTTPServer] Server error: ${error.message}`, error);
  });

  server.listen(port, '0.0.0.0', () => {
    logger.info(`[HTTPServer] Server running on 0.0.0.0:${port}`);
    logger.info(`[HTTPServer] Available routes: ${Array.from(routes.keys()).join(', ')}`);
    logger.info(
      `[HTTPServer] Railway deployment URL expected: ${process.env.RAILWAY_STATIC_URL || 'not set'}`
    );
  });

  return server;
}

module.exports = {
  createHTTPServer,
  registerRoute,
  registerRoutes,
};
