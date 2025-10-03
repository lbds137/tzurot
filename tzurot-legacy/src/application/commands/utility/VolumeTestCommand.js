/**
 * Volume Test Command - Test persistent volume functionality
 *
 * Tests if Railway persistent volume is working correctly by writing
 * and reading test files. Bot owner only command for deployment verification.
 */

const { Command } = require('../CommandAbstraction');
const logger = require('../../../logger');

/**
 * Creates the executor function for the volumetest command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const {
        fs = require('fs').promises,
        path = require('path'),
        process = globalThis.process,
      } = dependencies;

      // Check if user is bot owner
      const botOwnerId = process.env.BOT_OWNER_ID;
      if (!botOwnerId) {
        await context.respond('Bot owner ID is not configured.');
        return;
      }

      if (context.userId !== botOwnerId) {
        await context.respond('This command is restricted to the bot owner.');
        return;
      }

      // Use the same DATA_DIR as dataStorage.js
      const testDir = process.env.RAILWAY_ENVIRONMENT
        ? '/app/data'
        : path.join(process.cwd(), 'data');
      const testFile = path.join(testDir, 'volume_test.txt');
      const timestamp = new Date().toISOString();

      // Ensure directory exists
      await fs.mkdir(testDir, { recursive: true });

      // Write test file
      await fs.writeFile(testFile, `Volume test at ${timestamp}\n`, { flag: 'a' });

      // Read test file
      const content = await fs.readFile(testFile, 'utf8');
      const lines = content.trim().split('\n');

      // Get volume info
      const stats = await fs.stat(testDir);
      const files = await fs.readdir(testDir);

      // Create response
      if (context.respondWithEmbed) {
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
              value:
                files.length > 0
                  ? files.slice(0, 10).join(', ') + (files.length > 10 ? '...' : '')
                  : 'None',
              inline: false,
            },
            {
              name: 'Debug: Your ID',
              value: context.userId,
              inline: true,
            },
            {
              name: 'Debug: Bot Owner ID',
              value: botOwnerId || 'Not set',
              inline: true,
            },
          ],
          timestamp: new Date().toISOString(),
        };

        await context.respondWithEmbed(embed);
      } else {
        // Text fallback
        const status = [
          '**📁 Persistent Volume Test**',
          `Environment: ${process.env.RAILWAY_ENVIRONMENT ? `Railway (${process.env.RAILWAY_ENVIRONMENT})` : 'Local'}`,
          `NODE_ENV: ${process.env.NODE_ENV || 'Not set'}`,
          `Data Directory: \`${path.resolve(testDir)}\``,
          `Directory Status: ${stats.isDirectory() ? '✅ Exists' : '❌ Not Found'}`,
          `Files Found: ${files.length}`,
          `Test Writes: ${lines.length}`,
          `Persistence: ${
            lines.length > 1
              ? `✅ Working! Found ${lines.length} entries`
              : '⚠️ First run - redeploy to verify'
          }`,
          `Files: ${files.length > 0 ? files.slice(0, 5).join(', ') : 'None'}`,
        ];
        await context.respond(status.join('\n'));
      }
    } catch (error) {
      logger.error('[VolumeTestCommand] Execution failed:', error);
      await context.respond(`❌ Volume test failed: ${error.message}`);
    }
  };
}

/**
 * Factory function to create the volumetest command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The volumetest command instance
 */
function createVolumeTestCommand(dependencies = {}) {
  const command = new Command({
    name: 'volumetest',
    description: 'Test if persistent volume is working (bot owner only)',
    category: 'Utility',
    aliases: [],
    permissions: ['OWNER'], // Special permission for bot owner
    options: [], // No options needed
    execute: createExecutor(dependencies),
  });

  // Add ownerOnly property for backward compatibility
  command.ownerOnly = true;

  return command;
}

module.exports = {
  createVolumeTestCommand,
};
