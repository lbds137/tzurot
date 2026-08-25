import { describe, expect, it } from 'vitest';
import {
  ExportAdminSettingsSchema,
  ExportApiKeyMetadataRowSchema,
  ExportCommandEventRowSchema,
  ExportCredentialMetadataRowSchema,
  ExportExportJobRowSchema,
  ExportImportJobRowSchema,
  ExportJobsFileSchema,
  ExportReleaseDeliveryLogRowSchema,
  ExportShapesPersonaMappingRowSchema,
} from './accountExportAccountSchemas.js';

describe('accountExportAccountSchemas', () => {
  it('parses valid API key metadata (never the encrypted iv/content/tag)', () => {
    const result = ExportApiKeyMetadataRowSchema.safeParse({
      id: 'key-1',
      provider: 'openrouter',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects API key metadata carrying encrypted content (drift guard)', () => {
    const result = ExportApiKeyMetadataRowSchema.safeParse({
      id: 'key-1',
      provider: 'openrouter',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      content: 'encrypted-blob',
    });
    expect(result.success).toBe(false);
  });

  it('parses valid credential metadata', () => {
    const result = ExportCredentialMetadataRowSchema.safeParse({
      id: 'cred-1',
      service: 'shapes_inc',
      credentialType: 'session_cookie',
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: null,
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid jobs file with omitted export-job payload columns', () => {
    const importJob = {
      id: 'import-1',
      userId: 'user-1',
      personalityId: null,
      sourceSlug: 'slug',
      sourceService: 'shapes_inc',
      status: 'completed',
      importType: 'full',
      memoriesImported: 3,
      memoriesFailed: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      importMetadata: null,
    };
    const exportJob = {
      id: 'export-1',
      userId: 'user-1',
      sourceSlug: 'account',
      sourceService: 'account',
      status: 'completed',
      format: 'zip',
      fileName: 'export.zip',
      fileSizeBytes: 1024,
      downloadToken: 'a'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      completedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
      errorMessage: null,
      exportMetadata: null,
    };
    const result = ExportJobsFileSchema.safeParse({
      importJobs: [importJob],
      exportJobs: [exportJob],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an export job row carrying fileContent/fileData (drift guard)', () => {
    const result = ExportExportJobRowSchema.safeParse({
      id: 'export-1',
      userId: 'user-1',
      sourceSlug: 'account',
      sourceService: 'account',
      status: 'completed',
      format: 'zip',
      fileName: 'export.zip',
      fileSizeBytes: 1024,
      downloadToken: 'a'.repeat(64),
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      completedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
      errorMessage: null,
      exportMetadata: null,
      fileContent: 'should not be here',
    });
    expect(result.success).toBe(false);
  });

  it('parses a valid ImportJob row on its own', () => {
    const result = ExportImportJobRowSchema.safeParse({
      id: 'import-1',
      userId: 'user-1',
      personalityId: 'char-1',
      sourceSlug: 'slug',
      sourceService: 'shapes_inc',
      status: 'pending',
      importType: 'full',
      memoriesImported: null,
      memoriesFailed: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      importMetadata: null,
    });
    expect(result.success).toBe(true);
  });

  it('parses every DeliveryStatus enum value on a release-delivery row', () => {
    const statuses = [
      'pending',
      'sent',
      'failed_transient',
      'failed_permanent',
      'failed_bot_level',
    ];
    for (const status of statuses) {
      const result = ExportReleaseDeliveryLogRowSchema.safeParse({
        id: 'rdl-1',
        releaseId: 'release-1',
        userId: 'user-1',
        status,
        errorCode: null,
        attemptedAt: null,
        sentMessageId: null,
        messageDeletedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('parses a valid shapes-persona-mapping row', () => {
    const result = ExportShapesPersonaMappingRowSchema.safeParse({
      id: 'spm-1',
      shapesUserId: 'shapes-user-1',
      personaId: 'persona-1',
      mappedAt: '2026-01-01T00:00:00.000Z',
      mappedBy: null,
      verificationStatus: 'unverified',
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid command-event row', () => {
    const result = ExportCommandEventRowSchema.safeParse({
      id: 'ce-1',
      occurredAt: '2026-01-01T00:00:00.000Z',
      userId: '123456789012345678',
      guildId: null,
      channelKind: 'dm',
      command: 'memory.browse',
      characterId: null,
      outcome: 'ok',
      errorCode: null,
      latencyMs: 42,
      context: null,
    });
    expect(result.success).toBe(true);
  });

  it('parses a valid admin-settings row', () => {
    const result = ExportAdminSettingsSchema.safeParse({
      id: 'admin-settings-1',
      updatedBy: null,
      configDefaults: null,
      systemSettings: null,
      globalDefaultLlmConfigId: null,
      globalDefaultVisionConfigId: null,
      freeDefaultLlmConfigId: null,
      freeDefaultVisionConfigId: null,
      globalDefaultTtsConfigId: null,
      freeDefaultTtsConfigId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });
});
