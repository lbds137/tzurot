/**
 * Xray — TypeScript AST Analysis Tool
 *
 * Data model interfaces for structural codebase analysis.
 */

export interface XrayReport {
  generatedAt: string;
  packages: PackageInfo[];
  summary: ReportSummary;
}

export interface PackageInfo {
  name: string;
  path: string;
  files: FileInfo[];
}

export type SuppressionKind =
  | 'eslint-disable'
  | 'eslint-disable-next-line'
  | 'ts-expect-error'
  | 'ts-nocheck';

export interface SuppressionInfo {
  kind: SuppressionKind;
  line: number;
  rule?: string;
  justification?: string;
}

export interface FileInfo {
  path: string;
  lineCount: number;
  declarations: Declaration[];
  imports: ImportInfo[];
  suppressions: SuppressionInfo[];
}

export type DeclarationKind = 'class' | 'function' | 'interface' | 'type' | 'const' | 'enum';

export interface Declaration {
  kind: DeclarationKind;
  name: string;
  exported: boolean;
  line: number;
  members?: MemberInfo[];
  parameters?: ParameterInfo[];
  returnType?: string;
  description?: string;
  bodyLineCount?: number;
}

export interface MemberInfo {
  kind: 'method' | 'property';
  name: string;
  visibility: string;
  parameters?: ParameterInfo[];
  returnType?: string;
  bodyLineCount?: number;
}

export interface ParameterInfo {
  name: string;
  type: string;
  optional: boolean;
}

export interface ImportInfo {
  source: string;
  namedImports: string[];
  isTypeOnly: boolean;
}

export interface PackageHealth {
  totalLines: number;
  fileCount: number;
  exportedDeclarations: number;
  totalSuppressions: number;
  largestFile: { path: string; lines: number };
  avgDeclarationsPerFile: number;
  warnings: string[];
}

export interface ReportSummary {
  totalFiles: number;
  totalClasses: number;
  totalFunctions: number;
  totalInterfaces: number;
  totalTypes: number;
  totalSuppressions: number;
  byPackage: Record<
    string,
    {
      files: number;
      classes: number;
      functions: number;
      health: PackageHealth;
    }
  >;
}

export interface XrayOptions {
  packages?: string[];
  format?: 'terminal' | 'md' | 'json';
  includeTests?: boolean;
  includePrivate?: boolean;
  imports?: boolean;
  summary?: boolean;
  suppressions?: boolean;
  output?: string;
}
