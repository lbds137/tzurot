/**
 * Persona Truncation Warning
 *
 * Mirrors `commands/character/truncationWarning.ts` for persona: the shared
 * flow (two-click edit, 10062 catch, View Full `.txt` read path) lives in
 * `utils/dashboard/truncationGate/entityEditFlow`; this file supplies the
 * persona-specific {@link EntitySectionAdapter} (static section lookup, no
 * EnvConfig threading) and re-exports the factory-bound handlers under
 * their established names.
 *
 * Defense-in-depth: detects when stored persona content exceeds the modal
 * `maxLength` and warns the user before any silent truncation happens. The
 * cap-mismatch class of bug (UI < API) is what made this gate necessary on
 * the persona side.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  createTruncationEditFlow,
  type EntitySectionAdapter,
} from '../../utils/dashboard/truncationGate/entityEditFlow.js';
import type { FlattenedPersonaData } from './config.js';
import {
  findPersonaSection,
  loadPersonaSectionData,
  resolvePersonaSectionContext,
  type PersonaSectionSync,
} from './sectionContext.js';

const logger = createLogger('persona-truncation-warning');

/** Persona adapter: static section lookup, resolvers need no config. */
const personaSectionAdapter: EntitySectionAdapter<FlattenedPersonaData, PersonaSectionSync> = {
  entityType: 'persona',
  findSection: (_interaction, sectionId) => findPersonaSection(sectionId),
  loadSectionData: (interaction, entityId, sync) =>
    loadPersonaSectionData(interaction, entityId, sync),
  resolveSectionContext: (interaction, entityId, sectionId) =>
    resolvePersonaSectionContext(interaction, entityId, sectionId),
};

const flow = createTruncationEditFlow(personaSectionAdapter, logger);

export const showTruncationWarning = flow.showTruncationWarning;
export const handleEditTruncatedButton = flow.handleEditTruncatedButton;
export const handleOpenEditorButton = flow.handleOpenEditorButton;
export const handleViewFullButton = flow.handleViewFullButton;
export const handleCancelEditButton = flow.handleCancelEditButton;
