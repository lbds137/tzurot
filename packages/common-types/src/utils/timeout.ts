/**
 * Timeout calculation utilities
 */

import { TIMEOUTS } from '../config/constants.js';

/**
 * Calculate job timeout based on image count
 *
 * Images take longer to process (vision model calls), so we scale the timeout
 * based on the number of images in the request.
 *
 * @param imageCount - Number of images in the request
 * @returns Timeout in milliseconds
 */
export function calculateJobTimeout(imageCount: number): number {
  // Base timeout: 2 minutes, scale by image count (minimum 1x)
  // Cap at 4.5 minutes to stay under Railway's 5-minute limit with buffer
  return Math.min(TIMEOUTS.JOB_WAIT, TIMEOUTS.JOB_BASE * Math.max(1, imageCount));
}
