/**
 * Tests for HardcodedConstraints
 */

import { describe, it, expect } from 'vitest';
import {
  PLATFORM_CONSTRAINTS,
  OUTPUT_CONSTRAINTS,
  buildIdentityConstraints,
} from './HardcodedConstraints.js';

describe('HardcodedConstraints', () => {
  describe('PLATFORM_CONSTRAINTS', () => {
    it('should be wrapped in platform_constraints tags', () => {
      expect(PLATFORM_CONSTRAINTS).toContain('<platform_constraints>');
      expect(PLATFORM_CONSTRAINTS).toContain('</platform_constraints>');
    });

    it('should include CSAM prohibition', () => {
      expect(PLATFORM_CONSTRAINTS).toContain('No sexual content explicitly depicting minors');
    });

    it('should include WMD prohibition', () => {
      expect(PLATFORM_CONSTRAINTS).toContain('mass-casualty weapons');
    });

    it('should include malware prohibition', () => {
      expect(PLATFORM_CONSTRAINTS).toContain('No functional malware');
    });

    it('should include doxxing prohibition', () => {
      expect(PLATFORM_CONSTRAINTS).toContain('No real-person doxxing');
    });
  });

  describe('OUTPUT_CONSTRAINTS', () => {
    it('should be wrapped in output_constraints tags', () => {
      expect(OUTPUT_CONSTRAINTS).toContain('<output_constraints>');
      expect(OUTPUT_CONSTRAINTS).toContain('</output_constraints>');
    });

    it('should prohibit name labels in output', () => {
      expect(OUTPUT_CONSTRAINTS).toContain('do not include name labels');
    });

    it('should prohibit XML tags in output', () => {
      expect(OUTPUT_CONSTRAINTS).toContain('Never output XML tags');
    });

    it('should prohibit parroting', () => {
      expect(OUTPUT_CONSTRAINTS).toContain('Never repeat or parrot back');
    });
  });

  describe('buildIdentityConstraints', () => {
    it('should be wrapped in identity_constraints tags', () => {
      const result = buildIdentityConstraints('TestBot');
      expect(result).toContain('<identity_constraints>');
      expect(result).toContain('</identity_constraints>');
    });

    it('should include personality name in agency constraint', () => {
      const result = buildIdentityConstraints('Nyx');
      expect(result).toContain('Limit agency strictly to Nyx');
    });

    it('should include single turn constraint', () => {
      const result = buildIdentityConstraints('TestBot');
      expect(result).toContain('Generate only a single turn of dialogue');
    });

    it('should include impersonation prohibition', () => {
      const result = buildIdentityConstraints('TestBot');
      expect(result).toContain('Never impersonate, speak for, or predict');
    });

    it('should not include collision info when not provided', () => {
      const result = buildIdentityConstraints('TestBot');
      expect(result).not.toContain('shares your name');
    });

    it('should include collision info when user shares AI name', () => {
      const result = buildIdentityConstraints('Nyx', {
        userName: 'Nyx',
        discordUsername: 'nyx_user',
      });

      expect(result).toContain('A user named "Nyx" shares your name');
      expect(result).toContain('Nyx (@nyx_user)');
      expect(result).toContain('This is a different person');
    });
  });
});
