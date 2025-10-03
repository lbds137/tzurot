/**
 * PersonalityData Domain Entity
 * Represents all data associated with a personality
 */

/**
 * Backup metadata value object
 */
class BackupMetadata {
  constructor({
    lastBackup = null,
    lastMemoryTimestamp = null,
    totalMemories = 0,
    lastKnowledgeSync = null,
    totalKnowledge = 0,
    lastTrainingSync = null,
    totalTraining = 0,
    lastUserPersonalizationSync = null,
    lastChatHistorySync = null,
    totalChatMessages = 0,
    oldestChatMessage = null,
    newestChatMessage = null,
  } = {}) {
    this.lastBackup = lastBackup;
    this.lastMemoryTimestamp = lastMemoryTimestamp;
    this.totalMemories = totalMemories;
    this.lastKnowledgeSync = lastKnowledgeSync;
    this.totalKnowledge = totalKnowledge;
    this.lastTrainingSync = lastTrainingSync;
    this.totalTraining = totalTraining;
    this.lastUserPersonalizationSync = lastUserPersonalizationSync;
    this.lastChatHistorySync = lastChatHistorySync;
    this.totalChatMessages = totalChatMessages;
    this.oldestChatMessage = oldestChatMessage;
    this.newestChatMessage = newestChatMessage;
  }

  /**
   * Update backup timestamp
   */
  markBackupComplete() {
    this.lastBackup = new Date().toISOString();
  }

  /**
   * Update memory sync metadata
   * @param {number} totalCount - Total memory count
   * @param {number} lastTimestamp - Most recent memory timestamp
   */
  updateMemorySync(totalCount, lastTimestamp = null) {
    this.totalMemories = totalCount;
    if (lastTimestamp) {
      this.lastMemoryTimestamp = lastTimestamp;
    }
  }

  /**
   * Update knowledge sync metadata
   * @param {number} entryCount - Number of knowledge entries
   */
  updateKnowledgeSync(entryCount) {
    this.totalKnowledge = entryCount;
    this.lastKnowledgeSync = new Date().toISOString();
  }

  /**
   * Update training sync metadata
   * @param {number} entryCount - Number of training entries
   */
  updateTrainingSync(entryCount) {
    this.totalTraining = entryCount;
    this.lastTrainingSync = new Date().toISOString();
  }

  /**
   * Update user personalization sync metadata
   */
  updateUserPersonalizationSync() {
    this.lastUserPersonalizationSync = new Date().toISOString();
  }

  /**
   * Update chat history sync metadata
   * @param {number} totalMessages - Total message count
   * @param {string|null} oldestMessage - Oldest message timestamp
   * @param {string|null} newestMessage - Newest message timestamp
   */
  updateChatHistorySync(totalMessages, oldestMessage = null, newestMessage = null) {
    this.totalChatMessages = totalMessages;
    this.lastChatHistorySync = new Date().toISOString();
    if (oldestMessage) this.oldestChatMessage = oldestMessage;
    if (newestMessage) this.newestChatMessage = newestMessage;
  }
}

/**
 * PersonalityData aggregate root
 */
class PersonalityData {
  /**
   * Create personality data aggregate
   * @param {string} name - Personality name
   * @param {string} id - Personality ID
   */
  constructor(name, id = null) {
    this.name = name;
    this.id = id;
    this.profile = null;
    this.memories = [];
    this.knowledge = [];
    this.training = [];
    this.userPersonalization = {};
    this.chatHistory = [];
    this.metadata = new BackupMetadata();
  }

  /**
   * Update profile data
   * @param {Object} profileData - Profile information
   */
  updateProfile(profileData) {
    this.profile = profileData;
    if (profileData.id && !this.id) {
      this.id = profileData.id;
    }
  }

  /**
   * Sync memories with new data
   * @param {Array} newMemories - Array of memory objects
   * @returns {Object} Sync results
   */
  syncMemories(newMemories) {
    if (!Array.isArray(newMemories)) {
      throw new Error('Memories must be an array');
    }

    const existingIds = new Set(this.memories.map(m => m.id));
    const addedMemories = newMemories.filter(memory => !existingIds.has(memory.id));

    if (addedMemories.length > 0) {
      this.memories.push(...addedMemories);

      // Sort by timestamp to maintain chronological order
      this.memories.sort((a, b) => {
        const timeA =
          typeof a.created_at === 'number'
            ? a.created_at
            : new Date(a.created_at || a.timestamp || 0).getTime() / 1000;
        const timeB =
          typeof b.created_at === 'number'
            ? b.created_at
            : new Date(b.created_at || b.timestamp || 0).getTime() / 1000;
        return timeA - timeB;
      });

      // Update metadata
      const lastMemory = this.memories[this.memories.length - 1];
      const lastTimestamp =
        typeof lastMemory.created_at === 'number'
          ? lastMemory.created_at
          : new Date(lastMemory.created_at || lastMemory.timestamp || 0).getTime() / 1000;

      this.metadata.updateMemorySync(this.memories.length, lastTimestamp);
    }

    return {
      hasNewMemories: addedMemories.length > 0,
      newMemoryCount: addedMemories.length,
      totalMemories: this.memories.length,
    };
  }

  /**
   * Update knowledge data
   * @param {Array} knowledgeData - Knowledge entries
   * @returns {Object} Update results
   */
  updateKnowledge(knowledgeData) {
    if (!Array.isArray(knowledgeData)) {
      throw new Error('Knowledge data must be an array');
    }

    const hasChanges = JSON.stringify(this.knowledge) !== JSON.stringify(knowledgeData);

    if (hasChanges) {
      this.knowledge = [...knowledgeData];
      this.metadata.updateKnowledgeSync(this.knowledge.length);
    }

    return {
      hasNewKnowledge: hasChanges,
      knowledgeCount: this.knowledge.length,
    };
  }

  /**
   * Update training data
   * @param {Array} trainingData - Training entries
   * @returns {Object} Update results
   */
  updateTraining(trainingData) {
    if (!Array.isArray(trainingData)) {
      throw new Error('Training data must be an array');
    }

    const hasChanges = JSON.stringify(this.training) !== JSON.stringify(trainingData);

    if (hasChanges) {
      this.training = [...trainingData];
      this.metadata.updateTrainingSync(this.training.length);
    }

    return {
      hasNewTraining: hasChanges,
      trainingCount: this.training.length,
    };
  }

  /**
   * Update user personalization data
   * @param {Object} personalizationData - User personalization object
   * @returns {Object} Update results
   */
  updateUserPersonalization(personalizationData) {
    if (typeof personalizationData !== 'object' || personalizationData === null) {
      throw new Error('User personalization data must be an object');
    }

    const hasChanges =
      JSON.stringify(this.userPersonalization) !== JSON.stringify(personalizationData);

    if (hasChanges) {
      this.userPersonalization = { ...personalizationData };
      this.metadata.updateUserPersonalizationSync();
    }

    return {
      hasNewUserPersonalization: hasChanges,
    };
  }

  /**
   * Sync chat history with new messages
   * @param {Array} newMessages - Array of chat messages
   * @returns {Object} Sync results
   */
  syncChatHistory(newMessages) {
    if (!Array.isArray(newMessages)) {
      throw new Error('Chat messages must be an array');
    }

    // Get newest existing timestamp for efficient filtering
    let newestExistingTimestamp = 0;
    if (this.chatHistory.length > 0) {
      newestExistingTimestamp = this.chatHistory[this.chatHistory.length - 1].ts;
    }

    // Filter to only new messages
    const addedMessages = newMessages.filter(msg => msg.ts > newestExistingTimestamp);

    if (addedMessages.length > 0) {
      this.chatHistory.push(...addedMessages);

      // Update metadata
      const oldestTimestamp =
        this.chatHistory.length > 0 ? new Date(this.chatHistory[0].ts * 1000).toISOString() : null;
      const newestTimestamp =
        this.chatHistory.length > 0
          ? new Date(this.chatHistory[this.chatHistory.length - 1].ts * 1000).toISOString()
          : null;

      this.metadata.updateChatHistorySync(
        this.chatHistory.length,
        oldestTimestamp,
        newestTimestamp
      );
    }

    return {
      hasNewMessages: addedMessages.length > 0,
      newMessageCount: addedMessages.length,
      totalMessages: this.chatHistory.length,
    };
  }

  /**
   * Get summary of personality data
   * @returns {Object} Data summary
   */
  getSummary() {
    return {
      name: this.name,
      id: this.id,
      hasProfile: !!this.profile,
      memoriesCount: this.memories.length,
      knowledgeCount: this.knowledge.length,
      trainingCount: this.training.length,
      chatMessagesCount: this.chatHistory.length,
      hasUserPersonalization: Object.keys(this.userPersonalization).length > 0,
      lastBackup: this.metadata.lastBackup,
      dateRange:
        this.metadata.oldestChatMessage && this.metadata.newestChatMessage
          ? {
              oldest: this.metadata.oldestChatMessage,
              newest: this.metadata.newestChatMessage,
            }
          : null,
    };
  }

  /**
   * Mark backup as complete
   */
  markBackupComplete() {
    this.metadata.markBackupComplete();
  }
}

module.exports = {
  PersonalityData,
  BackupMetadata,
};
