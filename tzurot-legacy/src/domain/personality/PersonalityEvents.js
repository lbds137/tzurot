/**
 * Personality domain events
 * @module domain/personality/PersonalityEvents
 */

const { DomainEvent } = require('../shared/DomainEvent');

/**
 * @class PersonalityCreated
 * @extends DomainEvent
 * @description Event emitted when a new personality is created
 */
class PersonalityCreated extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.personalityId || !payload.ownerId || !payload.createdAt) {
      throw new Error('PersonalityCreated requires personalityId, ownerId, and createdAt');
    }
  }
}

/**
 * @class PersonalityProfileUpdated
 * @extends DomainEvent
 * @description Event emitted when personality profile is updated
 */
class PersonalityProfileUpdated extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    // Require updatedAt and at least one of: profile, configuration, or model
    if (!payload.updatedAt) {
      throw new Error('PersonalityProfileUpdated requires updatedAt');
    }

    if (!payload.profile && !payload.configuration && !payload.model) {
      throw new Error(
        'PersonalityProfileUpdated requires at least one of: profile, configuration, or model'
      );
    }
  }
}

/**
 * @class PersonalityRemoved
 * @extends DomainEvent
 * @description Event emitted when a personality is removed
 */
class PersonalityRemoved extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.removedBy || !payload.removedAt) {
      throw new Error('PersonalityRemoved requires removedBy and removedAt');
    }
  }
}

/**
 * @class PersonalityAliasAdded
 * @extends DomainEvent
 * @description Event emitted when an alias is added to a personality
 */
class PersonalityAliasAdded extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.alias || !payload.addedBy || !payload.addedAt) {
      throw new Error('PersonalityAliasAdded requires alias, addedBy, and addedAt');
    }
  }
}

/**
 * @class PersonalityAliasRemoved
 * @extends DomainEvent
 * @description Event emitted when an alias is removed from a personality
 */
class PersonalityAliasRemoved extends DomainEvent {
  constructor(aggregateId, payload) {
    super(aggregateId, payload);

    if (!payload.alias || !payload.removedBy || !payload.removedAt) {
      throw new Error('PersonalityAliasRemoved requires alias, removedBy, and removedAt');
    }
  }
}

module.exports = {
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
};
