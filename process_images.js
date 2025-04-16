const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const ffmpeg = require('fluent-ffmpeg');

// Configuration
const CONFIG = {
  maxDimension: 2500,
  sourceDir: process.env.SOURCE_DIR || '/Volumes/T7 Shield/JACKIESUMELL.COM',
  targetDir: process.env.TARGET_DIR || '/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders',
  csvPath: './file_mapping.csv',
  logPath: './processing_errors.log',
  dirMatchesPath: './directory_matches.txt',
  validImageExts: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.pdf'],
  validVideoExts: ['.mp4', '.mov', '.avi', '.webm']
};

// Add near the top of the file, after the require statements
const shouldProcess = process.argv.includes('--process');

// CSV writer setup
const csvWriter = createCsvWriter({
  path: CONFIG.csvPath,
  header: [
    { id: 'originalName', title: 'Original File Name' },
    { id: 'newName', title: 'New File Name' },
    { id: 'originalPath', title: 'Original Path' },
    { id: 'newPath', title: 'New Path' },
    { id: 'projectName', title: 'Project Name' },
    { id: 'year', title: 'Year' }
  ]
});

// Enhanced Logger setup
class Logger {
  constructor(logPath, dirMatchesPath) {
    this.logPath = logPath;
    this.dirMatchesPath = dirMatchesPath;
    this.dirErrorsPath = './directory_errors.txt';
    this.errors = [];
    this.dirMatches = [];
    this.dirErrors = [];
  }

  async log(message, type = 'ERROR') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${type}: ${message}\n`;
    this.errors.push(logEntry);
    await fs.appendFile(this.logPath, logEntry);
    console.log(logEntry.trim());
  }

  async logDirectoryMatch(sourcePath, targetPath, status, reason = '') {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] DIRECTORY_MATCH:
    Source: ${sourcePath}
    Target: ${targetPath}
    Status: ${status}${reason ? '\n    Reason: ' + reason : ''}\n`;
    
    this.dirMatches.push(logEntry);
    await fs.appendFile(this.dirMatchesPath, logEntry);
    
    if (status === 'FAILED') {
      this.dirErrors.push(logEntry);
    }
    
    console.log(logEntry.trim());
  }

  async logProjectIssue(projectName, issue) {
    await this.log(`Project "${projectName}": ${issue}`, 'PROJECT_ISSUE');
  }

  async writeDirectoryErrors() {
    try {
      await fs.writeFile(this.dirErrorsPath, this.dirErrors.join(''));
    } catch (error) {
      console.error('Error writing directory errors:', error);
    }
  }
}

const logger = new Logger(CONFIG.logPath, CONFIG.dirMatchesPath);

// Helper functions
function normalizeName(name) {
  return name
    .trim()  // Remove trailing/leading spaces
    .replace(/['']/g, "'")  // Normalize apostrophes
    .replace(/\s+/g, ' ')   // Replace multiple spaces with single space
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')  // Add space after numbers if missing
    .replace(/_+/g, '_')    // Normalize multiple underscores
    .replace(/\s+_gallery$/i, '_gallery');  // Fix spacing before _gallery suffix
}

function extractYearAndName(folderName) {
  // Normalize the folder name first
  const normalizedName = normalizeName(folderName);
  const match = normalizedName.match(/^(\d{4})\s+(.+)$/);
  if (!match) return null;
  return {
    year: match[1],
    name: match[2].trim() // Ensure no trailing spaces
  };
}

function formatNewFileName(year, projectName, index, total, ext) {
  const paddedIndex = String(index).padStart(2, '0');
  const paddedTotal = String(total).padStart(2, '0');
  return `${year}_${projectName.replace(/\s+/g, '_')}_image${paddedIndex}of${paddedTotal}${ext}`;
}

async function processImage(inputPath, outputPath, maxDimension) {
  try {
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    const isLandscape = metadata.width > metadata.height;
    const resizeOptions = isLandscape 
      ? { width: maxDimension, height: null }
      : { width: null, height: maxDimension };

    await image
      .resize(resizeOptions)
      .png({ quality: 90 })
      .toFile(outputPath);

    return true;
  } catch (error) {
    await logger.log(`Error processing image ${inputPath}: ${error.message}`);
    return false;
  }
}

async function processVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .size('2500x?')
      .format('webm')
      .on('end', () => resolve(true))
      .on('error', async (err) => {
        await logger.log(`Error processing video ${inputPath}: ${err.message}`);
        resolve(false);
      })
      .save(outputPath);
  });
}

// Main processing function
async function processProject(projectDir) {
  const projectInfo = extractYearAndName(path.basename(projectDir));
  if (!projectInfo) {
    await logger.logProjectIssue(projectDir, 'Invalid project folder name format');
    return;
  }

  const { year, name } = projectInfo;
  const sourceGalleryDir = path.join(projectDir, `${year} ${name}_gallery`);
  const targetGalleryDir = path.join(CONFIG.targetDir, `${year} ${name}`, `${year} ${name}_gallery`);
  
  try {
    const files = await fs.readdir(sourceGalleryDir);
    if (files.length === 0) {
      await logger.logProjectIssue(name, 'No files found in gallery directory');
      return;
    }

    const mediaFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return CONFIG.validImageExts.includes(ext) || CONFIG.validVideoExts.includes(ext);
    });

    // Create target gallery directory
    await fs.mkdir(targetGalleryDir, { recursive: true });

    const csvData = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file).toLowerCase();
      const originalPath = path.join(sourceGalleryDir, file);
      const newFileName = formatNewFileName(year, name, i + 1, mediaFiles.length, '.png');
      const newPath = path.join(targetGalleryDir, newFileName);

      let success = false;
      if (CONFIG.validImageExts.includes(ext)) {
        success = await processImage(originalPath, newPath, CONFIG.maxDimension);
      } else if (CONFIG.validVideoExts.includes(ext)) {
        const webmPath = newPath.replace('.png', '.webm');
        success = await processVideo(originalPath, webmPath);
      }

      if (success) {
        csvData.push({
          originalName: file,
          newName: newFileName,
          originalPath: originalPath,
          newPath: newPath,
          projectName: name,
          year: year
        });
      }
    }

    await csvWriter.writeRecords(csvData);

  } catch (error) {
    if (error.code === 'ENOENT') {
      await logger.logProjectIssue(name, 'Gallery directory not found');
    } else {
      await logger.logProjectIssue(name, `Error processing project: ${error.message}`);
    }
  }
}

// New helper function to check if directory is a project directory
function isProjectDirectory(dirName) {
  return /^\d{4}\s+.+$/.test(dirName);
}

// New helper function to check if directory is an NV directory
function isNVDirectory(dirName) {
  return /^NV/.test(dirName);
}

// New function to recursively find project directories
async function findProjectDirectories(baseDir) {
  const projectDirs = [];
  
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      
      const fullPath = path.join(baseDir, entry.name);
      
      if (isProjectDirectory(entry.name)) {
        projectDirs.push(fullPath);
      } else if (isNVDirectory(entry.name)) {
        // Recursively search NV directories
        const subDirs = await findProjectDirectories(fullPath);
        projectDirs.push(...subDirs);
      }
    }
  } catch (error) {
    await logger.log(`Error searching directory ${baseDir}: ${error.message}`);
  }
  
  return projectDirs;
}

// New function to verify directory structure
async function verifyProjectDirectory(projectDir) {
  const projectInfo = extractYearAndName(path.basename(projectDir));
  if (!projectInfo) {
    await logger.logDirectoryMatch(projectDir, '', 'FAILED', 'Invalid project folder name format');
    return false;
  }

  const { year, name } = projectInfo;
  const sourceGalleryDir = path.join(projectDir, `${year} ${name}_gallery`);
  const targetProjectDir = path.join(CONFIG.targetDir, `${year} ${name}`);
  const targetGalleryDir = path.join(targetProjectDir, `${year} ${name}_gallery`);

  try {
    // Check if source gallery exists and has media files
    try {
      await fs.access(sourceGalleryDir);
      const sourceFiles = await fs.readdir(sourceGalleryDir);
      const mediaFiles = sourceFiles.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return CONFIG.validImageExts.includes(ext) || CONFIG.validVideoExts.includes(ext);
      });

      if (mediaFiles.length === 0) {
        await logger.logDirectoryMatch(sourceGalleryDir, targetGalleryDir, 'FAILED', 'No media files found in source gallery');
        return false;
      }

      // Check target gallery directory
      try {
        await fs.access(targetGalleryDir);
        // If gallery exists, check if it's empty
        const targetFiles = await fs.readdir(targetGalleryDir);
        if (targetFiles.length > 0) {
          await logger.logDirectoryMatch(sourceGalleryDir, targetGalleryDir, 'FAILED', 'Target gallery directory exists and is not empty');
          return false;
        }
      } catch (error) {
        // Create target directories if they don't exist
        await fs.mkdir(targetProjectDir, { recursive: true });
        await fs.mkdir(targetGalleryDir, { recursive: true });
      }

      await logger.logDirectoryMatch(sourceGalleryDir, targetGalleryDir, 'SUCCESS', `Found ${mediaFiles.length} media files to process`);
      return true;

    } catch (error) {
      await logger.logDirectoryMatch(sourceGalleryDir, '', 'FAILED', 'Source gallery directory not found');
      return false;
    }

  } catch (error) {
    await logger.logDirectoryMatch(projectDir, targetProjectDir, 'FAILED', `Error: ${error.message}`);
    return false;
  }
}

// Add a cleanup function at the start of main()
async function cleanTargetDirectory() {
  try {
    console.log(`Cleaning target directory: ${CONFIG.targetDir}`);
    await fs.rm(CONFIG.targetDir, { recursive: true, force: true });
    await fs.mkdir(CONFIG.targetDir, { recursive: true });
    console.log('Target directory cleaned successfully.');
  } catch (error) {
    console.error('Error cleaning target directory:', error);
    throw error;
  }
}

// Update main execution function
async function main() {
  try {
    if (shouldProcess) {
      const proceed = await askUserConfirmation(
        'This will delete all contents in the target directory. Are you sure you want to proceed? (y/N): '
      );
      if (!proceed) {
        console.log('Operation cancelled.');
        return;
      }
      await cleanTargetDirectory();
    }

    // Clear the directory errors at the start
    await fs.writeFile(logger.dirErrorsPath, '');

    console.log('Searching for project directories...');
    const projectDirs = await findProjectDirectories(CONFIG.sourceDir);
    console.log(`Found ${projectDirs.length} project directories to process.`);
    
    // First, verify all directories
    console.log('\nVerifying directory structure...');
    const verifiedDirs = [];
    for (const projectDir of projectDirs) {
      if (await verifyProjectDirectory(projectDir)) {
        verifiedDirs.push(projectDir);
      }
    }

    // Write all directory errors to file
    await logger.writeDirectoryErrors();

    console.log(`\nVerification complete. ${verifiedDirs.length} of ${projectDirs.length} directories ready for processing.`);
    
    if (!shouldProcess) {
      console.log('\nPlease review directory_matches.txt and directory_errors.txt');
      console.log('To process the verified directories, run the script again with --process flag:');
      console.log('node process_images.js --process');
      return;
    }

    // Process files if --process flag is present
    console.log('\nProcessing verified directories...');
    for (const projectDir of verifiedDirs) {
      console.log(`Processing project directory: ${projectDir}`);
      await processProject(projectDir);
    }
    console.log('Processing complete. Check the log files for any issues.');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
} 