/**
 * Main Adapter exports
 * @module adapters
 *
 * This module exports all adapter implementations organized by type.
 * Adapters implement the Anti-Corruption Layer pattern, translating
 * between our domain model and external systems.
 */

const ai = require('./ai');
const discord = require('./discord');
const persistence = require('./persistence');

module.exports = {
  ai,
  discord,
  persistence,
  // Convenience exports for direct access
  ...ai,
  ...discord,
  ...persistence,
};
