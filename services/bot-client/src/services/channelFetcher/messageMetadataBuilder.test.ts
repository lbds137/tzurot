import { describe, it, expect } from 'vitest';
import { type AttachmentMetadata } from '@tzurot/common-types/types/schemas/discord';
import { type StoredReferencedMessage } from '@tzurot/common-types/types/schemas/message';
import {
  buildMessageMetadata,
  type BuiltMessageContentCarriers,
} from './messageMetadataBuilder.js';

const imageAttachment: AttachmentMetadata = {
  url: 'https://cdn/x.png',
  contentType: 'image/png',
  name: 'x.png',
};
const pdfAttachment: AttachmentMetadata = {
  url: 'https://cdn/d.pdf',
  contentType: 'application/pdf',
  name: 'd.pdf',
};

function carriers(
  overrides: Partial<BuiltMessageContentCarriers> = {}
): BuiltMessageContentCarriers {
  return { isForwarded: false, attachments: [], ...overrides };
}

function ref(id: string): StoredReferencedMessage {
  return { content: `ref-${id}` } as StoredReferencedMessage;
}

describe('buildMessageMetadata', () => {
  it('returns undefined when no carrier applies', () => {
    expect(buildMessageMetadata('m1', carriers())).toBeUndefined();
  });

  it('carries embeds and voice transcripts through', () => {
    const result = buildMessageMetadata(
      'm1',
      carriers({ embedsXml: ['<embed>a</embed>'], voiceTranscripts: ['hello'] })
    );
    expect(result).toEqual({ embedsXml: ['<embed>a</embed>'], voiceTranscripts: ['hello'] });
  });

  it('creates metadata when only one of embeds or transcripts is present', () => {
    expect(buildMessageMetadata('m1', carriers({ embedsXml: [] }))).toEqual({
      embedsXml: [],
      voiceTranscripts: undefined,
    });
  });

  describe('forwarded attachment lines', () => {
    it('describes only image attachments of a forwarded message', () => {
      const result = buildMessageMetadata(
        'm1',
        carriers({ isForwarded: true, attachments: [imageAttachment, pdfAttachment] })
      );
      expect(result?.forwardedAttachmentLines).toEqual(['[image/png: x.png]']);
    });

    it('falls back to a generic name when the attachment has none', () => {
      const result = buildMessageMetadata(
        'm1',
        carriers({
          isForwarded: true,
          attachments: [{ url: 'https://cdn/y.png', contentType: 'image/png' }],
        })
      );
      expect(result?.forwardedAttachmentLines).toEqual(['[image/png: image]']);
    });

    it('omits the field when the message is not forwarded', () => {
      const result = buildMessageMetadata('m1', carriers({ attachments: [imageAttachment] }));
      expect(result).toBeUndefined();
    });

    it('omits the field when a forwarded message has no image attachments', () => {
      const result = buildMessageMetadata(
        'm1',
        carriers({ isForwarded: true, attachments: [pdfAttachment] })
      );
      expect(result).toBeUndefined();
    });

    it('merges onto metadata that already carries embeds', () => {
      const result = buildMessageMetadata(
        'm1',
        carriers({ isForwarded: true, attachments: [imageAttachment], embedsXml: ['<embed/>'] })
      );
      expect(result).toEqual({
        embedsXml: ['<embed/>'],
        voiceTranscripts: undefined,
        forwardedAttachmentLines: ['[image/png: x.png]'],
      });
    });
  });

  describe('resolved link references', () => {
    it('attaches references resolved for this message', () => {
      const resolved = new Map([['m1', [ref('a')]]]);
      const result = buildMessageMetadata('m1', carriers(), resolved);
      expect(result?.referencedMessages).toEqual([ref('a')]);
    });

    it('ignores references keyed to a different message', () => {
      const resolved = new Map([['other', [ref('a')]]]);
      expect(buildMessageMetadata('m1', carriers(), resolved)).toBeUndefined();
    });

    it('ignores an empty reference list', () => {
      const resolved = new Map<string, StoredReferencedMessage[]>([['m1', []]]);
      expect(buildMessageMetadata('m1', carriers(), resolved)).toBeUndefined();
    });

    it('appends to references already present rather than replacing them', () => {
      const resolved = new Map([['m1', [ref('new')]]]);
      const result = buildMessageMetadata('m1', carriers(), resolved);
      expect(result?.referencedMessages).toHaveLength(1);
      expect(result?.referencedMessages?.[0]).toEqual(ref('new'));
    });

    it('combines with forwarded lines and embeds on one metadata object', () => {
      const resolved = new Map([['m1', [ref('a')]]]);
      const result = buildMessageMetadata(
        'm1',
        carriers({ isForwarded: true, attachments: [imageAttachment], voiceTranscripts: ['hi'] }),
        resolved
      );
      expect(result).toEqual({
        embedsXml: undefined,
        voiceTranscripts: ['hi'],
        forwardedAttachmentLines: ['[image/png: x.png]'],
        referencedMessages: [ref('a')],
      });
    });
  });
});
