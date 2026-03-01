/**
 * Tests for shared mapSettingToApiUpdate utility
 */

import { describe, it, expect } from 'vitest';
import { mapSettingToApiUpdate } from './settingsUpdate.js';

describe('mapSettingToApiUpdate', () => {
  describe('maxMessages', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('maxMessages', 75)).toEqual({ maxMessages: 75 });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('maxMessages', null)).toEqual({ maxMessages: null });
    });
  });

  describe('maxAge', () => {
    it('should map numeric value (seconds)', () => {
      expect(mapSettingToApiUpdate('maxAge', 3600)).toEqual({ maxAge: 3600 });
    });

    it('should map null (auto) to null', () => {
      expect(mapSettingToApiUpdate('maxAge', null)).toEqual({ maxAge: null });
    });

    it('should map -1 (off) to null', () => {
      expect(mapSettingToApiUpdate('maxAge', -1)).toEqual({ maxAge: null });
    });
  });

  describe('maxImages', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('maxImages', 5)).toEqual({ maxImages: 5 });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('maxImages', null)).toEqual({ maxImages: null });
    });
  });

  describe('crossChannelHistoryEnabled', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('crossChannelHistoryEnabled', true)).toEqual({
        crossChannelHistoryEnabled: true,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('crossChannelHistoryEnabled', null)).toEqual({
        crossChannelHistoryEnabled: null,
      });
    });
  });

  describe('shareLtmAcrossPersonalities', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('shareLtmAcrossPersonalities', false)).toEqual({
        shareLtmAcrossPersonalities: false,
      });
    });
  });

  describe('focusModeEnabled', () => {
    it('should map boolean value', () => {
      expect(mapSettingToApiUpdate('focusModeEnabled', true)).toEqual({
        focusModeEnabled: true,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('focusModeEnabled', null)).toEqual({
        focusModeEnabled: null,
      });
    });
  });

  describe('memoryScoreThreshold', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('memoryScoreThreshold', 0.7)).toEqual({
        memoryScoreThreshold: 0.7,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('memoryScoreThreshold', null)).toEqual({
        memoryScoreThreshold: null,
      });
    });
  });

  describe('memoryLimit', () => {
    it('should map numeric value', () => {
      expect(mapSettingToApiUpdate('memoryLimit', 50)).toEqual({
        memoryLimit: 50,
      });
    });

    it('should map null (auto/clear)', () => {
      expect(mapSettingToApiUpdate('memoryLimit', null)).toEqual({
        memoryLimit: null,
      });
    });
  });

  describe('unknown setting', () => {
    it('should return null for unrecognized setting ID', () => {
      expect(mapSettingToApiUpdate('unknownSetting', 42)).toBeNull();
    });
  });
});
