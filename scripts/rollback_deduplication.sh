#!/bin/bash
# Rollback script for message deduplication refactoring
# 
# This script quickly reverts changes made to the message deduplication system
# in case issues are discovered during testing or in production.
#
# Usage: ./scripts/rollback_deduplication.sh

# Set script to exit on error
set -e

# Display banner
echo "===================================================="
echo "  ROLLBACK MESSAGE DEDUPLICATION REFACTORING"
echo "===================================================="
echo

# Check if backup file exists
if [ ! -f "src/bot.js.original" ]; then
  echo "❌ ERROR: Backup file src/bot.js.original not found"
  echo "Cannot proceed with rollback"
  exit 1
fi

# Restore original bot.js
echo "🔄 Restoring original bot.js..."
cp src/bot.js.original src/bot.js
echo "✅ Original bot.js restored"

# Remove MessageTracker if it exists
if [ -f "src/messageTracker.js" ]; then
  echo "🔄 Removing messageTracker.js..."
  rm src/messageTracker.js
  echo "✅ messageTracker.js removed"
fi

# Check if we need to restart the bot
read -p "Do you want to restart the bot now? (y/N): " restart
if [[ $restart =~ ^[Yy]$ ]]; then
  echo "🔄 Restarting bot..."
  # Use npm command if available, otherwise use node directly
  if [ -f "package.json" ]; then
    npm run dev
  else
    node index.js
  fi
fi

echo
echo "===================================================="
echo "  ROLLBACK COMPLETE"
echo "===================================================="
echo
echo "The message deduplication system has been rolled back to its original implementation."
echo "If you are seeing this message, the rollback was successful."
echo
echo "Please document the issues that required rollback for future reference."
echo "===================================================="