/**
 * Response-strip seam test — WIRING test.
 *
 * `ResponsePostProcessor.test.ts` mocks both `stripRealMessageEchoArtifacts`
 * (stage 1, the real-message echo strip) and `stripResponseArtifacts` (stage
 * 2, the generic artifact pass), and `responseArtifacts.test.ts` exercises
 * each of those functions in isolation. Neither ever composes the two real
 * passes end to end: stage 2's leading-bracket step takes only a bracket
 * whose whole interior is a prompt timestamp, so a header line stage 1
 * misses is not caught downstream, and the two stages must be pinned
 * together. A wiring bug at that seam — stage 2 silently widening back out,
 * or stage 1 regressing — would be invisible to either mocked suite.
 *
 * So this file runs the REAL `ResponsePostProcessor.processResponse` with
 * every strip module real, in both `realMessagesEnabled` states, and mocks
 * ONLY the logger (same pattern as `responseArtifacts.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponsePostProcessor } from './ResponsePostProcessor.js';
import {
  formatRelativeTime,
  formatRelativeTimeDelta,
  formatAbsoluteTimestamp,
  formatPromptTimestamp,
  formatMemoryTimestamp,
  formatFullDateTime,
} from '@tzurot/common-types/utils/dateFormatting';

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => mockLogger,
  };
});

const NY = 'America/New_York';

describe.each([true, false])(
  'response strip seam — realMessagesEnabled=%s',
  realMessagesEnabled => {
    let processor: ResponsePostProcessor;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-03-18T15:30:00Z'));
      processor = new ResponsePostProcessor();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function run(content: string): string {
      return processor.processResponse(content, undefined, undefined, {
        personalityName: 'Lilith',
        userName: 'Vlad',
        realMessagesEnabled,
      }).cleanedContent;
    }

    describe('KEEP: identical in every flag state', () => {
      it('a leading non-header bracket aside passes through byte-identical', () => {
        const fixture = '[laughs] Anyway, no.';
        expect(run(fixture)).toBe(fixture);
      });

      it('a quoted OTHER-speaker header on line one survives — name-scoped, not shape-scoped', () => {
        const fixture = 'He typed: [Bob — yesterday] and I laughed.';
        expect(run(fixture)).toBe(fixture);
      });

      it('the preamble cannot cross a line boundary — a header on a LATER line is untouched', () => {
        const fixture = 'Just a normal line.\n[Lilith — 2026-09-09 (Wed) 14:07]\nHi.';
        expect(run(fixture)).toBe(fixture);
      });

      it('narrated prose ahead of a self-named bracketed aside passes through byte-identical', () => {
        const fixture = 'He handed me the note — [Lilith — 1834]\nAnd I read it twice.';
        expect(run(fixture)).toBe(fixture);
      });

      it('an over-length emphasis-run interior preceding the self header passes through byte-identical', () => {
        const fixture =
          '_He remembers everything from before, every detail still vivid in his mind_ [Lilith — reminiscing]\nAnd then he continued speaking as if nothing had happened.';
        expect(run(fixture)).toBe(fixture);
      });

      it('a compound leading line naming a DIFFERENT personality is not scoped by the self matcher', () => {
        const fixture =
          '[Sat 18:19] — *previous context* — [Damien — 2026-09-09 (Wed) 14:07]\nHello there.';
        expect(run(fixture)).toBe(fixture);
      });

      it('a weekday+clock bracket is not a formatter output, so it is never taken by either stage', () => {
        const fixture = '[Sat 18:19] Hello';
        expect(run(fixture)).toBe(fixture);
      });

      it('an aside after a stripped self-name prefix survives in every flag state', () => {
        const fixture = 'Lilith: [laughs] Anyway, no.';
        expect(run(fixture)).toBe('[laughs] Anyway, no.');
      });
    });

    describe('LEAK: a compound self-header line strips flag-on, leaks flag-off', () => {
      it('flag-off never renders a header to the model, so it never strips one either — asterisk-decorated compound', () => {
        const fixture =
          '[Sat 18:19] — *previous context* — [Lilith — 2026-09-09 (Wed) 14:07]\nDamien.';
        const result = run(fixture);
        expect(result).toBe(realMessagesEnabled ? 'Damien.' : fixture);
      });

      it('flag-off never renders a header to the model, so it never strips one either — bot-suffixed compound', () => {
        const fixture =
          '[Sat 18:19] — *previous context* — [Lilith (bot) — 2026-09-09 (Wed) 14:07]\nHi.';
        const result = run(fixture);
        expect(result).toBe(realMessagesEnabled ? 'Hi.' : fixture);
      });

      it('flag-off never renders a header to the model, so it never strips one either — underscore-decorated compound', () => {
        const fixture =
          '[Sat 18:19] — _previous context_ — [Lilith — 2026-09-09 (Wed) 14:07]\nDamien.';
        const result = run(fixture);
        expect(result).toBe(realMessagesEnabled ? 'Damien.' : fixture);
      });
    });

    describe('TIMESTAMP LEAK: an echoed prompt timestamp strips in every flag state', () => {
      it('formatRelativeTime', () => {
        const stamp = formatRelativeTime(new Date(Date.now() - 5 * 60_000), NY);
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('formatRelativeTimeDelta', () => {
        const stamp = formatRelativeTimeDelta(new Date(Date.now() - 3 * 3_600_000));
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('formatAbsoluteTimestamp', () => {
        const stamp = formatAbsoluteTimestamp(new Date(Date.now() - 3 * 3_600_000), NY);
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('formatPromptTimestamp', () => {
        const stamp = formatPromptTimestamp(new Date(Date.now() - 3 * 3_600_000), NY);
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('formatMemoryTimestamp', () => {
        const stamp = formatMemoryTimestamp(new Date(Date.now() - 3 * 86_400_000), NY);
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('formatFullDateTime', () => {
        const stamp = formatFullDateTime(new Date(), NY);
        expect(run(`[${stamp}] Hello`)).toBe('Hello');
      });

      it('a formatter timestamp after the self-name prefix strips with it', () => {
        const stamp = formatRelativeTime(new Date(Date.now() - 2 * 60_000), NY);
        expect(run(`Lilith: [${stamp}] Hello`)).toBe('Hello');
      });
    });

    describe('KEEP-CASES (TASK-923): a same-line bracketed em-dash aside naming no personality', () => {
      it("flag-on and flag-off: a same-line bracketed em-dash aside ('laughs — really') survives the name-agnostic matcher", () => {
        const fixture = '[laughs — really] Anyway, no.';
        const result = run(fixture);
        // Accepted tradeoff: `leadingHeaderLineMatcher` requires the closing
        // bracket to end the line, so a bracketed aside followed by
        // same-line prose is never truncated. The cost is the inverse case —
        // a header with same-line reply text survives (see the accepted
        // tradeoff test below).
        expect(result).toBe(fixture);
      });

      it("flag-on and flag-off: a same-line bracketed em-dash aside ('Name remembers — the promise made') survives the name-agnostic matcher", () => {
        const fixture = '[Name remembers — the promise made] I said I would never leave.';
        const result = run(fixture);
        expect(result).toBe(fixture);
      });

      it('a rendered header line alone at the top still strips flag-on — the end-of-line requirement does not disarm the strip', () => {
        // Pins `leadingHeaderLineMatcher` specifically: `Damien` shares no
        // prefix relationship with the run() personality ('Lilith'), so
        // `leadingSelfHeaderLineMatcher` cannot take this line either, and
        // stage 2's leading-bracket step takes only pure-timestamp interiors.
        // This case pins the STRIP, not the tail's newline consumption —
        // stage 2 trims, so a surviving blank line cannot redden a seam test;
        // that half is pinned at the unit tier in responseArtifacts.test.ts.
        const stamp = formatAbsoluteTimestamp(new Date(), NY);
        const fixture = `[Damien — ${stamp}]\nAnd then the reply.`;
        const result = run(fixture);
        expect(result).toBe(realMessagesEnabled ? 'And then the reply.' : fixture);
      });

      it('accepted tradeoff: a header with same-line reply text survives (the matcher requires end of line)', () => {
        // Same rendered header as above, but with same-line reply text — the
        // matcher's end-of-line requirement means the closing bracket is no
        // longer the last thing on the line, so it declines to strip.
        const stamp = formatAbsoluteTimestamp(new Date(), NY);
        const fixture = `[Damien — ${stamp}] and then the reply`;
        const result = run(fixture);
        expect(result).toBe(fixture);
      });
    });
  }
);
