import { describe, it, expect, vi, afterEach } from 'vitest';
import { selectContextVariant, type ReDerivableContextFields } from './contextVariant.js';

const fields: ReDerivableContextFields = {
  conversationHistory: [{ role: 'user' as never, content: 'prior' }],
  referencedMessages: [{ referenceNumber: 1, content: 'ref', authorName: 'A' }] as never,
  mentionedPersonas: [{ personaId: 'p', personaName: 'P' }] as never,
  referencedChannels: [{ channelId: 'c', channelName: 'gen' }] as never,
  activePersonaGuildInfo: { roles: ['Mod'] },
  participantGuildInfo: { 'persona-1': { roles: ['Admin'] } },
  extendedContextAttachments: [
    { url: 'https://cdn/x.png', contentType: 'image/png', id: 'x' },
  ] as never,
};

const makeLogger = () => ({ warn: vi.fn() });

afterEach(() => {
  delete process.env.CONTEXT_THIN_PAYLOAD;
});

describe('selectContextVariant', () => {
  it("returns kind:'legacy' with all fields when thin is off", () => {
    const variant = selectContextVariant({
      hasRawEnvelope: true,
      fields,
      logger: makeLogger(),
      channelId: 'c1',
    });
    // Narrow the discriminated union before touching the legacy-only fields.
    if (variant.kind !== 'legacy') throw new Error('expected legacy variant');
    expect(variant.conversationHistory).toBe(fields.conversationHistory);
    expect(variant.referencedMessages).toBe(fields.referencedMessages);
    expect(variant.mentionedPersonas).toBe(fields.mentionedPersonas);
    expect(variant.referencedChannels).toBe(fields.referencedChannels);
    // Guild/attachment surfaces flow through the legacy arm (worker re-derives them in envelope mode).
    expect(variant.activePersonaGuildInfo).toBe(fields.activePersonaGuildInfo);
    expect(variant.participantGuildInfo).toBe(fields.participantGuildInfo);
    expect(variant.extendedContextAttachments).toBe(fields.extendedContextAttachments);
  });

  it("returns kind:'envelope' carrying ONLY the discriminant when thin + envelope present", () => {
    process.env.CONTEXT_THIN_PAYLOAD = 'true';
    const variant = selectContextVariant({
      hasRawEnvelope: true,
      fields,
      logger: makeLogger(),
      channelId: 'c1',
    });
    expect(variant.kind).toBe('envelope');
    // The tighter type forbids the four fields at compile time; assert at
    // runtime that nothing but `kind` is present.
    expect(Object.keys(variant)).toEqual(['kind']);
  });

  it('normalizes an empty referencedMessages array to undefined on legacy', () => {
    const variant = selectContextVariant({
      hasRawEnvelope: true,
      fields: { ...fields, referencedMessages: [] as never },
      logger: makeLogger(),
      channelId: 'c1',
    });
    if (variant.kind !== 'legacy') throw new Error('expected legacy variant');
    expect(variant.referencedMessages).toBeUndefined();
  });

  it('falls back to legacy and warns when thin is on but no envelope is present', () => {
    process.env.CONTEXT_THIN_PAYLOAD = 'true';
    const logger = makeLogger();
    const variant = selectContextVariant({
      hasRawEnvelope: false,
      fields,
      logger,
      channelId: 'c1',
    });
    if (variant.kind !== 'legacy') throw new Error('expected legacy variant');
    expect(variant.conversationHistory).toBe(fields.conversationHistory);
    expect(logger.warn).toHaveBeenCalledWith(
      { channelId: 'c1' },
      expect.stringContaining('CONTEXT_THIN_PAYLOAD is on but no raw envelope')
    );
  });
});
