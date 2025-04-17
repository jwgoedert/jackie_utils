const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const csv = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const ffmpeg = require('fluent-ffmpeg');
const readline = require('readline');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// Configuration
const CONFIG = {
  maxDimension: 2500,
  sourceDir: process.env.SOURCE_DIR || '/Volumes/T7 Shield/JACKIESUMELL.COM',
  targetDir: process.env.TARGET_DIR || '/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders',
  csvPath: './file_mapping.csv',
  logPath: './processing_errors.log',
  dirMatchesPath: './directory_matches.txt',
  validImageExts: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.pdf'],
  validVideoExts: ['.mp4', '.mov', '.avi', '.webm'],
  ffmpegPath: '/opt/homebrew/bin/ffmpeg',  // Add explicit ffmpeg path
  pdftocairoPath: '/opt/homebrew/bin/pdftocairo' // Add explicit pdftocairo path
};

// Set ffmpeg path
ffmpeg.setFfmpegPath(CONFIG.ffmpegPath);

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

// Enhanced IGNORED_PATTERNS with more comprehensive hidden file patterns
const IGNORED_PATTERNS = [
  /^\._/,         // macOS resource fork files
  /^\.DS_Store$/, // macOS system files
  /^Thumbs\.db$/, // Windows thumbnail files
  /^\./, // Any file starting with dot
  /^__MACOSX$/   // macOS archive files
];

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
    .replace(/\s+_gallery$/i, '_gallery')  // Fix spacing before _gallery suffix
    .replace(/\s+$/, '')    // Extra check for trailing spaces
    .replace(/^\s+/, '');   // Extra check for leading spaces
}

// Update directory comparison function
function isSameDirectory(dir1, dir2) {
  const norm1 = normalizeName(dir1);
  const norm2 = normalizeName(dir2);
  return norm1 === norm2;
}

// Update extractYearAndName function
function extractYearAndName(folderName) {
  // Extra thorough cleaning before normalization
  const cleaned = folderName
    .replace(/\s+/g, ' ')   // Replace multiple spaces with single space
    .trim();                // Remove trailing/leading spaces
    
  // Normalize the folder name
  const normalizedName = normalizeName(cleaned);
  const match = normalizedName.match(/^(\d{4})\s+(.+)$/);
  if (!match) return null;
  
  return {
    year: match[1],
    name: match[2].trim() // Ensure no trailing spaces in name
  };
}

// Update formatNewFileName function
function formatNewFileName(year, projectName, index, total, ext) {
  const cleanProjectName = projectName
    .trim()
    .replace(/\s+/g, '_')   // Replace spaces with single underscore
    .replace(/_+/g, '_');   // Normalize multiple underscores
  
  const paddedIndex = String(index).padStart(2, '0');
  const paddedTotal = String(total).padStart(2, '0');
  return `${year}_${cleanProjectName}_image${paddedIndex}of${paddedTotal}${ext}`;
}

// Add PDF processing function
async function processPdf(inputPath, outputPath) {
  try {
    const tempPrefix = path.join(path.dirname(outputPath), 'temp_pdf_convert');
    
    // Use pdftocairo to convert PDF to PNG with high resolution
    const cmd = `"${CONFIG.pdftocairoPath}" -png -r 300 -f 1 -l 1 "${inputPath}" "${tempPrefix}"`;
    await execPromise(cmd);
    
    // The output file will be temp_pdf_convert-1.png
    const tempPath = `${tempPrefix}-1.png`;
    
    // Use sharp to resize and optimize the converted image
    await sharp(tempPath)
      .resize(CONFIG.maxDimension, CONFIG.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ 
        quality: 90,
        compressionLevel: 9, // Maximum compression
        palette: true // Use palette-based quantization for smaller file size
      })
      .toFile(outputPath);

    // Verify the output file was created and check its size
    const stats = await fs.stat(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 1) {
      // If file is still large, try additional compression
      await sharp(outputPath)
        .png({ 
          quality: 80,
          compressionLevel: 9,
          palette: true,
          colors: 256 // Reduce color palette for smaller size
        })
        .toFile(outputPath + '.tmp');
      
      await fs.unlink(outputPath);
      await fs.rename(outputPath + '.tmp', outputPath);
    }

    // Clean up the temporary file
    await fs.unlink(tempPath);
    return true;
  } catch (error) {
    await logger.log(`Error processing PDF ${inputPath}: ${error.message}`);
    return false;
  }
}

// Update processImage function to handle PDFs
async function processImage(inputPath, outputPath, maxDimension) {
  try {
    // If it's a PDF, use the PDF processor
    if (path.extname(inputPath).toLowerCase() === '.pdf') {
      return await processPdf(inputPath, outputPath);
    }

    // Otherwise process as regular image
    const image = sharp(inputPath);
    const metadata = await image.metadata();
    
    // Calculate dimensions while maintaining aspect ratio
    let width = metadata.width;
    let height = metadata.height;
    
    if (width > height && width > maxDimension) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    } else if (height > maxDimension) {
      width = Math.round((width * maxDimension) / height);
      height = maxDimension;
    }

    await image
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ 
        quality: 90,
        compressionLevel: 9, // Maximum compression
        palette: true // Use palette-based quantization for smaller file size
      })
      .toFile(outputPath);

    // Verify the output file was created and log its size
    const stats = await fs.stat(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 1) {
      // If file is still large, try additional compression
      await sharp(outputPath)
        .png({ 
          quality: 80,
          compressionLevel: 9,
          palette: true,
          colors: 256 // Reduce color palette for smaller size
        })
        .toFile(outputPath + '.tmp');
      
      await fs.unlink(outputPath);
      await fs.rename(outputPath + '.tmp', outputPath);
    }

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

// Update getMediaFiles function to be more explicit about file types
async function getMediaFiles(directory) {
  try {
    const files = await fs.readdir(directory);
    return files.filter(file => {
      // Skip system files and hidden files using enhanced patterns
      if (IGNORED_PATTERNS.some(pattern => pattern.test(file) || pattern.test(path.basename(file)))) {
        return false;
      }
      
      const ext = path.extname(file).toLowerCase();
      const isValidFile = CONFIG.validImageExts.includes(ext) || 
                         CONFIG.validVideoExts.includes(ext);
      
      if (!isValidFile) {
        // Log unsupported file extensions
        logger.log(`Skipping unsupported file extension: ${ext} in file ${file}`, 'INFO');
      }
      
      return isValidFile;
    });
  } catch (error) {
    await logger.log(`Error getting media files from ${directory}: ${error.message}`);
    return [];
  }
}

// Update processProject function
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
    // Create target gallery directory
    await fs.mkdir(targetGalleryDir, { recursive: true });

    // Get filtered media files
    const mediaFiles = await getMediaFiles(sourceGalleryDir);
    
    if (mediaFiles.length === 0) {
      await logger.logProjectIssue(name, 'No valid media files found in gallery directory');
      return;
    }

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

// Add this after the Logger class but before main()
function askUserConfirmation(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y');
    });
  });
}

// Update the main function
async function main() {
  try {
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
    
    if (shouldProcess) {
      const proceed = await askUserConfirmation(
        'This will process all verified directories. Are you sure you want to proceed? (y/N): '
      );
      
      if (!proceed) {
        console.log('Operation cancelled.');
        return;
      }

      // Process files if --process flag is present
      console.log('\nProcessing verified directories...');
      let successCount = 0;
      let failureCount = 0;

      for (const projectDir of verifiedDirs) {
        console.log(`\nProcessing project directory: ${projectDir}`);
        try {
          await processProject(projectDir);
          successCount++;
        } catch (error) {
          await logger.log(`Failed to process directory ${projectDir}: ${error.message}`);
          failureCount++;
        }
      }

      console.log('\nProcessing complete:');
      console.log(`- Successfully processed: ${successCount} directories`);
      console.log(`- Failed to process: ${failureCount} directories`);
      console.log('Check the log files for any issues.');
    } else {
      console.log('\nPlease review directory_matches.txt and directory_errors.txt');
      console.log('To process the verified directories, run the script again with --process flag:');
      console.log('node process_images.js --process');
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  main().catch(console.error);
} 