/**
 * Volume Test Command Handler
 *
 * Tests if Railway persistent volume is working correctly
 * by writing and reading a test file.
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../../logger');

module.exports = {
  meta: {
    name: 'volumetest',
    description: 'Test if persistent volume is working (bot owner only)',
    usage: 'volumetest',
  },

  async execute(message, args, config) {
    // Check if user is bot owner
    if (message.author.id !== process.env.BOT_OWNER_ID) {
      await message.reply('This command is restricted to the bot owner.');
      return;
    }

    try {
      // Use the same DATA_DIR as dataStorage.js
      const testDir = process.env.RAILWAY_ENVIRONMENT
        ? '/app/data'
        : path.join(process.cwd(), 'data');
      const testFile = path.join(testDir, 'volume_test.txt');
      const timestamp = new Date().toISOString();

      // Write test file
      await fs.writeFile(testFile, `Volume test at ${timestamp}\n`, { flag: 'a' });

      // Read test file
      const content = await fs.readFile(testFile, 'utf8');
      const lines = content.trim().split('\n');

      // Get volume info
      const stats = await fs.stat(testDir);
      const files = await fs.readdir(testDir);

      // Create response
      const embed = {
        title: '📁 Persistent Volume Test',
        color: 0x00ff00,
        fields: [
          {
            name: 'Environment',
            value: process.env.RAILWAY_ENVIRONMENT
              ? `Railway (${process.env.RAILWAY_ENVIRONMENT})`
              : 'Local',
            inline: true,
          },
          {
            name: 'NODE_ENV',
            value: process.env.NODE_ENV || 'Not set',
            inline: true,
          },
          {
            name: 'Data Directory',
            value: `\`${path.resolve(testDir)}\``,
            inline: false,
          },
          {
            name: 'Directory Status',
            value: stats.isDirectory() ? '✅ Exists' : '❌ Not Found',
            inline: true,
          },
          {
            name: 'Files Found',
            value: files.length.toString(),
            inline: true,
          },
          {
            name: 'Test Writes',
            value: lines.length.toString(),
            inline: true,
          },
          {
            name: 'Persistence Check',
            value:
              lines.length > 1
                ? `✅ Working! Found ${lines.length} entries from previous deployments`
                : '⚠️ First run - redeploy to verify persistence',
            inline: false,
          },
          {
            name: 'Files in Directory',
            value: files.join(', ') || 'None',
            inline: false,
          },
          {
            name: 'Debug: Your ID',
            value: message.author.id,
            inline: true,
          },
          {
            name: 'Debug: Bot Owner ID',
            value: process.env.BOT_OWNER_ID || 'Not set',
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      await message.reply({ embeds: [embed] });
    } catch (error) {
      logger.error('[VolumeTest] Error testing volume:', error);
      await message.reply(`❌ Volume test failed: ${error.message}`);
    }
  },
};
