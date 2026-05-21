/**
 * Tests for finding generation — Recipes Primary, Secondary, Tertiary.
 */

import { describe, it, expect } from 'vitest';
import { generateFindings } from './schema-audit-findings.js';
import type { PrismaField } from './schema-audit-parser.js';

describe('generateFindings — Recipe Primary (read-mode)', () => {
  const field: PrismaField = {
    model: 'User',
    field: 'someField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  it('flags MEDIUM when >50% of reads are `?? fallback`', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 8,
          truthinessGuardReads: 2,
          nonNullAssertionReads: 0,
          totalReads: 10,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('MEDIUM');
    expect(findings[0].recipe).toBe('read-mode-classification');
  });

  it('does NOT flag when reads are dominantly truthiness-guards (state machine)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 1,
          truthinessGuardReads: 8,
          nonNullAssertionReads: 0,
          totalReads: 9,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag when the split is ambiguous (e.g., 50/50)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 1,
          truthinessGuardReads: 1,
          nonNullAssertionReads: 0,
          totalReads: 2,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(0);
  });

  it('flags HIGH when >50% of reads are non-null assertions (fake-optional)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 0,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 5,
          totalReads: 5,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('HIGH');
  });

  it('does NOT flag fields without reads (zero-divisor and zero-signal both safe)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'someField',
          nullishCoalescingReads: 0,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 0,
          totalReads: 0,
        },
      ],
      [],
      [field]
    );
    expect(findings).toHaveLength(0);
  });

  it('does NOT flag fields that are not optional in the schema (sanity)', () => {
    const findings = generateFindings(
      [
        {
          model: 'User',
          field: 'requiredField',
          nullishCoalescingReads: 10,
          truthinessGuardReads: 0,
          nonNullAssertionReads: 0,
          totalReads: 10,
        },
      ],
      [],
      [
        {
          model: 'User',
          field: 'requiredField',
          type: 'String',
          optional: false,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    expect(findings).toHaveLength(0);
  });
});

describe('generateFindings — Recipe Secondary (bimodal-writes)', () => {
  const field: PrismaField = {
    model: 'User',
    field: 'someField',
    type: 'String',
    optional: true,
    defaultValue: null,
    doc: null,
  };

  it('flags HIGH when writes split bimodally (>=2 null/omit + >=2 value)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 2,
          valueSites: 3,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    const bimodal = findings.filter(f => f.recipe === 'bimodal-writes');
    expect(bimodal).toHaveLength(1);
    expect(bimodal[0].severity).toBe('HIGH');
  });

  it('does NOT flag when only one cluster present (e.g., all value)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    expect(findings.filter(f => f.recipe === 'bimodal-writes')).toHaveLength(0);
  });

  it('counts null and omit toward the same cluster', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 1,
          valueSites: 3,
          omittedSites: 1, // 1 null + 1 omit = 2 → bimodal threshold met
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [field]
    );
    expect(findings.filter(f => f.recipe === 'bimodal-writes')).toHaveLength(1);
  });
});

describe('generateFindings — Recipe Tertiary (always-passed-no-default)', () => {
  it('flags MEDIUM when all writes pass a value and no @default applies', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [
        {
          model: 'User',
          field: 'someField',
          type: 'String',
          optional: true,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    const t = findings.filter(f => f.recipe === 'always-passed-no-default');
    expect(t).toHaveLength(1);
    expect(t[0].severity).toBe('MEDIUM');
  });

  it('does NOT flag when @default is a generator (callers expected to omit)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'id',
          nullLiteralSites: 0,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 5,
        },
      ],
      [
        {
          model: 'User',
          field: 'id',
          type: 'String',
          optional: true,
          defaultValue: 'uuid()',
          doc: null,
        },
      ]
    );
    expect(findings.filter(f => f.recipe === 'always-passed-no-default')).toHaveLength(0);
  });

  it('does NOT flag when any site is null/omit (bimodal-writes territory)', () => {
    const findings = generateFindings(
      [],
      [
        {
          model: 'User',
          field: 'someField',
          nullLiteralSites: 1,
          valueSites: 5,
          omittedSites: 0,
          unclassifiableSites: 0,
          totalSites: 6,
        },
      ],
      [
        {
          model: 'User',
          field: 'someField',
          type: 'String',
          optional: true,
          defaultValue: null,
          doc: null,
        },
      ]
    );
    expect(findings.filter(f => f.recipe === 'always-passed-no-default')).toHaveLength(0);
  });
});
