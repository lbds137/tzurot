/**
 * AI Integration domain module
 * @module domain/ai
 */

const { AIRequest } = require('./AIRequest');
const { AIRequestId } = require('./AIRequestId');
const { AIContent } = require('./AIContent');
const { AIModel } = require('./AIModel');
const { AIService } = require('./AIService');
const { AIRequestRepository } = require('./AIRequestRepository');
const { AIRequestDeduplicator } = require('./AIRequestDeduplicator');
const {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
  AIContentSanitized,
  AIErrorDetected,
} = require('./AIEvents');

module.exports = {
  // Aggregates
  AIRequest,

  // Value Objects
  AIRequestId,
  AIContent,
  AIModel,

  // Services
  AIService,
  AIRequestDeduplicator,

  // Repositories
  AIRequestRepository,

  // Events
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
  AIContentSanitized,
  AIErrorDetected,
};
