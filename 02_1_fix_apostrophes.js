const fs = require('fs').promises;
const path = require('path');

// Configuration
const ROOT_DIR = '/Volumes/T7 Shield/JACKIESUMELL.COM'; // Replace this with your actual top-level path
const MAX_DEPTH = 4;
// Fix: Use a more comprehensive approach to detect apostrophes
const APOSTROPHE_PATTERN = /['']/g;  // Match both straight (U+0027) and curly (U+2019) apostrophes
const TYPO_APOSTROPHE = "’"; // U+2019
const YEAR_PATTERN = /^\d{4}/;

// Statistics tracking
const stats = {
  directoriesScanned: 0,
  directoriesRenamed: 0,
  errors: 0,
  skipped: 0
};

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

// Helper functions for console output
function printHeader() {
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bright}${colors.cyan}APOSTROPHE STANDARDIZATION TOOL${colors.reset}`);
  console.log('='.repeat(80));
  console.log(`${colors.bright}Base Directory:${colors.reset} ${ROOT_DIR}`);
  console.log(`${colors.bright}Max Depth:${colors.reset} ${MAX_DEPTH}`);
  console.log('='.repeat(80) + '\n');
}

function printProgress() {
  process.stdout.write(`\r${colors.dim}Directories scanned: ${stats.directoriesScanned} | Renamed: ${stats.directoriesRenamed} | Skipped: ${stats.skipped} | Errors: ${stats.errors}${colors.reset}`);
}

function printSummary() {
  console.log('\n\n' + '='.repeat(80));
  console.log(`${colors.bright}${colors.cyan}FINAL RESULTS${colors.reset}`);
  console.log('='.repeat(80));
  console.log(`${colors.bright}Directories Scanned:${colors.reset} ${stats.directoriesScanned}`);
  console.log(`${colors.bright}Directories Renamed:${colors.reset} ${stats.directoriesRenamed}`);
  console.log(`${colors.bright}Directories Skipped:${colors.reset} ${stats.skipped}`);
  console.log(`${colors.bright}Errors Encountered:${colors.reset} ${stats.errors}`);
  console.log('='.repeat(80));
  
  if (stats.errors === 0) {
    console.log(`\n${colors.green}✅ Apostrophe standardization completed successfully!${colors.reset}`);
  } else {
    console.log(`\n${colors.yellow}⚠️ Apostrophe standardization completed with ${stats.errors} errors${colors.reset}`);
  }
}

async function renameApostrophesInDirs(dir, depth = 0) {
  if (depth > MAX_DEPTH) return;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      stats.directoriesScanned++;
      printProgress();
      
      const currentPath = path.join(dir, entry.name);
      
      // Check if directory name contains apostrophes using the pattern
      if (APOSTROPHE_PATTERN.test(entry.name)) {
        // Reset the regex for the next test
        APOSTROPHE_PATTERN.lastIndex = 0;
        
        // Check if it's a year-prefixed directory or a subdirectory of one
        const isYearPrefixed = YEAR_PATTERN.test(entry.name);
        const parentDir = path.dirname(currentPath);
        const parentName = path.basename(parentDir);
        const isInYearDir = YEAR_PATTERN.test(parentName);
        
        if (isYearPrefixed || isInYearDir) {
          // Replace all apostrophes with the typographic version
          const newName = entry.name.replace(APOSTROPHE_PATTERN, TYPO_APOSTROPHE);
          const newPath = path.join(dir, newName);
          
          // Skip if the name would be the same after replacement
          if (newName === entry.name) {
            console.log(`\n${colors.yellow}⚠️ Skipping:${colors.reset} "${currentPath}" - already has typographic apostrophes`);
            stats.skipped++;
            continue;
          }
          
          try {
            await fs.rename(currentPath, newPath);
            console.log(`\n${colors.green}✅ Renamed:${colors.reset} "${currentPath}" → "${newPath}"`);
            stats.directoriesRenamed++;
            
            // Recurse into renamed path
            await renameApostrophesInDirs(newPath, depth + 1);
          } catch (error) {
            console.log(`\n${colors.red}❌ Error:${colors.reset} Failed to rename "${currentPath}": ${error.message}`);
            stats.errors++;
            
            // Still try to recurse into the original path
            await renameApostrophesInDirs(currentPath, depth + 1);
          }
        } else {
          // Not a year-prefixed directory or in one, skip
          stats.skipped++;
          await renameApostrophesInDirs(currentPath, depth + 1);
        }
      } else {
        // No apostrophes to fix, recurse normally
        stats.skipped++;
        await renameApostrophesInDirs(currentPath, depth + 1);
      }
    }
  } catch (error) {
    console.log(`\n${colors.red}❌ Error:${colors.reset} Failed to read directory "${dir}": ${error.message}`);
    stats.errors++;
  }
}

// Main execution
printHeader();
console.log(`${colors.cyan}Starting apostrophe standardization...${colors.reset}`);

renameApostrophesInDirs(ROOT_DIR)
  .then(() => {
    printSummary();
    console.log(`\n${colors.dim}See apostrophe_standardization.log for details${colors.reset}\n`);
  })
  .catch(err => {
    console.error(`\n${colors.red}❌ Script error:${colors.reset}`, err);
    process.exit(1);
  });