/**
 * Request Registry module for managing request deduplication
 * 
 * @module requestRegistry
 * @description
 * This module provides a centralized system for tracking and deduplicating
 * requests across the application. It helps prevent duplicate processing of
 * the same request, particularly in scenarios with race conditions.
 */

const logger = require('./logger');

/**
 * Registry class to track and deduplicate requests
 * @class
 */
class Registry {
  /**
   * Create a new Registry instance
   * @param {Object} options - Configuration options
   * @param {number} options.entryLifetime - Time in ms to keep entries in registry (default: 30000)
   * @param {number} options.cleanupInterval - Time in ms between cleanup runs (default: 60000)
   * @param {boolean} options.enableLogging - Whether to log operations (default: true)
   */
  constructor(options = {}) {
    this.registry = new Map();
    this.entryLifetime = options.entryLifetime || 30000; // Default: 30 seconds
    this.cleanupInterval = options.cleanupInterval || 60000; // Default: 60 seconds
    this.enableLogging = options.enableLogging !== false; // Default: true
    
    // Start periodic cleanup to prevent memory leaks
    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldEntries();
    }, this.cleanupInterval).unref(); // unref() allows the process to exit even if timer is active
    
    if (this.enableLogging) {
      logger.info(`[RequestRegistry] Initialized with entryLifetime=${this.entryLifetime}ms, cleanupInterval=${this.cleanupInterval}ms`);
    }
  }
  
  /**
   * Generate a unique request ID
   * @param {string} baseName - Base name for the request ID
   * @returns {string} Unique request ID
   */
  generateRequestId(baseName) {
    return `${baseName}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
  }
  
  /**
   * Add a request to the registry
   * @param {string} key - Unique key to identify the request
   * @param {Object} data - Data associated with the request
   * @returns {Object} The stored entry with requestId
   */
  addRequest(key, data = {}) {
    if (!key) {
      throw new Error('Request key is required');
    }
    
    const requestId = this.generateRequestId(key.split('-')[0] || 'req');
    
    const entry = {
      requestId,
      timestamp: Date.now(),
      completed: false,
      ...data
    };
    
    this.registry.set(key, entry);
    
    if (this.enableLogging) {
      logger.info(`[RequestRegistry] Added request: ${requestId} for key: ${key}`);
    }
    
    return entry;
  }
  
  /**
   * Check if a request exists and get its status
   * @param {string} key - The request key to check
   * @returns {Object|null} Request status or null if not found
   */
  checkRequest(key) {
    if (!key) {
      return null;
    }
    
    if (this.registry.has(key)) {
      const entry = this.registry.get(key);
      
      if (this.enableLogging) {
        logger.debug(`[RequestRegistry] Found request: ${key}, status: ${entry.completed ? 'completed' : 'pending'}`);
      }
      
      return { ...entry };
    }
    
    return null;
  }
  
  /**
   * Check if a request is a duplicate that should be blocked
   * @param {string} key - The request key to check
   * @param {Object} options - Options for checking duplicates
   * @param {number} options.timeWindow - Time window in ms to consider as duplicate (default: registry's entryLifetime)
   * @param {boolean} options.blockIncomplete - Whether to block if previous request is incomplete (default: true)
   * @returns {Object|null} Status object if duplicate, null if not a duplicate
   */
  isDuplicate(key, options = {}) {
    const timeWindow = options.timeWindow || this.entryLifetime;
    const blockIncomplete = options.blockIncomplete !== false;
    
    const entry = this.checkRequest(key);
    
    if (!entry) {
      return null;
    }
    
    const now = Date.now();
    const timeSinceRequest = now - entry.timestamp;
    
    // Check if the request is within the time window for deduplication
    if (timeSinceRequest < timeWindow) {
      // Check if we should block based on completion status
      if (!entry.completed && !blockIncomplete) {
        return null;
      }
      
      if (this.enableLogging) {
        logger.warn(`[RequestRegistry] Duplicate request detected: ${key}, age: ${timeSinceRequest}ms`);
      }
      
      return {
        isDuplicate: true,
        requestId: entry.requestId,
        timeSinceOriginal: timeSinceRequest,
        originalEntry: { ...entry }
      };
    }
    
    return null;
  }
  
  /**
   * Update request status or data
   * @param {string} key - The request key to update
   * @param {Object} updates - The fields to update
   * @returns {boolean} True if update was successful, false if request not found
   */
  updateRequest(key, updates = {}) {
    if (!this.registry.has(key)) {
      if (this.enableLogging) {
        logger.warn(`[RequestRegistry] Cannot update; request not found: ${key}`);
      }
      return false;
    }
    
    const entry = this.registry.get(key);
    const updatedEntry = { ...entry, ...updates };
    
    this.registry.set(key, updatedEntry);
    
    if (this.enableLogging) {
      logger.info(`[RequestRegistry] Updated request: ${key}, updates: ${JSON.stringify(Object.keys(updates))}`);
    }
    
    return true;
  }
  
  /**
   * Mark a request as completed
   * @param {string} key - The request key to mark as completed
   * @param {Object} additionalData - Any additional data to store with the completed request
   * @returns {boolean} True if marking as completed was successful, false if request not found
   */
  completeRequest(key, additionalData = {}) {
    return this.updateRequest(key, {
      completed: true,
      completedAt: Date.now(),
      ...additionalData
    });
  }
  
  /**
   * Remove a request from the registry
   * @param {string} key - The request key to remove
   * @returns {boolean} True if removal was successful, false if request not found
   */
  removeRequest(key) {
    if (!this.registry.has(key)) {
      return false;
    }
    
    this.registry.delete(key);
    
    if (this.enableLogging) {
      logger.info(`[RequestRegistry] Removed request: ${key}`);
    }
    
    return true;
  }
  
  /**
   * Clean up old entries from the registry
   * @param {number} maxAge - Maximum age in milliseconds (default: registry's entryLifetime)
   * @returns {number} Number of entries removed
   */
  cleanupOldEntries(maxAge) {
    const cutoffTime = Date.now() - (maxAge || this.entryLifetime);
    let removedCount = 0;
    
    for (const [key, entry] of this.registry.entries()) {
      if (entry.timestamp < cutoffTime) {
        this.registry.delete(key);
        removedCount++;
      }
    }
    
    if (removedCount > 0 && this.enableLogging) {
      logger.info(`[RequestRegistry] Cleaned up ${removedCount} old entries, registry size: ${this.registry.size}`);
    }
    
    return removedCount;
  }
  
  /**
   * Get current registry size
   * @returns {number} Number of entries in the registry
   */
  get size() {
    return this.registry.size;
  }
  
  /**
   * Get all registry entries
   * @returns {Object} Map of all registry entries
   */
  getAllEntries() {
    return new Map(this.registry);
  }
  
  /**
   * Destroy the registry and clean up resources
   */
  destroy() {
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    
    this.registry.clear();
    
    if (this.enableLogging) {
      logger.info(`[RequestRegistry] Registry destroyed and resources cleaned up`);
    }
  }
}

module.exports = {
  Registry
};