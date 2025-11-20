#!/usr/bin/env node

/**
 * Script to detect singleton anti-patterns in the codebase
 * Finds modules that create instances during import and export them directly
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const COLORS = {
  RED: '\x1b[31m',
  YELLOW: '\x1b[33m',
  GREEN: '\x1b[32m',
  BLUE: '\x1b[34m',
  RESET: '\x1b[0m'
};

// Patterns to detect
const patterns = {
  singletonExports: [],
  nodeEnvChecks: [],
  typeofTimerChecks: [],
  importTimeExecution: []
};

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  
  // Skip test files
  if (filePath.includes('.test.js') || filePath.includes('__tests__')) {
    return;
  }

  let ast;
  try {
    ast = parser.parse(content, {
      sourceType: 'module',
      plugins: ['jsx']
    });
  } catch (error) {
    console.error(`Failed to parse ${filePath}: ${error.message}`);
    return;
  }

  const fileName = path.relative(process.cwd(), filePath);

  traverse(ast, {
    // Check for singleton pattern: const instance = new Class()
    VariableDeclarator(path) {
      if (path.node.init && path.node.init.type === 'NewExpression') {
        // Check if this is at the top level (not inside a function)
        let parent = path.parent;
        while (parent) {
          if (parent.type === 'FunctionDeclaration' || 
              parent.type === 'FunctionExpression' ||
              parent.type === 'ArrowFunctionExpression') {
            return; // It's inside a function, so it's OK
          }
          parent = parent.parent;
        }
        const varName = path.node.id.name;
        const className = path.node.init.callee.name;
        
        // Store info about this instance
        const instanceInfo = {
          varName,
          className,
          line: path.node.loc.start.line
        };
        
        // Check if this instance is exported later in the file
        const programPath = path.getFunctionParent() || path.scope.getProgramParent().path;
        programPath.traverse({
          AssignmentExpression(assignPath) {
            if (assignPath.node.left.type === 'MemberExpression' &&
                assignPath.node.left.object.name === 'module' &&
                assignPath.node.left.property.name === 'exports' &&
                assignPath.node.right.name === varName) {
              patterns.singletonExports.push({
                file: fileName,
                line: instanceInfo.line,
                code: `const ${varName} = new ${className}()`,
                export: `module.exports = ${varName}`
              });
            }
          }
        });
      }
    },

    // Check for module.exports.property = new Class()
    AssignmentExpression(path) {
      if (path.node.left.type === 'MemberExpression' &&
          path.node.left.object.type === 'MemberExpression' &&
          path.node.left.object.object.name === 'module' &&
          path.node.left.object.property.name === 'exports' &&
          path.node.right.type === 'NewExpression') {
        
        // Skip if inside a function
        let parent = path.parent;
        let insideFunction = false;
        while (parent) {
          if (parent.type === 'FunctionDeclaration' || 
              parent.type === 'FunctionExpression' ||
              parent.type === 'ArrowFunctionExpression') {
            insideFunction = true;
            break;
          }
          parent = parent.parent;
        }
        
        if (!insideFunction) {
          const propertyName = path.node.left.property.name;
          const className = path.node.right.callee.name;
          patterns.singletonExports.push({
            file: fileName,
            line: path.node.loc.start.line,
            code: `module.exports.${propertyName} = new ${className}()`,
            export: `module.exports.${propertyName}`
          });
        }
      }
      
      // Check for direct module.exports = new Class()
      if (path.node.left.type === 'MemberExpression' &&
          path.node.left.object.name === 'module' &&
          path.node.left.property.name === 'exports' &&
          path.node.right.type === 'NewExpression') {
        patterns.singletonExports.push({
          file: fileName,
          line: path.node.loc.start.line,
          code: `module.exports = new ${path.node.right.callee.name || 'Class'}()`,
          export: 'direct'
        });
      }
    },

    // Check for process.env.NODE_ENV
    MemberExpression(path) {
      if (path.node.object.type === 'MemberExpression' &&
          path.node.object.object.name === 'process' &&
          path.node.object.property.name === 'env' &&
          path.node.property.name === 'NODE_ENV') {
        patterns.nodeEnvChecks.push({
          file: fileName,
          line: path.node.loc.start.line,
          code: content.split('\n')[path.node.loc.start.line - 1].trim()
        });
      }
    },

    // Check for typeof timer checks
    BinaryExpression(path) {
      if (path.node.left.type === 'UnaryExpression' &&
          path.node.left.operator === 'typeof' &&
          ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].includes(path.node.left.argument.name) &&
          path.node.right.value === 'undefined') {
        patterns.typeofTimerChecks.push({
          file: fileName,
          line: path.node.loc.start.line,
          code: content.split('\n')[path.node.loc.start.line - 1].trim()
        });
      }
    },

    // Check for import-time setInterval/setTimeout
    CallExpression(path) {
      if (['setInterval', 'setTimeout'].includes(path.node.callee.name)) {
        // Check if this is at module level
        let isModuleLevel = true;
        let current = path.scope;
        while (current) {
          if (current.path && (
            current.path.type === 'FunctionDeclaration' ||
            current.path.type === 'FunctionExpression' ||
            current.path.type === 'ArrowFunctionExpression' ||
            current.path.type === 'ClassMethod'
          )) {
            isModuleLevel = false;
            break;
          }
          current = current.parent;
        }
        
        if (isModuleLevel) {
          patterns.importTimeExecution.push({
            file: fileName,
            line: path.node.loc.start.line,
            code: content.split('\n')[path.node.loc.start.line - 1].trim(),
            timer: path.node.callee.name
          });
        }
      }
    }
  });
}

function findFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  
  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and test directories
      if (!file.includes('node_modules') && !file.startsWith('.')) {
        findFiles(filePath, fileList);
      }
    } else if (file.endsWith('.js')) {
      fileList.push(filePath);
    }
  });
  
  return fileList;
}

function main() {
  console.log(`${COLORS.BLUE}🔍 Checking for singleton anti-patterns...${COLORS.RESET}\n`);
  
  const srcFiles = findFiles(path.join(process.cwd(), 'src'));
  
  srcFiles.forEach(file => {
    checkFile(file);
  });

  // Report findings
  let hasIssues = false;

  if (patterns.singletonExports.length > 0) {
    hasIssues = true;
    console.log(`${COLORS.RED}❌ Singleton Export Anti-patterns Found:${COLORS.RESET}`);
    patterns.singletonExports.forEach(issue => {
      console.log(`\n  ${issue.file}:${issue.line}`);
      console.log(`  ${COLORS.YELLOW}${issue.code}${COLORS.RESET}`);
      if (issue.export !== 'direct') {
        console.log(`  ${COLORS.YELLOW}${issue.export}${COLORS.RESET}`);
      }
    });
    console.log(`\n  ${COLORS.BLUE}Fix: Export a factory function or the class itself, not an instance${COLORS.RESET}`);
  }

  if (patterns.nodeEnvChecks.length > 0) {
    hasIssues = true;
    console.log(`\n${COLORS.RED}❌ NODE_ENV Checks Found:${COLORS.RESET}`);
    patterns.nodeEnvChecks.forEach(issue => {
      console.log(`\n  ${issue.file}:${issue.line}`);
      console.log(`  ${COLORS.YELLOW}${issue.code}${COLORS.RESET}`);
    });
    console.log(`\n  ${COLORS.BLUE}Fix: Use dependency injection instead of environment checks${COLORS.RESET}`);
  }

  if (patterns.typeofTimerChecks.length > 0) {
    hasIssues = true;
    console.log(`\n${COLORS.RED}❌ Timer Existence Checks Found:${COLORS.RESET}`);
    patterns.typeofTimerChecks.forEach(issue => {
      console.log(`\n  ${issue.file}:${issue.line}`);
      console.log(`  ${COLORS.YELLOW}${issue.code}${COLORS.RESET}`);
    });
    console.log(`\n  ${COLORS.BLUE}Fix: Inject timer functions as dependencies${COLORS.RESET}`);
  }

  if (patterns.importTimeExecution.length > 0) {
    hasIssues = true;
    console.log(`\n${COLORS.RED}❌ Import-time Timer Execution Found:${COLORS.RESET}`);
    patterns.importTimeExecution.forEach(issue => {
      console.log(`\n  ${issue.file}:${issue.line}`);
      console.log(`  ${COLORS.YELLOW}${issue.code}${COLORS.RESET}`);
    });
    console.log(`\n  ${COLORS.BLUE}Fix: Move timer initialization into a method or factory${COLORS.RESET}`);
  }

  if (!hasIssues) {
    console.log(`${COLORS.GREEN}✅ No singleton anti-patterns found!${COLORS.RESET}`);
  } else {
    console.log(`\n${COLORS.BLUE}📚 See docs/improvements/TIMER_INJECTION_REFACTOR.md for best practices${COLORS.RESET}`);
    process.exit(1);
  }
}

main();