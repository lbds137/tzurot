/**
 * AI Request aggregate root
 * @module domain/ai/AIRequest
 */

const { AggregateRoot } = require('../shared/AggregateRoot');
const { AIRequestId } = require('./AIRequestId');
const { AIContent } = require('./AIContent');
const { AIModel } = require('./AIModel');
const { PersonalityId } = require('../personality/PersonalityId');
const { UserId } = require('../personality/UserId');
const {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
} = require('./AIEvents');

/**
 * @class AIRequest
 * @extends AggregateRoot
 * @description Aggregate root for AI request/response lifecycle
 */
class AIRequest extends AggregateRoot {
  constructor(id) {
    if (!(id instanceof AIRequestId)) {
      throw new Error('AIRequest must be created with AIRequestId');
    }

    super(id.toString());

    this.requestId = id;
    this.userId = null;
    this.personalityId = null;
    this.content = null;
    this.referencedContent = null;
    this.model = null;
    this.response = null;
    this.status = 'pending';
    this.attempts = 0;
    this.error = null;
    this.createdAt = null;
    this.sentAt = null;
    this.completedAt = null;
  }

  /**
   * Create a new AI request
   * @static
   * @param {Object} params - Request parameters
   * @returns {AIRequest} New request
   */
  static create({
    userId,
    personalityId,
    content,
    referencedContent = null,
    model = AIModel.createDefault(),
  }) {
    if (!(userId instanceof UserId)) {
      throw new Error('Invalid UserId');
    }

    if (!(personalityId instanceof PersonalityId)) {
      throw new Error('Invalid PersonalityId');
    }

    if (!(content instanceof AIContent)) {
      throw new Error('Invalid AIContent');
    }

    if (!(model instanceof AIModel)) {
      throw new Error('Invalid AIModel');
    }

    // Validate content compatibility with model
    if (!model.isCompatibleWith(content)) {
      throw new Error('Content not compatible with model capabilities');
    }

    const request = new AIRequest(AIRequestId.create());

    request.applyEvent(
      new AIRequestCreated(request.id, {
        requestId: request.id,
        userId: userId.toString(),
        personalityId: personalityId.toString(),
        content: content.toJSON(),
        referencedContent: referencedContent ? referencedContent.toJSON() : null,
        model: model.toJSON(),
        createdAt: new Date().toISOString(),
      })
    );

    return request;
  }

  /**
   * Mark request as sent
   */
  markSent() {
    if (this.status !== 'pending' && this.status !== 'retrying') {
      throw new Error('Can only send pending or retrying requests');
    }

    this.applyEvent(
      new AIRequestSent(this.id, {
        sentAt: new Date().toISOString(),
        attempt: this.attempts + 1,
      })
    );
  }

  /**
   * Record successful response
   * @param {AIContent} responseContent - Response content
   */
  recordResponse(responseContent) {
    if (this.status !== 'sent') {
      throw new Error('Can only record response for sent requests');
    }

    if (!(responseContent instanceof AIContent)) {
      throw new Error('Invalid response content');
    }

    this.applyEvent(
      new AIResponseReceived(this.id, {
        response: responseContent.toJSON(),
        completedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Record request failure
   * @param {Error} error - Error that occurred
   * @param {boolean} canRetry - Whether request can be retried
   */
  recordFailure(error, canRetry = true) {
    if (this.status === 'completed' || this.status === 'failed') {
      throw new Error('Cannot fail completed or failed request');
    }

    this.applyEvent(
      new AIRequestFailed(this.id, {
        error: {
          message: error.message,
          code: error.code || 'UNKNOWN',
          canRetry,
        },
        failedAt: new Date().toISOString(),
      })
    );
  }

  /**
   * Mark request for retry
   * @param {number} delayMs - Delay before retry
   */
  scheduleRetry(delayMs) {
    if (this.status !== 'failed') {
      throw new Error('Can only retry failed requests');
    }

    if (this.attempts >= 3) {
      throw new Error('Maximum retry attempts exceeded');
    }

    this.applyEvent(
      new AIRequestRetried(this.id, {
        retryAt: new Date(Date.now() + delayMs).toISOString(),
        attempt: this.attempts,
      })
    );
  }

  /**
   * Record rate limit hit
   * @param {number} retryAfterMs - Time to wait before retry
   */
  recordRateLimit(retryAfterMs) {
    this.applyEvent(
      new AIRequestRateLimited(this.id, {
        rateLimitedAt: new Date().toISOString(),
        retryAfter: retryAfterMs,
      })
    );
  }

  /**
   * Check if request can be retried
   * @returns {boolean} True if can retry
   */
  canRetry() {
    return this.status === 'failed' && this.attempts < 3 && this.error?.canRetry !== false;
  }

  /**
   * Get response time in milliseconds
   * @returns {number|null} Response time or null
   */
  getResponseTime() {
    if (!this.sentAt || !this.completedAt) {
      return null;
    }

    return new Date(this.completedAt).getTime() - new Date(this.sentAt).getTime();
  }

  // Event handlers
  onAIRequestCreated(event) {
    this.requestId = AIRequestId.fromString(event.payload.requestId);
    this.userId = UserId.fromString(event.payload.userId);
    this.personalityId = PersonalityId.fromString(event.payload.personalityId);
    this.content = new AIContent(event.payload.content);
    this.referencedContent = event.payload.referencedContent
      ? new AIContent(event.payload.referencedContent)
      : null;
    this.model = new AIModel(
      event.payload.model.name,
      event.payload.model.path,
      event.payload.model.capabilities
    );
    this.status = 'pending';
    this.attempts = 0;
    this.createdAt = event.payload.createdAt;
  }

  onAIRequestSent(event) {
    this.status = 'sent';
    this.sentAt = event.payload.sentAt;
    this.attempts = event.payload.attempt;
  }

  onAIResponseReceived(event) {
    this.response = new AIContent(event.payload.response);
    this.status = 'completed';
    this.completedAt = event.payload.completedAt;
  }

  onAIRequestFailed(event) {
    this.status = 'failed';
    this.error = event.payload.error;
  }

  onAIRequestRetried(event) {
    this.status = 'retrying';
  }

  onAIRequestRateLimited(event) {
    this.status = 'rate_limited';
  }

  // Serialization
  toJSON() {
    return {
      id: this.id,
      requestId: this.requestId.toString(),
      userId: this.userId?.toString() || null,
      personalityId: this.personalityId?.toString() || null,
      content: this.content?.toJSON() || null,
      referencedContent: this.referencedContent?.toJSON() || null,
      model: this.model?.toJSON() || null,
      response: this.response?.toJSON() || null,
      status: this.status,
      attempts: this.attempts,
      error: this.error,
      createdAt: this.createdAt,
      sentAt: this.sentAt,
      completedAt: this.completedAt,
      version: this.version,
    };
  }
}

module.exports = { AIRequest };
