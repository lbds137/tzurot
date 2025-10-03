/**
 * Deduplication Monitoring Module
 *
 * This module provides monitoring capabilities for message deduplication.
 * It tracks and logs statistics about message deduplication events to
 * help detect any issues with the refactored system.
 *
 * Usage:
 * ```
 * const { trackDedupe, getDedupStats, startMonitoring } = require('./monitoring/deduplicationMonitor');
 *
 * // In MessageTracker class
 * if (this.processedMessages.has(trackingId)) {
 *   trackDedupe('message', trackingId);
 *   return false;
 * }
 * ```
 */

const logger = require('../logger');
const fs = require('fs').promises;
const path = require('path');
const { botConfig } = require('../../config');

// Statistics tracking
const stats = {
  messageDedupes: 0, // Total deduplicated messages
  operationDedupes: 0, // Total deduplicated operations
  messageTypes: {}, // Counts by message type
  operationTypes: {}, // Counts by operation type
  channelStats: {}, // Counts by channel ID
  hourlyStats: {}, // Counts by hour
  startTime: Date.now(), // When monitoring started
  isProduction: botConfig.environment === 'production',
};

// Configuration
const LOG_INTERVAL = 15 * 60 * 1000; // 15 minutes
const STATS_FILE = path.join(__dirname, '../../logs/deduplication_stats.json');

/**
 * Track a deduplication event
 * @param {string} category - 'message' or 'operation'
 * @param {string} id - Tracking ID
 * @param {Object} details - Additional details (type, channelId, etc.)
 */
function trackDedupe(category, id, details = {}) {
  // Increment total counts
  if (category === 'message') {
    stats.messageDedupes++;

    // Track by message type
    const type = details.type || 'unknown';
    stats.messageTypes[type] = (stats.messageTypes[type] || 0) + 1;
  } else if (category === 'operation') {
    stats.operationDedupes++;

    // Track by operation type
    const type = details.type || 'unknown';
    stats.operationTypes[type] = (stats.operationTypes[type] || 0) + 1;
  }

  // Track by channel
  if (details.channelId) {
    stats.channelStats[details.channelId] = (stats.channelStats[details.channelId] || 0) + 1;
  }

  // Track by hour
  const hour = new Date().getHours();
  stats.hourlyStats[hour] = (stats.hourlyStats[hour] || 0) + 1;

  // Log deduplication event
  if (stats.isProduction) {
    // In production, only log periodically
    if ((stats.messageDedupes + stats.operationDedupes) % 100 === 0 || details.forceLog) {
      logStats();
    }
  } else {
    // In development, log each event
    logger.debug(`[DedupeMonitor] ${category} dedupe: ${id.substring(0, 30)}`);
  }
}

/**
 * Get current deduplication statistics
 * @returns {Object} Current stats
 */
function getDedupStats() {
  // Calculate runtime
  const runtime = Math.floor((Date.now() - stats.startTime) / (60 * 1000)); // minutes

  // Calculate rates
  const totalDedupes = stats.messageDedupes + stats.operationDedupes;
  const dedupePerMinute = runtime > 0 ? totalDedupes / runtime : 0;

  return {
    ...stats,
    runtime,
    totalDedupes,
    dedupePerMinute,
  };
}

/**
 * Log current statistics
 */
function logStats() {
  const currentStats = getDedupStats();
  logger.info(
    `[DedupeMonitor] Stats: ${currentStats.totalDedupes} dedupes (${currentStats.dedupePerMinute.toFixed(2)}/min)`
  );

  // In production, also log top channels
  if (stats.isProduction) {
    // Get top 3 channels by dedupe count
    const topChannels = Object.entries(currentStats.channelStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([channelId, count]) => `${channelId}: ${count}`)
      .join(', ');

    if (topChannels) {
      logger.info(`[DedupeMonitor] Top channels: ${topChannels}`);
    }
  }
}

/**
 * Save statistics to file
 * @returns {Promise<void>}
 */
async function saveStats() {
  try {
    const currentStats = getDedupStats();
    await fs.writeFile(STATS_FILE, JSON.stringify(currentStats, null, 2), 'utf8');
    logger.info(`[DedupeMonitor] Statistics saved to ${STATS_FILE}`);
  } catch (error) {
    logger.error(`[DedupeMonitor] Error saving statistics: ${error.message}`);
  }
}

/**
 * Start monitoring with periodic logging
 * @param {Object} options - Options for monitoring
 * @returns {NodeJS.Timeout} - The interval ID
 */
function startMonitoring(options = {}) {
  logger.info('[DedupeMonitor] Deduplication monitoring started');

  // Injectable timer function for testability
  const intervalFn = options.interval || setInterval;
  const logInterval = options.logInterval || LOG_INTERVAL;

  // Periodically log statistics
  const interval = intervalFn(() => {
    logStats();

    // In production, also save to file
    if (stats.isProduction) {
      saveStats().catch(() => {});
    }
  }, logInterval);

  // Save stats on exit
  process.on('SIGINT', async () => {
    logger.info('[DedupeMonitor] Saving final statistics before exit');
    await saveStats();
    process.exit(0);
  });
}

/**
 * Reset statistics
 */
function resetStats() {
  stats.messageDedupes = 0;
  stats.operationDedupes = 0;
  stats.messageTypes = {};
  stats.operationTypes = {};
  stats.channelStats = {};
  stats.hourlyStats = {};
  stats.startTime = Date.now();
  logger.info('[DedupeMonitor] Statistics reset');
}

module.exports = {
  trackDedupe,
  getDedupStats,
  startMonitoring,
  resetStats,
  logStats,
};
