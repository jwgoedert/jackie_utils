const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const ffmpeg = require('fluent-ffmpeg');
const readline = require('readline');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

// System verification function
async function verifySystemRequirements() {
  const checks = [];
  
  // Check Sharp installation and plugins
  try {
    // Just check the version info - don't try to process any images
    const version = sharp.versions;
    checks.push({ 
      name: 'Sharp', 
      status: 'OK', 
      version: `v${version.sharp} (libvips ${version.vips})`
    });
  } catch (error) {
    checks.push({ 
      name: 'Sharp', 
      status: 'ERROR', 
      error: 'Sharp not properly installed. Try: npm rebuild sharp'
    });
  }

  // Check ImageMagick
  try {
    const { stdout } = await execPromise('convert -version');
    checks.push({ name: 'ImageMagick', status: 'OK', version: stdout.split('\n')[0] });
  } catch (error) {
    checks.push({ name: 'ImageMagick', status: 'ERROR', error: error.message });
  }

  // Check ffmpeg
  try {
    const { stdout } = await execPromise('ffmpeg -version');
    checks.push({ name: 'ffmpeg', status: 'OK', version: stdout.split('\n')[0] });
  } catch (error) {
    checks.push({ name: 'ffmpeg', status: 'ERROR', error: error.message });
  }

  // Check libheif
  try {
    const { stdout } = await execPromise('brew list libheif');
    checks.push({ name: 'libheif', status: 'OK' });
  } catch (error) {
    checks.push({ 
      name: 'libheif', 
      status: 'ERROR', 
      error: 'libheif not installed. Install with: brew install libheif'
    });
  }

  return checks;
}

// Configuration with detailed comments
const CONFIG = {
  maxDimension: 2500,
  sourceDir: process.env.SOURCE_DIR || '/Volumes/T7 Shield/JACKIESUMELL.COM',
  targetDir: process.env.TARGET_DIR || '/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders',
  csvPath: './file_mapping.csv',
  logPath: './processing_errors.log',
  dirMatchesPath: './directory_matches.txt',
  directoryMismatchLog: './directory_mismatches.log',
  processingStatsLog: './processing_stats.log',  // New log for processing statistics
  validImageExts: ['.jpg','.JPG', '.jpeg', '.png', '.gif', '.webp', '.tif', '.pdf', '.heic', '.psd', '.ai', '.tiff'],
  validVideoExts: ['.mp4', '.mov', '.avi', '.webm'],
  ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  pdftocairoPath: '/opt/homebrew/bin/pdftocairo',
  convertPath: '/opt/homebrew/bin/convert',
  // Processing options
  imageCompression: {
    quality: 90,
    compressionLevel: 9,
    palette: true
  },
  // Timeouts
  timeouts: {
    imagemagick: 120000,  // 2 minutes
    ffmpeg: 300000,       // 5 minutes
    pdf: 180000          // 3 minutes
  }
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

// Enhanced Logger class
class Logger {
  constructor(logPath, dirMatchesPath) {
    this.logPath = logPath;
    this.dirMatchesPath = dirMatchesPath;
    this.dirErrorsPath = './directory_errors.txt';
    this.directoryMismatchPath = CONFIG.directoryMismatchLog;
    this.processingStatsPath = CONFIG.processingStatsLog;
    this.errors = [];
    this.dirMatches = [];
    this.dirErrors = [];
    this.stats = {
      totalFiles: 0,
      processedFiles: 0,
      failedFiles: 0,
      byExtension: {}
    };
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

  async logDirectoryMismatch(sourceDir, details) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] DIRECTORY_MISMATCH:
    Source Directory: ${sourceDir}
    Details: ${details}
    Files Found:\n`;

    try {
      const files = await fs.readdir(sourceDir);
      const filesList = files.map(file => `      - ${file}`).join('\n');
      await fs.appendFile(this.directoryMismatchPath, logEntry + filesList + '\n\n');
    } catch (error) {
      await fs.appendFile(this.directoryMismatchPath, 
        logEntry + '    Error reading directory contents: ' + error.message + '\n\n');
    }
  }

  async updateStats(file, success) {
    const ext = path.extname(file).toLowerCase();
    if (!this.stats.byExtension[ext]) {
      this.stats.byExtension[ext] = { total: 0, success: 0, failed: 0 };
    }
    
    this.stats.byExtension[ext].total++;
    if (success) {
      this.stats.byExtension[ext].success++;
      this.stats.processedFiles++;
    } else {
      this.stats.byExtension[ext].failed++;
      this.stats.failedFiles++;
    }
    
    // Write stats to file
    await fs.writeFile(
      this.processingStatsPath,
      JSON.stringify(this.stats, null, 2)
    );
  }
}

const logger = new Logger(CONFIG.logPath, CONFIG.dirMatchesPath);

// Update standardizeApostrophes function to use typographical apostrophe
function standardizeApostrophes(dirName) {
  // Convert all apostrophe variants to the typographical apostrophe (U+2019)
  const typographicalApostrophe = '\u2019';
  const before = dirName;
  const after = dirName.replace(/[′‵՚Ꞌꞌ᾽᾿`´ʹʼ']/g, typographicalApostrophe);
  
  if (before !== after) {
    console.log('Apostrophe standardization:');
    console.log('  Before:', before);
    console.log('  After:', after);
    console.log('  Before apostrophe codes:', Array.from(before.match(/[′‵՚Ꞌꞌ᾽᾿`´ʹʼ']/g) || []).map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`));
    console.log('  After apostrophe codes:', Array.from(after.match(/\u2019/g) || []).map(c => `U+${c.charCodeAt(0).toString(16).toUpperCase()}`));
  }
  
  return after;
}

// Update normalizeDirectoryName to use standardizeApostrophes first
function normalizeDirectoryName(dirName) {
  if (!dirName) return '';
  
  // First, standardize apostrophes using the dedicated function
  let normalized = standardizeApostrophes(dirName)
    .replace(/[""]/g, '')            // Remove quotes
    .replace(/_gallery$/i, '')       // Remove gallery suffix case-insensitive
    .replace(/\s+/g, ' ')           // Normalize multiple spaces to single space
    .trim();                        // Remove leading/trailing spaces

  // Handle "The Abolitionist's" patterns consistently
//   const abolitionistPattern = /\b(?:the\s+)?abolitionists?['']s?\b/gi;
//   if (normalized.match(abolitionistPattern)) {
//     // Preserve or add "The" for specific patterns
//     const hasThe = /\bthe\s+abolitionists?['']s?\s+(sanctuary|fieldguide|apothecarts|tea\s+party)/i.test(normalized);
//     const matchWord = normalized.match(/\b(?:the\s+)?abolitionists?['']s?\s+(\w+)/i)?.[1];
    
//     if (hasThe || ['Sanctuary', 'Fieldguide', 'Apothecarts', 'Tea'].includes(matchWord)) {
//       normalized = normalized.replace(abolitionistPattern, "The Abolitionist's");
//     } else {
//       normalized = normalized.replace(abolitionistPattern, "Abolitionist's");
//     }
//   }

  // Handle case-sensitive words consistently
//   const uppercaseWords = ['MoMA', 'PS1', 'THTHB', 'UCSCIAS', 'JTLC', 'NYC', 'UVM'];
//   uppercaseWords.forEach(word => {
//     const regex = new RegExp(word, 'i');
//     if (normalized.match(regex)) {
//       normalized = normalized.replace(regex, word);
//     }
//   });

  // Handle special case words that should be lowercase
//   const lowercaseWords = ['to', 'at', 'in', 'for', 'of', 'and'];
//   lowercaseWords.forEach(word => {
//     const regex = new RegExp(`\\b${word}\\b`, 'gi');
//     normalized = normalized.replace(regex, word.toLowerCase());
//   });

  // Special handling for "The" - preserve it in specific patterns
//   const preserveThePattern = /^The\s+(?:Abolitionist's|Locker\s+Room|Garrison|Alien\s+Apothecary)/i;
//   if (!preserveThePattern.test(normalized)) {
//     normalized = normalized.replace(/\bThe\b/g, 'the');
//   }
  
  // Handle year prefix consistently
//   const yearPrefix = /^(\d{4})\s+(.+)$/;
//   if (yearPrefix.test(normalized)) {
//     const match = normalized.match(yearPrefix);
//     const year = match[1];
//     const name = match[2];
//     normalized = `${year} ${name}`;
//   }
  
  // Remove any remaining special characters that might cause issues
//   normalized = normalized.replace(/[^\w\s\-\.]/g, '');
  
  // Ensure no double spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}


// Update the file renaming function to use standardized apostrophes
function formatNewFileName(year, projectName, index, total, ext) {
  // Standardize apostrophes in the project name
  projectName = standardizeApostrophes(projectName);
  const paddedIndex = String(index).padStart(2, '0');
  const paddedTotal = String(total).padStart(2, '0');
  return `${year}_${projectName.replace(/\s+/g, '_')}_image${paddedIndex}of${paddedTotal}${ext}`;
}

// Update extractYearAndName function
function extractYearAndName(folderName) {
  // Extra thorough cleaning before normalization
  const cleaned = folderName
    .replace(/\s+/g, ' ')   // Replace multiple spaces with single space
    .trim();                // Remove trailing/leading spaces
    
  // Normalize the folder name
  const normalizedName = normalizeDirectoryName(cleaned);
  
  console.log(`Processing folder name: "${folderName}"`);
  console.log(`Normalized name: "${normalizedName}"`);
  
  // Try to match year and name pattern
  const match = normalizedName.match(/^(\d{4})\s+(.+)$/);
  if (match) {
    const result = {
      year: match[1],
      name: match[2].trim() // Ensure no trailing spaces in name
    };
    console.log(`Found year at start: ${result.year}, name: ${result.name}`);
    return result;
  }
  
  // Try to find year anywhere in the string
  const yearMatch = normalizedName.match(/(\d{4})/);
  if (yearMatch) {
    const year = yearMatch[1];
    // Remove the year and any surrounding spaces or special characters
    const name = normalizedName
      .replace(year, '')
      .replace(/^[\s\-_]+|[\s\-_]+$/g, '') // Remove leading/trailing spaces, hyphens, underscores
      .trim();
      
    if (name) {
      const result = {
        year: year,
        name: name
      };
      console.log(`Found year in string: ${result.year}, name: ${result.name}`);
      return result;
    }
  }
  
  console.log('No valid year found in folder name');
  return null;
}

// Add PDF processing function
async function processPdf(inputPath, outputPath) {
  try {
    const tempPrefix = path.join(path.dirname(outputPath), 'temp_pdf_convert');
    
    // Use pdftocairo with more robust options
    const cmd = `"${CONFIG.pdftocairoPath}" -png -r 150 -f 1 -l 1 -scale-to 2500 "${inputPath}" "${tempPrefix}"`;
    await execPromise(cmd);
    
    const tempPath = `${tempPrefix}-1.png`;
    
    // Use sharp for final processing
    await sharp(tempPath)
      .resize(CONFIG.maxDimension, CONFIG.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ 
        quality: 90,
        compressionLevel: 9,
        palette: true
      })
      .toFile(outputPath);

    // Check file size and compress if needed
    const stats = await fs.stat(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 1) {
      await sharp(outputPath)
        .png({ 
          quality: 80,
          compressionLevel: 9,
          palette: true,
          colors: 256
        })
        .toFile(outputPath + '.tmp');
      
      await fs.unlink(outputPath);
      await fs.rename(outputPath + '.tmp', outputPath);
    }

    // Clean up temporary file
    try {
      await fs.access(tempPath);
      await fs.unlink(tempPath);
    } catch (error) {
      // File doesn't exist, no need to clean up
    }
    return true;
  } catch (error) {
    await logger.log(`Error processing PDF ${inputPath}: ${error.message}`);
    return false;
  }
}

// Add timeout wrapper for exec commands
async function execWithTimeout(command, timeoutMs = 60000) {
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs/1000} seconds`));
    }, timeoutMs);

    try {
      const result = await execPromise(command);
      clearTimeout(timeout);
      resolve(result);
    } catch (error) {
      clearTimeout(timeout);
      reject(error);
    }
  });
}

// Update processSpecialFormat function
async function processSpecialFormat(inputPath, outputPath) {
  try {
    const tempPath = outputPath.replace('.png', '_temp.png');
    const ext = path.extname(inputPath).toLowerCase();
    
    console.log(`Processing special format file: ${path.basename(inputPath)}`);
    
    // For HEIC files, use sharp with heif support
    if (ext === '.heic') {
      console.log('Using sharp for HEIC processing...');
      await sharp(inputPath, { failOnError: false })
        .rotate() // Auto-rotate based on EXIF orientation
        .resize(CONFIG.maxDimension, CONFIG.maxDimension, {
          fit: 'inside',
          withoutEnlargement: true
        })
        .png({ 
          quality: 90,
          compressionLevel: 9,
          palette: true
        })
        .toFile(outputPath);
      console.log('HEIC processing complete');
      return true;
    }

    // For PSD and AI files, use ImageMagick with density setting
    const isAI = ext === '.ai';
    console.log(`Using ImageMagick for ${isAI ? 'AI' : 'PSD'} processing...`);
    
    // Construct the ImageMagick command with auto-orient
    const magickCmd = `"${CONFIG.convertPath}" ${isAI ? '[0]' : ''} -density 300 "${inputPath}" -auto-orient -resize ${CONFIG.maxDimension}x${CONFIG.maxDimension}> "${tempPath}"`;
    console.log('Running ImageMagick command...');
    
    try {
      await execWithTimeout(magickCmd, 120000);
    } catch (error) {
      if (error.message.includes('timed out')) {
        throw new Error(`ImageMagick processing timed out for ${path.basename(inputPath)}`);
      }
      throw error;
    }
    
    console.log('ImageMagick processing complete, optimizing with sharp...');
    
    // Use sharp for final processing and optimization
    await sharp(tempPath)
      .rotate() // Ensure proper rotation is maintained
      .resize(CONFIG.maxDimension, CONFIG.maxDimension, {
        fit: 'inside',
        withoutEnlargement: true
      })
      .png({ 
        quality: 90,
        compressionLevel: 9,
        palette: true
      })
      .toFile(outputPath);

    // Verify output file size and compress further if needed
    const stats = await fs.stat(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 1) {
      console.log('File size > 1MB, performing additional compression...');
      await sharp(outputPath)
        .rotate() // Maintain rotation
        .png({ 
          quality: 80,
          compressionLevel: 9,
          palette: true,
          colors: 256
        })
        .toFile(outputPath + '.tmp');
      
      await fs.unlink(outputPath);
      await fs.rename(outputPath + '.tmp', outputPath);
    }

    // Clean up temporary file
    try {
      await fs.access(tempPath);
      await fs.unlink(tempPath);
      console.log('Temporary files cleaned up');
    } catch (error) {
      // File doesn't exist, no need to clean up
    }
    
    console.log(`Successfully processed: ${path.basename(inputPath)}`);
    return true;
  } catch (error) {
    await logger.log(`Error processing special format ${inputPath}: ${error.message}`);
    console.log(`Failed to process ${path.basename(inputPath)}: ${error.message}`);
    return false;
  }
}

// Add validation function
async function validateFile(filePath, ext) {
  // Check if file exists and is readable
  try {
    await fs.access(filePath, fs.constants.R_OK);
  } catch (error) {
    throw new Error(`File not accessible: ${error.message}`);
  }

  // Validate extension
  const fileExt = path.extname(filePath).toLowerCase();
  if (ext && fileExt !== ext.toLowerCase()) {
    throw new Error(`Invalid file extension: expected ${ext}, got ${fileExt}`);
  }

  return true;
}

// Update processImage with additional safety checks
async function processImage(inputPath, outputPath, maxDimension) {
  try {
    const ext = path.extname(inputPath).toLowerCase();
    console.log(`Processing image: ${path.basename(inputPath)}`);
    
    // Validate input file
    await validateFile(inputPath);
    
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    try {
      await fs.access(outputDir);
    } catch (error) {
      throw new Error(`Output directory does not exist: ${outputDir}`);
    }

    // Handle special formats
    if (['.heic', '.psd', '.ai'].includes(ext)) {
      return await processSpecialFormat(inputPath, outputPath);
    }
    
    // Handle PDFs
    if (ext === '.pdf') {
      return await processPdf(inputPath, outputPath);
    }

    // Process regular images
    console.log('Processing with sharp...');
    const image = sharp(inputPath);
    
    // Get metadata including orientation
    const metadata = await image.metadata();
    
    if (!metadata.width || !metadata.height) {
      throw new Error('Invalid image dimensions in metadata');
    }

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

    // Create processing pipeline
    let pipeline = image
      .rotate() // Auto-rotate based on EXIF orientation
      .resize(width, height, {
        fit: 'inside',
        withoutEnlargement: true
      });

    // If original has alpha channel, preserve it
    if (metadata.hasAlpha) {
      pipeline = pipeline.png(CONFIG.imageCompression);
    } else {
      pipeline = pipeline.png(CONFIG.imageCompression);
    }

    // Process the image
    await pipeline.toFile(outputPath);

    // Verify the output and check orientation
    const outputMetadata = await sharp(outputPath).metadata();

    // Verify output dimensions
    if (!outputMetadata.width || !outputMetadata.height) {
      throw new Error('Invalid output image dimensions');
    }

    // Check file size and compress if needed
    const stats = await fs.stat(outputPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 1) {
      console.log('File size > 1MB, performing additional compression...');
      const tmpPath = outputPath + '.tmp';
      await sharp(outputPath)
        .rotate() // Maintain rotation
        .png({ 
          ...CONFIG.imageCompression,
          quality: 80,
          colors: 256
        })
        .toFile(tmpPath);
      
      // Verify compressed file before replacing
      const compressedStats = await fs.stat(tmpPath);
      if (compressedStats.size > 0) {
        await fs.unlink(outputPath);
        await fs.rename(tmpPath, outputPath);
      } else {
        throw new Error('Compressed file is empty');
      }
    }

    // Update processing stats
    await logger.updateStats(inputPath, true);
    console.log(`Successfully processed: ${path.basename(inputPath)}`);
    return true;
  } catch (error) {
    await logger.updateStats(inputPath, false);
    await logger.log(`Error processing image ${inputPath}: ${error.message}`);
    console.log(`Failed to process ${path.basename(inputPath)}: ${error.message}`);
    return false;
  }
}

// Update processVideo with additional safety checks
async function processVideo(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    // Add error checking for input file
    if (!inputPath || !outputPath) {
      console.log('Invalid input or output path for video processing');
      resolve(false);
      return;
    }

    console.log(`Processing video: ${path.basename(inputPath)}`);
    
    // Create a timeout
    const timeout = setTimeout(() => {
      console.log(`Video processing timed out after ${CONFIG.timeouts.ffmpeg/1000} seconds`);
      resolve(false);
    }, CONFIG.timeouts.ffmpeg);

    ffmpeg(inputPath)
      .size('2500x?')
      .format('webm')
      .on('start', (commandLine) => {
        console.log('Started ffmpeg with command:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent) {
          console.log(`Processing: ${Math.round(progress.percent)}% done`);
        }
      })
      .on('end', async () => {
        clearTimeout(timeout);
        // Verify output file
        try {
          const stats = await fs.stat(outputPath);
          if (stats.size === 0) {
            await logger.log(`Error: Output video file is empty: ${outputPath}`);
            resolve(false);
            return;
          }
          console.log(`Successfully processed video: ${path.basename(inputPath)}`);
          await logger.updateStats(inputPath, true);
          resolve(true);
        } catch (error) {
          await logger.log(`Error verifying video output: ${error.message}`);
          resolve(false);
        }
      })
      .on('error', async (err) => {
        clearTimeout(timeout);
        await logger.log(`Error processing video ${inputPath}: ${err.message}`);
        await logger.updateStats(inputPath, false);
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

// Add new function to standardize apostrophes in full paths
function standardizePathApostrophes(fullPath) {
  // Split path into components
  const parts = fullPath.split(path.sep);
  
  // Standardize apostrophes in each part
  const standardizedParts = parts.map(part => standardizeApostrophes(part));
  
  // Log if any changes were made
  const before = fullPath;
  const after = standardizedParts.join(path.sep);
  if (before !== after) {
    console.log('\nPath apostrophe standardization:');
    console.log('  Before:', before);
    console.log('  After:', after);
    console.log('  Changed parts:');
    parts.forEach((part, i) => {
      if (part !== standardizedParts[i]) {
        console.log(`    - "${part}" → "${standardizedParts[i]}"`);
      }
    });
  }
  
  return after;
}

// Update verifyProjectDirectory to handle paths correctly
async function verifyProjectDirectory(projectDir) {
  const projectInfo = extractYearAndName(path.basename(projectDir));
  if (!projectInfo) {
    await logger.logDirectoryMatch(projectDir, '', 'FAILED', 'Invalid project folder name format');
    return false;
  }

  const { year, name } = projectInfo;
  const sourceName = `${year} ${name}`;
  // Standardize apostrophes in the name before adding _gallery suffix
  const standardizedName = standardizeApostrophes(name);
  const sourceGalleryDir = path.join(projectDir, `${year} ${standardizedName}_gallery`);

  try {
    // Find matching target directory
    let targetProjectDir = null;
    let targetGalleryDir = null;
    
    try {
      const targetBaseDir = CONFIG.targetDir;
      const targetDirs = await fs.readdir(targetBaseDir);
      
      // Normalize source name for comparison
      const normalizedSourceName = normalizeDirectoryName(sourceName);
      
      // Find matching directory - try multiple matching strategies
      let matchingDir = null;
      
      // 1. Try exact match
      matchingDir = targetDirs.find(dir => dir === sourceName);
      
      // 2. Try normalized match
      if (!matchingDir) {
        matchingDir = targetDirs.find(dir => 
          normalizeDirectoryName(dir) === normalizedSourceName
        );
      }
      
      // 3. Try case-insensitive match
      if (!matchingDir) {
        matchingDir = targetDirs.find(dir => 
          dir.toLowerCase() === sourceName.toLowerCase() ||
          normalizeDirectoryName(dir).toLowerCase() === normalizedSourceName.toLowerCase()
        );
      }
      
      // 4. Try partial match (for cases where names might have slight differences)
      if (!matchingDir) {
        // Create a simplified version of the name for comparison
        const simplifiedSource = normalizedSourceName
          .replace(/[^\w\s]/g, '')  // Remove special characters
          .replace(/\s+/g, ' ')     // Normalize spaces
          .trim()
          .toLowerCase();
          
        matchingDir = targetDirs.find(dir => {
          const simplifiedDir = normalizeDirectoryName(dir)
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
            
          return simplifiedDir === simplifiedSource;
        });
      }

      if (matchingDir) {
        targetProjectDir = path.join(targetBaseDir, matchingDir);
        targetGalleryDir = path.join(targetProjectDir, `${matchingDir}_gallery`);
      } else {
        await logger.logDirectoryMismatch(sourceGalleryDir, 
          `No matching directory found in database structure for: ${sourceName}\n` +
          `Normalized source name: ${normalizedSourceName}\n` +
          `Available target directories: ${targetDirs.join(', ')}`);
        return false;
      }
    } catch (error) {
      await logger.logDirectoryMismatch(sourceGalleryDir, 
        `Error accessing target directory: ${error.message}`);
      return false;
    }

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
      let existingFiles = [];
      try {
        await fs.access(targetGalleryDir);
        existingFiles = await fs.readdir(targetGalleryDir);
      } catch (error) {
        await logger.logDirectoryMismatch(sourceGalleryDir, 
          `Gallery directory does not exist in database structure: ${targetGalleryDir}`);
        return false;
      }

      // Count how many files still need processing
      const processedFileCount = existingFiles.length;
      const remainingFileCount = mediaFiles.length - processedFileCount;
      
      if (remainingFileCount > 0) {
        await logger.logDirectoryMatch(sourceGalleryDir, targetGalleryDir, 'SUCCESS', 
          `Found ${mediaFiles.length} total media files, ${remainingFileCount} still need processing`);
        return true;
      } else {
        await logger.logDirectoryMatch(sourceGalleryDir, targetGalleryDir, 'SKIPPED', 
          `All ${mediaFiles.length} files already processed`);
        return false;
      }

    } catch (error) {
      await logger.logDirectoryMatch(sourceGalleryDir, '', 'FAILED', 'Source gallery directory not found');
      return false;
    }

  } catch (error) {
    await logger.logDirectoryMatch(projectDir, '', 'FAILED', `Error: ${error.message}`);
    return false;
  }
}

// Update processProject to use standardizePathApostrophes
async function processProject(projectDir) {
  // Standardize apostrophes in the full project directory path
  projectDir = standardizePathApostrophes(projectDir);
  
  const projectInfo = extractYearAndName(path.basename(projectDir));
  if (!projectInfo) {
    await logger.logProjectIssue(projectDir, 'Invalid project folder name format');
    return;
  }

  const { year, name } = projectInfo;
  const sourceName = `${year} ${name}`;
  // Standardize apostrophes in the name before adding _gallery suffix
  const standardizedName = standardizeApostrophes(name);
  const sourceGalleryDir = path.join(projectDir, `${year} ${standardizedName}_gallery`);

  try {
    // Find matching target directory
    const targetBaseDir = CONFIG.targetDir;
    const targetDirs = await fs.readdir(targetBaseDir);
    
    // Normalize source name for comparison
    const normalizedSourceName = normalizeDirectoryName(sourceName);
    
    // Find matching directory - try multiple matching strategies
    let matchingDir = null;
    
    // 1. Try exact match
    matchingDir = targetDirs.find(dir => dir === sourceName);
    
    // 2. Try normalized match
    if (!matchingDir) {
      matchingDir = targetDirs.find(dir => 
        normalizeDirectoryName(dir) === normalizedSourceName
      );
    }
    
    // 3. Try case-insensitive match
    if (!matchingDir) {
      matchingDir = targetDirs.find(dir => 
        dir.toLowerCase() === sourceName.toLowerCase() ||
        normalizeDirectoryName(dir).toLowerCase() === normalizedSourceName.toLowerCase()
      );
    }
    
    // 4. Try partial match (for cases where names might have slight differences)
    if (!matchingDir) {
      // Create a simplified version of the name for comparison
      const simplifiedSource = normalizedSourceName
        .replace(/[^\w\s]/g, '')  // Remove special characters
        .replace(/\s+/g, ' ')     // Normalize spaces
        .trim()
        .toLowerCase();
        
      matchingDir = targetDirs.find(dir => {
        const simplifiedDir = normalizeDirectoryName(dir)
          .replace(/[^\w\s]/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();
          
        return simplifiedDir === simplifiedSource;
      });
    }

    if (!matchingDir) {
      await logger.logProjectIssue(name, `No matching directory found in database structure for: ${sourceName}`);
      return;
    }

    // Standardize apostrophes in target paths
    const targetProjectDir = standardizePathApostrophes(path.join(targetBaseDir, matchingDir));
    const targetGalleryDir = standardizePathApostrophes(path.join(targetProjectDir, `${matchingDir}_gallery`));

    // Get filtered media files
    const mediaFiles = await getMediaFiles(sourceGalleryDir);
    
    if (mediaFiles.length === 0) {
      await logger.logProjectIssue(name, 'No valid media files found in gallery directory');
      return;
    }

    // Get list of already processed files
    let existingFiles = [];
    try {
      existingFiles = await fs.readdir(targetGalleryDir);
    } catch (error) {
      await logger.logProjectIssue(name, `Target gallery directory not found: ${targetGalleryDir}`);
      return;
    }

    const csvData = [];
    for (let i = 0; i < mediaFiles.length; i++) {
      const file = mediaFiles[i];
      const ext = path.extname(file).toLowerCase();
      const originalPath = path.join(sourceGalleryDir, file);
      
      // Use different extensions for images and videos
      const isVideo = CONFIG.validVideoExts.includes(ext);
      const newExt = isVideo ? '.webm' : '.png';
      const newFileName = formatNewFileName(year, name, i + 1, mediaFiles.length, newExt);
      const newPath = path.join(targetGalleryDir, newFileName);

      // Skip if file already exists
      if (existingFiles.includes(newFileName)) {
        console.log(`Skipping already processed file: ${file} -> ${newFileName}`);
        
        // Add to CSV data even if skipped to maintain complete record
        csvData.push({
          originalName: file,
          newName: newFileName,
          originalPath: originalPath,
          newPath: newPath,
          projectName: name,
          year: year
        });
        continue;
      }

      console.log(`Processing ${i + 1}/${mediaFiles.length}: ${file}`);
      let success = false;

      try {
        if (isVideo) {
          success = await processVideo(originalPath, newPath);
        } else {
          success = await processImage(originalPath, newPath, CONFIG.maxDimension);
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
          console.log(`Successfully processed: ${file} -> ${newFileName}`);
        } else {
          console.log(`Failed to process: ${file}`);
        }
      } catch (error) {
        console.log(`Error processing file ${file}: ${error.message}`);
        await logger.log(`Error processing file ${file}: ${error.message}`);
      }
    }

    if (csvData.length > 0) {
      await csvWriter.writeRecords(csvData);
    }

  } catch (error) {
    if (error.code === 'ENOENT') {
      await logger.logProjectIssue(name, 'Gallery directory not found');
    } else {
      await logger.logProjectIssue(name, `Error processing project: ${error.message}`);
    }
  }
}

// Simple helper function to check if directory is a project directory
function isProjectDirectory(dirName) {
  return /^\d{4}\s+.+$/.test(dirName);
}

// Simple helper function to check if directory is an NV directory
function isNVDirectory(dirName) {
  return /^NV/.test(dirName);
}

// Simple directory finding function
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
    console.log('Verifying system requirements...');
    const systemChecks = await verifySystemRequirements();
    
    // Log system check results
    console.log('\nSystem Requirements Check:');
    for (const check of systemChecks) {
      console.log(`${check.name}: ${check.status}${check.version ? ` (${check.version})` : ''}`);
      if (check.features) {
        console.log('  Features:', JSON.stringify(check.features, null, 2));
      }
      if (check.note) {
        console.log(`  Note: ${check.note}`);
      }
      if (check.error) {
        console.log(`  Error: ${check.error}`);
      }
    }

    // Check for critical errors
    const criticalErrors = systemChecks.filter(check => check.status === 'ERROR');
    if (criticalErrors.length > 0) {
      console.error('\nCritical system requirements not met:');
      criticalErrors.forEach(error => {
        console.error(`- ${error.name}: ${error.error}`);
        if (error.name === 'Sharp') {
          console.error('\nTo fix Sharp installation:');
          console.error('1. Ensure libvips is installed: brew install vips');
          console.error('2. Reinstall Sharp: npm rebuild sharp');
          console.error('3. If issues persist, try: npm install sharp@latest');
        }
        if (error.name === 'Sharp HEIF Support') {
          console.error('\nTo fix HEIF support:');
          console.error('1. Ensure libheif is installed: brew install libheif');
          console.error('2. Reinstall Sharp: npm rebuild sharp');
        }
      });
      console.error('\nPlease install missing dependencies before proceeding.');
      process.exit(1);
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