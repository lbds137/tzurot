/**
 * Script to update the TEST_COVERAGE_SUMMARY.md file with the latest coverage data
 */
const fs = require('fs');
const path = require('path');

// Path to the coverage report
const coverageSummaryPath = path.join(__dirname, '..', 'coverage', 'coverage-summary.json');
// Path to the markdown file
const markdownPath = path.join(__dirname, '..', 'docs', 'testing', 'TEST_COVERAGE_SUMMARY.md');

// Helper function to read the previous coverage file
function readPreviousCoverage() {
  try {
    const previousContent = fs.readFileSync(markdownPath, 'utf8');
    return previousContent;
  } catch (error) {
    console.error(`Error reading previous coverage file: ${error.message}`);
    return null;
  }
}

// Helper function to update the coverage summary
function updateCoverageSummary() {
  try {
    // Read the coverage summary
    const coverageSummary = JSON.parse(fs.readFileSync(coverageSummaryPath, 'utf8'));
    
    // Extract the total coverage
    const total = coverageSummary.total;
    
    // Create the coverage table
    let coverageTable = '```\n';
    coverageTable += '--------------------------|---------|-----------|---------|---------|-----------------------------------------------------------------------------------------------------------------\n';
    coverageTable += 'File                     | % Stmts | % Branch  | % Funcs | % Lines | Uncovered Line #s                                                                                               \n';
    coverageTable += '--------------------------|---------|-----------|---------|---------|-----------------------------------------------------------------------------------------------------------------\n';
    
    // Add the total row
    coverageTable += 'All files                ';
    coverageTable += ` | ${formatPercentage(total.statements.pct)}`;
    coverageTable += ` | ${formatPercentage(total.branches.pct)}`;
    coverageTable += ` | ${formatPercentage(total.functions.pct)}`;
    coverageTable += ` | ${formatPercentage(total.lines.pct)}`;
    coverageTable += ' |                                                                                                               \n';
    
    // Add rows for each file
    const files = Object.keys(coverageSummary).filter(key => key !== 'total');
    
    files.forEach(file => {
      // Skip total and directory entries
      if (file === 'total' || !file.includes('.js')) {
        return;
      }
      
      // Get just the filename
      const filename = file.split('/').pop();
      
      // Get the coverage data
      const fileCoverage = coverageSummary[file];
      
      // Add padding to filename
      const paddedFilename = filename.padEnd(25, ' ');
      
      // Add the file row
      coverageTable += paddedFilename;
      coverageTable += ` | ${formatPercentage(fileCoverage.statements.pct)}`;
      coverageTable += ` | ${formatPercentage(fileCoverage.branches.pct)}`;
      coverageTable += ` | ${formatPercentage(fileCoverage.functions.pct)}`;
      coverageTable += ` | ${formatPercentage(fileCoverage.lines.pct)}`;
      
      // Add uncovered lines if available
      let uncoveredLines = '';
      if (fileCoverage.lines.skipped) {
        uncoveredLines = formatLineNumbers(fileCoverage.lines.skipped);
      }
      coverageTable += ` | ${uncoveredLines}\n`;
    });
    
    coverageTable += '--------------------------|---------|-----------|---------|---------|-----------------------------------------------------------------------------------------------------------------\n';
    coverageTable += '```\n';
    
    // Read the previous markdown file
    const previousContent = readPreviousCoverage();
    
    // Create the new markdown content
    let markdownContent = '# Test Coverage Summary\n\n';
    markdownContent += '## Overall Coverage\n';
    markdownContent += coverageTable;
    
    // If previous content exists, keep everything after the coverage table
    if (previousContent) {
      const afterTableContent = previousContent.split('```\n')[1];
      if (afterTableContent) {
        markdownContent += '\n' + afterTableContent;
      }
    }
    
    // Write the updated markdown file
    fs.writeFileSync(markdownPath, markdownContent);
    
    console.log(`Coverage summary updated in ${markdownPath}`);
  } catch (error) {
    console.error(`Error updating coverage summary: ${error.message}`);
  }
}

// Helper function to format percentage
function formatPercentage(value) {
  if (value === undefined || value === null) {
    return 'N/A'.padEnd(7, ' ');
  }
  
  return value.toFixed(2).toString().padEnd(7, ' ');
}

// Helper function to format line numbers
function formatLineNumbers(lines) {
  if (!lines || lines.length === 0) {
    return '';
  }
  
  // Convert the line numbers array to a string
  return lines.join(',').padEnd(48, ' ');
}

// Execute the function
updateCoverageSummary();