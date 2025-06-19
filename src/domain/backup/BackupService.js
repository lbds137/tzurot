/**
 * BackupService Domain Service
 * Orchestrates backup operations for personality data
 */

const { BackupJob, BackupStatus } = require('./BackupJob');
const { PersonalityData } = require('./PersonalityData');
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
    delayFn = (ms) => new Promise(resolve => setTimeout(resolve, ms))
  }) {
    this.personalityDataRepository = personalityDataRepository;
    this.apiClientService = apiClientService;
    this.authenticationService = authenticationService;
    this.delayFn = delayFn;
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

      // Backup profile data
      await this._backupProfile(personalityData, authData);
      job.updateResults('profile', { updated: true });

      if (personalityData.id) {
        // Backup memories
        await this.delayFn(this.delayBetweenRequests);
        const memoryResult = await this._backupMemories(personalityData, authData);
        job.updateResults('memories', memoryResult);

        // Backup knowledge
        await this.delayFn(this.delayBetweenRequests);
        const knowledgeResult = await this._backupKnowledge(personalityData, authData);
        job.updateResults('knowledge', knowledgeResult);

        // Backup training
        await this.delayFn(this.delayBetweenRequests);
        const trainingResult = await this._backupTraining(personalityData, authData);
        job.updateResults('training', trainingResult);

        // Backup user personalization
        await this.delayFn(this.delayBetweenRequests);
        const userPersonalizationResult = await this._backupUserPersonalization(personalityData, authData);
        job.updateResults('userPersonalization', userPersonalizationResult);

        // Backup chat history
        await this.delayFn(this.delayBetweenRequests);
        const chatResult = await this._backupChatHistory(personalityData, authData);
        job.updateResults('chatHistory', chatResult);
      }

      // Mark backup complete and save
      personalityData.markBackupComplete();
      await this.personalityDataRepository.save(personalityData);

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
   * @returns {Promise<Array<BackupJob>>} Array of completed jobs
   */
  async executeBulkBackup(personalityNames, userId, authData, progressCallback = null) {
    if (!Array.isArray(personalityNames) || personalityNames.length === 0) {
      throw new Error('Invalid personality names: must be non-empty array');
    }

    const jobs = [];
    let successCount = 0;

    if (progressCallback) {
      await progressCallback(
        `📦 Starting bulk backup of ${personalityNames.length} personalities...\n` +
        `This may take a few minutes.`
      );
    }

    for (const personalityName of personalityNames) {
      const job = new BackupJob({
        personalityName,
        userId,
        isBulk: true
      });
      jobs.push(job);

      try {
        await this.executeBackup(job, authData, progressCallback);
        successCount++;

        // Delay between personalities
        if (successCount < personalityNames.length) {
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
        logger.error(`[BackupService] Error in bulk backup for ${personalityName}: ${error.message}`);
      }
    }

    if (progressCallback && jobs.every(job => job.status !== BackupStatus.FAILED || !this._isAuthenticationError(job.error))) {
      await progressCallback(`\n✅ Bulk backup complete! Backed up ${successCount} personalities.`);
    }

    return jobs;
  }

  /**
   * Backup profile data
   * @private
   */
  async _backupProfile(personalityData, authData) {
    const profile = await this.apiClientService.fetchPersonalityProfile(personalityData.name, authData);
    personalityData.updateProfile(profile);
  }

  /**
   * Backup memories
   * @private
   */
  async _backupMemories(personalityData, authData) {
    const memories = await this.apiClientService.fetchAllMemories(personalityData.id, personalityData.name, authData);
    return personalityData.syncMemories(memories);
  }

  /**
   * Backup knowledge
   * @private
   */
  async _backupKnowledge(personalityData, authData) {
    const knowledge = await this.apiClientService.fetchKnowledgeData(personalityData.id, personalityData.name, authData);
    return personalityData.updateKnowledge(knowledge);
  }

  /**
   * Backup training
   * @private
   */
  async _backupTraining(personalityData, authData) {
    const training = await this.apiClientService.fetchTrainingData(personalityData.id, personalityData.name, authData);
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
    return personalityData.updateUserPersonalization(userPersonalization);
  }

  /**
   * Backup chat history
   * @private
   */
  async _backupChatHistory(personalityData, authData) {
    const chatHistory = await this.apiClientService.fetchChatHistory(personalityData.id, personalityData.name, authData);
    return personalityData.syncChatHistory(chatHistory);
  }

  /**
   * Send completion message with detailed results
   * @private
   */
  async _sendCompletionMessage(job, progressCallback) {
    const { results } = job;
    const { personalityName } = job;
    
    let message = `✅ Backup complete for **${personalityName}**\n` +
      `• Profile: Updated\n` +
      `• New memories: ${results.memories.newCount}\n` +
      `• Total memories: ${results.memories.totalCount}\n` +
      `• Knowledge: ${results.knowledge.updated ? 'Updated' : 'Unchanged'} (${results.knowledge.entryCount} entries)\n` +
      `• Training: ${results.training.updated ? 'Updated' : 'Unchanged'} (${results.training.entryCount} entries)\n` +
      `• User Personalization: ${results.userPersonalization.updated ? 'Updated' : 'Unchanged'}\n` +
      `• Chat History: ${results.chatHistory.newMessageCount} new messages (total: ${results.chatHistory.totalMessages})`;

    await progressCallback(message);
  }

  /**
   * Check if error is authentication-related
   * @private
   */
  _isAuthenticationError(error) {
    if (!error) return false;
    return error.status === 401 || 
           error.message.includes('401') || 
           error.message.includes('Authentication') ||
           error.message.includes('Session cookie');
  }
}

module.exports = {
  BackupService
};