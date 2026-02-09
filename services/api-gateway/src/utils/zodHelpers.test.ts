/**
 * Zod Validation Helpers Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { formatZodError, sendZodError } from './zodHelpers.js';

describe('zodHelpers', () => {
  describe('formatZodError', () => {
    it('should format error with field path prefix', () => {
      const schema = z.object({ name: z.string().min(1) });
      const result = schema.safeParse({ name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatZodError(result.error);
        expect(message).toMatch(/^name: /);
      }
    });

    it('should format error without field path for root-level schemas', () => {
      const schema = z.string().uuid('bad uuid');
      const result = schema.safeParse('not-a-uuid');
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatZodError(result.error);
        expect(message).toBe('bad uuid');
      }
    });

    it('should format nested field path with dots', () => {
      const schema = z.object({
        config: z.object({ maxMessages: z.number().min(1) }),
      });
      const result = schema.safeParse({ config: { maxMessages: 0 } });
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatZodError(result.error);
        expect(message).toMatch(/^config\.maxMessages: /);
      }
    });

    it('should use first issue when multiple errors exist', () => {
      const schema = z.object({
        a: z.string(),
        b: z.string(),
      });
      const result = schema.safeParse({ a: 123, b: 456 });
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatZodError(result.error);
        expect(message).toMatch(/^a: /);
      }
    });
  });

  describe('sendZodError', () => {
    let mockRes: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };

    beforeEach(() => {
      mockRes = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };
    });

    it('should send 400 validation error response', () => {
      const schema = z.object({ name: z.string().min(1) });
      const result = schema.safeParse({ name: '' });
      expect(result.success).toBe(false);
      if (!result.success) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Mock Express response for testing
        sendZodError(mockRes as any, result.error);
        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
          expect.objectContaining({
            error: 'VALIDATION_ERROR',
            message: expect.stringMatching(/^name: /),
          })
        );
      }
    });
  });
});
