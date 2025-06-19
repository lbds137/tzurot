/**
 * Backup Command - DDD Implementation
 * Backs up personality data including profile, memories, knowledge, training, and chat history
 */

const { Command, CommandOption } = require('../CommandAbstraction');
const { BackupJob } = require('../../../domain/backup/BackupJob');
const { BackupService } = require('../../../domain/backup/BackupService');
const {
  PersonalityDataRepository,
} = require('../../../infrastructure/backup/PersonalityDataRepository');
const { BackupAPIClient } = require('../../../infrastructure/backup/BackupAPIClient');
const { ZipArchiveService } = require('../../../infrastructure/backup/ZipArchiveService');
const logger = require('../../../logger');
const { USER_CONFIG } = require('../../../constants');
const path = require('path');

/**
 * Session storage for user authentication cookies
 * In production, this should be encrypted and stored securely
 */
const userSessions = new Map();

/**
 * Creates the executor function for the backup command
 * @param {Object} dependencies - Injected dependencies
 * @returns {Function} Executor function
 */
function createExecutor(dependencies = {}) {
  return async function execute(context) {
    try {
      const {
        backupService = null,
        personalityDataRepository = new PersonalityDataRepository(),
        apiClientService = new BackupAPIClient(),
        zipArchiveService = new ZipArchiveService(),
        delayFn = null,
      } = dependencies;

      // Initialize backup service if not provided
      const backupServiceInstance =
        backupService ||
        new BackupService({
          personalityDataRepository,
          apiClientService,
          authenticationService: null, // Not needed for current implementation
          delayFn: delayFn,
        });

      // Check if API URL is configured
      if (!process.env.SERVICE_WEBSITE) {
        const errorEmbed = {
          title: '❌ Configuration Error',
          description: 'Backup API URL not configured. Please set SERVICE_WEBSITE in environment.',
          color: 0xf44336,
          timestamp: new Date().toISOString(),
        };
        await context.respond({ embeds: [errorEmbed] });
        return;
      }

      // Get subcommand and arguments
      const subcommand = context.options.subcommand || context.args[0];

      // Handle --set-cookie subcommand
      if (subcommand === 'set-cookie') {
        return await handleSetCookie(context);
      }

      // Get authentication data
      const authData = await getAuthData(context);
      if (!authData) {
        return; // Error already sent to user
      }

      // Handle different backup operations
      if (!subcommand) {
        return await showHelp(context);
      } else if (subcommand === 'all') {
        return await handleBulkBackup(context, backupServiceInstance, authData, zipArchiveService);
      } else {
        return await handleSingleBackup(
          context,
          subcommand,
          backupServiceInstance,
          authData,
          zipArchiveService
        );
      }
    } catch (error) {
      logger.error('[BackupCommand] Execution failed:', error);
      const errorEmbed = {
        title: '❌ Command Error',
        description: 'An error occurred while executing the backup command.',
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
    }
  };
}

/**
 * Show help information
 * @param {Object} context - Command context
 */
async function showHelp(context) {
  const { botPrefix } = require('../../../../config');

  const helpEmbed = {
    title: '📦 Backup Command Help',
    description: 'Backup personality data from the AI service',
    color: 0x2196f3,
    fields: [
      {
        name: 'Usage',
        value: [
          `\`${botPrefix} backup <personality-name>\` - Backup a single personality`,
          `\`${botPrefix} backup all\` - Backup all owner personalities`,
          `\`${botPrefix} backup set-cookie <cookie>\` - Set browser session cookie`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Data Types Backed Up',
        value: [
          '• Profile configuration',
          '• Memories (incremental sync)',
          '• Knowledge & story data',
          '• Training examples',
          '• User personalization',
          '• Complete chat history',
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Authentication Required',
        value:
          'You must set your session cookie first using the `set-cookie` subcommand. Token authentication does not work for backup APIs.',
        inline: false,
      },
      {
        name: '🔒 Privacy Notice',
        value:
          'Session cookies are stored only in memory and never persisted to disk. They are automatically deleted when the bot restarts.',
        inline: false,
      },
    ],
    footer: {
      text: 'Administrator permissions required',
    },
    timestamp: new Date().toISOString(),
  };

  await context.respond({ embeds: [helpEmbed] });
}

/**
 * Handle setting session cookie
 * @param {Object} context - Command context
 */
async function handleSetCookie(context) {
  const cookieValue = context.options.cookie || context.args.slice(1).join(' ').trim();

  if (!cookieValue) {
    const helpEmbed = {
      title: '❌ Missing Cookie',
      description: 'Please provide your session cookie.',
      color: 0xf44336,
      fields: [
        {
          name: 'How to get your session cookie:',
          value: [
            '1. Open the service website in your browser and log in',
            '2. Open Developer Tools (F12)',
            '3. Go to Application/Storage → Cookies',
            '4. Find the `appSession` cookie',
            '5. Copy its value (the long string)',
            '6. Use this command with the cookie value',
          ].join('\n'),
          inline: false,
        },
      ],
      footer: {
        text: '⚠️ Security Notice: Only use this in DMs for security!',
      },
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [helpEmbed] });
    return;
  }

  // For security, only accept cookies in DMs
  if (!context.isDM()) {
    const errorEmbed = {
      title: '❌ Security Restriction',
      description: 'For security, please set your session cookie via DM, not in a public channel.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
    return;
  }

  // Store the session cookie
  userSessions.set(context.userId, {
    cookie: `appSession=${cookieValue}`,
    setAt: Date.now(),
  });

  const successEmbed = {
    title: '✅ Cookie Saved',
    description: 'Session cookie saved! You can now use the backup command.',
    color: 0x4caf50,
    fields: [
      {
        name: '🔒 Privacy & Security',
        value: [
          '• Your session cookie is stored **only in memory**',
          '• It is **never saved to disk** or any persistent storage',
          '• The cookie is **automatically deleted** when the bot restarts',
          '• Session cookies expire and may need periodic updates',
        ].join('\n'),
        inline: false,
      },
    ],
    footer: {
      text: '⚠️ Note: Your session data is temporary and not persisted.',
    },
    timestamp: new Date().toISOString(),
  };
  await context.respond({ embeds: [successEmbed] });
}

/**
 * Get authentication data for user
 * @param {Object} context - Command context
 * @returns {Object|null} Authentication data or null if not available
 */
async function getAuthData(context) {
  const userSession = userSessions.get(context.userId);
  if (!userSession) {
    const { botPrefix } = require('../../../../config');

    const errorEmbed = {
      title: '❌ Authentication Required',
      description: 'Session cookie required for backup operations.',
      color: 0xf44336,
      fields: [
        {
          name: 'How to set your session cookie:',
          value: [
            '1. Open the service website in your browser and log in',
            '2. Open Developer Tools (F12)',
            '3. Go to Application/Storage → Cookies',
            '4. Find the `appSession` cookie',
            '5. Copy its value (the long string)',
            `6. Use: \`${botPrefix} backup set-cookie <cookie-value>\``,
          ].join('\n'),
          inline: false,
        },
      ],
      footer: {
        text: '⚠️ Note: Token authentication does not work for these backup APIs.',
      },
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
    return null;
  }

  return { cookie: userSession.cookie };
}

/**
 * Handle bulk backup of all owner personalities
 * @param {Object} context - Command context
 * @param {BackupService} backupService - Backup service instance
 * @param {Object} authData - Authentication data
 * @param {ZipArchiveService} zipArchiveService - ZIP archive service
 */
async function handleBulkBackup(context, backupService, authData, zipArchiveService) {
  const ownerPersonalities = USER_CONFIG.OWNER_PERSONALITIES_LIST.split(',')
    .map(p => p.trim())
    .filter(p => p);

  if (ownerPersonalities.length === 0) {
    const errorEmbed = {
      title: '❌ No Personalities',
      description: 'No owner personalities configured.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respond({ embeds: [errorEmbed] });
    return;
  }

  // Create progress callback
  const progressCallback = async message => {
    await context.respond(message);
  };

  try {
    await backupService.executeBulkBackup(
      ownerPersonalities,
      context.userId,
      authData,
      progressCallback
    );

    // Create bulk ZIP archive after successful backups
    const backupDir = path.join(__dirname, '..', '..', '..', '..', 'data', 'personalities');
    const personalityPaths = ownerPersonalities.map(name => ({
      name: name.toLowerCase(),
      path: path.join(backupDir, name.toLowerCase()),
    }));

    try {
      const zipBuffer = await zipArchiveService.createBulkArchive(personalityPaths);

      // Check if ZIP is within Discord limits
      if (!zipArchiveService.isWithinDiscordLimits(zipBuffer.length)) {
        const errorEmbed = {
          title: '⚠️ File Too Large',
          description: `The bulk backup ZIP file is too large to send via Discord (${zipArchiveService.formatBytes(zipBuffer.length)}). Maximum file size is 8MB.`,
          color: 0xff9800,
          fields: [
            {
              name: 'Alternative',
              value:
                'The backup data has been saved locally on the bot server. Contact the bot administrator for manual retrieval.',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        await context.respond({ embeds: [errorEmbed] });
        return;
      }

      // Send ZIP file as attachment
      const successEmbed = {
        title: '✅ Bulk Backup Complete',
        description: `Successfully created backup archive for ${ownerPersonalities.length} personalities.`,
        color: 0x4caf50,
        fields: [
          {
            name: '👥 Personalities Included',
            value: ownerPersonalities.map(p => `• ${p}`).join('\n'),
            inline: false,
          },
          {
            name: '💾 Archive Size',
            value: zipArchiveService.formatBytes(zipBuffer.length),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      await context.respond({
        embeds: [successEmbed],
        files: [
          {
            attachment: zipBuffer,
            name: `tzurot_bulk_backup_${new Date().toISOString().split('T')[0]}.zip`,
          },
        ],
      });
    } catch (zipError) {
      logger.error(`[BackupCommand] Bulk ZIP creation error: ${zipError.message}`);
      const errorEmbed = {
        title: '⚠️ Archive Creation Failed',
        description:
          'The bulk backup was successful but failed to create ZIP archive. Data is saved locally.',
        color: 0xff9800,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
    }
  } catch (error) {
    logger.error(`[BackupCommand] Bulk backup error: ${error.message}`);
  }
}

/**
 * Handle single personality backup
 * @param {Object} context - Command context
 * @param {string} personalityName - Name of personality to backup
 * @param {BackupService} backupService - Backup service instance
 * @param {Object} authData - Authentication data
 * @param {ZipArchiveService} zipArchiveService - ZIP archive service
 */
async function handleSingleBackup(
  context,
  personalityName,
  backupService,
  authData,
  zipArchiveService
) {
  const job = new BackupJob({
    personalityName: personalityName.toLowerCase(),
    userId: context.userId,
    isBulk: false,
  });

  // Create progress callback
  const progressCallback = async message => {
    await context.respond(message);
  };

  try {
    await backupService.executeBackup(job, authData, progressCallback);

    // Create ZIP archive after successful backup
    const backupDir = path.join(__dirname, '..', '..', '..', '..', 'data', 'personalities');
    const personalityPath = path.join(backupDir, personalityName.toLowerCase());

    try {
      const zipBuffer = await zipArchiveService.createPersonalityArchive(
        personalityName.toLowerCase(),
        personalityPath
      );

      // Check if ZIP is within Discord limits
      if (!zipArchiveService.isWithinDiscordLimits(zipBuffer.length)) {
        const errorEmbed = {
          title: '⚠️ File Too Large',
          description: `The backup ZIP file is too large to send via Discord (${zipArchiveService.formatBytes(zipBuffer.length)}). Maximum file size is 8MB.`,
          color: 0xff9800,
          fields: [
            {
              name: 'Alternative',
              value:
                'The backup data has been saved locally on the bot server. Contact the bot administrator for manual retrieval.',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        await context.respond({ embeds: [errorEmbed] });
        return;
      }

      // Send ZIP file as attachment
      const successEmbed = {
        title: '✅ Backup Complete',
        description: `Successfully created backup archive for **${personalityName}**.`,
        color: 0x4caf50,
        fields: [
          {
            name: '📦 Archive Contents',
            value: [
              '• Profile configuration',
              '• Memories & chat history',
              '• Knowledge & training data',
              '• User personalization',
              '• Backup metadata',
            ].join('\n'),
            inline: false,
          },
          {
            name: '💾 Archive Size',
            value: zipArchiveService.formatBytes(zipBuffer.length),
            inline: true,
          },
        ],
        timestamp: new Date().toISOString(),
      };

      await context.respond({
        embeds: [successEmbed],
        files: [
          {
            attachment: zipBuffer,
            name: `${personalityName.toLowerCase()}_backup_${new Date().toISOString().split('T')[0]}.zip`,
          },
        ],
      });
    } catch (zipError) {
      logger.error(`[BackupCommand] ZIP creation error: ${zipError.message}`);
      const errorEmbed = {
        title: '⚠️ Archive Creation Failed',
        description:
          'The backup was successful but failed to create ZIP archive. Data is saved locally.',
        color: 0xff9800,
        timestamp: new Date().toISOString(),
      };
      await context.respond({ embeds: [errorEmbed] });
    }
  } catch (error) {
    logger.error(`[BackupCommand] Single backup error: ${error.message}`);
  }
}

/**
 * Factory function to create the backup command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The backup command instance
 */
function createBackupCommand(dependencies = {}) {
  const command = new Command({
    name: 'backup',
    description: 'Backup personality data from the AI service (Requires Administrator permission)',
    category: 'Utility',
    aliases: [],
    permissions: ['ADMIN'],
    options: [
      new CommandOption({
        name: 'subcommand',
        description: 'Backup operation to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'Backup single personality', value: 'personality' },
          { name: 'Backup all owner personalities', value: 'all' },
          { name: 'Set session cookie', value: 'set-cookie' },
        ],
      }),
      new CommandOption({
        name: 'personality',
        description: 'Name of personality to backup',
        type: 'string',
        required: false,
      }),
      new CommandOption({
        name: 'cookie',
        description: 'Session cookie value (for set-cookie operation)',
        type: 'string',
        required: false,
      }),
    ],
    execute: createExecutor(dependencies),
  });

  // Add adminOnly property for backward compatibility
  command.adminOnly = true;

  return command;
}

module.exports = {
  createBackupCommand,
  userSessions, // Export for testing
  // Export internal functions for testing
  handleSetCookie,
  getAuthData,
  handleBulkBackup,
  handleSingleBackup,
  showHelp,
};
