import { describe, it, expect } from 'vitest';
import {
  isLikelyErrorDescription,
  isValidVisionDescription,
  VISION_MIN_DESCRIPTION_LENGTH,
} from './visionDescriptionValidity.js';

describe('isLikelyErrorDescription', () => {
  it('detects provider error text returned as content', () => {
    expect(isLikelyErrorDescription('I am unable to access the image you shared.')).toBe(true);
    expect(isLikelyErrorDescription('Error loading the attachment; the URL has expired.')).toBe(
      true
    );
    expect(isLikelyErrorDescription('I was unable to fetch the image URL provided.')).toBe(true);
    expect(isLikelyErrorDescription('Sorry, I cannot access the provided URL.')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isLikelyErrorDescription('UNABLE TO VIEW the image')).toBe(true);
  });

  it('does NOT flag legitimate descriptions that mention an image URL', () => {
    // The old bare 'image url' / 'provided url' substrings mis-classified
    // real descriptions like these, negative-caching a valid result.
    expect(
      isLikelyErrorDescription('The image URL shown in this banner is styled as a hyperlink.')
    ).toBe(false);
    expect(
      isLikelyErrorDescription('A screenshot where the provided URL appears in the address bar.')
    ).toBe(false);
  });

  it('does not flag ordinary descriptions', () => {
    expect(isLikelyErrorDescription('A tabby cat sleeping on a windowsill in the sun.')).toBe(
      false
    );
  });
});

describe('isValidVisionDescription', () => {
  it('accepts a genuine description', () => {
    expect(isValidVisionDescription('A tabby cat sleeping on a windowsill.')).toBe(true);
  });

  it('rejects error-shaped content', () => {
    expect(isValidVisionDescription('I am unable to process the image at this time.')).toBe(false);
  });

  it('rejects content below the minimum length', () => {
    expect(isValidVisionDescription('a'.repeat(VISION_MIN_DESCRIPTION_LENGTH - 1))).toBe(false);
    expect(isValidVisionDescription('   short   ')).toBe(false);
  });

  it('rejects placeholder-marker content', () => {
    expect(isValidVisionDescription('[Image attachment: cat.png]')).toBe(false);
  });
});
