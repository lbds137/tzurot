// Load environment variables
require('dotenv').config();
const coreConversation = require('./src/core/conversation');
const { initBot, client } = require('./src/bot');
const { clearAllWebhookCaches } = require('./src/webhookManager');
const logger = require('./src/logger');
const { botConfig } = require('./config');
const { releaseNotificationManager } = require('./src/core/notifications');
const { getApplicationBootstrap } = require('./src/application/bootstrap/ApplicationBootstrap');

// Track whether app has been initialized
let isInitialized = false;
// HTTP server instance (handles health checks, webhooks, etc.)
let httpServer = null;
// Application bootstrap instance
let appBootstrap = null;

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, _promise) => {
  logger.error('Unhandled Promise Rejection:', reason);
});

// Proper cleanup on exit
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Initialize the application only once
async function init() {
  if (isInitialized) {
    logger.info('Application already initialized, skipping duplicate initialization');
    return;
  }
  
  try {
    logger.info(`Starting ${botConfig.name} initialization...`);
    
    // Check if Railway volume is mounted
    const fs = require('fs').promises;
    try {
      const dataDir = '/app/data';
      const stats = await fs.stat(dataDir);
      if (stats.isDirectory()) {
        logger.info(`Railway volume mounted successfully at ${dataDir}`);
        // Test write permissions
        const testFile = `${dataDir}/.volume-test`;
        await fs.writeFile(testFile, new Date().toISOString());
        await fs.unlink(testFile);
        logger.info('Railway volume is writable');
      }
    } catch (volumeError) {
      logger.warn('Railway volume not detected or not writable:', volumeError.message);
    }
    
    // Initialize conversation manager (loads saved conversation data)
    await coreConversation.initConversationManager();
    logger.info('Conversation manager initialized');

    // Initialize application bootstrap with DDD authentication
    try {
      appBootstrap = getApplicationBootstrap();
      await appBootstrap.initialize();
      logger.info('Application bootstrap initialized');
    } catch (error) {
      logger.error('Failed to initialize application bootstrap:', error);
      throw error; // DDD authentication is now required
    }

    // Initialize pluralkitReplyTracker cleanup
    const pluralkitReplyTracker = require('./src/utils/pluralkitReplyTracker');
    pluralkitReplyTracker.startCleanup();
    logger.info('Pluralkit reply tracker initialized');

    // AI client gets authentication from DDD system when needed
    logger.info('AI client will be initialized by DDD system when needed');

    // Initialize and start the bot - this is critical for user experience
    // Bot will get authentication from the DDD system via ApplicationBootstrap
    await initBot();
    logger.info('Bot initialized and started');

    // Now that the bot is started, we can do non-blocking background tasks

    // Initialize release notification manager and check for updates
    try {
      await releaseNotificationManager.initialize(client);
      logger.info('Release notification manager initialized');

      // Check for new version and send notifications in the background
      // We don't await this to avoid blocking startup
      releaseNotificationManager.checkAndNotify()
        .then(result => {
          if (result.notified) {
            logger.info(`Sent release notifications for v${result.version} to ${result.usersNotified} users`);
          }
        })
        .catch(error => {
          logger.error('Error checking for release notifications:', error);
        });
    } catch (notificationError) {
      logger.error('Failed to initialize release notifications:', notificationError);
      // Continue without notifications - not critical for bot operation
    }

    // Start HTTP server for health checks, webhooks, and other endpoints
    try {
      const { createHTTPServer } = require('./src/httpServer');
      const httpPort = process.env.PORT || process.env.HTTP_PORT || 3000;
      
      logger.info(`[Init] Starting HTTP server on port ${httpPort} (PORT env: ${process.env.PORT || 'not set'})`);
      
      // Create context with Discord client and other shared resources
      const serverContext = {
        discordClient: global.tzurotClient || client,
      };
      
      httpServer = createHTTPServer(httpPort, serverContext);
      logger.info(`[Init] HTTP server started successfully on port ${httpPort}`);
      
      // Log Railway-specific environment info
      if (process.env.RAILWAY_ENVIRONMENT) {
        logger.info(`[Init] Railway environment: ${process.env.RAILWAY_ENVIRONMENT}`);
        logger.info(`[Init] Railway public domain: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'not set'}`);
        logger.info(`[Init] Railway static URL: ${process.env.RAILWAY_STATIC_URL || 'not set'}`);
        logger.info(`[Init] Railway service URL: ${process.env.RAILWAY_SERVICE_URL || 'not set'}`);
      } else {
        logger.info(`[Init] Not running on Railway (RAILWAY_ENVIRONMENT not set)`);
      }
    } catch (httpError) {
      logger.error('[Init] Failed to start HTTP server:', httpError);
      logger.error('[Init] HTTP server error details:', httpError.stack);
      // Continue initialization despite HTTP server failure
      // The bot can still function without it
    }
    
    isInitialized = true;
    logger.info(`${botConfig.name} initialization complete`);
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Cleanup function for proper shutdown
async function cleanup() {
  logger.info(`Shutting down ${botConfig.name}...`);
  
  // Send deactivation messages to all channels with activated personalities
  try {
    await sendDeactivationMessages();
  } catch (error) {
    logger.error('Error sending deactivation messages:', error);
  }
  
  // Save all conversation data
  try {
    logger.info('Saving conversation data...');
    await coreConversation.saveAllData();
  } catch (error) {
    logger.error('Error saving conversation data:', error);
  }
  
  // Clear all webhook caches
  try {
    clearAllWebhookCaches();
  } catch (error) {
    logger.error('Error clearing webhook caches:', error);
  }
  
  // Stop pluralkit reply tracker cleanup
  try {
    const pluralkitReplyTracker = require('./src/utils/pluralkitReplyTracker');
    pluralkitReplyTracker.stopCleanup();
    logger.info('Pluralkit reply tracker cleanup stopped');
  } catch (error) {
    logger.error('Error stopping pluralkit reply tracker:', error);
  }
  
  // Destroy client if it exists
  if (client) {
    try {
      logger.info('Destroying Discord client...');
      await client.destroy();
    } catch (error) {
      logger.error('Error destroying Discord client:', error);
    }
  }
  
  // Close HTTP server if it exists
  if (httpServer) {
    try {
      logger.info('Closing HTTP server...');
      httpServer.close();
    } catch (error) {
      logger.error('Error closing HTTP server:', error);
    }
  }
  
  logger.info('Shutdown complete.');
  process.exit(0);
}

/**
 * Send deactivation messages to all channels with activated personalities
 * before the bot shuts down
 */
async function sendDeactivationMessages() {
  // Import required modules
  const { getAllActivatedChannels, deactivatePersonality } = require('./src/core/conversation');
  
  // Get all channels with activated personalities
  const activatedChannels = getAllActivatedChannels();
  
  if (!activatedChannels || Object.keys(activatedChannels).length === 0) {
    logger.info('No activated channels to deactivate during shutdown');
    return;
  }
  
  logger.info(`Deactivating personalities in ${Object.keys(activatedChannels).length} channels`);
  
  // Only proceed if client is available
  if (!client || !client.channels) {
    logger.warn('Discord client not available, skipping deactivation messages');
    return;
  }
  
  // Message to send when deactivating
  const shutdownMessage = `**Channel-wide activation disabled due to bot shutdown.** The bot is shutting down. Personalities will no longer be active in this channel until the bot returns and is reactivated.`;
  
  // Process each activated channel
  const promises = [];
  
  for (const [channelId, personalityName] of Object.entries(activatedChannels)) {
    try {
      // Try to get the channel
      const channel = await client.channels.fetch(channelId).catch(() => null);
      
      if (channel && channel.isTextBased()) {
        // Send deactivation message
        logger.info(`Sending shutdown deactivation message to channel ${channelId} for personality ${personalityName}`);
        promises.push(
          channel.send(shutdownMessage)
            .catch(err => logger.error(`Failed to send deactivation message to channel ${channelId}:`, err))
        );
        
        // Deactivate the personality in this channel
        deactivatePersonality(channelId);
      }
    } catch (error) {
      logger.error(`Error processing deactivation for channel ${channelId}:`, error);
    }
  }
  
  // Wait for all messages to be sent (with a timeout)
  if (promises.length > 0) {
    try {
      // Use Promise.allSettled with timeout to avoid hanging if a promise never resolves
      const timer = globalThis.setTimeout || setTimeout;
      const timeoutPromise = new Promise(resolve => timer(resolve, 5000));
      await Promise.race([
        Promise.allSettled(promises),
        timeoutPromise
      ]);
      logger.info('Deactivation messages sent (or timeout reached)');
    } catch (error) {
      logger.error('Error waiting for deactivation messages:', error);
    }
  }
}

// Start the application
init();