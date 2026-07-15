/**
 * Tests for the user feedback sub-manifest — file-local invariants.
 */

import { describe, it, expect } from 'vitest';
import { userFeedbackRoutes } from './feedback.js';
import type { AnyRouteDef } from '../types.js';

describe('user feedback routes', () => {
  const route: AnyRouteDef = userFeedbackRoutes.submitFeedback;

  it('submitFeedback is a provisioned user POST on /feedback', () => {
    expect(route.method).toBe('post');
    expect(route.path).toBe('/feedback');
    expect(route.requiresProvisionedUser).toBe(true);
  });

  it('does NOT declare atMostOnce — sequential retries are absorbed by the dedupe gate', () => {
    expect(route.meta?.atMostOnce).toBeUndefined();
  });
});
