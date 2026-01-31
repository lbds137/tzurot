/**
 * Health check routes
 */

const logger = require('../logger');
const os = require('os');

// Track when the server was started
const startTime = Date.now();

/**
 * Get the current uptime in seconds
 * @returns {number} Uptime in seconds
 */
function getUptime() {
  return Math.floor((Date.now() - startTime) / 1000);
}

/**
 * Format uptime into a human-readable string
 * @param {number} uptime Uptime in seconds
 * @returns {string} Formatted uptime string (e.g., "3d 2h 5m 10s")
 */
function formatUptime(uptime) {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);
  const seconds = uptime % 60;

  return `${days}d ${hours}h ${minutes}m ${seconds}s`;
}

/**
 * Get memory usage information
 * @returns {Object} Memory usage stats
 */
function getMemoryUsage() {
  const usage = process.memoryUsage();
  return {
    rss: `${Math.round(usage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(usage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(usage.external / 1024 / 1024)} MB`,
  };
}

/**
 * Get system information
 * @returns {Object} System info
 */
function getSystemInfo() {
  return {
    platform: os.platform(),
    nodeVersion: process.version,
    cpuCount: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
    freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
  };
}

/**
 * Check Discord connection status
 * @param {Object} client - Discord.js client
 * @returns {Object} Discord status
 */
function checkDiscordStatus(client) {
  if (!client) {
    return { connected: false, status: 'No client provided' };
  }

  return {
    connected: client.ws?.status === 0, // 0 = READY
    status: ['READY', 'CONNECTING', 'RECONNECTING', 'IDLE', 'NEARLY', 'DISCONNECTED'][
      client.ws?.status ?? 5
    ],
    ping: client.ws?.ping ? `${client.ws.ping}ms` : 'N/A',
    guilds: client.guilds?.cache?.size || 0,
    users: client.users?.cache?.size || 0,
  };
}

/**
 * Check AI service status
 * @returns {Object} AI service status
 */
function checkAIStatus() {
  // Check if AI service has recent successful requests
  // This is a simplified check - could be enhanced with actual service monitoring
  return {
    available: true,
    status: 'operational',
    lastCheck: new Date().toISOString(),
  };
}

/**
 * Health check handler
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function healthHandler(req, res) {
  try {
    const context = global.httpServerContext || {};
    const client = context.discordClient;

    const discordStatus = checkDiscordStatus(client);
    const aiStatus = checkAIStatus();

    // Determine overall health status
    let overallStatus = 'healthy';
    if (!discordStatus.connected) {
      overallStatus = 'critical';
    } else if (!aiStatus.available) {
      overallStatus = 'degraded';
    }

    const uptimeSeconds = getUptime();

    const healthData = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: {
        seconds: uptimeSeconds,
        formatted: formatUptime(uptimeSeconds),
      },
      memory: getMemoryUsage(),
      system: getSystemInfo(),
      components: {
        discord: discordStatus,
        ai: aiStatus,
      },
    };

    // Set appropriate status code based on health status
    let statusCode = 200;
    if (healthData.status === 'critical') statusCode = 503;

    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(healthData, null, 2));

    logger.info(
      `[Health] Health check request from ${req.socket.remoteAddress} - Status: ${healthData.status}`
    );
  } catch (error) {
    logger.error('[Health] Error generating health check data', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'Internal Server Error',
        message: error.message,
      })
    );
  }
}

/**
 * Root path handler
 * @param {http.IncomingMessage} req - The request object
 * @param {http.ServerResponse} res - The response object
 */
async function rootHandler(req, res) {
  const clientIP = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  logger.info(`[Health] Root endpoint accessed from ${clientIP}`);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      status: 'ok',
      service: 'Tzurot Discord Bot',
      version: '1.2.1',
      environment: process.env.RAILWAY_ENVIRONMENT || 'local',
      port: process.env.PORT || '3000',
      endpoints: {
        health: '/health',
        avatars: '/avatars',
        webhooks: '/webhooks',
      },
    })
  );
}

module.exports = {
  routes: [
    { method: 'GET', path: '/', handler: rootHandler },
    { method: 'GET', path: '/health', handler: healthHandler },
    { method: 'GET', path: '/health/', handler: healthHandler },
  ],
};
