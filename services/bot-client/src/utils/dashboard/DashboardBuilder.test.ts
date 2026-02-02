/**
 * Tests for DashboardBuilder functions
 */

import { describe, it, expect } from 'vitest';
import type { APIButtonComponentWithCustomId, APIStringSelectComponent } from 'discord.js';
import { ButtonStyle } from 'discord.js';
import {
  buildDashboardEmbed,
  buildEditMenu,
  buildActionButtons,
  buildDashboardComponents,
  getOverallStatus,
  type ActionButtonOptions,
} from './DashboardBuilder.js';
import { SectionStatus, type DashboardConfig } from './types.js';

// Helper to get button data with proper typing
function getButtonData(
  row: ReturnType<typeof buildActionButtons>,
  index: number
): APIButtonComponentWithCustomId {
  return row.components[index].data as unknown as APIButtonComponentWithCustomId;
}

// Helper to get select menu data with proper typing
function getSelectMenuData(
  row: ReturnType<typeof buildEditMenu>,
  index: number
): APIStringSelectComponent {
  return row.components[index].data as unknown as APIStringSelectComponent;
}

// Test data type
interface TestEntity {
  id: string;
  name: string;
  description: string | null;
}

// Test config factory
function createTestConfig(): DashboardConfig<TestEntity> {
  return {
    entityType: 'test-entity',
    getTitle: data => `Edit: ${data.name}`,
    sections: [
      {
        id: 'identity',
        label: '🏷️ Identity',
        description: 'Name and basic info',
        fieldIds: ['name'],
        fields: [{ id: 'name', label: 'Name', style: 'short', required: true }],
        getStatus: data => (data.name ? SectionStatus.COMPLETE : SectionStatus.EMPTY),
        getPreview: data => data.name || '_Not configured_',
      },
      {
        id: 'details',
        label: 'Details',
        description: 'Optional details',
        fieldIds: ['description'],
        fields: [{ id: 'description', label: 'Description', style: 'paragraph' }],
        getStatus: data => (data.description ? SectionStatus.COMPLETE : SectionStatus.EMPTY),
        getPreview: data => data.description || '_Not configured_',
      },
    ],
  };
}

const testEntity: TestEntity = {
  id: 'entity-123',
  name: 'Test Entity',
  description: 'A test description',
};

describe('DashboardBuilder', () => {
  describe('buildDashboardEmbed', () => {
    it('should create embed with title from config', () => {
      const config = createTestConfig();
      const embed = buildDashboardEmbed(config, testEntity);

      expect(embed.data.title).toBe('Edit: Test Entity');
    });

    it('should add section fields with status emoji', () => {
      const config = createTestConfig();
      const embed = buildDashboardEmbed(config, testEntity);

      expect(embed.data.fields).toHaveLength(2);
      expect(embed.data.fields?.[0].name).toContain('Identity');
      expect(embed.data.fields?.[0].name).toContain('✅'); // Complete status
    });

    it('should show preview for configured sections', () => {
      const config = createTestConfig();
      const embed = buildDashboardEmbed(config, testEntity);

      expect(embed.data.fields?.[0].value).toBe('Test Entity');
      expect(embed.data.fields?.[1].value).toBe('A test description');
    });

    it('should show placeholder for empty sections', () => {
      const config = createTestConfig();
      const emptyEntity: TestEntity = { id: '1', name: '', description: null };
      const embed = buildDashboardEmbed(config, emptyEntity);

      expect(embed.data.fields?.[0].value).toBe('_Not configured_');
    });
  });

  describe('buildEditMenu', () => {
    it('should create select menu with section options', () => {
      const config = createTestConfig();
      const row = buildEditMenu(config, 'entity-123', testEntity);

      // Row should contain components
      expect(row.components).toHaveLength(1);
      const menu = row.components[0];
      expect(menu.data).toBeDefined();
    });

    it('should use correct customId format', () => {
      const config = createTestConfig();
      const row = buildEditMenu(config, 'entity-123', testEntity);

      const menu = getSelectMenuData(row, 0);
      expect(menu.custom_id).toBe('test-entity::menu::entity-123');
    });
  });

  describe('buildActionButtons', () => {
    it('should create empty row when no options provided', () => {
      const config = createTestConfig();
      const row = buildActionButtons(config, 'entity-123');

      expect(row.components).toHaveLength(0);
    });

    it('should add refresh button when showRefresh is true', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = { showRefresh: true };
      const row = buildActionButtons(config, 'entity-123', options);

      expect(row.components).toHaveLength(1);
      const button = getButtonData(row, 0);
      expect(button.custom_id).toBe('test-entity::refresh::entity-123');
      expect(button.label).toBe('Refresh');
    });

    it('should add close button when showClose is true', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = { showClose: true };
      const row = buildActionButtons(config, 'entity-123', options);

      expect(row.components).toHaveLength(1);
      const button = getButtonData(row, 0);
      expect(button.custom_id).toBe('test-entity::close::entity-123');
      expect(button.label).toBe('Close');
    });

    it('should add delete button when showDelete is true', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = { showDelete: true };
      const row = buildActionButtons(config, 'entity-123', options);

      expect(row.components).toHaveLength(1);
      const button = getButtonData(row, 0);
      expect(button.custom_id).toBe('test-entity::delete::entity-123');
      expect(button.label).toBe('Delete');
      expect(button.style).toBe(ButtonStyle.Danger);
    });

    describe('toggleGlobal button', () => {
      it('should not show toggle button when isOwned is false', () => {
        const config = createTestConfig();
        const options: ActionButtonOptions = {
          toggleGlobal: { isGlobal: false, isOwned: false },
        };
        const row = buildActionButtons(config, 'entity-123', options);

        // Button should NOT be added when user doesn't own the entity
        const toggleButton = row.components.find(
          c =>
            (c.data as { custom_id?: string }).custom_id ===
            'test-entity::toggle-global::entity-123'
        );
        expect(toggleButton).toBeUndefined();
      });

      it('should show "Make Global" button when isOwned and not global', () => {
        const config = createTestConfig();
        const options: ActionButtonOptions = {
          toggleGlobal: { isGlobal: false, isOwned: true },
        };
        const row = buildActionButtons(config, 'entity-123', options);

        expect(row.components).toHaveLength(1);
        const button = getButtonData(row, 0);
        expect(button.custom_id).toBe('test-entity::toggle-global::entity-123');
        expect(button.label).toBe('Make Global');
        expect(button.style).toBe(ButtonStyle.Primary);
        expect(button.emoji).toEqual(expect.objectContaining({ name: '🌐' }));
      });

      it('should show "Make Private" button when isOwned and is global', () => {
        const config = createTestConfig();
        const options: ActionButtonOptions = {
          toggleGlobal: { isGlobal: true, isOwned: true },
        };
        const row = buildActionButtons(config, 'entity-123', options);

        expect(row.components).toHaveLength(1);
        const button = getButtonData(row, 0);
        expect(button.custom_id).toBe('test-entity::toggle-global::entity-123');
        expect(button.label).toBe('Make Private');
        expect(button.style).toBe(ButtonStyle.Secondary);
        expect(button.emoji).toEqual(expect.objectContaining({ name: '🔒' }));
      });

      it('should position toggle button between refresh and close', () => {
        const config = createTestConfig();
        const options: ActionButtonOptions = {
          showRefresh: true,
          showClose: true,
          toggleGlobal: { isGlobal: false, isOwned: true },
        };
        const row = buildActionButtons(config, 'entity-123', options);

        // Order should be: Refresh, Toggle, Close
        expect(row.components).toHaveLength(3);
        expect(getButtonData(row, 0).label).toBe('Refresh');
        expect(getButtonData(row, 1).label).toBe('Make Global');
        expect(getButtonData(row, 2).label).toBe('Close');
      });
    });

    it('should add multiple buttons in correct order', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = {
        showRefresh: true,
        showClose: true,
        showDelete: true,
      };
      const row = buildActionButtons(config, 'entity-123', options);

      // Order: Refresh, Close, Delete
      expect(row.components).toHaveLength(3);
      expect(getButtonData(row, 0).label).toBe('Refresh');
      expect(getButtonData(row, 1).label).toBe('Close');
      expect(getButtonData(row, 2).label).toBe('Delete');
    });
  });

  describe('buildDashboardComponents', () => {
    it('should return menu row only when no button options', () => {
      const config = createTestConfig();
      const components = buildDashboardComponents(config, 'entity-123', testEntity);

      expect(components).toHaveLength(1);
    });

    it('should return menu and button rows when options provided', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = { showClose: true };
      const components = buildDashboardComponents(config, 'entity-123', testEntity, options);

      expect(components).toHaveLength(2);
    });

    it('should include button row when toggleGlobal is defined', () => {
      const config = createTestConfig();
      const options: ActionButtonOptions = {
        toggleGlobal: { isGlobal: false, isOwned: true },
      };
      const components = buildDashboardComponents(config, 'entity-123', testEntity, options);

      expect(components).toHaveLength(2);
    });
  });

  describe('getOverallStatus', () => {
    it('should return COMPLETE when all sections complete', () => {
      const config = createTestConfig();
      const result = getOverallStatus(config, testEntity);

      expect(result.status).toBe(SectionStatus.COMPLETE);
      expect(result.completedCount).toBe(2);
      expect(result.totalCount).toBe(2);
      expect(result.percentage).toBe(100);
    });

    it('should return PARTIAL when some sections complete', () => {
      const config = createTestConfig();
      const partialEntity: TestEntity = { id: '1', name: 'Test', description: null };
      const result = getOverallStatus(config, partialEntity);

      expect(result.status).toBe(SectionStatus.PARTIAL);
      expect(result.completedCount).toBe(1);
      expect(result.percentage).toBe(50);
    });

    it('should return EMPTY when no sections complete', () => {
      const config = createTestConfig();
      const emptyEntity: TestEntity = { id: '1', name: '', description: null };
      const result = getOverallStatus(config, emptyEntity);

      expect(result.status).toBe(SectionStatus.EMPTY);
      expect(result.completedCount).toBe(0);
      expect(result.percentage).toBe(0);
    });
  });
});
