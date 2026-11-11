/**
 * preprocessingResultsBuilder Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { AttachmentType } from '@tzurot/common-types/constants/media';
import { buildPreprocessingResults } from './preprocessingResultsBuilder.js';

describe('buildPreprocessingResults', () => {
  it('routes unnumbered results to the trigger and numbered ones to their reference', () => {
    const result = buildPreprocessingResults(
      [
        { url: 'https://cdn.example.com/a/1/voice.ogg', name: 'voice.ogg', content: 'hello' },
        {
          url: 'https://cdn.example.com/a/2/ref.ogg',
          name: 'ref.ogg',
          content: 'quoted',
          sourceReferenceNumber: 2,
        },
      ],
      [
        { url: 'https://cdn.example.com/a/3/cat.png?ex=1', description: 'a cat' },
        {
          url: 'https://cdn.example.com/a/4/dog.png',
          description: 'a dog',
          sourceReferenceNumber: 1,
        },
      ]
    );

    expect(result.processedAttachments.map(a => [a.type, a.description])).toEqual([
      [AttachmentType.Image, 'a cat'],
      [AttachmentType.Audio, 'hello'],
    ]);
    expect(result.processedAttachments[0].metadata.name).toBe('cat.png');
    expect(result.referenceAttachments[1][0].description).toBe('a dog');
    expect(result.referenceAttachments[2][0].description).toBe('quoted');
  });
});
