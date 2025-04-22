const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const ffmpeg = require('fluent-ffmpeg');

// Configuration
const CONFIG = {
  maxDimension: 2500,
  sourceDir: '/Volumes/T7/JACKIESUMELL.COM',
  targetDir: process.cwd() + '/project-folders',
  csvPath: './file_mapping.csv',
  logPath: './processing_errors.log',
  dirMatchesPath: './directory_matches.txt',
  validImageExts: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.pdf'],
  validVideoExts: ['.mp4', '.mov', '.avi', '.webm']
};

// Normalize directory names
const normalizeName = (name) => {
  return name
    .trim()  // Remove trailing/leading spaces
    .replace(/['']/g, "'")  // Normalize apostrophes
    .replace(/\s+/g, ' ')    // Normalize multiple spaces
    .replace(/(\d+)([A-Za-z])/g, '$1 $2')  // Add space after numbers if missing
    .replace(/_+/g, '_')     // Normalize multiple underscores
    .toLowerCase();  // Convert to lowercase for comparison
};

// Directory comparison function
const isSameDirectory = (dir1, dir2) => {
  return normalizeName(dir1) === normalizeName(dir2);
};

// Get directory without _gallery suffix
const getBaseDirectoryName = (name) => {
  return name.replace(/_gallery$/i, '').trim();
};

// CSV writer setup
const csvWriter = createCsvWriter({
  path: CONFIG.csvPath,
  header: [
    { id: 'sourcePath', title: 'Source Path' },
    { id: 'targetPath', title: 'Target Path' },
    { id: 'status', title: 'Status' },
    { id: 'error', title: 'Error' }
  ]
});

// Utility functions
const logError = async (message) => {
  await fs.appendFile(CONFIG.logPath, `${new Date().toISOString()}: ${message}\n`);
  console.error(message);
};

const logDirectoryMatch = async (match) => {
  const matchString = `[${new Date().toISOString()}] DIRECTORY_MATCH:
    Source: ${match.source}
    Target: ${match.target}
    Status: ${match.status}
    Reason: ${match.reason}\n`;
  await fs.appendFile(CONFIG.dirMatchesPath, matchString);
  console.log(matchString);
};

const getProjectDirectories = async (baseDir) => {
  try {
    const entries = await fs.readdir(baseDir, { withFileTypes: true });
    const dirs = entries
      .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
      .map(dir => ({
        path: path.join(baseDir, dir.name),
        name: dir.name,
        normalizedName: normalizeName(dir.name)
      }));
    return dirs;
  } catch (error) {
    await logError(`Error reading directory ${baseDir}: ${error.message}`);
    return [];
  }
};

const findGalleryDirectory = async (projectDir) => {
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    const galleryDir = entries.find(entry => 
      entry.isDirectory() && 
      normalizeName(entry.name).endsWith('_gallery')
    );
    return galleryDir ? path.join(projectDir, galleryDir.name) : null;
  } catch (error) {
    await logError(`Error finding gallery directory in ${projectDir}: ${error.message}`);
    return null;
  }
};

const getMediaFiles = async (directory) => {
  try {
    const files = await fs.readdir(directory);
    return files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return CONFIG.validImageExts.includes(ext) || CONFIG.validVideoExts.includes(ext);
    });
  } catch (error) {
    await logError(`Error getting media files from ${directory}: ${error.message}`);
    return [];
  }
};

const createTargetDirectories = async (targetPath) => {
  try {
    await fs.mkdir(targetPath, { recursive: true });
  } catch (error) {
    await logError(`Error creating directory ${targetPath}: ${error.message}`);
    throw error;
  }
};

const processImage = async (sourcePath, targetPath) => {
  try {
    const image = sharp(sourcePath);
    const metadata = await image.metadata();
    
    // Determine if resizing is needed
    const needsResize = metadata.width > CONFIG.maxDimension || metadata.height > CONFIG.maxDimension;
    
    if (needsResize) {
      // Maintain aspect ratio while ensuring neither dimension exceeds maxDimension
      if (metadata.width > metadata.height) {
        await image
          .resize(CONFIG.maxDimension, null, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .toFile(targetPath);
      } else {
        await image
          .resize(null, CONFIG.maxDimension, {
            fit: 'inside',
            withoutEnlargement: true
          })
          .toFile(targetPath);
      }
    } else {
      // If no resize needed, just copy the file
      await fs.copyFile(sourcePath, targetPath);
    }
    
    return { status: 'success' };
  } catch (error) {
    await logError(`Error processing image ${sourcePath}: ${error.message}`);
    return { status: 'error', error: error.message };
  }
};

const processVideo = async (sourcePath, targetPath) => {
  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .output(targetPath)
      .on('end', () => resolve({ status: 'success' }))
      .on('error', (err) => {
        logError(`Error processing video ${sourcePath}: ${err.message}`);
        resolve({ status: 'error', error: err.message });
      })
      .run();
  });
};

const processMediaFile = async (sourcePath, targetPath) => {
  const ext = path.extname(sourcePath).toLowerCase();
  
  if (CONFIG.validImageExts.includes(ext)) {
    return await processImage(sourcePath, targetPath);
  } else if (CONFIG.validVideoExts.includes(ext)) {
    return await processVideo(sourcePath, targetPath);
  } else {
    return { status: 'error', error: 'Unsupported file type' };
  }
};

const verifyDirectoryStructure = async (sourceDir, targetDir) => {
  const results = [];
  
  // Get all project directories
  const projectDirs = await getProjectDirectories(sourceDir);
  console.log(`Found ${projectDirs.length} project directories to process.\n`);
  
  // Create a map of normalized names to actual directory names
  const normalizedMap = new Map();
  for (const dir of projectDirs) {
    const normalized = normalizeName(getBaseDirectoryName(dir.name));
    if (normalizedMap.has(normalized)) {
      await logError(`Warning: Duplicate normalized name found: "${dir.name}" and "${normalizedMap.get(normalized)}"`);
    }
    normalizedMap.set(normalized, dir.name);
  }
  
  for (const projectDir of projectDirs) {
    // Find gallery directory in source
    const sourceGallery = await findGalleryDirectory(projectDir.path);
    if (!sourceGallery) {
      results.push({
        source: projectDir.path,
        target: '',
        status: 'FAILED',
        reason: 'Source gallery directory not found'
      });
      continue;
    }
    
    // Get target directory path using normalized name
    const normalized = normalizeName(getBaseDirectoryName(projectDir.name));
    const targetName = normalizedMap.get(normalized) || projectDir.name;
    const targetPath = path.join(targetDir, targetName);
    
    // Find or create gallery directory in target
    const targetGallery = path.join(targetPath, path.basename(sourceGallery));
    
    // Get media files in source gallery
    const mediaFiles = await getMediaFiles(sourceGallery);
    
    if (mediaFiles.length === 0) {
      results.push({
        source: sourceGallery,
        target: targetGallery,
        status: 'FAILED',
        reason: 'No media files found in source gallery'
      });
      continue;
    }
    
    try {
      // Check if target exists and is empty
      try {
        const targetContents = await fs.readdir(targetGallery);
        if (targetContents.length > 0) {
          results.push({
            source: sourceGallery,
            target: targetGallery,
            status: 'FAILED',
            reason: 'Target directory exists and is not empty'
          });
          continue;
        }
      } catch (error) {
        // Directory doesn't exist, which is fine
      }
      
      results.push({
        source: sourceGallery,
        target: targetGallery,
        status: 'SUCCESS',
        reason: `Found ${mediaFiles.length} media files to process`
      });
      
    } catch (error) {
      results.push({
        source: sourceGallery,
        target: targetGallery,
        status: 'FAILED',
        reason: `Error verifying target directory: ${error.message}`
      });
    }
  }
  
  return results;
};

const processDirectories = async (sourceDir, targetDir) => {
  const results = [];
  
  // Get all project directories
  const projectDirs = await getProjectDirectories(sourceDir);
  
  // Create a map of normalized names to actual directory names
  const normalizedMap = new Map();
  for (const dir of projectDirs) {
    const normalized = normalizeName(getBaseDirectoryName(dir.name));
    normalizedMap.set(normalized, dir.name);
  }
  
  for (const projectDir of projectDirs) {
    // Find gallery directory in source
    const sourceGallery = await findGalleryDirectory(projectDir.path);
    if (!sourceGallery) continue;
    
    // Get target directory path using normalized name
    const normalized = normalizeName(getBaseDirectoryName(projectDir.name));
    const targetName = normalizedMap.get(normalized) || projectDir.name;
    const targetPath = path.join(targetDir, targetName);
    
    // Find or create gallery directory in target
    const targetGallery = path.join(targetPath, path.basename(sourceGallery));
    await createTargetDirectories(targetGallery);
    
    // Get media files in source gallery
    const mediaFiles = await getMediaFiles(sourceGallery);
    
    // Process each media file
    for (const file of mediaFiles) {
      const sourcePath = path.join(sourceGallery, file);
      const targetPath = path.join(targetGallery, file);
      
      const result = await processMediaFile(sourcePath, targetPath);
      
      results.push({
        sourcePath,
        targetPath,
        status: result.status,
        error: result.error || ''
      });
    }
  }
  
  return results;
};

const main = async () => {
  console.log('Searching for project directories...');
  
  // First verify the directory structure
  console.log('\nVerifying directory structure...');
  const verificationResults = await verifyDirectoryStructure(CONFIG.sourceDir, CONFIG.targetDir);
  
  // Log all results
  for (const result of verificationResults) {
    await logDirectoryMatch(result);
  }
  
  const successCount = verificationResults.filter(r => r.status === 'SUCCESS').length;
  console.log(`\nVerification complete. ${successCount} of ${verificationResults.length} directories ready for processing.\n`);
  
  // If --process flag is provided, proceed with processing
  if (process.argv.includes('--process')) {
    const duplicates = verificationResults.filter(r => 
      r.reason && r.reason.includes('Duplicate normalized name found')
    );
    
    if (duplicates.length > 0) {
      console.log('\nWarning: Found duplicate directory names after normalization:');
      duplicates.forEach(d => console.log(d.reason));
      console.log('\nPlease resolve these duplicates before processing.');
      return;
    }
    
    console.log('Processing directories...');
    const results = await processDirectories(CONFIG.sourceDir, CONFIG.targetDir);
    
    // Write results to CSV
    await csvWriter.writeRecords(results);
    
    const processSuccessCount = results.filter(r => r.status === 'success').length;
    console.log(`\nProcessing complete. ${processSuccessCount} of ${results.length} files processed successfully.`);
  } else {
    console.log('Please run with --process flag to process the directories.');
  }
};

main().catch(console.error);
