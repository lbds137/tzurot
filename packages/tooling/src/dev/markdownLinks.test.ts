import { describe, expect, it } from 'vitest';
import { extractNonRenderingLinks, extractRelativeLinks } from './markdownLinks.js';

describe('extractRelativeLinks', () => {
  it('extracts ../ and ./ targets, stripping a trailing fragment', () => {
    const md = ['[a](../foo.md)', '[b](./bar.md#section)', '[c](../../baz.md)'].join('\n');
    expect(extractRelativeLinks(md)).toEqual(['../foo.md', './bar.md', '../../baz.md']);
  });

  it('skips absolute URLs, mailto, and bare anchors', () => {
    const md = [
      '[a](https://example.com/foo.md)',
      '[b](http://example.com/foo.md)',
      '[c](mailto:someone@example.com)',
      '[d](#section)',
    ].join('\n');
    expect(extractRelativeLinks(md)).toEqual([]);
  });

  it('skips root-relative paths', () => {
    expect(extractRelativeLinks('[a](/absolute/path.md)')).toEqual([]);
  });

  // CommonMark treats a bare target as relative exactly like a dotted one, and
  // this is the dominant cross-reference style in tracker/docs/. Scoping to the
  // dotted forms made the gate blind to it — and to 14 dead links written that
  // way.
  it('extracts a BARE relative target that looks like a file', () => {
    expect(extractRelativeLinks('[a](bare-path.md)')).toEqual(['bare-path.md']);
    expect(extractRelativeLinks('[a](themes/sub.md)')).toEqual(['themes/sub.md']);
    expect(extractRelativeLinks('[a](img/diagram.png)')).toEqual(['img/diagram.png']);
    expect(extractRelativeLinks('[a](bare.md#frag)')).toEqual(['bare.md']);
  });

  it('skips a bare target with no file extension, so prose in brackets is not a path', () => {
    expect(extractRelativeLinks('[a](some-page)')).toEqual([]);
    expect(extractRelativeLinks('[see the epic](whatever we call it)')).toEqual([]);
  });

  it('skips a version string, which is extension-shaped but not a file', () => {
    // The corpus is release-note-heavy, so `[v3](v3.0.0-beta.199)` is a
    // plausible future link; `.199` must not read as a file extension.
    expect(extractRelativeLinks('[v3](v3.0.0-beta.199)')).toEqual([]);
    expect(extractRelativeLinks('[a](thing.2026)')).toEqual([]);
    // …while a real extension containing digits still counts.
    expect(extractRelativeLinks('[a](archive.7z)')).toEqual(['archive.7z']);
  });

  // Every filename under tracker/ carries spaces, and CommonMark only renders a
  // link to one of them when the destination is angle-wrapped or percent-encoded
  // (both verified against `marked`; the bare form stays literal text). Before
  // this, the encoded form resolved against a literal `%20` path and reported
  // dangling, and the angle form was dropped entirely — a dead link written that
  // way was never seen.
  describe('spaced filenames', () => {
    it('percent-decodes an encoded target, which is what GitHub copy-link emits', () => {
      expect(extractRelativeLinks('[t](doc-20%20-%20Theme.md)')).toEqual(['doc-20 - Theme.md']);
    });

    it('unwraps the angle-bracket target form', () => {
      expect(extractRelativeLinks('[t](<doc-20 - Theme.md>)')).toEqual(['doc-20 - Theme.md']);
    });

    // Unwrapping has to precede the fragment strip: the other order leaves
    // `<doc-20 - Theme.md`, closing bracket gone, resolving against nothing.
    // GitHub strips padding inside the brackets and renders href="doc.md"
    // (probed), so the padding is not part of the path. Untrimmed, the trailing
    // space defeated the $-anchored extension test and — the angled branch
    // having skipped the whitespace branch — the target vanished from both.
    it('trims padding inside the angle brackets', () => {
      expect(extractRelativeLinks('[t](< doc.md >)')).toEqual(['doc.md']);
      expect(extractNonRenderingLinks('[t](< doc.md >)')).toEqual([]);
    });

    it('unwraps before stripping the fragment', () => {
      expect(extractRelativeLinks('[t](<doc-20 - Theme.md#sec>)')).toEqual(['doc-20 - Theme.md']);
      expect(extractRelativeLinks('[t](doc-20%20-%20Theme.md#sec)')).toEqual(['doc-20 - Theme.md']);
    });

    // A destination is only decodable if it is well-formed; an undecodable one
    // stays in the resolvable set so it reports dangling instead of vanishing.
    it('falls back to the raw target when the escape is malformed', () => {
      expect(extractRelativeLinks('[t](broken%zz.md)')).toEqual(['broken%zz.md']);
    });

    it('reports a bare-spaced target as non-rendering rather than resolving it', () => {
      expect(extractNonRenderingLinks('[t](doc-20 - Theme.md)')).toEqual(['doc-20 - Theme.md']);
      expect(extractRelativeLinks('[t](doc-20 - Theme.md)')).toEqual([]);
    });

    // The same protection the resolvable branch gets from isRelativeFileTarget.
    // Without it the non-rendering branch re-opens the false-positive class from
    // the other side: these are the file's own "prose, not a path" fixtures, and
    // flagging them would redden `pnpm quality` on an ordinary bracketed aside —
    // with advice about angle-wrapping a filename that is not one.
    it('does not flag bracketed prose that was never meant to be a path', () => {
      expect(extractNonRenderingLinks('[see the epic](whatever we call it)')).toEqual([]);
      expect(extractNonRenderingLinks('the [runtime](Node js version)')).toEqual([]);
    });

    // The likeliest real shape in this corpus: every tracker filename has
    // spaces, so linking to a heading inside one is natural. An anchor makes
    // the last segment `Theme.md#the-fix`, which no extension test can match,
    // so judging the unstripped form dropped it from BOTH buckets.
    it('flags a bare-spaced target carrying a fragment, reporting it whole', () => {
      expect(extractNonRenderingLinks('[see the fix](doc-20 - Theme.md#the-fix)')).toEqual([
        'doc-20 - Theme.md#the-fix',
      ]);
    });

    // The routing check and the segment split have to agree on what whitespace
    // is. A tab-bearing destination reaches the same outcome at GitHub as a
    // space-bearing one — probed, `[t](foo<TAB>bar.md)` comes back as literal
    // text — so routing on `' '` alone sent it down the resolvable branch to be
    // reported dangling: the right verdict for the wrong reason.
    it('routes on any whitespace, not just a literal space', () => {
      expect(extractNonRenderingLinks('[t](foo\tbar.md)')).toEqual(['foo\tbar.md']);
      expect(extractRelativeLinks('[t](foo\tbar.md)')).toEqual([]);
    });

    // A scheme-qualified target with a space is a broken EXTERNAL url, not a
    // repo-relative path — advising percent-encoding would misframe it. This
    // gate passes over external urls entirely, as isRelativeFileTarget does.
    it('does not flag a scheme-qualified target as a relative path', () => {
      expect(extractNonRenderingLinks('[a](https://example.com/some page.md)')).toEqual([]);
      expect(extractNonRenderingLinks('[a](mailto:someone@example.com x)')).toEqual([]);
    });

    // A spaced destination qualifies on a file-shaped SEGMENT, not on the whole
    // string — `isRelativeFileTarget` rejects `doc-20 - Theme.md` outright, so
    // testing the segments is what separates it from `whatever we call it`.
    it('flags a spaced target whose last segment carries a real extension', () => {
      expect(extractNonRenderingLinks('[t](my notes.md)')).toEqual(['my notes.md']);
      expect(extractNonRenderingLinks('[t](some folder/deep file.png)')).toEqual([
        'some folder/deep file.png',
      ]);
    });

    it('does not flag the two rendering forms as non-rendering', () => {
      expect(extractNonRenderingLinks('[t](<doc-20 - Theme.md>)')).toEqual([]);
      expect(extractNonRenderingLinks('[t](doc-20%20-%20Theme.md)')).toEqual([]);
    });
  });

  // A title is parsed as its own field, not part of the path (verified against
  // `marked`), so it comes off before the destination is judged — otherwise its
  // space would read as a path space and misclassify the link as non-rendering.
  describe('titled links', () => {
    it('strips a double- or single-quoted title from the target', () => {
      expect(extractRelativeLinks('[t](../foo.md "Title")')).toEqual(['../foo.md']);
      expect(extractRelativeLinks("[t](../foo.md 'Title')")).toEqual(['../foo.md']);
    });

    it('strips the title from an angle-wrapped spaced target', () => {
      expect(extractRelativeLinks('[t](<doc-20 - Theme.md> "Title")')).toEqual([
        'doc-20 - Theme.md',
      ]);
    });

    it('does not mistake a titled link for a non-rendering one', () => {
      expect(extractNonRenderingLinks('[t](../foo.md "Title")')).toEqual([]);
    });

    // The combination that actually exercises the ordering: the title has to
    // come off BEFORE the space check, or `my notes.md "Title"` is judged on a
    // string whose last segment is `"Title"` rather than `notes.md`. Every
    // other title test lands in the resolvable bucket, so none of them covers
    // this path.
    it('strips the title before judging a bare-spaced target', () => {
      expect(extractNonRenderingLinks('[t](my notes.md "Title")')).toEqual(['my notes.md']);
      expect(extractRelativeLinks('[t](my notes.md "Title")')).toEqual([]);
    });
  });

  it('includes image link targets — same rot class as a regular link', () => {
    expect(extractRelativeLinks('![alt text](../images/diagram.png)')).toEqual([
      '../images/diagram.png',
    ]);
  });

  it('ignores link syntax inside a fenced code block', () => {
    const md = ['Write links like this:', '', '```markdown', '[t](../made-up.md)', '```'].join(
      '\n'
    );
    expect(extractRelativeLinks(md)).toEqual([]);
  });

  it('ignores link syntax inside an inline code span', () => {
    expect(extractRelativeLinks('Use `[t](../made-up.md)` for a relative link.')).toEqual([]);
  });

  it('still extracts a real link that sits next to a code sample', () => {
    const md = ['```', '[t](../not-real.md)', '```', '', 'See [the epic](../active-epic.md).'].join(
      '\n'
    );
    expect(extractRelativeLinks(md)).toEqual(['../active-epic.md']);
  });

  // The shapes the extractor's docstring says it mishandles. Each of those
  // sentences is a claim about runtime behavior, so it is pinned here rather
  // than left as prose (02-code-standards § "A Comment That Asserts Behavior Is
  // a Claim"). These characterize the CURRENT behavior — if a real markdown-link
  // parser ever replaces the regex, these are the cases to revisit, and they
  // will fail loudly rather than drift silently.
  //
  // The first three are misses. The last two run the other way: an OVER-match
  // that reports non-paths as dangling, and a stripCode assumption that
  // swallows real links. Both directions belong here — a limitation that
  // produces a spurious CI failure is as much a documented behavior as one that
  // produces a blind spot, and it is the direction that actually costs someone
  // a red `pnpm quality` on text that was never a path.
  describe('documented parse limitations', () => {
    // Verified against `marked`: the spaced form is not a link at all, so
    // reporting it as non-rendering is the right diagnosis — but the captured
    // text is truncated at the paren, which is why the report echoes the target
    // instead of building an angle-wrapped suggestion from it. The unspaced
    // sibling DOES render, and truncation still mangles it into a dangling
    // report; that half is the limitation this case documents.
    it('a target containing a literal ) truncates at that paren (fails loud)', () => {
      expect(extractNonRenderingLinks('[t](../notes (draft).md)')).toEqual(['../notes (draft']);
      expect(extractRelativeLinks('[t](../notes(draft).md)')).toEqual(['../notes(draft']);
    });

    it('link text with nested brackets matches nothing (fails silent)', () => {
      expect(extractRelativeLinks('[a [b]](../x.md)')).toEqual([]);
    });

    it('reference-style links match nothing (fails silent)', () => {
      expect(extractRelativeLinks('[t][ref]\n\n[ref]: ../foo.md')).toEqual([]);
    });

    // The compound of three limitations documented above, and the only one that
    // lands in NEITHER bucket: the capture truncates before the closing `>`, so
    // the target no longer reads as angle-wrapped, and the truncation leaves no
    // file-shaped segment for looksLikeIntendedPath to recognize. Pinned so the
    // silence is visible rather than discovered.
    // The non-rendering branch over-matches in the same direction its sibling
    // does: a bracketed description naming a file has one file-shaped segment.
    // Narrowing the segment test would lose `doc-20 - Theme.md`, which is the
    // case the gate exists for. Backticking suppresses it, as on the other side.
    it('over-matches a bracketed description that names a file (loud, wrong direction)', () => {
      expect(
        extractNonRenderingLinks('[see the config](tsconfig.json for the compiler options)')
      ).toEqual(['tsconfig.json for the compiler options']);
      expect(
        extractNonRenderingLinks('see `[the config](tsconfig.json for the options)` here')
      ).toEqual([]);
    });

    it('an angle-wrapped target with a space AND a literal ) vanishes entirely', () => {
      expect(extractRelativeLinks('[t](<foo (bar).md>)')).toEqual([]);
      expect(extractNonRenderingLinks('[t](<foo (bar).md>)')).toEqual([]);
    });

    // Not hypothetical: the first draft of the task that filed this limitation
    // wrote these two examples in link form, and the gate reported both as
    // dangling within minutes of them being written down.
    it('over-matches a bare domain-like target (fails loud, wrong direction)', () => {
      expect(extractRelativeLinks('see [docs](example.com) here')).toEqual(['example.com']);
      expect(extractRelativeLinks('the [runtime](Node.js) version')).toEqual(['Node.js']);
    });

    // The workaround the docstring offers, in both spellings a writer would
    // reach for. Documenting an escape hatch that does not work would be worse
    // than documenting none.
    it('backticking suppresses the over-match, around the link or the target', () => {
      expect(extractRelativeLinks('see `[docs](example.com)` here')).toEqual([]);
      expect(extractRelativeLinks('see [docs](`example.com`) here')).toEqual([]);
    });

    it('stripCode drops a real link when inline backticks are unbalanced', () => {
      expect(extractRelativeLinks('a `span here and [t](../real.md) then `another` tail')).toEqual(
        []
      );
      // Balanced, same link: it survives. Without this half the assertion above
      // would pass for any reason at all — including the link never being seen.
      expect(extractRelativeLinks('a `span` and [t](../real.md) tail')).toEqual(['../real.md']);
    });
  });
});
