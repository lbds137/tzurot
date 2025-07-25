/**
 * BackupService Domain Service
 * Orchestrates backup operations for personality data
 */

const { BackupJob, BackupStatus } = require('./BackupJob');
const logger = require('../../logger');

/**
 * Domain service for backup operations
 */
class BackupService {
  /**
   * Create backup service
   * @param {Object} dependencies - Injected dependencies
   * @param {Object} dependencies.personalityDataRepository - Repository for personality data
   * @param {Object} dependencies.apiClientService - Service for API calls
   * @param {Object} dependencies.authenticationService - Service for auth validation
   * @param {Function} [dependencies.delayFn] - Function for delays between operations
   */
  constructor({
    personalityDataRepository,
    apiClientService,
    authenticationService,
    delayFn = null,
  }) {
    this.personalityDataRepository = personalityDataRepository;
    this.apiClientService = apiClientService;
    this.authenticationService = authenticationService;
    this.delayFn = delayFn || this._createDefaultDelayFn();
    this.delayBetweenRequests = 1000; // 1 second between API requests
  }

  /**
   * Execute backup for a single personality
   * @param {BackupJob} job - Backup job to execute
   * @param {Object} authData - Authentication data
   * @param {Function} [progressCallback] - Callback for progress updates
   * @returns {Promise<BackupJob>} Completed job
   */
  async executeBackup(job, authData, progressCallback = null) {
    return this.executeBackupWithCachedUser(job, authData, progressCallback, null);
  }

  /**
   * Execute backup for a single personality with optional cached user data
   * @param {BackupJob} job - Backup job to execute
   * @param {Object} authData - Authentication data
   * @param {Function} [progressCallback] - Callback for progress updates
   * @param {Object} [cachedCurrentUser] - Pre-fetched current user data (for bulk operations)
   * @returns {Promise<BackupJob>} Completed job
   */
  async executeBackupWithCachedUser(
    job,
    authData,
    progressCallback = null,
    cachedCurrentUser = null
  ) {
    if (!(job instanceof BackupJob)) {
      throw new Error('Invalid job: must be BackupJob instance');
    }

    if (job.status !== BackupStatus.PENDING) {
      throw new Error(`Cannot execute job in status: ${job.status}`);
    }

    try {
      job.start();
      logger.info(`[BackupService] Starting backup for ${job.personalityName}`);

      if (progressCallback) {
        await progressCallback(`🔄 Starting backup for **${job.personalityName}**...`);
      }

      // Load existing personality data
      const personalityData = await this.personalityDataRepository.load(job.personalityName);

      // Check ownership - fetch current user and personality profile to compare user_id
      let isOwner = false;
      let currentUser = null;
      let personalityProfile = null;
      let userDisplayPrefix = null;

      try {
        // Use cached user if available (for bulk operations), otherwise fetch current user
        if (cachedCurrentUser) {
          currentUser = cachedCurrentUser;
          logger.debug(
            `[BackupService] Using cached current user for ${job.personalityName}: ${currentUser.id}`
          );
        } else {
          currentUser = await this.apiClientService.fetchCurrentUser(authData);
          logger.debug(
            `[BackupService] Fetched current user for ${job.personalityName}: ${currentUser?.id}`
          );
        }

        // Extract user display name for file prefixing
        if (currentUser && currentUser.displayName) {
          userDisplayPrefix = this._convertToHyphenated(currentUser.displayName);
          logger.info(`[BackupService] User display prefix: ${userDisplayPrefix}`);
        }

        // Fetch personality profile to get user_id (always succeeds if personality exists)
        personalityProfile = await this.apiClientService.fetchPersonalityProfile(
          job.personalityName,
          authData
        );

        if (currentUser && currentUser.id && personalityProfile && personalityProfile.user_id) {
          // Convert both IDs to strings for comparison to handle type differences
          const currentUserId = String(currentUser.id);
          const profileUserId = String(personalityProfile.user_id);
          isOwner = currentUserId === profileUserId;

          logger.debug(
            `[BackupService] Ownership comparison for ${job.personalityName}: currentUser.id="${currentUserId}" (type: ${typeof currentUser.id}) vs personalityProfile.user_id="${profileUserId}" (type: ${typeof personalityProfile.user_id})`
          );

          if (!isOwner) {
            logger.warn(
              `[BackupService] IDs don't match for ${job.personalityName}: "${currentUserId}" !== "${profileUserId}"`
            );
          }
        } else {
          logger.debug(
            `[BackupService] Missing data for ownership check: currentUser=${!!currentUser} (id: ${currentUser?.id}), personalityProfile=${!!personalityProfile} (user_id: ${personalityProfile?.user_id})`
          );
        }

        logger.info(
          `[BackupService] User ownership check for ${job.personalityName}: ${isOwner ? 'owner' : 'non-owner'}`
        );
      } catch (error) {
        logger.warn(
          `[BackupService] Could not verify ownership for ${job.personalityName}: ${error.message}`
        );
        // Default to limited backup for safety
        isOwner = false;
      }

      // Store user info for ZIP naming
      job.userDisplayPrefix = userDisplayPrefix;

      // Fetch personality profile - for non-owners this returns limited public API data
      if (personalityProfile) {
        personalityData.updateProfile(personalityProfile);
      } else {
        // Fallback to fetch profile if not already fetched
        await this._backupProfile(personalityData, authData);
      }

      // Owners get full backup, non-owners get limited backup
      if (isOwner) {
        // Full backup for owners
        job.updateResults('profile', { updated: true });

        if (personalityData.id) {
          // Backup memories
          await this.delayFn(this.delayBetweenRequests);
          const memoryResult = await this._backupMemories(personalityData, authData);
          job.updateResults('memories', {
            newCount: memoryResult.newMemoryCount,
            totalCount: memoryResult.totalMemories,
            updated: memoryResult.hasNewMemories,
          });

          // Backup knowledge
          await this.delayFn(this.delayBetweenRequests);
          const knowledgeResult = await this._backupKnowledge(personalityData, authData);
          job.updateResults('knowledge', {
            updated: knowledgeResult.hasNewKnowledge,
            entryCount: knowledgeResult.knowledgeCount,
          });

          // Backup training
          await this.delayFn(this.delayBetweenRequests);
          const trainingResult = await this._backupTraining(personalityData, authData);
          job.updateResults('training', {
            updated: trainingResult.hasNewTraining,
            entryCount: trainingResult.trainingCount,
          });

          // Backup user personalization
          await this.delayFn(this.delayBetweenRequests);
          const userPersonalizationResult = await this._backupUserPersonalization(
            personalityData,
            authData
          );
          job.updateResults('userPersonalization', {
            updated: userPersonalizationResult.hasNewUserPersonalization,
          });

          // Backup chat history
          await this.delayFn(this.delayBetweenRequests);
          const chatResult = await this._backupChatHistory(personalityData, authData);
          job.updateResults('chatHistory', {
            newMessageCount: chatResult.newMessageCount,
            totalMessages: chatResult.totalMessages,
            updated: chatResult.hasNewMessages,
          });
        }
      } else {
        // Limited backup for non-owners
        // For non-owners, the private API returns the same limited data as public API
        // We can still get the personality ID, but limited profile data
        job.updateResults('profile', {
          updated: false,
          skipped: true,
          reason: 'Non-owner: Limited public profile data only',
        });

        // The limited data will always have an ID, so we can always backup memories, user personalization, and chat history
        if (personalityData.id) {
          // Backup memories
          await this.delayFn(this.delayBetweenRequests);
          const memoryResult = await this._backupMemories(personalityData, authData);
          job.updateResults('memories', {
            newCount: memoryResult.newMemoryCount,
            totalCount: memoryResult.totalMemories,
            updated: memoryResult.hasNewMemories,
          });

          // Backup user personalization
          await this.delayFn(this.delayBetweenRequests);
          const userPersonalizationResult = await this._backupUserPersonalization(
            personalityData,
            authData
          );
          job.updateResults('userPersonalization', {
            updated: userPersonalizationResult.hasNewUserPersonalization,
          });

          // Backup chat history
          await this.delayFn(this.delayBetweenRequests);
          const chatResult = await this._backupChatHistory(personalityData, authData);
          job.updateResults('chatHistory', {
            newMessageCount: chatResult.newMessageCount,
            totalMessages: chatResult.totalMessages,
            updated: chatResult.hasNewMessages,
          });
        } else {
          // This should not happen as limited data always includes ID, but handle gracefully
          logger.error(
            `[BackupService] Unexpected: No personality ID in limited profile data for ${job.personalityName}`
          );
          job.updateResults('memories', {
            updated: false,
            skipped: true,
            reason: 'Missing personality ID (unexpected)',
            newCount: 0,
            totalCount: 0,
          });
          job.updateResults('userPersonalization', {
            updated: false,
            skipped: true,
            reason: 'Missing personality ID (unexpected)',
          });
          job.updateResults('chatHistory', {
            updated: false,
            skipped: true,
            reason: 'Missing personality ID (unexpected)',
            newMessageCount: 0,
            totalMessages: 0,
          });
        }

        // Set results for skipped data types (not available to non-owners)
        job.updateResults('knowledge', {
          updated: false,
          skipped: true,
          reason: 'Non-owner access',
          entryCount: 0,
        });
        job.updateResults('training', {
          updated: false,
          skipped: true,
          reason: 'Non-owner access',
          entryCount: 0,
        });
      }

      // Mark backup complete and conditionally save to filesystem
      personalityData.markBackupComplete();

      if (job.persistToFilesystem) {
        await this.personalityDataRepository.save(personalityData);
        logger.info(
          `[BackupService] Backup data persisted to filesystem for ${job.personalityName}`
        );
      } else {
        logger.info(
          `[BackupService] Backup data not persisted to filesystem for ${job.personalityName} (non-owner or temporary backup)`
        );
      }

      // Store the personality data in the job for potential ZIP creation from memory
      job.personalityData = personalityData;

      job.complete(job.results);
      logger.info(`[BackupService] Backup completed for ${job.personalityName}`);

      if (progressCallback) {
        await this._sendCompletionMessage(job, progressCallback);
      }

      return job;
    } catch (error) {
      logger.error(`[BackupService] Backup failed for ${job.personalityName}: ${error.message}`);
      job.fail(error);

      if (progressCallback) {
        await progressCallback(`❌ Failed to backup **${job.personalityName}**: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Execute bulk backup for multiple personalities
   * @param {Array<string>} personalityNames - Names of personalities to backup
   * @param {string} userId - User requesting backup
   * @param {Object} authData - Authentication data
   * @param {Function} [progressCallback] - Callback for progress updates
   * @param {boolean} [persistToFilesystem=true] - Whether to persist backups to filesystem
   * @returns {Promise<Array<BackupJob>>} Array of completed jobs
   */
  async executeBulkBackup(
    personalityNames,
    userId,
    authData,
    progressCallback = null,
    persistToFilesystem = true
  ) {
    if (!Array.isArray(personalityNames) || personalityNames.length === 0) {
      throw new Error('Invalid personality names: must be non-empty array');
    }

    // Fetch current user once for the entire bulk operation to avoid repeated API calls
    let cachedCurrentUser = null;
    try {
      cachedCurrentUser = await this.apiClientService.fetchCurrentUser(authData);
      logger.info(`[BackupService] Cached current user for bulk backup: ${cachedCurrentUser?.id}`);
    } catch (error) {
      logger.warn(`[BackupService] Failed to fetch current user for bulk backup: ${error.message}`);
    }

    // Create all jobs upfront
    const jobs = personalityNames.map(
      personalityName =>
        new BackupJob({
          personalityName,
          userId,
          isBulk: true,
          persistToFilesystem,
        })
    );

    let successCount = 0;

    if (progressCallback) {
      await progressCallback(
        `📦 Starting bulk backup of ${personalityNames.length} personalities...\n` +
          `This may take a few minutes.`
      );
    }

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];

      try {
        await this.executeBackupWithCachedUser(job, authData, progressCallback, cachedCurrentUser);
        successCount++;

        // Delay between personalities
        if (i < jobs.length - 1) {
          await this.delayFn(this.delayBetweenRequests * 2);
        }
      } catch (error) {
        // Check for authentication errors that should stop the bulk operation
        if (this._isAuthenticationError(error)) {
          if (progressCallback) {
            await progressCallback(
              `\n❌ Authentication failed! Your session cookie may have expired.\n` +
                `Successfully backed up ${successCount} of ${personalityNames.length} personalities before failure.\n\n` +
                `Please update your session cookie with the backup --set-cookie command.`
            );
          }
          break;
        }
        // For other errors, continue with next personality
        logger.error(
          `[BackupService] Error in bulk backup for ${job.personalityName}: ${error.message}`
        );
      }
    }

    if (
      progressCallback &&
      jobs.every(
        job => job.status !== BackupStatus.FAILED || !this._isAuthenticationError(job.error)
      )
    ) {
      await progressCallback(`\n✅ Bulk backup complete! Backed up ${successCount} personalities.`);
    }

    return jobs;
  }

  /**
   * Backup profile data
   * @private
   */
  async _backupProfile(personalityData, authData) {
    const profile = await this.apiClientService.fetchPersonalityProfile(
      personalityData.name,
      authData
    );
    personalityData.updateProfile(profile);
  }

  /**
   * Backup memories
   * @private
   */
  async _backupMemories(personalityData, authData) {
    const memories = await this.apiClientService.fetchAllMemories(
      personalityData.id,
      personalityData.name,
      authData
    );
    logger.debug(
      `[BackupService] API returned ${memories?.length || 0} memories for ${personalityData.name}`
    );

    const result = personalityData.syncMemories(memories);
    logger.debug(
      `[BackupService] PersonalityData sync result for ${personalityData.name}: ${JSON.stringify(result)}`
    );
    logger.debug(
      `[BackupService] PersonalityData now has ${personalityData.memories?.length || 0} memories stored`
    );

    return result;
  }

  /**
   * Backup knowledge
   * @private
   */
  async _backupKnowledge(personalityData, authData) {
    const knowledge = await this.apiClientService.fetchKnowledgeData(
      personalityData.id,
      personalityData.name,
      authData
    );
    return personalityData.updateKnowledge(knowledge);
  }

  /**
   * Backup training
   * @private
   */
  async _backupTraining(personalityData, authData) {
    const training = await this.apiClientService.fetchTrainingData(
      personalityData.id,
      personalityData.name,
      authData
    );
    return personalityData.updateTraining(training);
  }

  /**
   * Backup user personalization
   * @private
   */
  async _backupUserPersonalization(personalityData, authData) {
    const userPersonalization = await this.apiClientService.fetchUserPersonalizationData(
      personalityData.id,
      personalityData.name,
      authData
    );
    logger.debug(
      `[BackupService] API returned user personalization for ${personalityData.name}: ${JSON.stringify(userPersonalization)}`
    );

    const result = personalityData.updateUserPersonalization(userPersonalization);
    logger.debug(
      `[BackupService] PersonalityData user personalization sync result for ${personalityData.name}: ${JSON.stringify(result)}`
    );
    logger.debug(
      `[BackupService] PersonalityData now has ${Object.keys(personalityData.userPersonalization || {}).length} user personalization keys`
    );

    return result;
  }

  /**
   * Backup chat history
   * @private
   */
  async _backupChatHistory(personalityData, authData) {
    const chatHistory = await this.apiClientService.fetchChatHistory(
      personalityData.id,
      personalityData.name,
      authData
    );
    logger.debug(
      `[BackupService] API returned ${chatHistory?.length || 0} chat messages for ${personalityData.name}`
    );

    const result = personalityData.syncChatHistory(chatHistory);
    logger.debug(
      `[BackupService] PersonalityData chat history sync result for ${personalityData.name}: ${JSON.stringify(result)}`
    );
    logger.debug(
      `[BackupService] PersonalityData now has ${personalityData.chatHistory?.length || 0} chat messages stored`
    );

    return result;
  }

  /**
   * Send completion message with detailed results
   * @private
   */
  async _sendCompletionMessage(job, progressCallback) {
    const { results } = job;
    const { personalityName } = job;

    let message = `✅ Backup complete for **${personalityName}**\n`;

    // Profile data
    if (results.profile.skipped) {
      message += `• Profile: Skipped (${results.profile.reason})\n`;
    } else {
      message += `• Profile: ${results.profile.updated ? 'Updated' : 'Unchanged'}\n`;
    }

    // Memory data
    message += `• New memories: ${results.memories.newCount || 0}\n`;
    message += `• Total memories: ${results.memories.totalCount || 0}\n`;

    // Knowledge data
    if (results.knowledge.skipped) {
      message += `• Knowledge: Skipped (${results.knowledge.reason})\n`;
    } else {
      message += `• Knowledge: ${results.knowledge.updated ? 'Updated' : 'Unchanged'} (${results.knowledge.entryCount} entries)\n`;
    }

    // Training data
    if (results.training.skipped) {
      message += `• Training: Skipped (${results.training.reason})\n`;
    } else {
      message += `• Training: ${results.training.updated ? 'Updated' : 'Unchanged'} (${results.training.entryCount} entries)\n`;
    }

    // User personalization
    message += `• User Personalization: ${results.userPersonalization.updated ? 'Updated' : 'Unchanged'}\n`;

    // Chat history
    message += `• Chat History: ${results.chatHistory.newMessageCount || 0} new messages (total: ${results.chatHistory.totalMessages || 0})`;

    await progressCallback(message);
  }

  /**
   * Check if error is authentication-related
   * @private
   */
  _isAuthenticationError(error) {
    if (!error) return false;
    return (
      error.status === 401 ||
      error.message.includes('401') ||
      error.message.includes('Authentication') ||
      error.message.includes('Session cookie')
    );
  }

  /**
   * Create default delay function (injectable pattern)
   * @private
   */
  _createDefaultDelayFn() {
    // Use globalThis for cross-platform compatibility
    const timer = globalThis.setTimeout;
    return ms => new Promise(resolve => timer(resolve, ms));
  }

  /**
   * Convert display name to hyphenated filename-safe format
   * @private
   * @param {string} displayName - User's display name
   * @returns {string} Hyphenated version
   */
  _convertToHyphenated(displayName) {
    return displayName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '') // Remove non-alphanumeric except spaces
      .trim()
      .replace(/\s+/g, '-'); // Replace spaces with hyphens
  }
}

module.exports = {
  BackupService,
};
