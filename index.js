// Load environment variables
require('dotenv').config();
const { initStorage } = require('./src/dataStorage');
const { initPersonalityManager } = require('./src/personalityManager');
const { initBot, client } = require('./src/bot');
const { clearAllWebhookCaches } = require('./src/webhookManager');

// Track whether app has been initialized
let isInitialized = false;

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Proper cleanup on exit
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// Initialize the application only once
async function init() {
  if (isInitialized) {
    console.log('Application already initialized, skipping duplicate initialization');
    return;
  }
  
  try {
    console.log('Starting Tzurot initialization...');
    
    // Initialize data storage
    await initStorage();
    console.log('Data storage initialized');
    
    // Initialize personality manager
    await initPersonalityManager();
    console.log('Personality manager initialized');
    
    // Initialize and start the bot
    await initBot();
    console.log('Bot initialized and started');
    
    isInitialized = true;
    console.log('Tzurot initialization complete');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Cleanup function for proper shutdown
async function cleanup() {
  console.log('Shutting down Tzurot...');
  
  // Clear all webhook caches
  clearAllWebhookCaches();
  
  // Destroy client if it exists
  if (client) {
    try {
      console.log('Destroying Discord client...');
      await client.destroy();
    } catch (error) {
      console.error('Error destroying Discord client:', error);
    }
  }
  
  console.log('Shutdown complete.');
  process.exit(0);
}

// Start the application
init();