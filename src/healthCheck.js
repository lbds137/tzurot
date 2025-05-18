/**
 * Health Check module for the Tzurot Discord bot
 *
 * @module healthCheck
 * @description
 * This module provides health check functionality for the bot, including:
 * - Status information about various components (Discord, AI service)
 * - Basic metrics like uptime and memory usage
 * - An HTTP endpoint for external monitoring systems
 *
 * Usage:
 * ```javascript
 * const { createHealthServer } = require('./healthCheck');
 * const server = createHealthServer(discordClient, 3000);
 * ```
 */

const http = require('http');
const logger = require('./logger');
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
  const memoryUsage = process.memoryUsage();
  return {
    rss: `${Math.round(memoryUsage.rss / 1024 / 1024)} MB`,
    heapTotal: `${Math.round(memoryUsage.heapTotal / 1024 / 1024)} MB`,
    heapUsed: `${Math.round(memoryUsage.heapUsed / 1024 / 1024)} MB`,
    external: `${Math.round(memoryUsage.external / 1024 / 1024)} MB`,
    memoryUsagePercent: `${Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)}%`,
  };
}

/**
 * Get system information
 * @returns {Object} System information
 */
function getSystemInfo() {
  return {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    cpuCores: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024)} MB`,
    freeMemory: `${Math.round(os.freemem() / 1024 / 1024)} MB`,
    loadAverage: os.loadavg(),
  };
}

/**
 * Check Discord connection status
 * @param {Object} client Discord.js client
 * @returns {Object} Discord connection status
 */
function checkDiscordStatus(client) {
  if (!client) {
    return {
      status: 'unavailable',
      message: 'Discord client not initialized',
    };
  }

  return {
    status: client.isReady() ? 'ok' : 'error',
    message: client.isReady() ? 'Connected to Discord' : 'Not connected to Discord',
    ping: client.ws.ping ? `${client.ws.ping}ms` : 'Unknown',
    servers: client.guilds.cache.size,
    uptime: client.uptime ? formatUptime(Math.floor(client.uptime / 1000)) : 'Unknown',
  };
}

/**
 * Check AI service status
 * @returns {Object} AI service status
 */
function checkAIStatus() {
  // This is a placeholder. In a real implementation,
  // you might want to make a test request to the OpenAI API
  // to check if it's responding correctly.
  return {
    status: 'ok',
    message: 'AI service assumed operational (no direct health check implemented)',
  };
}

/**
 * Factory function to create runHealthChecks function
 * @param {Object} client Discord.js client
 * @returns {Function} runHealthChecks function
 */
function createHealthChecksRunner(client) {
  /**
   * Run all health checks
   * @returns {Object} Combined health check results
   */
  return function runHealthChecks() {
    const uptimeSeconds = getUptime();
    const discordStatus = checkDiscordStatus(client);
    const aiStatus = checkAIStatus();

    // Determine overall status
    let overallStatus = 'ok';
    if (discordStatus.status !== 'ok' || aiStatus.status !== 'ok') {
      overallStatus = 'degraded';
    }
    if (discordStatus.status === 'error' && aiStatus.status === 'error') {
      overallStatus = 'critical';
    }

    return {
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
  };
}

/**
 * Create and start HTTP server for health checks
 * @param {Object} client Discord.js client
 * @param {number} port Port number for the health check server
 * @returns {http.Server} HTTP server instance
 */
function createHealthServer(client, port = 3000) {
  // Create a health checks runner specifically for this client
  const runHealthChecks = createHealthChecksRunner(client);

  const server = http.createServer((req, res) => {
    if (req.url === '/health' || req.url === '/health/') {
      try {
        const healthData = runHealthChecks();

        // Set appropriate status code based on health status
        let statusCode = 200;
        if (healthData.status === 'degraded') statusCode = 200; // Still return 200 but with degraded status in body
        if (healthData.status === 'critical') statusCode = 503; // Service Unavailable

        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(healthData, null, 2));

        // Log health check requests
        logger.info(
          `Health check request from ${req.socket.remoteAddress} - Status: ${healthData.status}`
        );
      } catch (error) {
        logger.error('Error generating health check data', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: 'Internal Server Error',
            message: error.message,
          })
        );
      }
    } else {
      // For any other route, return 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });

  server.on('error', error => {
    logger.error(`Health check server error: ${error.message}`, error);
  });

  server.listen(port, () => {
    logger.info(`Health check server running on port ${port}`);
  });

  return server;
}

module.exports = {
  createHealthServer,
  getUptime,
  formatUptime,
  getMemoryUsage,
  getSystemInfo,
};
