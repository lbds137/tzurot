/**
 * Personality repository interface
 * @module domain/personality/PersonalityRepository
 */

/**
 * @interface PersonalityRepository
 * @description Repository interface for personality persistence
 */
class PersonalityRepository {
  /**
   * Save a personality aggregate
   * @param {Personality} personality - Personality to save
   * @returns {Promise<void>}
   */
  async save(_personality) {
    throw new Error('PersonalityRepository.save() must be implemented');
  }

  /**
   * Find personality by ID
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<Personality|null>} Personality or null if not found
   */
  async findById(_personalityId) {
    throw new Error('PersonalityRepository.findById() must be implemented');
  }

  /**
   * Find all personalities owned by a user
   * @param {UserId} ownerId - Owner's user ID
   * @returns {Promise<Personality[]>} Array of personalities
   */
  async findByOwner(_ownerId) {
    throw new Error('PersonalityRepository.findByOwner() must be implemented');
  }

  /**
   * Find all personalities
   * @returns {Promise<Personality[]>} Array of all personalities
   */
  async findAll() {
    throw new Error('PersonalityRepository.findAll() must be implemented');
  }

  /**
   * Check if personality exists
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<boolean>} True if exists
   */
  async exists(_personalityId) {
    throw new Error('PersonalityRepository.exists() must be implemented');
  }

  /**
   * Delete a personality
   * @param {PersonalityId} personalityId - Personality ID
   * @returns {Promise<void>}
   */
  async delete(_personalityId) {
    throw new Error('PersonalityRepository.delete() must be implemented');
  }

  /**
   * Get next available ID (for event sourcing)
   * @returns {Promise<string>} Next ID
   */
  async nextId() {
    throw new Error('PersonalityRepository.nextId() must be implemented');
  }

  /**
   * Find personality by name or alias
   * @param {string} nameOrAlias - Name or alias to search for
   * @returns {Promise<Personality|null>} Personality or null if not found
   */
  async findByNameOrAlias(_nameOrAlias) {
    throw new Error('PersonalityRepository.findByNameOrAlias() must be implemented');
  }
}

module.exports = { PersonalityRepository };
