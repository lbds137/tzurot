import { describe, it, expect } from 'vitest';
import { incognitoFields } from './incognitoFields.js';

describe('incognitoFields', () => {
  it('is empty when the result reports no incognito state', () => {
    expect(incognitoFields(undefined)).toEqual({});
    expect(incognitoFields({})).toEqual({});
  });

  it('carries the kind beside incognito: true', () => {
    expect(incognitoFields({ incognitoModeActive: true, incognitoKind: 'session' })).toEqual({
      incognito: true,
      incognitoKind: 'session',
    });
  });

  it('omits the kind when not incognito or when none was reported', () => {
    expect(incognitoFields({ incognitoModeActive: false, incognitoKind: 'session' })).toEqual({
      incognito: false,
    });
    expect(incognitoFields({ incognitoModeActive: true })).toEqual({ incognito: true });
  });
});
