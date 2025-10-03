/**
 * BackupJob Domain Entity
 * Represents a backup operation with its state and results
 */

/**
 * Backup job status enumeration
 */
const BackupStatus = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

/**
 * BackupJob entity representing a single backup operation
 */
class BackupJob {
  /**
   * Create a new backup job
   * @param {Object} params - Job parameters
   * @param {string} params.personalityName - Name of personality to backup
   * @param {string} params.userId - User ID requesting backup
   * @param {boolean} [params.isBulk=false] - Whether this is part of a bulk operation
   * @param {boolean} [params.persistToFilesystem=true] - Whether to save backup to filesystem
   * @param {string} [params.id] - Unique job ID (auto-generated if not provided)
   */
  constructor({ personalityName, userId, isBulk = false, persistToFilesystem = true, id = null }) {
    this.id = id || this._generateId();
    this.personalityName = personalityName;
    this.userId = userId;
    this.isBulk = isBulk;
    this.persistToFilesystem = persistToFilesystem;
    this.status = BackupStatus.PENDING;
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.error = null;

    // Backup results
    this.results = {
      profile: { updated: false },
      memories: { newCount: 0, totalCount: 0 },
      knowledge: { updated: false, entryCount: 0 },
      training: { updated: false, entryCount: 0 },
      userPersonalization: { updated: false },
      chatHistory: { newMessageCount: 0, totalMessages: 0 },
    };
  }

  /**
   * Mark job as started
   */
  start() {
    if (this.status !== BackupStatus.PENDING) {
      throw new Error(`Cannot start job in status: ${this.status}`);
    }
    this.status = BackupStatus.IN_PROGRESS;
    this.startedAt = new Date();
  }

  /**
   * Mark job as completed successfully
   * @param {Object} results - Backup operation results
   */
  complete(results) {
    if (this.status !== BackupStatus.IN_PROGRESS) {
      throw new Error(`Cannot complete job in status: ${this.status}`);
    }
    this.status = BackupStatus.COMPLETED;
    this.completedAt = new Date();
    this.results = { ...this.results, ...results };
  }

  /**
   * Mark job as failed
   * @param {Error} error - Error that caused failure
   */
  fail(error) {
    if (this.status === BackupStatus.COMPLETED) {
      throw new Error('Cannot fail a completed job');
    }
    this.status = BackupStatus.FAILED;
    this.completedAt = new Date();
    this.error = {
      message: error.message,
      stack: error.stack,
      timestamp: new Date(),
    };
  }

  /**
   * Get job duration in milliseconds
   * @returns {number|null} Duration or null if not started
   */
  getDuration() {
    if (!this.startedAt) return null;
    const endTime = this.completedAt || new Date();
    return endTime.getTime() - this.startedAt.getTime();
  }

  /**
   * Check if job is in a terminal state
   * @returns {boolean} True if completed or failed
   */
  isFinished() {
    return this.status === BackupStatus.COMPLETED || this.status === BackupStatus.FAILED;
  }

  /**
   * Get human-readable status
   * @returns {string} Status description
   */
  getStatusDescription() {
    switch (this.status) {
      case BackupStatus.PENDING:
        return 'Waiting to start';
      case BackupStatus.IN_PROGRESS:
        return 'Backup in progress';
      case BackupStatus.COMPLETED:
        return 'Backup completed successfully';
      case BackupStatus.FAILED:
        return `Backup failed: ${this.error?.message || 'Unknown error'}`;
      default:
        return 'Unknown status';
    }
  }

  /**
   * Update results for a specific data type
   * @param {string} dataType - Type of data (memories, knowledge, etc.)
   * @param {Object} result - Result data for this type
   */
  updateResults(dataType, result) {
    if (!this.results[dataType]) {
      throw new Error(`Unknown data type: ${dataType}`);
    }
    this.results[dataType] = { ...this.results[dataType], ...result };
  }

  /**
   * Generate unique job ID
   * @private
   * @returns {string} Unique identifier
   */
  _generateId() {
    return `backup_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Serialize job to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      personalityName: this.personalityName,
      userId: this.userId,
      isBulk: this.isBulk,
      persistToFilesystem: this.persistToFilesystem,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      startedAt: this.startedAt?.toISOString() || null,
      completedAt: this.completedAt?.toISOString() || null,
      error: this.error,
      results: this.results,
    };
  }

  /**
   * Create job from JSON data
   * @param {Object} data - JSON data
   * @returns {BackupJob} Restored job instance
   */
  static fromJSON(data) {
    const job = new BackupJob({
      personalityName: data.personalityName,
      userId: data.userId,
      isBulk: data.isBulk,
      persistToFilesystem: data.persistToFilesystem,
      id: data.id,
    });

    job.status = data.status;
    job.createdAt = new Date(data.createdAt);
    job.startedAt = data.startedAt ? new Date(data.startedAt) : null;
    job.completedAt = data.completedAt ? new Date(data.completedAt) : null;
    job.error = data.error;
    job.results = data.results;

    return job;
  }
}

module.exports = {
  BackupJob,
  BackupStatus,
};
