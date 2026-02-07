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
    { items: sourceFile.getInterfaces() as NamedNode[], kind: 'interface' },
    { items: sourceFile.getTypeAliases() as NamedNode[], kind: 'type' },
    { items: sourceFile.getEnums() as NamedNode[], kind: 'enum' },
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

const SUPPRESSION_PATTERNS: {
  kind: SuppressionKind;
  regex: RegExp;
}[] = [
  {
    kind: 'eslint-disable-next-line',
    regex: /\/\/\s*eslint-disable-next-line(?:\s+([^\s-][^\n]*?))?(?:\s+--\s+(.+))?$/,
  },
  {
    kind: 'eslint-disable',
    regex: /\/\*\s*eslint-disable(?:\s+([^\s*][^*]*?))?(?:\s+--\s+(.+?))?\s*\*\//,
  },
  {
    kind: 'ts-expect-error',
    regex: /\/\/\s*@ts-expect-error(?:\s+--\s+(.+)|(\s+.+))?$/,
  },
  {
    kind: 'ts-nocheck',
    regex: /\/\/\s*@ts-nocheck/,
  },
];

/**
 * Extract lint suppression comments from raw file content.
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- pattern-matching loop with simple branches
export function extractSuppressions(content: string): SuppressionInfo[] {
  const suppressions: SuppressionInfo[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const { kind, regex } of SUPPRESSION_PATTERNS) {
      const match = regex.exec(line);
      if (match === null) continue;

      const info: SuppressionInfo = { kind, line: i + 1 };

      if (kind === 'eslint-disable-next-line' || kind === 'eslint-disable') {
        if (match[1] !== undefined && match[1].trim() !== '') info.rule = match[1].trim();
        if (match[2] !== undefined && match[2].trim() !== '') {
          info.justification = match[2].trim();
        }
      } else if (kind === 'ts-expect-error') {
        // match[1] is after " -- ", match[2] is trailing text without " -- "
        const justText = match[1] ?? match[2];
        if (justText !== undefined && justText.trim() !== '') {
          info.justification = justText.trim();
        }
      }

      suppressions.push(info);
      break; // Only match first pattern per line
    }
  }

  return suppressions;
}
