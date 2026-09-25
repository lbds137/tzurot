/**
 * Tests for Embed Attachment Naming
 */

import { describe, it, expect } from 'vitest';
import { EMBED_NAMING } from '@tzurot/common-types/constants/media';
import { embedImageAttachmentName, embedMediaAttachmentName } from './embedAttachmentName.js';

describe('embedImageAttachmentName', () => {
  it('names the image slot of the first embed', () => {
    expect(embedImageAttachmentName(0, EMBED_NAMING.IMAGE_SLOT)).toBe('embed-1-image.png');
  });

  it('names the thumbnail slot of the first embed', () => {
    expect(embedImageAttachmentName(0, EMBED_NAMING.THUMBNAIL_SLOT)).toBe('embed-1-thumbnail.png');
  });

  it('renders the embed index 1-based', () => {
    expect(embedImageAttachmentName(1, EMBED_NAMING.IMAGE_SLOT)).toBe('embed-2-image.png');
  });

  it('names both slots of a second embed independently', () => {
    expect(embedImageAttachmentName(2, EMBED_NAMING.IMAGE_SLOT)).toBe('embed-3-image.png');
    expect(embedImageAttachmentName(2, EMBED_NAMING.THUMBNAIL_SLOT)).toBe('embed-3-thumbnail.png');
  });
});

describe('embedMediaAttachmentName', () => {
  it('names the first media item of the first embed', () => {
    expect(embedMediaAttachmentName(0, 0)).toBe('embed-1-media-1.png');
  });

  it('renders both the embed and media index 1-based', () => {
    expect(embedMediaAttachmentName(1, 2)).toBe('embed-2-media-3.png');
  });

  it('scopes a media name to the media-2 forwarded snapshot', () => {
    expect(embedMediaAttachmentName(0, 2, { snapshotIndex: 1 })).toBe(
      'forward-2-embed-1-media-3.png'
    );
  });
});

describe('snapshot-scoped naming', () => {
  it('scopes an image name to the first forwarded snapshot', () => {
    expect(embedImageAttachmentName(0, EMBED_NAMING.IMAGE_SLOT, { snapshotIndex: 0 })).toBe(
      'forward-1-embed-1-image.png'
    );
  });

  it('scopes a thumbnail name to a later embed in a later forwarded snapshot', () => {
    expect(embedImageAttachmentName(2, EMBED_NAMING.THUMBNAIL_SLOT, { snapshotIndex: 1 })).toBe(
      'forward-2-embed-3-thumbnail.png'
    );
  });
});
