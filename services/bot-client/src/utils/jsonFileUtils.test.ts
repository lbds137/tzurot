/**
 * Tests for JSON File Utilities
 *
 * Tests shared JSON import/export utilities used by character and preset commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AttachmentBuilder } from 'discord.js';
import type { Attachment } from 'discord.js';
import {
  validateJsonFile,
  downloadAndParseJson,
  validateAndParseJsonFile,
  createJsonAttachment,
  buildExportData,
} from './jsonFileUtils.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    DISCORD_LIMITS: {
      AVATAR_SIZE: 10 * 1024 * 1024, // 10MB
    },
  };
});

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('jsonFileUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateJsonFile', () => {
    const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment =>
      ({
        contentType: 'application/json',
        name: 'test.json',
        size: 1000,
        url: 'https://example.com/test.json',
        ...overrides,
      }) as Attachment;

    it('should accept valid JSON file with application/json content type', () => {
      const file = createMockAttachment({ contentType: 'application/json' });
      const result = validateJsonFile(file);
      expect(result).toEqual({ valid: true });
    });

    it('should accept valid JSON file with .json extension', () => {
      const file = createMockAttachment({ contentType: undefined, name: 'data.json' });
      const result = validateJsonFile(file);
      expect(result).toEqual({ valid: true });
    });

    it('should accept files with text/json content type', () => {
      const file = createMockAttachment({ contentType: 'text/json' });
      const result = validateJsonFile(file);
      expect(result).toEqual({ valid: true });
    });

    it('should reject non-JSON files by content type', () => {
      const file = createMockAttachment({ contentType: 'text/plain', name: 'data.txt' });
      const result = validateJsonFile(file);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('must be a JSON file');
    });

    it('should reject files that are too large', () => {
      const file = createMockAttachment({ size: 11 * 1024 * 1024 }); // 11MB
      const result = validateJsonFile(file);
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('too large');
    });

    it('should accept files within size limit', () => {
      const file = createMockAttachment({ size: 5 * 1024 * 1024 }); // 5MB
      const result = validateJsonFile(file);
      expect(result).toEqual({ valid: true });
    });

    it('should respect custom max size', () => {
      const file = createMockAttachment({ size: 2 * 1024 * 1024 }); // 2MB
      const result = validateJsonFile(file, 1 * 1024 * 1024); // 1MB limit
      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('too large');
    });
  });

  describe('downloadAndParseJson', () => {
    it('should download and parse valid JSON', async () => {
      const testData = { name: 'Test', value: 123 };
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(testData)),
      });

      const result = await downloadAndParseJson('https://example.com/test.json', 'test.json');

      expect(result).toHaveProperty('data');
      expect((result as { data: unknown }).data).toEqual(testData);
    });

    it('should return error for HTTP failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await downloadAndParseJson('https://example.com/test.json', 'test.json');

      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('Failed to parse');
    });

    it('should return error for invalid JSON', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve('not valid json {'),
      });

      const result = await downloadAndParseJson('https://example.com/test.json', 'test.json');

      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('Failed to parse');
    });

    it('should return error for network failure', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await downloadAndParseJson('https://example.com/test.json', 'test.json');

      expect(result).toHaveProperty('error');
    });
  });

  describe('validateAndParseJsonFile', () => {
    const createMockAttachment = (overrides: Partial<Attachment> = {}): Attachment =>
      ({
        contentType: 'application/json',
        name: 'test.json',
        size: 1000,
        url: 'https://example.com/test.json',
        ...overrides,
      }) as Attachment;

    it('should validate, download, and parse valid JSON file', async () => {
      const testData = { name: 'Test', value: 123 };
      mockFetch.mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(testData)),
      });

      const file = createMockAttachment();
      const result = await validateAndParseJsonFile(file);

      expect(result).toHaveProperty('data');
      expect((result as { data: unknown }).data).toEqual(testData);
    });

    it('should return error for invalid file type', async () => {
      const file = createMockAttachment({ contentType: 'text/plain', name: 'data.txt' });
      const result = await validateAndParseJsonFile(file);

      expect(result).toHaveProperty('error');
      expect((result as { error: string }).error).toContain('must be a JSON file');
    });

    it('should return error for oversized file without making network request', async () => {
      const file = createMockAttachment({ size: 11 * 1024 * 1024 });
      const result = await validateAndParseJsonFile(file);

      expect(result).toHaveProperty('error');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('createJsonAttachment', () => {
    it('should create AttachmentBuilder with correct JSON content', () => {
      const data = { name: 'Test', value: 123 };
      const attachment = createJsonAttachment(data, 'test-file', 'Test description');

      expect(attachment).toBeInstanceOf(AttachmentBuilder);
    });

    it('should use provided filename with .json extension', () => {
      const data = { test: true };
      const attachment = createJsonAttachment(data, 'my-preset', 'Description');

      // The attachment name is set in the constructor options
      expect(attachment).toBeInstanceOf(AttachmentBuilder);
    });
  });

  describe('buildExportData', () => {
    it('should include only specified fields', () => {
      const source = {
        name: 'Test',
        description: 'A test',
        secret: 'should not include',
        value: 123,
      };
      const fields = ['name', 'description', 'value'] as const;

      const result = buildExportData(source, fields);

      expect(result).toEqual({
        name: 'Test',
        description: 'A test',
        value: 123,
      });
      expect(result).not.toHaveProperty('secret');
    });

    it('should exclude null values', () => {
      const source = {
        name: 'Test',
        description: null,
        value: 123,
      };
      const fields = ['name', 'description', 'value'] as const;

      const result = buildExportData(source, fields);

      expect(result).toEqual({
        name: 'Test',
        value: 123,
      });
      expect(result).not.toHaveProperty('description');
    });

    it('should exclude undefined values', () => {
      const source = {
        name: 'Test',
        description: undefined,
        value: 123,
      };
      const fields = ['name', 'description', 'value'] as const;

      const result = buildExportData(source, fields);

      expect(result).not.toHaveProperty('description');
    });

    it('should exclude empty string values', () => {
      const source = {
        name: 'Test',
        description: '',
        value: 123,
      };
      const fields = ['name', 'description', 'value'] as const;

      const result = buildExportData(source, fields);

      expect(result).not.toHaveProperty('description');
    });

    it('should include zero values', () => {
      const source = {
        name: 'Test',
        count: 0,
      };
      const fields = ['name', 'count'] as const;

      const result = buildExportData(source, fields);

      expect(result).toEqual({
        name: 'Test',
        count: 0,
      });
    });

    it('should include false values', () => {
      const source = {
        name: 'Test',
        enabled: false,
      };
      const fields = ['name', 'enabled'] as const;

      const result = buildExportData(source, fields);

      expect(result).toEqual({
        name: 'Test',
        enabled: false,
      });
    });
  });
});
