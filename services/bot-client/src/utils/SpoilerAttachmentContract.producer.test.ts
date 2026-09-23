/**
 * Producer half of the bot-client→ai-worker spoiler-attachment contract.
 *
 * Runs the REAL `extractAttachments` over a discord.js-shaped attachment
 * collection and snapshots its output to a committed JSON fixture under
 * `@tzurot/test-utils` (`fixtures/contracts/spoiler-attachments/`). CI
 * COMPARES (strict); regenerate-on-purpose and commit the diff on drift.
 *
 * The ai-worker consumer test
 * (`SpoilerAttachmentContract.consumer.contract.test.ts`) reads this SAME
 * fixture and feeds it to the real renderers. The committed fixture IS the
 * contract artifact — the two services share data, not code, so neither
 * imports the other (depcruise boundary stays intact). See
 * `packages/test-utils/src/contractFixtures.ts` for the rationale.
 */

import { describe, it, expect } from 'vitest';
import { Collection } from 'discord.js';
import type { Attachment, Snowflake } from 'discord.js';
import { contractFixtureFile, stableFixtureJson } from '@tzurot/test-utils';
import { extractAttachments } from './attachmentExtractor.js';

function makeAttachment(id: string, name: string, spoiler: boolean): Attachment {
  return {
    id,
    url: `https://cdn.discordapp.com/attachments/1/${id}/${name}`,
    contentType: 'image/png',
    name,
    size: 1000,
    duration: null,
    waveform: null,
    spoiler,
  } as Attachment;
}

describe('spoiler-attachment contract — producer fixture generation', () => {
  it('real extractAttachments output matches the committed fixture', async () => {
    const attachments = new Collection<Snowflake, Attachment>();
    // Filename-prefix spoiler, flag unset — the prefix alone must carry it.
    attachments.set('1', makeAttachment('1', 'SPOILER_cat.png', false));
    // Flag-based spoiler AND an unrelated filename — the flag alone must carry it.
    attachments.set('2', makeAttachment('2', 'hidden.png', true));
    // Neither signal — an ordinary upload.
    attachments.set('3', makeAttachment('3', 'plain.png', false));

    const result = extractAttachments(attachments);

    await expect(stableFixtureJson(result)).toMatchFileSnapshot(
      contractFixtureFile('spoiler-attachments/extracted.json')
    );
  });
});
