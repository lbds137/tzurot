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
const { resolvePersonality } = require('../../../utils/aliasResolver');

/**
 * Resolve a personality name/alias to the actual full name
 * @param {string} input - User input (could be full name, alias, or display name)
 * @returns {Promise<{fullName: string, displayName: string} | null>} Resolved personality info or null if not found
 */
async function resolvePersonalityName(input) {
  logger.debug(`[BackupCommand] Resolving personality name for input: "${input}"`);

  try {
    // Use DDD system to resolve personality by name or alias
    const personality = await resolvePersonality(input);
    if (personality) {
      const fullName = personality.profile?.name || personality.name;
      const displayName = personality.profile?.displayName || fullName;

      logger.debug(`[BackupCommand] Found personality: ${fullName}`);
      return {
        fullName: fullName,
        displayName: displayName,
      };
    }

    logger.debug(`[BackupCommand] No personality found for input: "${input}"`);
    return null;
  } catch (error) {
    logger.error(`[BackupCommand] Error resolving personality name: ${error.message}`);
    return null;
  }
}

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
        await context.respondWithEmbed(errorEmbed);
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
      } else if (subcommand === 'self' || subcommand === 'recent') {
        return await handleCategoryBackup(
          context,
          subcommand,
          backupServiceInstance,
          authData,
          zipArchiveService,
          apiClientService
        );
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
      await context.respondWithEmbed(errorEmbed);
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
          `\`${botPrefix} backup self\` - Backup your own personalities`,
          `\`${botPrefix} backup recent\` - Backup personalities you recently talked to`,
          `\`${botPrefix} backup set-cookie <cookie>\` - Set browser session cookie`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Data Types Backed Up',
        value: [
          '**For personality owners:**',
          '• Profile configuration (private API)',
          '• Memories (incremental sync)',
          '• Knowledge & story data',
          '• Training examples',
          '• User personalization',
          '• Complete chat history',
          '',
          '**For non-owners:**',
          '• Limited profile data (public API only)',
          '• Memories (incremental sync)',
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
      text: 'Available to all users',
    },
    timestamp: new Date().toISOString(),
  };

  await context.respondWithEmbed(helpEmbed);
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
    await context.respondWithEmbed(helpEmbed);
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
    await context.respondWithEmbed(errorEmbed);
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
  await context.respondWithEmbed(successEmbed);
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
    await context.respondWithEmbed(errorEmbed);
    return null;
  }

  return { cookie: userSession.cookie };
}

/**
 * Handle category-based backup (self or recent)
 * @param {Object} context - Command context
 * @param {string} category - Category type ('self' or 'recent')
 * @param {BackupService} backupService - Backup service instance
 * @param {Object} authData - Authentication data
 * @param {ZipArchiveService} zipArchiveService - ZIP archive service
 * @param {BackupAPIClient} apiClientService - API client service
 */
async function handleCategoryBackup(
  context,
  category,
  backupService,
  authData,
  zipArchiveService,
  apiClientService
) {
  try {
    // Fetch personalities for the category
    const personalities = await apiClientService.fetchPersonalitiesByCategory(category, authData);

    if (!personalities || personalities.length === 0) {
      const errorEmbed = {
        title: '❌ No Personalities Found',
        description: `No ${category} personalities found for your account.`,
        color: 0xf44336,
        timestamp: new Date().toISOString(),
      };
      await context.respondWithEmbed(errorEmbed);
      return;
    }

    // Extract personality usernames from the API response
    const personalityNames = personalities.map(p => p.username);
    logger.debug(
      `[BackupCommand] Extracted ${personalityNames.length} personality usernames: ${personalityNames.join(', ')}`
    );

    // Create progress callback
    const progressCallback = async message => {
      await context.respond(message);
    };

    // Start backup message
    const startEmbed = {
      title: `📦 Starting ${category === 'self' ? 'Self-Owned' : 'Recent'} Backup`,
      description: `Beginning backup of ${personalityNames.length} ${category} personalities...`,
      color: 0x2196f3,
      fields: [
        {
          name: '📤 Delivery',
          value: `Individual ZIP files will be sent as each personality completes`,
          inline: false,
        },
      ],
      timestamp: new Date().toISOString(),
    };
    await context.respondWithEmbed(startEmbed);

    // Track results
    const successfulBackups = [];
    const failedBackups = [];

    // Process each personality one by one
    for (const personalityName of personalityNames) {
      const job = new BackupJob({
        personalityName: personalityName.toLowerCase(),
        userId: context.userId,
        isBulk: true,
        persistToFilesystem: false, // Don't persist category backups to filesystem
      });

      try {
        // Run the backup
        await backupService.executeBackup(job, authData, progressCallback);

        // If successful, send the ZIP immediately
        if (job.status === 'completed') {
          try {
            logger.info(`[BackupCommand] Job completed for ${personalityName}, sending ZIP file`);
            await _sendIndividualBackupZip(context, job, zipArchiveService);
            successfulBackups.push(personalityName);
          } catch (zipError) {
            logger.error(
              `[BackupCommand] ZIP creation error for ${personalityName}: ${zipError.message}`
            );
            const errorEmbed = {
              title: '⚠️ ZIP Creation Failed',
              description: `Failed to create ZIP for **${personalityName}**. Data was backed up successfully but ZIP delivery failed.`,
              color: 0xff9800,
              timestamp: new Date().toISOString(),
            };
            await context.respondWithEmbed(errorEmbed);
            // Still count as successful since data was backed up
            successfulBackups.push(personalityName);
          }
        } else {
          failedBackups.push(personalityName);
        }

        // Delay between personalities to avoid rate limits
        if (personalityName !== personalityNames[personalityNames.length - 1]) {
          await backupService.delayFn(2000);
        }
      } catch (error) {
        logger.error(`[BackupCommand] Error backing up ${personalityName}: ${error.message}`);
        failedBackups.push(personalityName);

        // Check for authentication errors that should stop the bulk operation
        if (
          error.status === 401 ||
          error.message.includes('401') ||
          error.message.includes('Authentication') ||
          error.message.includes('Session cookie')
        ) {
          const authErrorEmbed = {
            title: '❌ Authentication Failed',
            description: `Your session cookie may have expired.\nSuccessfully backed up ${successfulBackups.length} of ${personalityNames.length} personalities before failure.`,
            color: 0xf44336,
            fields: [
              {
                name: 'Next Steps',
                value: 'Please update your session cookie with the backup set-cookie command.',
                inline: false,
              },
            ],
            timestamp: new Date().toISOString(),
          };
          await context.respondWithEmbed(authErrorEmbed);
          break; // Stop processing on auth errors
        }
      }
    }

    // Send final summary
    const summaryEmbed = {
      title: `📦 ${category === 'self' ? 'Self-Owned' : 'Recent'} Backup Complete`,
      description: `Successfully backed up ${successfulBackups.length} of ${personalityNames.length} personalities.`,
      color: successfulBackups.length > 0 ? 0x4caf50 : 0xf44336,
      fields: [],
      timestamp: new Date().toISOString(),
    };

    if (successfulBackups.length > 0) {
      summaryEmbed.fields.push({
        name: '✅ Successful Backups',
        value: _formatPersonalityList(successfulBackups),
        inline: true,
      });
    }

    if (failedBackups.length > 0) {
      summaryEmbed.fields.push({
        name: '❌ Failed Backups',
        value: _formatPersonalityList(failedBackups),
        inline: true,
      });
    }

    await context.respondWithEmbed(summaryEmbed);
  } catch (error) {
    logger.error(`[BackupCommand] Category backup error: ${error.message}`);
    const errorEmbed = {
      title: '❌ Backup Failed',
      description: `Failed to fetch ${category} personalities: ${error.message}`,
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respondWithEmbed(errorEmbed);
  }
}

/**
 * Handle bulk backup of all owner personalities
 * @param {Object} context - Command context
 * @param {BackupService} backupService - Backup service instance
 * @param {Object} authData - Authentication data
 * @param {ZipArchiveService} zipArchiveService - ZIP archive service
 */
async function handleBulkBackup(context, backupService, authData, zipArchiveService) {
  // Check if user is bot owner - bulk backup is owner-only
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  if (!isBotOwner) {
    const errorEmbed = {
      title: '❌ Access Denied',
      description:
        'Bulk backup is only available to the bot owner. Use single personality backup instead.',
      color: 0xf44336,
      timestamp: new Date().toISOString(),
    };
    await context.respondWithEmbed(errorEmbed);
    return;
  }

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
    await context.respondWithEmbed(errorEmbed);
    return;
  }

  // Create progress callback
  const progressCallback = async message => {
    await context.respond(message);
  };

  // Start bulk backup message
  const startEmbed = {
    title: '📦 Starting Bulk Backup',
    description: `Beginning backup of ${ownerPersonalities.length} personalities...`,
    color: 0x2196f3,
    fields: [
      {
        name: '📤 Delivery',
        value: `Individual ZIP files will be sent as each personality completes`,
        inline: false,
      },
    ],
    timestamp: new Date().toISOString(),
  };
  await context.respondWithEmbed(startEmbed);

  // Track results
  const successfulBackups = [];
  const failedBackups = [];

  // Process each personality one by one, just like individual backups
  for (const personalityName of ownerPersonalities) {
    const job = new BackupJob({
      personalityName: personalityName.toLowerCase(),
      userId: context.userId,
      isBulk: true,
      persistToFilesystem: isBotOwner,
    });

    try {
      // Run the backup
      await backupService.executeBackup(job, authData, progressCallback);

      // If successful, send the ZIP immediately
      if (job.status === 'completed') {
        try {
          logger.info(`[BackupCommand] Job completed for ${personalityName}, sending ZIP file`);
          await _sendIndividualBackupZip(context, job, zipArchiveService);
          successfulBackups.push(personalityName);
        } catch (zipError) {
          logger.error(
            `[BackupCommand] ZIP creation error for ${personalityName}: ${zipError.message}`
          );
          const errorEmbed = {
            title: '⚠️ ZIP Creation Failed',
            description: `Failed to create ZIP for **${personalityName}**. Data was backed up successfully but ZIP delivery failed.`,
            color: 0xff9800,
            timestamp: new Date().toISOString(),
          };
          await context.respondWithEmbed(errorEmbed);
          // Still count as successful since data was backed up
          successfulBackups.push(personalityName);
        }
      } else {
        failedBackups.push(personalityName);
      }

      // Delay between personalities to avoid rate limits
      if (personalityName !== ownerPersonalities[ownerPersonalities.length - 1]) {
        await backupService.delayFn(2000);
      }
    } catch (error) {
      logger.error(`[BackupCommand] Error backing up ${personalityName}: ${error.message}`);
      failedBackups.push(personalityName);

      // Check for authentication errors that should stop the bulk operation
      if (
        error.status === 401 ||
        error.message.includes('401') ||
        error.message.includes('Authentication') ||
        error.message.includes('Session cookie')
      ) {
        const authErrorEmbed = {
          title: '❌ Authentication Failed',
          description: `Your session cookie may have expired.\nSuccessfully backed up ${successfulBackups.length} of ${ownerPersonalities.length} personalities before failure.`,
          color: 0xf44336,
          fields: [
            {
              name: 'Next Steps',
              value: 'Please update your session cookie with the backup set-cookie command.',
              inline: false,
            },
          ],
          timestamp: new Date().toISOString(),
        };
        await context.respondWithEmbed(authErrorEmbed);
        break; // Stop processing on auth errors
      }
    }
  }

  // Send final summary
  const summaryEmbed = {
    title: '📦 Bulk Backup Complete',
    description: `Successfully backed up ${successfulBackups.length} of ${ownerPersonalities.length} personalities.`,
    color: successfulBackups.length > 0 ? 0x4caf50 : 0xf44336,
    fields: [],
    timestamp: new Date().toISOString(),
  };

  if (successfulBackups.length > 0) {
    summaryEmbed.fields.push({
      name: '✅ Successful Backups',
      value: _formatPersonalityList(successfulBackups),
      inline: true,
    });
  }

  if (failedBackups.length > 0) {
    summaryEmbed.fields.push({
      name: '❌ Failed Backups',
      value: _formatPersonalityList(failedBackups),
      inline: true,
    });
  }

  await context.respondWithEmbed(summaryEmbed);
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
  // Check if user is bot owner
  const isBotOwner = context.userId === process.env.BOT_OWNER_ID;

  // Resolve personality name to full name before creating backup job
  const resolvedName = await resolvePersonalityName(personalityName);
  const actualPersonalityName = resolvedName ? resolvedName.fullName : personalityName;

  if (!resolvedName) {
    logger.warn(
      `[BackupCommand] Could not resolve personality name: ${personalityName}, using as-is`
    );
  } else {
    logger.debug(`[BackupCommand] Resolved ${personalityName} to ${actualPersonalityName}`);
  }

  const job = new BackupJob({
    personalityName: actualPersonalityName.toLowerCase(),
    userId: context.userId,
    isBulk: false,
    persistToFilesystem: isBotOwner, // Only persist for bot owner
  });

  // Create progress callback
  const progressCallback = async message => {
    await context.respond(message);
  };

  try {
    await backupService.executeBackup(job, authData, progressCallback);

    // Create and send ZIP archive using shared logic
    try {
      await _sendIndividualBackupZip(context, job, zipArchiveService);
    } catch (zipError) {
      logger.error(`[BackupCommand] ZIP creation error: ${zipError.message}`);
      const errorEmbed = {
        title: '⚠️ Archive Creation Failed',
        description:
          'The backup was successful but failed to create ZIP archive. Data is saved locally.',
        color: 0xff9800,
        timestamp: new Date().toISOString(),
      };
      await context.respondWithEmbed(errorEmbed);
    }
  } catch (error) {
    logger.error(`[BackupCommand] Single backup error: ${error.message}`);
  }
}

/**
 * Helper method to send individual backup ZIP file
 * @private
 */
async function _sendIndividualBackupZip(context, job, zipArchiveService) {
  // Create ZIP from memory for the individual personality
  const zipBuffer = await zipArchiveService.createPersonalityArchiveFromMemory(
    job.personalityName,
    job.personalityData,
    job.results
  );

  // Check if ZIP is within Discord limits
  if (!zipArchiveService.isWithinDiscordLimits(zipBuffer.length)) {
    const errorEmbed = {
      title: '⚠️ File Too Large',
      description: `The backup ZIP for **${job.personalityName}** is too large to send via Discord (${zipArchiveService.formatBytes(zipBuffer.length)}). Maximum file size is 8MB.`,
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
    await context.respondWithEmbed(errorEmbed);
    return;
  }

  // Build dynamic archive contents based on what was actually backed up
  const archiveContents = [];

  if (job.results.profile && job.results.profile.updated) {
    archiveContents.push('• Profile configuration');
  } else if (job.results.profile && job.results.profile.skipped) {
    archiveContents.push('• Limited profile data');
  }

  // Only show memories if there are actually memories
  if (job.results.memories && job.results.memories.totalCount > 0) {
    const memCount = job.results.memories.totalCount;
    archiveContents.push(`• Memories (${memCount} total)`);
  }

  // Only show knowledge if there are actually knowledge entries
  if (
    job.results.knowledge &&
    job.results.knowledge.updated &&
    job.results.knowledge.entryCount > 0
  ) {
    const knowledgeCount = job.results.knowledge.entryCount;
    archiveContents.push(`• Knowledge data (${knowledgeCount} entries)`);
  }

  // Only show training if there are actually training entries
  if (job.results.training && job.results.training.updated && job.results.training.entryCount > 0) {
    const trainingCount = job.results.training.entryCount;
    archiveContents.push(`• Training data (${trainingCount} entries)`);
  }

  // Only show user personalization if it was updated
  if (job.results.userPersonalization && job.results.userPersonalization.updated) {
    archiveContents.push('• User personalization');
  }

  // Only show chat history if there are actually messages
  if (job.results.chatHistory && job.results.chatHistory.totalMessages > 0) {
    const msgCount = job.results.chatHistory.totalMessages;
    archiveContents.push(`• Chat history (${msgCount} messages)`);
  }

  archiveContents.push('• Backup metadata');

  const successEmbed = {
    title: '✅ Backup Complete',
    description: `Successfully created backup archive for **${job.personalityName}**.`,
    color: 0x4caf50,
    fields: [
      {
        name: '📦 Archive Contents',
        value: archiveContents.join('\n'),
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

  // Generate filename with user display prefix if available
  const dateStr = new Date().toISOString().split('T')[0];
  const baseFilename = `${job.personalityName.toLowerCase()}_backup_${dateStr}.zip`;
  const filename = job.userDisplayPrefix
    ? `${job.userDisplayPrefix}_${baseFilename}`
    : baseFilename;

  await context.respond({
    embeds: [successEmbed],
    files: [
      {
        attachment: zipBuffer,
        name: filename,
      },
    ],
  });
}

/**
 * Factory function to create the backup command
 * @param {Object} dependencies - Optional dependencies to inject
 * @returns {Command} The backup command instance
 */
function createBackupCommand(dependencies = {}) {
  const command = new Command({
    name: 'backup',
    description: 'Backup personality data from the AI service',
    category: 'Utility',
    aliases: [],
    permissions: ['USER'],
    options: [
      new CommandOption({
        name: 'subcommand',
        description: 'Backup operation to perform',
        type: 'string',
        required: false,
        choices: [
          { name: 'Backup single personality', value: 'personality' },
          { name: 'Backup all owner personalities', value: 'all' },
          { name: 'Backup your own personalities', value: 'self' },
          { name: 'Backup recent personalities', value: 'recent' },
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

  // Available to all users (no special permissions needed)

  return command;
}

/**
 * Format personality list with truncation for Discord embed limits
 * @private
 * @param {Array<string>} personalities - List of personality names
 * @returns {string} Formatted list that fits within Discord's 1024 char limit
 */
function _formatPersonalityList(personalities) {
  const MAX_LENGTH = 1000; // Leave some buffer for safety
  let result = '';
  let truncated = 0;

  for (const personality of personalities) {
    const line = `• ${personality}\n`;
    if (result.length + line.length > MAX_LENGTH) {
      truncated = personalities.length - personalities.indexOf(personality);
      break;
    }
    result += line;
  }

  if (truncated > 0) {
    result += `\n*...and ${truncated} more*`;
  }

  return result.trim() || 'None';
}

module.exports = {
  createBackupCommand,
  userSessions, // Export for testing
  // Export internal functions for testing
  handleSetCookie,
  getAuthData,
  handleBulkBackup,
  handleCategoryBackup,
  handleSingleBackup,
  showHelp,
  _formatPersonalityList, // Export for testing
};
