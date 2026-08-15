/**
 * Tests for the canonical reference shape, its renderer, and the dedup projection.
 */

import { describe, it, expect } from 'vitest';
import { TEXT_LIMITS } from '@tzurot/common-types/constants/discord';
import { enrichmentKey } from './QuoteFormatter.js';
import {
  dedupeReference,
  promptTime,
  referenceSearchText,
  renderReference,
  type RenderableReference,
} from './RenderableReference.js';

function reference(over: Partial<RenderableReference> = {}): RenderableReference {
  return {
    number: 3,
    from: 'Vladlena',
    fromId: 'persona-uuid',
    username: 'vlad',
    role: 'user',
    time: '2026-07-20 (Mon) • 1 week ago',
    content: 'the original message text',
    locationContext: '<location type="guild">\n<server name="Guild"/>\n</location>',
    embedsXml: ['<embed>\n<title>An embed</title>\n</embed>'],
    attachments: [
      { kind: 'image', filename: 'photo.png', contentType: 'image/png', description: 'a cat' },
    ],
    ...over,
  };
}

describe('renderReference', () => {
  it('renders every drawn field onto the quote', () => {
    const xml = renderReference(reference());

    expect(xml).toContain(
      '<quote number="3" from="Vladlena" from_id="persona-uuid" username="vlad" role="user" t="2026-07-20 (Mon) • 1 week ago">'
    );
    expect(xml).toContain('<content>the original message text</content>');
    expect(xml).toContain('<server name="Guild"/>');
    expect(xml).toContain('<title>An embed</title>');
    expect(xml).toContain('<image filename="photo.png" type="image/png">a cat</image>');
  });

  it('renders forwarding from the FIELD, not from a caller-supplied mode', () => {
    expect(renderReference(reference({ isForwarded: true }))).toContain('type="forward"');
    expect(renderReference(reference({ isForwarded: false }))).not.toContain('type="forward"');
    expect(renderReference(reference())).not.toContain('type="forward"');
  });

  it('keeps a forwarded reference every OTHER attribute too', () => {
    // The forwarded path used to run through a wrapper that hardcoded the
    // author and dropped number/role/username/location on every forwarded reply.
    const xml = renderReference(reference({ isForwarded: true }));

    expect(xml).toContain('number="3"');
    expect(xml).toContain('from="Vladlena"');
    expect(xml).toContain('username="vlad"');
    expect(xml).toContain('role="user"');
    expect(xml).toContain('<server name="Guild"/>');
  });

  describe('username', () => {
    it('is emitted when it differs from the rendered name', () => {
      expect(renderReference(reference({ from: 'Vladlena', username: 'vlad' }))).toContain(
        'username="vlad"'
      );
    });

    it('is omitted when it duplicates the rendered name', () => {
      expect(renderReference(reference({ from: 'vlad', username: 'vlad' }))).not.toContain(
        'username='
      );
    });

    it('is omitted when empty or absent', () => {
      expect(renderReference(reference({ username: '' }))).not.toContain('username=');
      expect(renderReference(reference({ username: undefined }))).not.toContain('username=');
    });
  });

  it('omits empty sections rather than emitting hollow ones', () => {
    const xml = renderReference(
      reference({ content: '', locationContext: undefined, embedsXml: undefined, attachments: [] })
    );

    expect(xml).not.toContain('<content>');
    expect(xml).not.toContain('<embeds>');
    expect(xml).not.toContain('<attachments>');
  });
});

describe('promptTime', () => {
  it('formats a usable timestamp', () => {
    expect(promptTime('2026-07-20T14:32:00Z')).toContain('2026-07-20');
  });

  it('returns undefined rather than an empty t="" attribute', () => {
    expect(promptTime(undefined)).toBeUndefined();
    expect(promptTime('')).toBeUndefined();
    expect(promptTime('not a date')).toBeUndefined();
  });
});

describe('dedupeReference', () => {
  it('inherits EVERY field except the three it always subtracts', () => {
    // The structural guard on the whole projection. A field-by-field rebuild —
    // the shape this replaced, and the source of three separate dropped-field
    // bugs — fails here the moment someone adds a field to the reference and
    // forgets to copy it, because this walks the object's own keys rather than
    // a list someone has to remember to update.
    const full = reference({ isForwarded: true });
    const stub = dedupeReference(full);
    const subtracted = new Set(['content', 'locationContext', 'embedsXml']);

    for (const key of Object.keys(full) as (keyof RenderableReference)[]) {
      if (subtracted.has(key)) {
        continue;
      }
      expect(stub[key], `field "${key}" was not inherited by the projection`).toEqual(full[key]);
    }

    expect(stub.locationContext).toBeUndefined();
    expect(stub.embedsXml).toBeUndefined();
    expect(stub.content).not.toBe(full.content);
  });

  it('drops location and embeds from the rendered stub', () => {
    const xml = renderReference(dedupeReference(reference()));

    expect(xml).not.toContain('<server name="Guild"/>');
    expect(xml).not.toContain('<embeds>');
  });

  it('keeps attachments — their enrichment exists nowhere else', () => {
    const xml = renderReference(dedupeReference(reference()));

    expect(xml).toContain('<image filename="photo.png" type="image/png">a cat</image>');
  });

  it('names an UNDESCRIBED attachment instead of omitting it', () => {
    const xml = renderReference(
      dedupeReference(
        reference({
          attachments: [{ kind: 'image', filename: 'broken.png', contentType: 'image/png' }],
        })
      )
    );

    expect(xml).toContain('<image filename="broken.png" type="image/png"/>');
  });

  it('prepends the plain marker when no attachment carries enrichment', () => {
    const stub = dedupeReference(
      reference({ attachments: [{ kind: 'file', filename: 'report.pdf' }] })
    );

    expect(stub.content).toContain('[Referenced message — full text in the chat log]');
    expect(stub.content).not.toContain('its media is described here');
  });

  it('earns the media clause only from actual enrichment', () => {
    const described = dedupeReference(reference());
    const undescribed = dedupeReference(
      reference({ attachments: [{ kind: 'image', filename: 'x.png', status: 'undescribed' }] })
    );

    expect(described.content).toContain('its media is described here');
    expect(undescribed.content).not.toContain('its media is described here');
  });

  describe('subtracting enrichment the chat log already renders', () => {
    it('drops an attachment whose description the chat log carries', () => {
      const stub = dedupeReference(reference(), new Set([enrichmentKey('image', 'a cat')]));

      expect(stub.attachments).toEqual([]);
      // And the prefix follows the subtraction rather than the input: promising
      // "its media is described here" beside nothing is the same class of false
      // claim this whole change exists to remove.
      expect(stub.content).not.toContain('its media is described here');
    });

    it('keeps an attachment the chat log does NOT carry', () => {
      const stub = dedupeReference(
        reference(),
        new Set([enrichmentKey('image', 'some other description')])
      );

      expect(renderReference(stub)).toContain('a cat');
      expect(stub.content).toContain('its media is described here');
    });

    it('subtracts per attachment, not all-or-nothing', () => {
      const stub = dedupeReference(
        reference({
          attachments: [
            { kind: 'image', filename: 'carried.png', description: 'in the chat log' },
            { kind: 'image', filename: 'orphan.png', description: 'nowhere else' },
          ],
        }),
        new Set([enrichmentKey('image', 'in the chat log')])
      );

      expect(stub.attachments).toHaveLength(1);
      expect(renderReference(stub)).toContain('nowhere else');
      expect(renderReference(stub)).not.toContain('carried.png');
    });

    it('never subtracts an UNDESCRIBED attachment', () => {
      // The chat log has nothing to render for it either, so the stub is its
      // only mention — subtracting would erase the fact that it exists.
      const stub = dedupeReference(
        reference({
          attachments: [{ kind: 'image', filename: 'broken.png', status: 'undescribed' }],
        }),
        new Set([enrichmentKey('image', 'a cat')])
      );

      expect(renderReference(stub)).toContain(
        '<image filename="broken.png" status="undescribed"/>'
      );
    });

    it('does not subtract across modalities on identical text', () => {
      // The set is keyed by kind, so a TRANSCRIPT the chat log carries cannot
      // cancel an image described with the same words. Improbable, but the two
      // strings come from different producers and mean different things, and
      // conflating them drops an element for a reason unrelated to it.
      const stub = dedupeReference(
        reference({
          attachments: [{ kind: 'image', filename: 'sign.png', description: 'meet me at seven' }],
        }),
        new Set([enrichmentKey('voice', 'meet me at seven')])
      );

      expect(renderReference(stub)).toContain('meet me at seven');
    });

    it('subtracts nothing when the caller supplies no set', () => {
      // The safe default, and it has a direction: a duplicated description costs
      // tokens, a dropped one costs the answer.
      expect(dedupeReference(reference()).attachments).toEqual(reference().attachments);
      expect(dedupeReference(reference(), new Set()).attachments).toEqual(reference().attachments);
    });
  });

  describe('the preview', () => {
    it('is kept for OUR OWN persona — a contentless stub names nothing the model can resolve', () => {
      // The continuation risk this preview once guarded against is blocked in
      // the prompt itself (OUTPUT_CONSTRAINTS plus the <contextual_references>
      // instruction), so the assistant role gets the same preview every other
      // role gets rather than a marker with no referent.
      const stub = dedupeReference(
        reference({ role: 'assistant', content: 'my earlier line', attachments: [] })
      );

      expect(stub.content).toContain('my earlier line');
      expect(stub.content).toBe(
        '[Referenced message — full text in the chat log]\n\nmy earlier line'
      );
    });

    it('caps an assistant preview at the same limit as every other role', () => {
      const long = 'y'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 50);
      const stub = dedupeReference(
        reference({ role: 'assistant', content: long, attachments: [] })
      );

      expect(stub.content).toContain('y'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...');
      expect(stub.content).not.toContain('y'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 1));
    });

    it('is KEPT for a third-party bot — not our text, so the trap does not apply', () => {
      const stub = dedupeReference(reference({ role: 'bot', content: 'a webhook posted this' }));

      expect(stub.content).toContain('a webhook posted this');
    });

    it('is kept for a person', () => {
      expect(dedupeReference(reference({ role: 'user' })).content).toContain(
        'the original message text'
      );
    });

    it('is kept for a sibling persona', () => {
      const stub = dedupeReference(reference({ role: 'character', content: 'sibling said this' }));

      expect(stub.content).toContain('sibling said this');
    });

    it('is capped, and the cap applies to the text alone', () => {
      const long = 'x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 50);
      const stub = dedupeReference(reference({ content: long }));

      expect(stub.content).toContain('x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT) + '...');
      expect(stub.content).not.toContain('x'.repeat(TEXT_LIMITS.DEDUP_STUB_CONTENT + 1));
    });

    it('leaves a marker-only stub with no trailing blank line', () => {
      const stub = dedupeReference(reference({ content: '' }));

      expect(stub.content.endsWith('\n')).toBe(false);
    });
  });
});

describe('referenceSearchText', () => {
  it('carries the message text and every attachment description', () => {
    const text = referenceSearchText(
      reference({
        attachments: [
          { kind: 'image', filename: 'a.png', description: 'a cat' },
          { kind: 'voice', filename: 'b.ogg', description: 'hello there' },
        ],
      })
    );

    expect(text).toBe('the original message text\na cat\nhello there');
  });

  it('appends embed text when the caller extracted some', () => {
    expect(referenceSearchText(reference(), 'An embed')).toContain('An embed');
  });

  it('excludes filenames, statuses and content types — metadata is query noise', () => {
    const text = referenceSearchText(
      reference({
        content: '',
        attachments: [
          { kind: 'image', filename: 'photo.png', contentType: 'image/png', status: 'undescribed' },
          { kind: 'file', filename: 'report.pdf', contentType: 'application/pdf' },
        ],
      })
    );

    expect(text).toBe('');
  });

  it('drops empty and whitespace-only pieces', () => {
    expect(referenceSearchText(reference({ content: '   ', attachments: [] }), '  ')).toBe('');
  });
});
