import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  attachmentArb,
  describableReferenceNumbers,
  envelopeContextArb,
  legacyContextArb,
} from './jobContextArbitraries.js';

// Deterministic gate: pinned seed (FC_SEED overrides for exploration).
fc.configureGlobal({ seed: Number(process.env.FC_SEED ?? 0x715a), numRuns: 100 });

describe('jobContextArbitraries', () => {
  // Schema-acceptance properties live in the api-gateway property test —
  // this package deliberately stays off @tzurot/common-types (see module doc).
  it('envelopeContextArb always carries the envelope invariant structurally', () => {
    fc.assert(
      fc.property(envelopeContextArb(), context => {
        expect(context.kind).toBe('envelope');
        expect(context.rawAssemblyInputs).toBeDefined();
        expect(context.rawAssemblyInputs?.rawMessageContent.length).toBeGreaterThan(0);
      })
    );
  });

  it('legacyContextArb never generates an envelope shape', () => {
    fc.assert(
      fc.property(legacyContextArb(), context => {
        expect(context.kind === undefined || context.kind === 'legacy').toBe(true);
        expect(context.rawAssemblyInputs).toBeUndefined();
      })
    );
  });

  it('reference numbers are unique crawl-order within a generated envelope', () => {
    fc.assert(
      fc.property(envelopeContextArb(), context => {
        const refs = context.rawAssemblyInputs?.rawReferencedMessages ?? [];
        const numbers = refs.map(r => r.referenceNumber);
        expect(new Set(numbers).size).toBe(numbers.length);
      })
    );
  });

  it('describableReferenceNumbers selects exactly the image/audio-bearing references', () => {
    fc.assert(
      fc.property(envelopeContextArb(), context => {
        const refs = context.rawAssemblyInputs?.rawReferencedMessages ?? [];
        const oracle = describableReferenceNumbers(context);
        for (const ref of refs) {
          const hasDescribable = (ref.attachments ?? []).some(
            a => a.contentType.startsWith('image/') || a.contentType.startsWith('audio/')
          );
          expect(oracle.includes(ref.referenceNumber)).toBe(hasDescribable);
        }
      })
    );
  });

  it('attachmentArb(describableOnly) never yields ignored content types', () => {
    fc.assert(
      fc.property(attachmentArb({ describableOnly: true }), att => {
        expect(att.contentType.startsWith('image/') || att.contentType.startsWith('audio/')).toBe(
          true
        );
      })
    );
  });
});
