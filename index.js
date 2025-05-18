// Load environment variables
require('dotenv').config();
const { initStorage } = require('./src/dataStorage');
const { initPersonalityManager } = require('./src/personalityManager');
const { initConversationManager, saveAllData } = require('./src/conversationManager');
const { initBot, client } = require('./src/bot');
const { clearAllWebhookCaches } = require('./src/webhookManager');
const { createHealthServer } = require('./src/healthCheck');
const { initAuth } = require('./src/auth');
const { initAiClient } = require('./src/aiService');
const logger = require('./src/logger');

// Track whether app has been initialized
let isInitialized = false;
// Health check server instance
let healthServer = null;

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
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
    logger.info('Starting Tzurot initialization...');
    
    // Initialize data storage
    await initStorage();
    logger.info('Data storage initialized');
    
    // Initialize basic personality manager (loads existing data)
    await initPersonalityManager();
    logger.info('Personality manager initialized');
    
    // Initialize conversation manager (loads saved conversation data)
    await initConversationManager();
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
    
    isInitialized = true;
    logger.info('Tzurot initialization complete');
  } catch (error) {
    logger.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Cleanup function for proper shutdown
async function cleanup() {
  logger.info('Shutting down Tzurot...');
  
  // Save all conversation data
  try {
    logger.info('Saving conversation data...');
    await saveAllData();
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
  
  logger.info('Shutdown complete.');
  process.exit(0);
}

// Start the application
init();