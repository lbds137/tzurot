import { describe, it, expect } from 'vitest';
import {
  DiagnosticLogSchema,
  DiagnosticLogResponseSchema,
  DiagnosticLogsResponseSchema,
  RecentDiagnosticLogSchema,
  RecentDiagnosticLogsResponseSchema,
  DiagnosticUpdateResponseSchema,
} from './diagnostic.js';
import type { DiagnosticPayload } from '../../types/diagnostic.js';

function validLogShape() {
  return {
    id: 'log-uuid-1',
    requestId: 'req-uuid-1',
    triggerMessageId: '123456789012345678',
    personalityId: 'personality-uuid',
    userId: 'discord-user-id',
    guildId: 'discord-guild-id',
    channelId: 'discord-channel-id',
    model: 'claude-3-5-sonnet',
    provider: 'anthropic',
    durationMs: 1500,
    createdAt: '2026-05-23T12:00:00Z',
    data: { meta: { requestId: 'req-uuid-1' } },
  };
}

describe('DiagnosticLogSchema', () => {
  it('accepts a fully-populated log', () => {
    expect(DiagnosticLogSchema.safeParse(validLogShape()).success).toBe(true);
  });

  it('accepts nullable fields as null', () => {
    const log = {
      ...validLogShape(),
      triggerMessageId: null,
      personalityId: null,
      guildId: null,
      channelId: null,
    };
    expect(DiagnosticLogSchema.safeParse(log).success).toBe(true);
  });

  it('rejects null userId (column is NOT NULL; every writer supplies it)', () => {
    const log = { ...validLogShape(), userId: null };
    expect(DiagnosticLogSchema.safeParse(log).success).toBe(false);
  });

  it('accepts createdAt as either string OR Date', () => {
    const asString = { ...validLogShape(), createdAt: '2026-05-23T12:00:00Z' };
    const asDate = { ...validLogShape(), createdAt: new Date('2026-05-23T12:00:00Z') };
    expect(DiagnosticLogSchema.safeParse(asString).success).toBe(true);
    expect(DiagnosticLogSchema.safeParse(asDate).success).toBe(true);
  });

  it('accepts arbitrary data field shape (trusted JSONB)', () => {
    const withArbitraryData = { ...validLogShape(), data: { totally: ['novel', 'shape', 42] } };
    expect(DiagnosticLogSchema.safeParse(withArbitraryData).success).toBe(true);
  });

  it('survives the RESPONSE direction: `data` is z.unknown() passthrough, so nothing on it is stripped', () => {
    // `data` never goes through a mirrored Zod shape (see the file-header rationale) —
    // it's an opaque passthrough, so a field a typed schema WOULD strip (an undeclared
    // wire key) instead survives untouched. Pin that a deeply-nested new field
    // (attachmentDescriptions[].attribution.model) reaches `result.data` unchanged.
    const sentinelModel = 'qwen/qwen3.5-397b-a17b';
    const log = {
      ...validLogShape(),
      data: {
        meta: { requestId: 'req-uuid-1' },
        inputProcessing: {
          rawUserMessage: 'hi',
          attachmentDescriptions: [
            {
              description: 'a photo of a cat',
              attribution: { model: sentinelModel, fromCache: false },
            },
          ],
        },
      },
    };
    const result = DiagnosticLogSchema.safeParse(log);
    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data.data as DiagnosticPayload;
      expect(data.inputProcessing.attachmentDescriptions[0]?.attribution?.model).toBe(
        sentinelModel
      );
    }
  });

  it('rejects missing required string fields', () => {
    const missingModel = { ...validLogShape() } as Partial<ReturnType<typeof validLogShape>>;
    delete missingModel.model;
    expect(DiagnosticLogSchema.safeParse(missingModel).success).toBe(false);
  });
});

describe('DiagnosticLogResponseSchema', () => {
  it('accepts a wrapped single log', () => {
    expect(DiagnosticLogResponseSchema.safeParse({ log: validLogShape() }).success).toBe(true);
  });

  it('rejects an array under log (must be single)', () => {
    expect(DiagnosticLogResponseSchema.safeParse({ log: [validLogShape()] }).success).toBe(false);
  });
});

describe('DiagnosticLogsResponseSchema', () => {
  it('accepts an empty logs array with count 0', () => {
    expect(DiagnosticLogsResponseSchema.safeParse({ logs: [], count: 0 }).success).toBe(true);
  });

  it('accepts multiple logs', () => {
    expect(
      DiagnosticLogsResponseSchema.safeParse({
        logs: [validLogShape(), validLogShape()],
        count: 2,
      }).success
    ).toBe(true);
  });

  it('rejects negative count', () => {
    expect(DiagnosticLogsResponseSchema.safeParse({ logs: [], count: -1 }).success).toBe(false);
  });
});

describe('RecentDiagnosticLogSchema', () => {
  it('accepts a log summary with personalityName', () => {
    const summary = {
      id: 'log-uuid',
      requestId: 'req-uuid',
      personalityId: 'personality-uuid',
      userId: 'discord-user',
      guildId: 'discord-guild',
      channelId: 'discord-channel',
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      durationMs: 1500,
      createdAt: '2026-05-23T12:00:00Z',
      personalityName: 'TestPersonality',
    };
    expect(RecentDiagnosticLogSchema.safeParse(summary).success).toBe(true);
  });

  it('accepts null personalityName (JSONB extraction may fail)', () => {
    const summary = {
      id: 'log-uuid',
      requestId: 'req-uuid',
      personalityId: null,
      userId: '123456789012345678',
      guildId: null,
      channelId: null,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      durationMs: 1500,
      createdAt: new Date(),
      personalityName: null,
    };
    expect(RecentDiagnosticLogSchema.safeParse(summary).success).toBe(true);
  });

  it('rejects null userId (column is NOT NULL; every writer supplies it)', () => {
    const summary = {
      id: 'log-uuid',
      requestId: 'req-uuid',
      personalityId: null,
      userId: null,
      guildId: null,
      channelId: null,
      model: 'claude-3-5-sonnet',
      provider: 'anthropic',
      durationMs: 1500,
      createdAt: new Date(),
      personalityName: null,
    };
    expect(RecentDiagnosticLogSchema.safeParse(summary).success).toBe(false);
  });
});

describe('RecentDiagnosticLogsResponseSchema', () => {
  it('accepts the empty case', () => {
    expect(RecentDiagnosticLogsResponseSchema.safeParse({ logs: [], count: 0 }).success).toBe(true);
  });
});

describe('DiagnosticUpdateResponseSchema', () => {
  it('accepts { success: true }', () => {
    expect(DiagnosticUpdateResponseSchema.safeParse({ success: true }).success).toBe(true);
  });

  it('rejects { success: false } (literal true required)', () => {
    expect(DiagnosticUpdateResponseSchema.safeParse({ success: false }).success).toBe(false);
  });
});
