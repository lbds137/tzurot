/**
 * `prisma/drift-ignore.schema.json` declares constraints — `type` required on
 * every `protectedIndexes` entry, `additionalProperties: false` everywhere —
 * that `protectedIndexRegistry.ts` never checks at load time (it reads only
 * the fields it uses, so an entry missing `type` loads without complaint).
 * Without this test, the schema's constraints are purely advisory: nothing
 * runs them, so a committed file can drift out of shape while every other
 * gate stays green.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
// Named export, not the default: ajv ships CJS, so under `moduleResolution:
// NodeNext` a default import resolves to the module namespace object, which
// tsc rejects as not constructable (verified — the default-import form failed
// `pnpm --filter @tzurot/tooling build` with TS2351 while passing at runtime).
import { Ajv2020 } from 'ajv/dist/2020.js';

const SCHEMA_PATH = fileURLToPath(
  new URL('../../../../prisma/drift-ignore.schema.json', import.meta.url)
);
const DATA_PATH = fileURLToPath(new URL('../../../../prisma/drift-ignore.json', import.meta.url));

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;
const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8')) as {
  protectedIndexes: Record<string, unknown>[];
};

describe('drift-ignore.json validates against its schema', () => {
  it('the committed file validates', () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile(schema);

    const isValid = validate(data);

    expect(isValid, ajv.errorsText(validate.errors)).toBe(true);
  });

  it('rejects a protectedIndexes entry missing the required `type` field', () => {
    const ajv = new Ajv2020();
    const validate = ajv.compile(schema);

    const invalid = structuredClone(data);
    delete invalid.protectedIndexes[0]?.type;

    expect(validate(invalid)).toBe(false);
    expect(ajv.errorsText(validate.errors)).toContain("required property 'type'");
  });
});
