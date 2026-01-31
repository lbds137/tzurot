/**
 * Content Similarity Utilities
 *
 * This module provides utilities for comparing message content similarity,
 * particularly useful for detecting duplicate messages from proxy systems.
 */

const logger = require('../logger');

/**
 * Calculate the similarity between two strings using Levenshtein distance
 * Normalized to a value between 0 (completely different) and 1 (identical)
 *
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @returns {number} - Similarity score between 0 and 1
 */
function calculateSimilarity(str1, str2) {
  if (!str1 || !str2) return 0;
  if (typeof str1 !== 'string' || typeof str2 !== 'string') return 0;

  // If strings are identical, return 1 immediately
  if (str1 === str2) return 1;

  // Normalize strings to lowercase and trim whitespace
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  // If either string is empty after normalization, return 0
  if (s1.length === 0 || s2.length === 0) return 0;

  // For very short strings, use a simpler comparison
  if (s1.length < 5 || s2.length < 5) {
    return s1.includes(s2) || s2.includes(s1) ? 0.9 : 0;
  }

  // Calculate Levenshtein distance (dynamic programming approach)
  const len1 = s1.length;
  const len2 = s2.length;

  // Initialize distance matrix
  const matrix = Array(len1 + 1)
    .fill()
    .map(() => Array(len2 + 1).fill(0));

  // Fill the first row and column
  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  // Fill the rest of the matrix
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1.charAt(i - 1) === s2.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1, // deletion
        matrix[i][j - 1] + 1, // insertion
        matrix[i - 1][j - 1] + cost // substitution
      );
    }
  }

  // Get the Levenshtein distance
  const distance = matrix[len1][len2];

  // Calculate similarity score (1 - normalized distance)
  // Use the maximum length for normalization
  const maxLen = Math.max(len1, len2);
  const similarity = 1 - distance / maxLen;

  return similarity;
}

/**
 * Check if two message contents are similar enough to be considered duplicates
 *
 * @param {string} content1 - Content of first message
 * @param {string} content2 - Content of second message
 * @param {number} [threshold=0.8] - Similarity threshold (0-1)
 * @returns {boolean} - True if messages are similar enough to be considered duplicates
 */
function areContentsSimilar(content1, content2, threshold = 0.8) {
  const similarity = calculateSimilarity(content1, content2);
  logger.debug(
    `[ContentSimilarity] Similarity score: ${similarity.toFixed(2)} (threshold: ${threshold})`
  );
  return similarity >= threshold;
}

/**
 * Get a reasonable delay time for waiting for potential proxy messages
 *
 * @returns {number} - Delay in milliseconds
 */
function getProxyDelayTime() {
  // Proxy systems typically take 1-2 seconds to delete and proxy a message
  // We use a slightly longer delay to be safe
  return 2500; // 2.5 seconds
}

module.exports = {
  calculateSimilarity,
  areContentsSimilar,
  getProxyDelayTime,
};
