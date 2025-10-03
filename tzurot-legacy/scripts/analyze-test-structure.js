#!/usr/bin/env node

/**
 * Analyze test structure and identify mismatches with source code
 */

const fs = require('fs');
const path = require('path');

// Get all source files
function getSourceFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      getSourceFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.includes('.test.')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Get all test files
function getTestFiles(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      getTestFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Analyze the structure
function analyzeStructure() {
  const sourceFiles = getSourceFiles('src');
  const testFiles = getTestFiles('tests/unit');
  
  console.log('=== Test Structure Analysis ===\n');
  
  // Find source files without tests
  console.log('Source files without corresponding tests:');
  const sourcesWithoutTests = [];
  
  for (const sourceFile of sourceFiles) {
    const relativePath = path.relative('src', sourceFile);
    const expectedTestPath = path.join('tests/unit', relativePath.replace('.js', '.test.js'));
    
    if (!fs.existsSync(expectedTestPath)) {
      sourcesWithoutTests.push({ source: sourceFile, expectedTest: expectedTestPath });
    }
  }
  
  if (sourcesWithoutTests.length === 0) {
    console.log('  ✓ All source files have tests in expected locations\n');
  } else {
    sourcesWithoutTests.forEach(({ source, expectedTest }) => {
      console.log(`  ❌ ${source}`);
      console.log(`     Expected test: ${expectedTest}`);
    });
    console.log();
  }
  
  // Find tests without corresponding source files
  console.log('Test files without corresponding source:');
  const testsWithoutSource = [];
  
  for (const testFile of testFiles) {
    const relativePath = path.relative('tests/unit', testFile);
    const expectedSourcePath = path.join('src', relativePath.replace('.test.js', '.js'));
    
    // Handle special cases (like multiple test files for one source)
    const baseName = path.basename(testFile, '.test.js');
    const isSpecializedTest = baseName.includes('.') && !baseName.startsWith('.');
    
    if (!fs.existsSync(expectedSourcePath) && !isSpecializedTest) {
      testsWithoutSource.push({ test: testFile, expectedSource: expectedSourcePath });
    }
  }
  
  if (testsWithoutSource.length === 0) {
    console.log('  ✓ All tests have corresponding source files\n');
  } else {
    testsWithoutSource.forEach(({ test, expectedSource }) => {
      console.log(`  ❌ ${test}`);
      console.log(`     Expected source: ${expectedSource}`);
    });
    console.log();
  }
  
  // Find duplicate test coverage
  console.log('Modules with multiple test files:');
  const testsByModule = {};
  
  for (const testFile of testFiles) {
    const baseName = path.basename(testFile, '.test.js').split('.')[0];
    if (!testsByModule[baseName]) {
      testsByModule[baseName] = [];
    }
    testsByModule[baseName].push(testFile);
  }
  
  const duplicates = Object.entries(testsByModule).filter(([_, tests]) => tests.length > 1);
  
  if (duplicates.length === 0) {
    console.log('  ✓ No duplicate test coverage found\n');
  } else {
    duplicates.forEach(([module, tests]) => {
      console.log(`  ⚠️  ${module}:`);
      tests.forEach(test => console.log(`     - ${test}`));
    });
    console.log();
  }
  
  // Check for inconsistent naming
  console.log('Inconsistent test naming patterns:');
  const namingIssues = [];
  
  for (const testFile of testFiles) {
    const fileName = path.basename(testFile);
    
    // Check for camelCase vs kebab-case inconsistency
    if (fileName.includes('-') && fileName.match(/[A-Z]/)) {
      namingIssues.push({ file: testFile, issue: 'Mixed camelCase and kebab-case' });
    }
    
    // Check for tests at wrong level
    const relativePath = path.relative('tests/unit', testFile);
    const pathParts = relativePath.split(path.sep);
    
    // If test is for a file in a subdirectory but test is at root level
    if (pathParts.length === 1 && !relativePath.includes('.')) {
      const baseName = path.basename(testFile, '.test.js').split('.')[0];
      const possibleSource = sourceFiles.find(s => s.includes(`/${baseName}.js`));
      
      if (possibleSource && possibleSource.includes('/')) {
        namingIssues.push({ 
          file: testFile, 
          issue: `Should be in subdirectory to match source: ${possibleSource}` 
        });
      }
    }
  }
  
  if (namingIssues.length === 0) {
    console.log('  ✓ Test naming is consistent\n');
  } else {
    namingIssues.forEach(({ file, issue }) => {
      console.log(`  ⚠️  ${file}`);
      console.log(`     ${issue}`);
    });
    console.log();
  }
  
  // Summary
  console.log('=== Summary ===');
  console.log(`Total source files: ${sourceFiles.length}`);
  console.log(`Total test files: ${testFiles.length}`);
  console.log(`Source files without tests: ${sourcesWithoutTests.length}`);
  console.log(`Test files without source: ${testsWithoutSource.length}`);
  console.log(`Modules with duplicate tests: ${duplicates.length}`);
  console.log(`Naming inconsistencies: ${namingIssues.length}`);
}

// Run the analysis
analyzeStructure();