/**
 * Consumer half of the bot-client→ai-worker spoiler-attachment contract.
 *
 * Reads the SAME committed fixture the bot-client producer test
 * (`SpoilerAttachmentContract.producer.test.ts`) generates, parses it through
 * the real `attachmentMetadataSchema`, and renders it through REAL ai-worker
 * code (no renderer mocks) on both paths a spoilered attachment reaches: the
 * current-turn placeholder/header path (`buildAttachmentDescriptions`) and
 * the reference/history path (`buildRenderableAttachments` + `renderAttachment`).
 * The committed fixture IS the contract artifact — neither service imports
 * the other. See `packages/test-utils/src/contractFixtures.ts` for the
 * rationale.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { attachmentMetadataSchema } from '@tzurot/common-types/types/schemas/discord';
import { loadContractFixture } from '@tzurot/test-utils';
import { buildAttachmentDescriptions } from './RAGUtils.js';
import { buildRenderableAttachments, renderAttachment } from './prompt/QuoteFormatter.js';
import type { ProcessedAttachment } from './MultimodalProcessor.js';

describe('spoiler-attachment contract — consumer derivation', () => {
  const parsed = z
    .array(attachmentMetadataSchema)
    .parse(loadContractFixture('spoiler-attachments/extracted.json'));

  it('current-turn header path: SPOILER_cat.png and hidden.png render Spoiler image, plain.png renders Image', () => {
    const processed: ProcessedAttachment[] = parsed.map((metadata): ProcessedAttachment => ({
      type: AttachmentType.Image,
      description: `a description of ${metadata.name ?? 'attachment'}`,
      originalUrl: metadata.originalUrl ?? metadata.url,
      metadata,
    }));

    const result = buildAttachmentDescriptions(processed);

    expect(result).toContain('[Spoiler image: SPOILER_cat.png]');
    expect(result).toContain('[Spoiler image: hidden.png]');
    expect(result).toContain('[Image: plain.png]');
  });

  it('reference path: spoiler="true" reaches the rendered <image> element for the flagged attachments only', () => {
    const built = buildRenderableAttachments(parsed, () => 'a description');
    const rendered = built.map(b => renderAttachment(b.attachment));

    const byName = (name: string): string => {
      const match = rendered.find(r => r.includes(`filename="${name}"`));
      if (match === undefined) {
        throw new Error(`Expected a rendered element for ${name}`);
      }
      return match;
    };

    expect(byName('SPOILER_cat.png')).toContain('spoiler="true"');
    expect(byName('hidden.png')).toContain('spoiler="true"');
    expect(byName('plain.png')).not.toContain('spoiler=');
  });
});
