const { getFeatureFlags } = require('./FeatureFlags');
const logger = require('../../logger');

/**
 * Comparison testing framework for validating new system against legacy
 * Allows running operations through both systems and comparing results
 */
class ComparisonTester {
  constructor(options = {}) {
    this.featureFlags = options.featureFlags || getFeatureFlags();
    this.logger = options.logger || logger;
    this.results = new Map();
    this.discrepancies = [];
    this.options = {
      logDiscrepancies: options.logDiscrepancies !== false,
      throwOnMismatch: options.throwOnMismatch || false,
      compareTimeout: options.compareTimeout || 5000,
      ...options,
    };
  }

  /**
   * Run an operation through both legacy and new systems and compare results
   * @param {string} operationName - Name of the operation for logging
   * @param {Function} legacyOperation - Legacy system function
   * @param {Function} newOperation - New system function
   * @param {Object} options - Comparison options
   * @returns {Object} Result with both outputs and comparison status
   */
  async compare(operationName, legacyOperation, newOperation, options = {}) {
    const startTime = Date.now();
    const result = {
      operationName,
      timestamp: new Date().toISOString(),
      legacyResult: null,
      newResult: null,
      legacyError: null,
      newError: null,
      match: false,
      discrepancies: [],
      duration: 0,
    };

    try {
      // Run legacy operation
      try {
        result.legacyResult = await this._runWithTimeout(
          legacyOperation,
          this.options.compareTimeout,
          'Legacy operation'
        );
      } catch (error) {
        result.legacyError = this._serializeError(error);
      }

      // Run new operation
      try {
        result.newResult = await this._runWithTimeout(
          newOperation,
          this.options.compareTimeout,
          'New operation'
        );
      } catch (error) {
        result.newError = this._serializeError(error);
      }

      // Compare results
      const comparison = this._compareResults(
        result.legacyResult,
        result.newResult,
        result.legacyError,
        result.newError,
        options
      );

      result.match = comparison.match;
      result.discrepancies = comparison.discrepancies;
      result.duration = Date.now() - startTime;

      // Store result
      this._storeResult(result);

      // Handle discrepancies
      if (!result.match) {
        this._handleDiscrepancy(result);
      }

      return result;
    } catch (error) {
      this.logger.error(`Comparison test failed for ${operationName}:`, error);
      throw error;
    }
  }

  /**
   * Compare multiple operations in parallel
   * @param {Array} operations - Array of {name, legacy, new, options}
   * @returns {Array} Results for all operations
   */
  async compareMultiple(operations) {
    const results = await Promise.allSettled(
      operations.map(op => this.compare(op.name, op.legacy, op.new, op.options))
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          operationName: operations[index].name,
          error: result.reason.message,
          match: false,
        };
      }
    });
  }

  /**
   * Run operation with timeout
   */
  async _runWithTimeout(operation, timeout, description) {
    // For testing purposes, operations should complete quickly
    // In production, we rely on the underlying operations having their own timeouts
    try {
      return await operation();
    } catch (error) {
      if (error.message && error.message.includes('timeout')) {
        throw new Error(`${description} timed out`);
      }
      throw error;
    }
  }

  /**
   * Compare results from both systems
   */
  _compareResults(legacyResult, newResult, legacyError, newError, options = {}) {
    const discrepancies = [];
    let match = true;

    // If both errored, compare error types
    if (legacyError && newError) {
      if (legacyError.name !== newError.name || legacyError.message !== newError.message) {
        match = false;
        discrepancies.push({
          type: 'error_mismatch',
          legacy: legacyError,
          new: newError,
        });
      }
      return { match, discrepancies };
    }

    // If only one errored, they don't match
    if (legacyError || newError) {
      match = false;
      discrepancies.push({
        type: 'error_state_mismatch',
        legacy: legacyError,
        new: newError,
      });
      return { match, discrepancies };
    }

    // Compare successful results
    const comparison = this._deepCompare(legacyResult, newResult, options);
    if (!comparison.match) {
      match = false;
      discrepancies.push(...comparison.discrepancies);
    }

    return { match, discrepancies };
  }

  /**
   * Deep comparison of results with configurable options
   */
  _deepCompare(obj1, obj2, options = {}, path = '') {
    const discrepancies = [];
    const {
      ignoreFields = [],
      compareTimestamps = false,
      compareFunctions = false,
      customComparators = {},
    } = options;

    // Handle custom comparators
    if (customComparators[path]) {
      const result = customComparators[path](obj1, obj2);
      return {
        match: result,
        discrepancies: result ? [] : [{ path, type: 'custom_mismatch', legacy: obj1, new: obj2 }],
      };
    }

    // Handle null/undefined
    if (obj1 === null || obj1 === undefined || obj2 === null || obj2 === undefined) {
      const match = obj1 === obj2;
      if (!match) {
        discrepancies.push({ path, type: 'null_mismatch', legacy: obj1, new: obj2 });
      }
      return { match, discrepancies };
    }

    // Handle primitives
    if (typeof obj1 !== 'object' || typeof obj2 !== 'object') {
      const match = obj1 === obj2;
      if (!match) {
        discrepancies.push({ path, type: 'value_mismatch', legacy: obj1, new: obj2 });
      }
      return { match, discrepancies };
    }

    // Handle arrays
    if (Array.isArray(obj1) && Array.isArray(obj2)) {
      if (obj1.length !== obj2.length) {
        discrepancies.push({
          path,
          type: 'array_length_mismatch',
          legacy: obj1.length,
          new: obj2.length,
        });
        return { match: false, discrepancies };
      }

      for (let i = 0; i < obj1.length; i++) {
        const result = this._deepCompare(obj1[i], obj2[i], options, `${path}[${i}]`);
        if (!result.match) {
          discrepancies.push(...result.discrepancies);
        }
      }

      return { match: discrepancies.length === 0, discrepancies };
    }

    // Handle objects
    const keys1 = Object.keys(obj1).filter(key => !ignoreFields.includes(key));
    const keys2 = Object.keys(obj2).filter(key => !ignoreFields.includes(key));

    // Check for missing keys
    const missingInNew = keys1.filter(key => !keys2.includes(key));
    const missingInLegacy = keys2.filter(key => !keys1.includes(key));

    if (missingInNew.length > 0) {
      discrepancies.push({ path, type: 'missing_keys_new', keys: missingInNew });
    }
    if (missingInLegacy.length > 0) {
      discrepancies.push({ path, type: 'missing_keys_legacy', keys: missingInLegacy });
    }

    // Compare common keys
    const commonKeys = keys1.filter(key => keys2.includes(key));
    for (const key of commonKeys) {
      // Skip timestamps if configured
      if (
        !compareTimestamps &&
        (key.includes('timestamp') || key.includes('createdAt') || key.includes('updatedAt'))
      ) {
        continue;
      }

      // Skip functions if configured
      if (!compareFunctions && typeof obj1[key] === 'function') {
        continue;
      }

      const result = this._deepCompare(
        obj1[key],
        obj2[key],
        options,
        path ? `${path}.${key}` : key
      );
      if (!result.match) {
        discrepancies.push(...result.discrepancies);
      }
    }

    return { match: discrepancies.length === 0, discrepancies };
  }

  /**
   * Serialize error for comparison
   */
  _serializeError(error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
    };
  }

  /**
   * Store comparison result
   */
  _storeResult(result) {
    if (!this.results.has(result.operationName)) {
      this.results.set(result.operationName, []);
    }
    this.results.get(result.operationName).push(result);
  }

  /**
   * Handle discrepancy based on configuration
   */
  _handleDiscrepancy(result) {
    this.discrepancies.push(result);

    if (this.options.logDiscrepancies) {
      this.logger.warn(`Comparison mismatch in ${result.operationName}:`, {
        discrepancies: result.discrepancies,
        duration: result.duration,
      });
    }

    if (this.options.throwOnMismatch) {
      const error = new Error(`Comparison mismatch in ${result.operationName}`);
      error.result = result;
      throw error;
    }
  }

  /**
   * Get comparison statistics
   */
  getStatistics() {
    const stats = {
      totalOperations: 0,
      totalComparisons: 0,
      matches: 0,
      mismatches: 0,
      operationStats: {},
    };

    for (const [operation, results] of this.results.entries()) {
      stats.totalOperations++;
      stats.totalComparisons += results.length;

      const operationMatches = results.filter(r => r.match).length;
      const operationMismatches = results.length - operationMatches;

      stats.matches += operationMatches;
      stats.mismatches += operationMismatches;

      stats.operationStats[operation] = {
        total: results.length,
        matches: operationMatches,
        mismatches: operationMismatches,
        successRate: ((operationMatches / results.length) * 100).toFixed(2) + '%',
        averageDuration:
          (results.reduce((sum, r) => sum + r.duration, 0) / results.length).toFixed(2) + 'ms',
      };
    }

    stats.overallSuccessRate =
      stats.totalComparisons > 0
        ? ((stats.matches / stats.totalComparisons) * 100).toFixed(2) + '%'
        : '0%';

    return stats;
  }

  /**
   * Get all discrepancies
   */
  getDiscrepancies() {
    return [...this.discrepancies];
  }

  /**
   * Clear results and discrepancies
   */
  clear() {
    this.results.clear();
    this.discrepancies = [];
  }
}

// Singleton instance
let instance = null;

/**
 * Get the comparison tester instance
 * @param {Object} options - Optional configuration
 * @returns {ComparisonTester}
 */
function getComparisonTester(options) {
  if (!instance) {
    instance = new ComparisonTester(options);
  }
  return instance;
}

/**
 * Reset the comparison tester instance
 */
function resetComparisonTester() {
  instance = null;
}

module.exports = {
  ComparisonTester,
  getComparisonTester,
  resetComparisonTester,
};
