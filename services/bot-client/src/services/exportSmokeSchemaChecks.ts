/**
 * Export-smoke validator — per-file JSON schema validation + `.md` emptiness.
 *
 * Split out of `exportSmokeValidator.ts` to stay under the ESLint
 * `max-lines` budget. Runs unconditionally (unlike the manifest/id/count
 * checks) — it does not need the parsed personality directory. See
 * `exportSmokeValidator.ts`'s docstring for the SECURITY constraint on
 * findings (never exported file content).
 */

import type { z } from 'zod';
import { resolveExportSchemaForPath } from '@tzurot/common-types/schemas/export/accountExportManifest';

const decoder = new TextDecoder();

function issueSummary(error: z.ZodError): string {
  return error.issues
    .map(issue => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}:${issue.code}`)
    .join('; ');
}

function validateJsonFile(path: string, bytes: Uint8Array, findings: string[]): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    findings.push(`json-parse: ${path} failed to parse`);
    return;
  }

  const schema = resolveExportSchemaForPath(path);
  if (schema === undefined) {
    findings.push(`json-schema: ${path} is an unrecognized json path`);
    return;
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    findings.push(`json-schema: ${path} failed validation (${issueSummary(result.error)})`);
  }
}

function validateMdFile(path: string, bytes: Uint8Array, findings: string[]): void {
  const text = decoder.decode(bytes);
  if (text.trim() === '') {
    findings.push(`md-empty: ${path} is empty`);
  }
}

/** Validates every `.json` and `.md` file in the archive independently of the manifest. */
export function validateJsonAndMdFiles(
  files: Record<string, Uint8Array>,
  findings: string[]
): void {
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('.json')) {
      validateJsonFile(path, bytes, findings);
    } else if (path.endsWith('.md')) {
      validateMdFile(path, bytes, findings);
    }
  }
}
