/**
 * Centralized alias resolution utility
 * Provides consistent alias-to-personality resolution across the application
 */
const logger = require('../logger');
const { getApplicationBootstrap } = require('../application/bootstrap/ApplicationBootstrap');

/**
 * Resolve a personality by name or alias
 * @param {string} nameOrAlias - The personality name or alias to resolve
 * @returns {Promise<Object|null>} The resolved personality object or null
 */
async function resolvePersonality(nameOrAlias) {
  if (!nameOrAlias || typeof nameOrAlias !== 'string') {
    return null;
  }

  const trimmedInput = nameOrAlias.trim();
  if (!trimmedInput) {
    return null;
  }

  logger.debug(`[AliasResolver] Resolving personality for: "${trimmedInput}"`);

  // Use the DDD personality router
  const bootstrap = getApplicationBootstrap();
  const router = bootstrap.getPersonalityRouter();
  const personality = await router.getPersonality(trimmedInput);

  if (personality) {
    logger.debug(
      `[AliasResolver] Found personality: ${personality.profile?.name || personality.name}`
    );
  }

  return personality;
}

/**
 * Resolve multiple personalities from a list of names/aliases
 * @param {string[]} namesOrAliases - Array of names or aliases to resolve
 * @returns {Promise<Object[]>} Array of resolved personalities (excludes nulls)
 */
async function resolveMultiplePersonalities(namesOrAliases) {
  if (!Array.isArray(namesOrAliases)) {
    return [];
  }

  const results = await Promise.all(
    namesOrAliases.map(nameOrAlias => resolvePersonality(nameOrAlias))
  );

  // Filter out null results
  return results.filter(personality => personality !== null);
}

/**
 * Check if a name or alias exists
 * @param {string} nameOrAlias - The name or alias to check
 * @returns {Promise<boolean>} True if the personality exists
 */
async function personalityExists(nameOrAlias) {
  const personality = await resolvePersonality(nameOrAlias);
  return personality !== null;
}

/**
 * Get the full name of a personality from a name or alias
 * @param {string} nameOrAlias - The name or alias
 * @returns {Promise<string|null>} The full name or null if not found
 */
async function getFullName(nameOrAlias) {
  const personality = await resolvePersonality(nameOrAlias);
  return personality ? personality.profile?.name || personality.name : null;
}

/**
 * Get all aliases for a personality
 * @param {string} personalityName - The personality name
 * @returns {Promise<string[]>} Array of aliases
 */
async function getAliases(personalityName) {
  const personality = await resolvePersonality(personalityName);
  if (!personality) {
    return [];
  }

  // Return aliases array if it exists, otherwise empty array
  return personality.aliases || [];
}

module.exports = {
  resolvePersonality,
  resolveMultiplePersonalities,
  personalityExists,
  getFullName,
  getAliases,
};
