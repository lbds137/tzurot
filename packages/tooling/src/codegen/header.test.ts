/**
 * Trivial test — header.ts is one string constant. Asserts the contract
 * the codegen pre-commit hook relies on: the AUTO-GENERATED marker is in
 * the first 200 characters so the temporal-marker scan in
 * .husky/pre-commit can short-circuit on it.
 */

import { describe, it, expect } from 'vitest';
import { AUTOGEN_HEADER } from './header.js';

describe('AUTOGEN_HEADER', () => {
  it('contains the AUTO-GENERATED marker', () => {
    expect(AUTOGEN_HEADER).toContain('AUTO-GENERATED FILE');
  });

  it('keeps the marker within the first 200 chars (pre-commit hook skip window)', () => {
    const idx = AUTOGEN_HEADER.indexOf('AUTO-GENERATED FILE');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(200);
  });

  it('mentions the regen command', () => {
    expect(AUTOGEN_HEADER).toContain('pnpm ops codegen:routes');
  });

  it('starts with a JS block comment so it parses inside any TS file', () => {
    expect(AUTOGEN_HEADER.startsWith('/*')).toBe(true);
  });
});
