/**
 * AI domain events
 * @module domain/ai/AIEvents
 */

const { DomainEvent } = require('../shared/DomainEvent');

/**
 * @class AIRequestCreated
 * @extends DomainEvent
 * @description Event when AI request is created
 */
class AIRequestCreated extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (
      !payload.requestId ||
      !payload.userId ||
      !payload.personalityId ||
      !payload.content ||
      !payload.model ||
      !payload.createdAt
    ) {
      throw new Error('AIRequestCreated requires complete request data');
    }
  }
}

/**
 * @class AIRequestSent
 * @extends DomainEvent
 * @description Event when request is sent to AI service
 */
class AIRequestSent extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.sentAt || !payload.attempt) {
      throw new Error('AIRequestSent requires sentAt and attempt');
    }
  }
}

/**
 * @class AIResponseReceived
 * @extends DomainEvent
 * @description Event when response is received from AI
 */
class AIResponseReceived extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.response || !payload.completedAt) {
      throw new Error('AIResponseReceived requires response and completedAt');
    }
  }
}

/**
 * @class AIRequestFailed
 * @extends DomainEvent
 * @description Event when AI request fails
 */
class AIRequestFailed extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.error || !payload.failedAt) {
      throw new Error('AIRequestFailed requires error and failedAt');
    }
  }
}

/**
 * @class AIRequestRetried
 * @extends DomainEvent
 * @description Event when request is scheduled for retry
 */
class AIRequestRetried extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.retryAt || payload.attempt === undefined) {
      throw new Error('AIRequestRetried requires retryAt and attempt');
    }
  }
}

/**
 * @class AIRequestRateLimited
 * @extends DomainEvent
 * @description Event when request hits rate limit
 */
class AIRequestRateLimited extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.rateLimitedAt || payload.retryAfter === undefined) {
      throw new Error('AIRequestRateLimited requires rateLimitedAt and retryAfter');
    }
  }
}

/**
 * @class AIContentSanitized
 * @extends DomainEvent
 * @description Event when AI response content is sanitized
 */
class AIContentSanitized extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.originalLength || !payload.sanitizedLength || !payload.sanitizedAt) {
      throw new Error('AIContentSanitized requires length data and sanitizedAt');
    }
  }
}

/**
 * @class AIErrorDetected
 * @extends DomainEvent
 * @description Event when error pattern detected in AI response
 */
class AIErrorDetected extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.errorType || !payload.detectedAt) {
      throw new Error('AIErrorDetected requires errorType and detectedAt');
    }
  }
}

module.exports = {
  AIRequestCreated,
  AIRequestSent,
  AIResponseReceived,
  AIRequestFailed,
  AIRequestRetried,
  AIRequestRateLimited,
  AIContentSanitized,
  AIErrorDetected,
};
