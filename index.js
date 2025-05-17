require('dotenv').config();
const { initBot } = require('./src/bot');

// Error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

// Error handling for unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
});

// Initialize and start the bot
initBot().catch(error => {
  console.error('Failed to initialize bot:', error);
  process.exit(1);
});