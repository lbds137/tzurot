/**
 * Character Truncation Warning
 *
 * Detects over-length legacy field values in a character section before a
 * user opens the edit modal, and shows a destructive-action warning with
 * explicit opt-in. The flow itself (two-click edit, 10062 catch, View Full
 * `.txt` read path) lives in `utils/dashboard/truncationGate/entityEditFlow`;
 * this file supplies the character-specific {@link EntitySectionAdapter}
 * (section lookup is user-dependent for bot-admin gating, and the data
 * resolvers thread EnvConfig) and re-exports the factory-bound handlers
 * under their established names so dashboard routing stays untouched.
 *
 * The silent-truncate site in `utils/dashboard/ModalFactory.ts` still runs
 * after user consent — this module's job is gating the modal on an informed
 * decision, plus offering a View Full read path so users can see the
 * content they'd be about to truncate before committing.
 */

import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  createTruncationEditFlow,
  type EntitySectionAdapter,
} from '../../utils/dashboard/truncationGate/entityEditFlow.js';
import type { CharacterData } from './characterTypes.js';
import {
  findCharacterSection,
  loadCharacterSectionData,
  resolveCharacterSectionContext,
  type CharacterSectionSync,
} from './sectionContext.js';

const logger = createLogger('character-truncation-warning');

/**
 * Character adapter: section lookup needs the user id (admin gating), and
 * the async resolvers thread the live EnvConfig.
 */
const characterSectionAdapter: EntitySectionAdapter<CharacterData, CharacterSectionSync> = {
  entityType: 'character',
  findSection: (interaction, sectionId) => findCharacterSection(sectionId, interaction.user.id),
  loadSectionData: (interaction, entityId, sync) =>
    loadCharacterSectionData(interaction, entityId, getConfig(), sync),
  resolveSectionContext: (interaction, entityId, sectionId) =>
    resolveCharacterSectionContext(interaction, entityId, sectionId, getConfig()),
};

const flow = createTruncationEditFlow(characterSectionAdapter, logger);

export const showTruncationWarning = flow.showTruncationWarning;
export const handleEditTruncatedButton = flow.handleEditTruncatedButton;
export const handleOpenEditorButton = flow.handleOpenEditorButton;
export const handleViewFullButton = flow.handleViewFullButton;
export const handleCancelEditButton = flow.handleCancelEditButton;
