/**
 * Personality domain module
 * @module domain/personality
 */

const { Personality } = require('./Personality');
const { PersonalityId } = require('./PersonalityId');
const { PersonalityProfile } = require('./PersonalityProfile');
const { PersonalityConfiguration } = require('./PersonalityConfiguration');
const { PersonalityRepository } = require('./PersonalityRepository');
const { UserId } = require('./UserId');
const { Alias } = require('./Alias');
const {
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
} = require('./PersonalityEvents');

module.exports = {
  // Aggregate
  Personality,

  // Value Objects
  PersonalityId,
  PersonalityProfile,
  PersonalityConfiguration,
  UserId,
  Alias,

  // Repository
  PersonalityRepository,

  // Events
  PersonalityCreated,
  PersonalityProfileUpdated,
  PersonalityRemoved,
  PersonalityAliasAdded,
  PersonalityAliasRemoved,
};
