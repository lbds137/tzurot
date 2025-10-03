/**
 * Authentication domain events
 * @module domain/authentication/AuthenticationEvents
 */

const { DomainEvent } = require('../shared/DomainEvent');

/**
 * @class UserAuthenticated
 * @extends DomainEvent
 * @description Event when user successfully authenticates
 */
class UserAuthenticated extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.userId || !payload.token || !payload.authenticatedAt) {
      throw new Error('UserAuthenticated requires userId, token, and authenticatedAt');
    }
  }
}

/**
 * @class UserTokenExpired
 * @extends DomainEvent
 * @description Event when user token expires
 */
class UserTokenExpired extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.expiredAt) {
      throw new Error('UserTokenExpired requires expiredAt');
    }
  }
}

/**
 * @class UserTokenRefreshed
 * @extends DomainEvent
 * @description Event when user token is refreshed
 */
class UserTokenRefreshed extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.newToken || !payload.refreshedAt) {
      throw new Error('UserTokenRefreshed requires newToken and refreshedAt');
    }
  }
}

/**
 * @class UserNsfwVerified
 * @extends DomainEvent
 * @description Event when user completes NSFW verification
 */
class UserNsfwVerified extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.verifiedAt) {
      throw new Error('UserNsfwVerified requires verifiedAt');
    }
  }
}

/**
 * @class UserNsfwVerificationCleared
 * @extends DomainEvent
 * @description Event when NSFW verification is cleared
 */
class UserNsfwVerificationCleared extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.reason || !payload.clearedAt) {
      throw new Error('UserNsfwVerificationCleared requires reason and clearedAt');
    }
  }
}


/**
 * @class AuthenticationDenied
 * @extends DomainEvent
 * @description Event when authentication is denied
 */
class AuthenticationDenied extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.reason || !payload.context || !payload.deniedAt) {
      throw new Error('AuthenticationDenied requires reason, context, and deniedAt');
    }
  }
}

/**
 * @class ProxyAuthenticationAttempted
 * @extends DomainEvent
 * @description Event when proxy authentication is attempted in DM
 */
class ProxyAuthenticationAttempted extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.userId || !payload.attemptedAt) {
      throw new Error('ProxyAuthenticationAttempted requires userId and attemptedAt');
    }
  }
}

module.exports = {
  UserAuthenticated,
  UserTokenExpired,
  UserTokenRefreshed,
  UserNsfwVerified,
  UserNsfwVerificationCleared,
  AuthenticationDenied,
  ProxyAuthenticationAttempted,
};
