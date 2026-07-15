import { describe, it, expect } from 'vitest';
import {
  StartAccountExportInputSchema,
  StartAccountExportResponseSchema,
  AccountExportStatusResponseSchema,
  AccountExportJobSummarySchema,
  AccountExportJobStatusSchema,
  ACCOUNT_DELETE_CONFIRMATION_PHRASE,
  AccountDeleteTokenSchema,
  AccountDeletePreviewResponseSchema,
  OwnedCharacterImpactSchema,
  IssueAccountDeleteTokenSchema,
  IssueAccountDeleteTokenResponseSchema,
  DeleteAccountSchema,
  DeleteAccountResponseSchema,
} from './account.js';

describe('StartAccountExportInputSchema', () => {
  it('accepts an empty body and strips extras', () => {
    expect(StartAccountExportInputSchema.safeParse({}).success).toBe(true);
    const parsed = StartAccountExportInputSchema.parse({ stray: true });
    expect(parsed).toEqual({});
  });
});

describe('StartAccountExportResponseSchema', () => {
  it('accepts the accepted-job shape', () => {
    const result = StartAccountExportResponseSchema.safeParse({
      success: true,
      exportJobId: '123e4567-e89b-42d3-a456-426614174000',
      status: 'pending',
      downloadUrl: 'https://gateway.example/exports/123e4567-e89b-42d3-a456-426614174000',
      expiresAt: '2026-07-16T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects success:false (the route only emits the happy shape)', () => {
    expect(
      StartAccountExportResponseSchema.safeParse({
        success: false,
        exportJobId: 'x',
        status: 'pending',
        downloadUrl: 'u',
        expiresAt: 'e',
      }).success
    ).toBe(false);
  });
});

describe('AccountExportJobSummarySchema', () => {
  const BASE = {
    id: 'job-1',
    status: 'pending',
    fileName: null,
    fileSizeBytes: null,
    createdAt: '2026-07-15T00:00:00.000Z',
    completedAt: null,
    expiresAt: '2026-07-16T00:00:00.000Z',
    downloadUrl: null,
  };

  it('accepts a pending job with all nullable fields null', () => {
    expect(AccountExportJobSummarySchema.safeParse(BASE).success).toBe(true);
  });

  it('rejects a non-integer fileSizeBytes', () => {
    expect(AccountExportJobSummarySchema.safeParse({ ...BASE, fileSizeBytes: 1.5 }).success).toBe(
      false
    );
  });

  it('rejects a missing expiresAt (the download-lifetime field is required)', () => {
    const { expiresAt: _expiresAt, ...withoutExpiry } = BASE;
    expect(AccountExportJobSummarySchema.safeParse(withoutExpiry).success).toBe(false);
  });

  it('rejects statuses outside the lifecycle vocabulary', () => {
    expect(AccountExportJobSummarySchema.safeParse({ ...BASE, status: 'exploded' }).success).toBe(
      false
    );
  });
});

describe('AccountExportJobStatusSchema', () => {
  it('accepts exactly the four lifecycle states', () => {
    for (const status of ['pending', 'in_progress', 'completed', 'failed']) {
      expect(AccountExportJobStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(AccountExportJobStatusSchema.safeParse('done').success).toBe(false);
  });
});

describe('AccountExportStatusResponseSchema', () => {
  it('accepts a null job (never exported)', () => {
    expect(AccountExportStatusResponseSchema.safeParse({ job: null }).success).toBe(true);
  });

  it('normalizes Date fields to ISO strings (wire-safety across serialization)', () => {
    const parsed = AccountExportStatusResponseSchema.parse({
      job: {
        id: 'job-1',
        status: 'completed',
        fileName: 'tzurot-account-export-alice-2026-07-15.zip',
        fileSizeBytes: 1024,
        createdAt: new Date('2026-07-15T00:00:00Z'),
        completedAt: new Date('2026-07-15T00:01:00Z'),
        expiresAt: '2026-07-16T00:00:00.000Z',
        downloadUrl: 'https://gateway.example/exports/job-1',
      },
    });
    expect(parsed.job?.createdAt).toBe('2026-07-15T00:00:00.000Z');
    expect(parsed.job?.expiresAt).toBe('2026-07-16T00:00:00.000Z');
  });
});

describe('AccountDeleteTokenSchema', () => {
  it('accepts only acctdel_-prefixed tokens (never purge/preview tokens)', () => {
    expect(AccountDeleteTokenSchema.safeParse('acctdel_0123456789abcdef').success).toBe(true);
    expect(AccountDeleteTokenSchema.safeParse('purge_0123456789abcdef').success).toBe(false);
    expect(AccountDeleteTokenSchema.safeParse('acctdel_short').success).toBe(false);
  });
});

describe('AccountDeletePreviewResponseSchema', () => {
  it('accepts a preview and pins the exact confirmation phrase', () => {
    const parsed = AccountDeletePreviewResponseSchema.safeParse({
      confirmationPhrase: ACCOUNT_DELETE_CONFIRMATION_PHRASE,
      ownedCharacters: [{ id: 'x1', name: 'XBot', otherUsersWithMemories: 2 }],
      counts: { personas: 1, characters: 1, conversationMessages: 2, memories: 3, facts: 4 },
      hasActiveExport: false,
    });
    expect(parsed.success).toBe(true);

    expect(
      AccountDeletePreviewResponseSchema.safeParse({
        confirmationPhrase: 'DELETE EVERYTHING',
        ownedCharacters: [],
        counts: { personas: 0, characters: 0, conversationMessages: 0, memories: 0, facts: 0 },
        hasActiveExport: false,
      }).success
    ).toBe(false);
  });
});

describe('IssueAccountDeleteTokenSchema', () => {
  it('requires a non-empty confirmation phrase', () => {
    expect(IssueAccountDeleteTokenSchema.safeParse({ confirmationPhrase: '' }).success).toBe(false);
    expect(IssueAccountDeleteTokenSchema.safeParse({ confirmationPhrase: 'x' }).success).toBe(true);
  });
});

describe('DeleteAccountResponseSchema', () => {
  it('accepts the deletion summary shape (no slugs/ids leak to the wire)', () => {
    const parsed = DeleteAccountResponseSchema.safeParse({
      success: true,
      summary: {
        personas: 1,
        characters: 1,
        conversationMessages: 2,
        memories: 3,
        facts: 4,
        factsSweptByTag: 5,
        pendingMemories: 6,
        diagnosticLogs: 7,
        characterNames: ['XBot'],
      },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('OwnedCharacterImpactSchema', () => {
  it('requires an integer cross-user reach', () => {
    expect(
      OwnedCharacterImpactSchema.safeParse({ id: 'x1', name: 'XBot', otherUsersWithMemories: 2 })
        .success
    ).toBe(true);
    expect(
      OwnedCharacterImpactSchema.safeParse({ id: 'x1', name: 'XBot', otherUsersWithMemories: 1.5 })
        .success
    ).toBe(false);
  });
});

describe('IssueAccountDeleteTokenResponseSchema', () => {
  it('only carries a correctly-branded token', () => {
    expect(
      IssueAccountDeleteTokenResponseSchema.safeParse({ deleteToken: 'acctdel_0123456789abcdef' })
        .success
    ).toBe(true);
    expect(
      IssueAccountDeleteTokenResponseSchema.safeParse({ deleteToken: 'purge_0123456789abcdef' })
        .success
    ).toBe(false);
  });
});

describe('DeleteAccountSchema', () => {
  it('accepts only a branded delete token as input', () => {
    expect(DeleteAccountSchema.safeParse({ deleteToken: 'acctdel_0123456789abcdef' }).success).toBe(
      true
    );
    expect(DeleteAccountSchema.safeParse({ deleteToken: 'not-a-token' }).success).toBe(false);
  });
});
