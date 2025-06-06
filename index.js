// Load environment variables
require('dotenv').config();
const { initStorage } = require('./src/dataStorage');
const corePersonality = require('./src/core/personality');
const coreConversation = require('./src/core/conversation');
const { initBot, client } = require('./src/bot');
const { clearAllWebhookCaches } = require('./src/webhookManager');
const { createHealthServer } = require('./src/healthCheck');
const { initAuth } = require('./src/auth');
const { initAiClient } = require('./src/aiService');
const logger = require('./src/logger');
const { botConfig } = require('./config');
const { releaseNotificationManager } = require('./src/core/notifications');

// Track whether app has been initialized
let isInitialized = false;
// Health check server instance
let healthServer = null;
// Webhook server instance
let webhookServer = null;

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
    
    // Initialize data storage
    await initStorage();
    logger.info('Data storage initialized');
    
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
    
    // Initialize basic personality manager (loads existing data)
    await corePersonality.initialize();
    logger.info('Personality manager initialized');
    
    // Initialize conversation manager (loads saved conversation data)
    await coreConversation.initConversationManager();
    logger.info('Conversation manager initialized');
    
    // Initialize auth system (loads saved tokens)
    await initAuth();
    logger.info('Auth system initialized');
    
    // Initialize the AI client after auth is loaded
    initAiClient();
    logger.info('AI client initialized');
    
    // Initialize and start the bot - this is critical for user experience
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
    
    // Start health check server
    try {
      // Get Discord client from global scope to avoid circular dependencies
      const botClient = global.tzurotClient || client;
      if (!botClient) {
        throw new Error('Discord client not properly initialized');
      }
      
      // Start health check server with the initialized client
      const healthPort = process.env.HEALTH_PORT || 3000;
      healthServer = createHealthServer(botClient, healthPort);
      logger.info(`Health check server started on port ${healthPort}`);
    } catch (healthError) {
      logger.error('Failed to start health check server:', healthError);
      // Continue initialization despite health check failure
      // The bot can still function without it
    }
    
    // Start webhook server for external integrations
    try {
      const { createWebhookServer } = require('./src/webhookServer');
      const webhookPort = process.env.WEBHOOK_PORT || 3001;
      webhookServer = createWebhookServer(webhookPort);
      logger.info(`Webhook server started on port ${webhookPort}`);
    } catch (webhookError) {
      logger.error('Failed to start webhook server:', webhookError);
      // Continue without webhook server - not critical for basic operation
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
  
  // Destroy client if it exists
  if (client) {
    try {
      logger.info('Destroying Discord client...');
      await client.destroy();
    } catch (error) {
      logger.error('Error destroying Discord client:', error);
    }
  }
  
  // Close health check server if it exists
  if (healthServer) {
    try {
      logger.info('Closing health check server...');
      healthServer.close();
    } catch (error) {
      logger.error('Error closing health check server:', error);
    }
  }
  
  // Close webhook server if it exists
  if (webhookServer) {
    try {
      logger.info('Closing webhook server...');
      webhookServer.close();
    } catch (error) {
      logger.error('Error closing webhook server:', error);
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
      const timeoutPromise = new Promise(resolve => setTimeout(resolve, 5000));
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