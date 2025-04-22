const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Parse command line arguments
const args = process.argv.slice(2);
let configPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--config' && i + 1 < args.length) {
    configPath = args[i + 1];
    break;
  }
}

// Configuration
const API_URL = 'http://localhost:1337/api/projects/group-by-year';
const COLLAGES_SOURCE = path.join(__dirname, '..', 'jackie_collage_integration', 'data', 'collages_flattened');
const GALLERY_SOURCE = path.join(__dirname, '..', 'jackie_collage_integration', 'data', 'project_folders');
let OUTPUT_DIR = path.join(__dirname, '..', 'jackie_collage_integration', 'project-folders-test');

// Utility functions
async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function getProjectNames() {
  try {
    const response = await axios.get(API_URL);
    const projectsByYear = response.data;
    const allProjects = [];
    
    // Flatten the year-based structure into a single array of project names
    for (const year in projectsByYear) {
      projectsByYear[year].forEach(project => {
        allProjects.push({
          name: project.name,
          year: year
        });
      });
    }
    
    return allProjects;
  } catch (error) {
    console.error('Error fetching projects:', error.message);
    throw error;
  }
}

async function createProjectDirectories(projects) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(__dirname, `db_projects_list${timestamp}.txt`);
  const logEntries = {
    new: [],
    updated: [],
    existing: [],
    errors: []
  };

  for (const project of projects) {
    const dirName = `${project.year} ${project.name}`;
    const basePath = path.join(OUTPUT_DIR, dirName);
    const collagePath = path.join(basePath, `${dirName}_collage`);
    const galleryPath = path.join(basePath, `${dirName}_gallery`);

    try {
      // Check if directory exists
      const exists = await fs.access(basePath).then(() => true).catch(() => false);
      
      if (!exists) {
        await ensureDirectoryExists(basePath);
        await ensureDirectoryExists(collagePath);
        await ensureDirectoryExists(galleryPath);
        logEntries.new.push(dirName);
      } else {
        logEntries.existing.push(dirName);
      }
    } catch (error) {
      logEntries.errors.push(`Error creating directories for ${dirName}: ${error.message}`);
    }
  }

  // Write log file
  const logContent = [
    '=== Newly Added Project Directories ===',
    ...logEntries.new,
    '\n=== Updated Project Directories ===',
    ...logEntries.updated,
    '\n=== Existing Directories ===',
    ...logEntries.existing,
    '\n=== Errors and Warnings ===',
    ...logEntries.errors
  ].join('\n');

  await fs.writeFile(logFile, logContent);
  return logFile;
}

async function copyCollageImages() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(__dirname, `collage_output${timestamp}.txt`);
  const logEntries = [];

  try {
    const projectDirs = await fs.readdir(OUTPUT_DIR);
    const collageFiles = await fs.readdir(COLLAGES_SOURCE);

    for (const projectDir of projectDirs) {
      const collageDir = path.join(OUTPUT_DIR, projectDir, `${projectDir}_collage`);
      const projectName = projectDir.split(' ').slice(1).join(' ');
      
      // Find matching collage file
      const matchingCollage = collageFiles.find(file => 
        file.toLowerCase().includes(projectName.toLowerCase())
      );

      if (matchingCollage) {
        const sourcePath = path.join(COLLAGES_SOURCE, matchingCollage);
        const targetPath = path.join(collageDir, matchingCollage);
        await fs.copyFile(sourcePath, targetPath);
        logEntries.push(`Success: Found and copied collage for ${projectDir}`);
      } else {
        logEntries.push(`Error: No collage found for ${projectDir}`);
      }
    }
  } catch (error) {
    logEntries.push(`Error during collage copy process: ${error.message}`);
  }

  await fs.writeFile(logFile, logEntries.join('\n'));
  return logFile;
}

async function copyGalleryImages() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFile = path.join(__dirname, `gallery_output${timestamp}.txt`);
  const logEntries = [];

  try {
    const projectDirs = await fs.readdir(OUTPUT_DIR);
    const galleryDirs = await fs.readdir(GALLERY_SOURCE);

    for (const projectDir of projectDirs) {
      const galleryDir = path.join(OUTPUT_DIR, projectDir, `${projectDir}_gallery`);
      const projectName = projectDir.split(' ').slice(1).join(' ');
      
      // Find matching gallery directory
      const matchingGallery = galleryDirs.find(dir => 
        dir.toLowerCase().includes(projectName.toLowerCase())
      );

      if (matchingGallery) {
        const sourcePath = path.join(GALLERY_SOURCE, matchingGallery);
        const files = await fs.readdir(sourcePath);
        
        for (const file of files) {
          const sourceFilePath = path.join(sourcePath, file);
          const targetFilePath = path.join(galleryDir, file);
          await fs.copyFile(sourceFilePath, targetFilePath);
        }
        logEntries.push(`Success: Found and copied gallery images for ${projectDir}`);
      } else {
        logEntries.push(`Error: No gallery found for ${projectDir}`);
      }
    }
  } catch (error) {
    logEntries.push(`Error during gallery copy process: ${error.message}`);
  }

  await fs.writeFile(logFile, logEntries.join('\n'));
  return logFile;
}

async function main() {
  try {
    console.log('Starting migration process...');
    
    // Load configuration if provided
    let config = null;
    if (configPath) {
      try {
        const configData = await fs.readFile(configPath, 'utf8');
        config = JSON.parse(configData);
        console.log('Loaded configuration:', config);
        
        // Set custom output directory if provided
        if (config.destinationPath) {
          OUTPUT_DIR = config.destinationPath;
          console.log(`Using custom output directory: ${OUTPUT_DIR}`);
        }
      } catch (error) {
        console.error('Error loading configuration:', error.message);
      }
    }
    
    // Ensure output directory exists
    await ensureDirectoryExists(OUTPUT_DIR);
    console.log(`Output directory: ${OUTPUT_DIR}`);
    
    // Get project names from API
    console.log('Fetching project names from API...');
    const projects = await getProjectNames();
    
    // Create project directories
    console.log('Creating project directories...');
    const projectsLogFile = await createProjectDirectories(projects);
    console.log(`Project directories log saved to: ${projectsLogFile}`);
    
    // Copy collage images
    console.log('Copying collage images...');
    const collagesLogFile = await copyCollageImages();
    console.log(`Collage copy log saved to: ${collagesLogFile}`);
    
    // Copy gallery images
    console.log('Copying gallery images...');
    const galleryLogFile = await copyGalleryImages();
    console.log(`Gallery copy log saved to: ${galleryLogFile}`);
    
    console.log('Migration process completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
  }
}

// Run the migration
main(); 