/**
 * Unit tests for the durable form of a quoted reference.
 *
 * The round trip through a real database lives in
 * `storedReference.component.test.ts`; this covers the shape decisions the
 * adapter makes on either side of it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', () => ({ createLogger: () => mockLogger }));
import { type ReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import { type BuiltAttachment } from './QuoteFormatter.js';
import {
  buildStoredAttachments,
  fromStoredReference,
  toStoredReference,
} from './storedReference.js';

const liveRef = (overrides: Partial<ReferencedMessage> = {}): ReferencedMessage => ({
  referenceNumber: 2,
  discordMessageId: 'msg-1',
  discordUserId: 'discord-user-1',
  authorUsername: 'alice',
  authorDisplayName: 'Alice',
  authorRole: 'user',
  content: 'the original text',
  embeds: '',
  timestamp: '2026-07-31T12:00:00.000Z',
  locationContext: '<location channel="general"/>',
  ...overrides,
});

const image = (url: string, filename: string, description?: string): BuiltAttachment => ({
  url,
  attachment:
    description !== undefined
      ? { kind: 'image', filename, contentType: 'image/png', description }
      : { kind: 'image', filename, contentType: 'image/png', status: 'undescribed' },
});

describe('toStoredReference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects enrichment for every modality, keyed by attachment URL', () => {
    const stored = toStoredReference(liveRef(), [
      image('https://cdn/a.png', 'a.png', 'a whiteboard'),
      {
        url: 'https://cdn/b.ogg',
        attachment: { kind: 'voice', filename: 'b.ogg', durationSeconds: 3, description: 'hello' },
      },
    ]);

    expect(stored.attachmentEnrichment).toEqual([
      { url: 'https://cdn/a.png', kind: 'image', description: 'a whiteboard' },
      { url: 'https://cdn/b.ogg', kind: 'voice', description: 'hello' },
    ]);
  });

  it('leaves enrichment UNDEFINED when nothing was computed', () => {
    // Not `[]`. Absence has to keep meaning "never computed" — a retryable
    // state — rather than "computed, produced nothing".
    const stored = toStoredReference(liveRef(), [image('https://cdn/a.png', 'a.png')]);

    expect(stored.attachmentEnrichment).toBeUndefined();
  });

  it('stores the RAW authorRole, never the derived one', () => {
    // The derived role depends on which personalities are visible in the
    // history of the turn doing the rendering. Freezing this turn's answer
    // would make a sibling persona's quote read as the responder's own line
    // for as long as the row survives.
    const stored = toStoredReference(liveRef({ authorRole: 'assistant' }), []);

    expect(stored.authorRole).toBe('assistant');
    expect(stored).not.toHaveProperty('role');
  });

  it('does not store isDeduplicated — replay decides that for itself', () => {
    const stored = toStoredReference(liveRef({ isDeduplicated: true }), []);

    expect(stored).not.toHaveProperty('isDeduplicated');
  });

  it('carries the author Discord id across, so replay can resolve the persona', () => {
    const stored = toStoredReference(liveRef(), []);

    expect(stored.authorDiscordId).toBe('discord-user-1');
  });

  it('drops enrichment with no URL to key it by, and says so', () => {
    // Reachable: the dependency step synthesizes `originalUrl: ''` when a
    // transcription result carries no attachment URL, and that entry reaches
    // the deduped path's orphan tail. Persisting it would write a row nothing
    // at replay could ever correlate — a key that matches every attachment or
    // none, depending on the reader.
    const stored = toStoredReference(
      liveRef(),
      [{ url: '', attachment: { kind: 'voice', filename: 'x.ogg', description: 'orphaned' } }],
      'req-keyless-3'
    );

    expect(stored.attachmentEnrichment).toBeUndefined();
    // Silence is the habit this change exists to break: it reached the prompt
    // and will not survive replay, so the log is the only place that shows up —
    // carrying the request id, or the log names no owner for the lost work.
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-keyless-3', kind: 'voice', filename: 'x.ogg' }),
      expect.stringContaining('no attachment URL')
    );
  });

  it('drops enrichment on a file, which has nowhere to render it', () => {
    const stored = toStoredReference(liveRef(), [
      { url: 'https://cdn/c.zip', attachment: { kind: 'file', filename: 'c.zip' } },
    ]);

    expect(stored.attachmentEnrichment).toBeUndefined();
  });
});

describe('buildStoredAttachments', () => {
  const base = {
    discordMessageId: 'msg-1',
    authorUsername: 'alice',
    authorDisplayName: 'Alice',
    content: 'text',
    timestamp: '2026-07-31T12:00:00.000Z',
    locationContext: '',
  };

  it('correlates by URL, so two attachments sharing a filename stay distinct', () => {
    // The predecessor matched by filename and could not tell these apart — one
    // description would have been rendered against both pictures.
    const rendered = buildStoredAttachments({
      ...base,
      attachments: [
        { url: 'https://cdn/1/image.png', contentType: 'image/png', name: 'image.png' },
        { url: 'https://cdn/2/image.png', contentType: 'image/png', name: 'image.png' },
      ],
      attachmentEnrichment: [
        { url: 'https://cdn/2/image.png', kind: 'image', description: 'the SECOND one' },
      ],
    });

    expect(rendered).toEqual([
      { kind: 'image', filename: 'image.png', contentType: 'image/png', status: 'undescribed' },
      {
        kind: 'image',
        filename: 'image.png',
        contentType: 'image/png',
        description: 'the SECOND one',
      },
    ]);
  });

  it('renders an orphaned transcript as voice, not as a picture', () => {
    // Enrichment whose attachment row is gone still renders — it is paid work —
    // and it renders under the modality recorded when it was built.
    const rendered = buildStoredAttachments({
      ...base,
      attachments: [],
      attachmentEnrichment: [
        { url: 'https://cdn/vanished.ogg', kind: 'voice', description: 'ORPHAN_TRANSCRIPT' },
      ],
    });

    expect(rendered).toEqual([{ kind: 'voice', description: 'ORPHAN_TRANSCRIPT' }]);
  });

  it('names the absence when an attachment has no enrichment', () => {
    const rendered = buildStoredAttachments({
      ...base,
      attachments: [{ url: 'https://cdn/a.ogg', contentType: 'audio/ogg', isVoiceMessage: true }],
    });

    expect(rendered).toEqual([
      { kind: 'voice', filename: undefined, contentType: 'audio/ogg', status: 'untranscribed' },
    ]);
  });
});

describe('fromStoredReference', () => {
  const stored = {
    discordMessageId: 'msg-1',
    authorUsername: 'alice',
    authorDisplayName: 'Alice',
    content: 'text',
    timestamp: '2026-07-31T12:00:00.000Z',
    locationContext: '<location channel="general"/>',
  };

  it('never numbers a replayed quote — there is no marker to point at', () => {
    expect(fromStoredReference(stored, 'Ref Bot').number).toBeUndefined();
  });

  it('prefers the hydrated persona name over the Discord display name', () => {
    const renderable = fromStoredReference(
      { ...stored, resolvedPersonaName: 'Alicia', resolvedPersonaId: 'persona-9' },
      'Ref Bot'
    );

    expect(renderable.from).toBe('Alicia');
    expect(renderable.fromId).toBe('persona-9');
  });

  it('suppresses a pre-XML location block rather than rendering it as prose', () => {
    const renderable = fromStoredReference(
      { ...stored, locationContext: '**Server**: Test\nThis conversation is taking place in #x' },
      'Ref Bot'
    );

    expect(renderable.locationContext).toBeUndefined();
  });
});
