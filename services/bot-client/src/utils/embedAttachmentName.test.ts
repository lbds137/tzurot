/**
 * Tests for Embed Attachment Naming
 */

import { describe, it, expect } from 'vitest';
import { EMBED_NAMING } from '@tzurot/common-types/constants/media';
import { embedImageAttachmentName } from './embedAttachmentName.js';

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
