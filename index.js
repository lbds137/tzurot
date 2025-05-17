// Load environment variables
require('dotenv').config();
const { initStorage } = require('./src/dataStorage');
const { initPersonalityManager } = require('./src/personalityManager');
const { initBot } = require('./src/bot');

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Initialize the application
async function init() {
  try {
    // Initialize data storage
    await initStorage();
    
    // Initialize personality manager
    await initPersonalityManager();
    
    // Initialize and start the bot
    await initBot();
    
    console.log('Tzurot initialization complete');
  } catch (error) {
    console.error('Failed to initialize application:', error);
    process.exit(1);
  }
}

// Start the application
init();