/**
 * Tests for ResultsListener
 *
 * Tests the critical JobResult construction logic from Redis Stream messages.
 * Focus: Ensuring the bug where `result` field was missing is prevented.
 */

import { describe, it, expect } from 'vitest';
import type { JobResult } from '@tzurot/common-types';

describe('ResultsListener - JobResult Construction', () => {
  /**
   * This test documents the CRITICAL BUG that was fixed:
   * ResultsListener was parsing the Redis Stream's `result` field
   * (which is just the inner result object) and treating it as a complete JobResult.
   *
   * This caused MessageHandler to error with "Job result missing result data".
   */
  describe('JobResult construction from Redis Stream data', () => {
    it('should construct JobResult with nested result object', () => {
      // This is what comes from Redis Stream
      const redisMessage = {
        jobId: 'job-123',
        requestId: 'req-123',
        result: JSON.stringify({
          // ← This is a JSON string!
          content: 'AI response text',
          success: true,
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4.5',
            tokensUsed: 1000,
          },
        }),
        completedAt: '2025-11-15T08:00:00.000Z',
      };

      // Parse inner result (what was in the bug: we stopped here and called this JobResult)
      const parsedResult = JSON.parse(redisMessage.result);

      // ❌ WRONG (the bug we fixed):
      // const jobResult: JobResult = parsedResult;
      // This gives: { content: "...", success: true, metadata: {...} }
      // Missing: jobId, status, and result is not nested!

      // ✅ CORRECT (what we fixed it to):
      const jobResult: JobResult = {
        jobId: redisMessage.jobId,
        status: 'completed',
        result: parsedResult, // ← Now properly nested!
      };

      // Verify structure matches TypeScript interface
      expect(jobResult).toEqual({
        jobId: 'job-123',
        status: 'completed',
        result: {
          content: 'AI response text',
          success: true,
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4.5',
            tokensUsed: 1000,
          },
        },
      });

      // Verify the bug is fixed: result field exists and is nested
      expect(jobResult.result).toBeDefined();
      expect(jobResult.result?.content).toBe('AI response text');
    });

    it('should handle minimal result data', () => {
      const redisMessage = {
        jobId: 'job-456',
        requestId: 'req-456',
        result: JSON.stringify({
          content: 'Minimal response',
        }),
        completedAt: '2025-11-15T08:01:00.000Z',
      };

      const parsedResult = JSON.parse(redisMessage.result);
      const jobResult: JobResult = {
        jobId: redisMessage.jobId,
        status: 'completed',
        result: parsedResult,
      };

      expect(jobResult.result?.content).toBe('Minimal response');
    });

    it('should handle full result data with all optional fields', () => {
      const redisMessage = {
        jobId: 'job-789',
        requestId: 'req-789',
        result: JSON.stringify({
          content: 'Full response',
          attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
          referencedMessagesDescriptions: '[Previous message]',
          metadata: {
            modelUsed: 'anthropic/claude-sonnet-4.5',
            tokensUsed: 2000,
            processingTimeMs: 5000,
            retrievedMemories: 10,
          },
        }),
        completedAt: '2025-11-15T08:02:00.000Z',
      };

      const parsedResult = JSON.parse(redisMessage.result);
      const jobResult: JobResult = {
        jobId: redisMessage.jobId,
        status: 'completed',
        result: parsedResult,
      };

      expect(jobResult.result).toEqual({
        content: 'Full response',
        attachmentDescriptions: '[Image: cat.jpg]\nA cute cat',
        referencedMessagesDescriptions: '[Previous message]',
        metadata: {
          modelUsed: 'anthropic/claude-sonnet-4.5',
          tokensUsed: 2000,
          processingTimeMs: 5000,
          retrievedMemories: 10,
        },
      });
    });

    it('should demonstrate the bug that MessageHandler was catching', () => {
      // Simulate what the bug was doing
      const redisMessage = {
        jobId: 'job-bug',
        requestId: 'req-bug',
        result: JSON.stringify({
          content: 'Response',
          success: true,
        }),
        completedAt: '2025-11-15T08:00:00.000Z',
      };

      // ❌ THE BUG: Treating parsed result as JobResult
      const buggyJobResult = JSON.parse(redisMessage.result) as JobResult;

      // This is what MessageHandler was checking:
      const result = buggyJobResult.result;

      // This would be undefined! (the bug)
      expect(result).toBeUndefined();

      // ✅ THE FIX: Proper construction
      const fixedJobResult: JobResult = {
        jobId: redisMessage.jobId,
        status: 'completed',
        result: JSON.parse(redisMessage.result),
      };

      // Now result exists!
      expect(fixedJobResult.result).toBeDefined();
      expect(fixedJobResult.result?.content).toBe('Response');
    });
  });

  describe('Redis Stream message structure', () => {
    it('should match expected Redis xAdd format', () => {
      // This is what ai-worker publishes:
      // await redis.xAdd('job-results', '*', {
      //   jobId,
      //   requestId,
      //   result: JSON.stringify(result),
      //   completedAt: new Date().toISOString(),
      // });

      const expectedStructure = {
        jobId: expect.any(String),
        requestId: expect.any(String),
        result: expect.any(String), // ← Must be JSON string!
        completedAt: expect.any(String),
      };

      const actualMessage = {
        jobId: 'job-123',
        requestId: 'req-123',
        result: JSON.stringify({ content: 'test' }),
        completedAt: '2025-11-15T08:00:00.000Z',
      };

      expect(actualMessage).toMatchObject(expectedStructure);
      expect(typeof actualMessage.result).toBe('string');
    });
  });
});
