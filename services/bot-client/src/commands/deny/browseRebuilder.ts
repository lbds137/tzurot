/**
 * Deny Browse Rebuilder Registration
 *
 * Side-effect module that registers the `deny` adapter with the shared
 * browse-rebuilder registry. Kept separate from `browse.ts` so that
 * `detail.ts` can ensure the registration has happened (by importing
 * this file) without creating a circular import back into `browse.ts`.
 *
 * Consumed by:
 * - `renderPostActionScreen` (destructive-action success → direct re-render)
 * - `handleSharedBackButton` (Back-to-Browse click)
 *
 * Deny is unique among the four browse-capable commands in that its
 * `buildBrowseResponse` takes pre-fetched entries (synchronous), so the
 * adapter first does `fetchEntriesResult(ownerClient)` and then passes the
 * result into the shared builder. `fetchEntriesResult` reports `ok: false`
 * on API failure — the adapter propagates that as its own null return, and
 * the shared helper falls through to the error terminal.
 */

import { registerBrowseRebuilder } from '../../utils/dashboard/index.js';
import type { BrowseSortType } from '../../utils/browse/index.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { buildBrowseResponse, fetchEntriesResult, type DenyBrowseFilter } from './browse.js';

registerBrowseRebuilder('deny', async (interaction, browseContext, successBanner) => {
  const { ownerClient } = clientsFor(interaction);
  const fetched = await fetchEntriesResult(ownerClient);
  if (!fetched.ok) {
    return null;
  }
  const result = buildBrowseResponse(
    fetched.entries,
    browseContext.page,
    browseContext.filter as DenyBrowseFilter,
    (browseContext.sort ?? 'date') as BrowseSortType,
    { listTruncated: fetched.truncated }
  );
  return {
    content: successBanner,
    embeds: [result.embed],
    components: result.components,
  };
});
