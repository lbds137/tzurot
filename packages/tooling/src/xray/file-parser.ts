/**
 * Xray — File Parser
 *
 * Uses ts-morph in isolated/in-memory mode to extract structural information
 * from TypeScript source files without type resolution.
 */

import {
  Project,
  type ClassDeclaration,
  type FunctionDeclaration,
  type ImportDeclaration,
  type SourceFile,
  Node,
  type Node as NodeType,
} from 'ts-morph';

import type {
  Declaration,
  DeclarationKind,
  FileInfo,
  ImportInfo,
  MemberInfo,
  ParameterInfo,
  SuppressionInfo,
  SuppressionKind,
} from './types.js';

interface ParseOptions {
  includePrivate?: boolean;
  includeImports?: boolean;
}

// Single shared project instance for in-memory parsing
const project = new Project({ useInMemoryFileSystem: true });

/**
 * Parse a TypeScript source file and extract structural information.
 */
export function parseFile(filePath: string, content: string, options: ParseOptions = {}): FileInfo {
  const { includePrivate = false, includeImports = false } = options;

  const sourceFile = project.createSourceFile('__xray_temp__.ts', content, {
    overwrite: true,
  });

  const lineCount = content.split('\n').length;

  const declarations = extractDeclarations(sourceFile, includePrivate);
  declarations.sort((a, b) => a.line - b.line);

  const imports = includeImports ? extractImports(sourceFile) : [];
  const suppressions = extractSuppressions(content);

  return { path: filePath, lineCount, declarations, imports, suppressions };
}

function extractDeclarations(sourceFile: SourceFile, includePrivate: boolean): Declaration[] {
  const declarations: Declaration[] = [];
  const shouldInclude = (exported: boolean): boolean => includePrivate || exported;

  for (const cls of sourceFile.getClasses()) {
    const decl = parseClass(cls);
    if (shouldInclude(decl.exported)) declarations.push(decl);
  }

  for (const func of sourceFile.getFunctions()) {
    const decl = parseFunction(func);
    if (shouldInclude(decl.exported)) declarations.push(decl);
  }

  // Simple named declarations: interfaces, types, enums
  type NamedNode = NodeType & {
    getName: () => string;
    isExported: () => boolean;
    getStartLineNumber: () => number;
  };
  const simpleDecls: { items: NamedNode[]; kind: DeclarationKind }[] = [
    { items: sourceFile.getInterfaces(), kind: 'interface' },
    { items: sourceFile.getTypeAliases(), kind: 'type' },
    { items: sourceFile.getEnums(), kind: 'enum' },
  ];

  for (const { items, kind } of simpleDecls) {
    for (const item of items) {
      const exported = item.isExported();
      if (!shouldInclude(exported)) continue;
      declarations.push({
        kind,
        name: item.getName(),
        exported,
        line: item.getStartLineNumber(),
        description: getJsDocFirstLine(item),
      });
    }
  }

  declarations.push(...extractVariables(sourceFile, shouldInclude));

  return declarations;
}

function extractVariables(
  sourceFile: SourceFile,
  shouldInclude: (exported: boolean) => boolean
): Declaration[] {
  const declarations: Declaration[] = [];

  for (const varStmt of sourceFile.getVariableStatements()) {
    const isExported = varStmt.isExported();
    if (!shouldInclude(isExported)) continue;

    for (const varDecl of varStmt.getDeclarations()) {
      declarations.push({
        kind: 'const',
        name: varDecl.getName(),
        exported: isExported,
        line: varDecl.getStartLineNumber(),
        description: getJsDocFirstLine(varStmt),
      });
    }
  }

  return declarations;
}

function extractImports(sourceFile: SourceFile): ImportInfo[] {
  return sourceFile.getImportDeclarations().map(parseImport);
}

function parseImport(importDecl: ImportDeclaration): ImportInfo {
  const namedImports = importDecl.getNamedImports().map(n => n.getName());
  const defaultImport = importDecl.getDefaultImport();
  const namespaceImport = importDecl.getNamespaceImport();

  const allImports = [...namedImports];
  if (defaultImport !== undefined) {
    allImports.unshift(defaultImport.getText());
  }
  if (namespaceImport !== undefined) {
    allImports.unshift(`* as ${namespaceImport.getText()}`);
  }

  return {
    source: importDecl.getModuleSpecifierValue(),
    namedImports: allImports,
    isTypeOnly: importDecl.isTypeOnly(),
  };
}

function parseClass(cls: ClassDeclaration): Declaration {
  const members: MemberInfo[] = [];

  for (const method of cls.getMethods()) {
    members.push({
      kind: 'method',
      name: method.getName(),
      visibility: getVisibility(method),
      parameters: method.getParameters().map(extractParam),
      returnType: method.getReturnTypeNode()?.getText(),
      bodyLineCount: getBodyLineCount(method),
    });
  }

  for (const prop of cls.getProperties()) {
    members.push({
      kind: 'property',
      name: prop.getName(),
      visibility: getVisibility(prop),
      returnType: prop.getTypeNode()?.getText(),
    });
  }

  return {
    kind: 'class',
    name: cls.getName() ?? '<anonymous>',
    exported: cls.isExported(),
    line: cls.getStartLineNumber(),
    members,
    description: getJsDocFirstLine(cls),
    bodyLineCount: getNodeLineCount(cls),
  };
}

function parseFunction(func: FunctionDeclaration): Declaration {
  return {
    kind: 'function',
    name: func.getName() ?? '<anonymous>',
    exported: func.isExported(),
    line: func.getStartLineNumber(),
    parameters: func.getParameters().map(extractParam),
    returnType: func.getReturnTypeNode()?.getText(),
    description: getJsDocFirstLine(func),
    bodyLineCount: getBodyLineCount(func),
  };
}

function extractParam(param: {
  getName: () => string;
  getTypeNode: () => { getText: () => string } | undefined;
  isOptional: () => boolean;
}): ParameterInfo {
  return {
    name: param.getName(),
    type: param.getTypeNode()?.getText() ?? 'unknown',
    optional: param.isOptional(),
  };
}

function getVisibility(node: { getScope?: () => string }): string {
  try {
    return node.getScope?.() ?? 'public';
  } catch {
    return 'public';
  }
}

function getJsDocFirstLine(node: NodeType): string | undefined {
  if (!Node.isJSDocable(node)) return undefined;
  const docs = node.getJsDocs();
  if (docs.length === 0) return undefined;
  const description = docs[0].getDescription().trim();
  if (description === '') return undefined;
  const firstLine = description.split('\n').find(l => l.trim() !== '');
  return firstLine?.trim();
}

function getBodyLineCount(node: {
  getBody?: () => { getStartLineNumber: () => number; getEndLineNumber: () => number } | undefined;
}): number | undefined {
  const body = node.getBody?.();
  if (body === undefined) return undefined;
  return body.getEndLineNumber() - body.getStartLineNumber() + 1;
}

function getNodeLineCount(node: {
  getStartLineNumber: () => number;
  getEndLineNumber: () => number;
}): number {
  return node.getEndLineNumber() - node.getStartLineNumber() + 1;
}

// Each pattern captures the raw tail after the directive as ONE group; the
// rule name and ` -- ` justification are split apart in code (splitSuppressionTail).
// A single greedy/lazy-to-a-literal-terminator capture is linear \u2014 the old nested
// optional groups (`(?:\s+(rule))?(?:\s+--\s+(just))?`) let the rule quantifier and
// the ` -- ` delimiter's `\s+` exchange characters, which regexp/no-super-linear-
// backtracking flags as polynomial ReDoS.
const SUPPRESSION_PATTERNS: {
  kind: SuppressionKind;
  regex: RegExp;
}[] = [
  {
    kind: 'eslint-disable-next-line',
    regex: /\/\/\s*eslint-disable-next-line(\s[^\n]*)?$/,
  },
  {
    kind: 'eslint-disable',
    regex: /\/\*\s*eslint-disable(\s[\s\S]*?)?\*\//,
  },
  {
    kind: 'ts-expect-error',
    regex: /\/\/\s*@ts-expect-error(\s[^\n]*)?$/,
  },
  {
    kind: 'ts-nocheck',
    regex: /\/\/\s*@ts-nocheck/,
  },
];

/**
 * Split a suppression comment's raw tail into its rule part and justification on
 * the ` -- ` delimiter (the project's lint-suppression convention). Splits on the
 * FIRST delimiter so a justification may itself contain ` -- `.
 */
function splitSuppressionTail(raw: string): { rulePart: string; justification?: string } {
  const DELIMITER = ' -- ';
  const delimIndex = raw.indexOf(DELIMITER);
  if (delimIndex === -1) {
    return { rulePart: raw.trim() };
  }
  return {
    rulePart: raw.slice(0, delimIndex).trim(),
    justification: raw.slice(delimIndex + DELIMITER.length).trim() || undefined,
  };
}

/** Build a SuppressionInfo from a matched directive's kind + raw tail. */
function buildSuppressionInfo(
  kind: SuppressionKind,
  lineNumber: number,
  rawTail: string
): SuppressionInfo {
  const info: SuppressionInfo = { kind, line: lineNumber };
  const { rulePart, justification } = splitSuppressionTail(rawTail);

  if (kind === 'eslint-disable-next-line' || kind === 'eslint-disable') {
    if (rulePart !== '') info.rule = rulePart;
    if (justification !== undefined) info.justification = justification;
  } else if (kind === 'ts-expect-error') {
    // No rule name \u2014 the justification is either after ` -- ` or the bare trailing text.
    const justText = justification ?? (rulePart !== '' ? rulePart : undefined);
    if (justText !== undefined) info.justification = justText;
  }

  return info;
}

/** Match the first suppression directive on a single line, if any. */
function matchSuppressionLine(line: string, lineNumber: number): SuppressionInfo | null {
  for (const { kind, regex } of SUPPRESSION_PATTERNS) {
    const match = regex.exec(line);
    if (match !== null) return buildSuppressionInfo(kind, lineNumber, match[1] ?? '');
  }
  return null;
}

/**
 * Extract lint suppression comments from raw file content.
 */
export function extractSuppressions(content: string): SuppressionInfo[] {
  return content.split('\n').flatMap((line, i) => {
    const info = matchSuppressionLine(line, i + 1);
    return info !== null ? [info] : [];
  });
}
