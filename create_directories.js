const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

const API_URL = 'http://localhost:1337/api/projects';

// Configuration - can be modified as needed
const OUTPUT_DIR = path.join(__dirname, '..', 'jackie_utils', 'project-folders');

async function ensureDirectoryExists(dirPath) {
  try {
    await fs.access(dirPath);
  } catch {
    await fs.mkdir(dirPath, { recursive: true });
  }
}

async function getProjectsFromAPI() {
  try {
    const response = await axios.get(API_URL);
    // Log the response structure to debug
    console.log('API Response:', JSON.stringify(response.data, null, 2));
    
    // Handle API response structure
    if (response.data.data && Array.isArray(response.data.data)) {
      // Map the data to extract year and name
      return response.data.data.map(project => ({
        attributes: {
          year: project.Date,
          name: project.Name
        }
      }));
    } else {
      throw new Error('Unexpected API response structure - expected array of projects');
    }
  } catch (error) {
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('API Error Response:', error.response.data);
      console.error('API Error Status:', error.response.status);
    }
    throw error;
  }
}

async function createProjectDirectories() {
  try {
    // Ensure base output directory exists
    await ensureDirectoryExists(OUTPUT_DIR);
    console.log(`Creating project directories in: ${OUTPUT_DIR}`);

    // Get projects from API
    console.log('Fetching projects from API...');
    const projects = await getProjectsFromAPI();
    
    if (!Array.isArray(projects)) {
      throw new Error(`Expected array of projects, got: ${typeof projects}`);
    }

    // Create directories for each project
    console.log('Creating project directories...');
    const results = {
      created: [],
      existing: [],
      errors: []
    };

    for (const project of projects) {
      // Extract attributes from Strapi's response structure
      const { year, name } = project.attributes || project;
      if (!year || !name) {
        console.error('Invalid project data:', project);
        continue;
      }

      const dirName = `${year} ${name}`;
      const projectPath = path.join(OUTPUT_DIR, dirName);
      const collagePath = path.join(projectPath, `${dirName}_collage`);
      const galleryPath = path.join(projectPath, `${dirName}_gallery`);

      try {
        // Check if directory already exists
        const exists = await fs.access(projectPath).then(() => true).catch(() => false);
        
        if (!exists) {
          // Create main project directory and subdirectories
          await ensureDirectoryExists(projectPath);
          await ensureDirectoryExists(collagePath);
          await ensureDirectoryExists(galleryPath);
          results.created.push(dirName);
          console.log(`Created: ${dirName}`);
        } else {
          results.existing.push(dirName);
          console.log(`Already exists: ${dirName}`);
        }
      } catch (error) {
        results.errors.push({ name: dirName, error: error.message });
        console.error(`Error creating ${dirName}:`, error.message);
      }
    }

    // Print summary
    console.log('\nSummary:');
    console.log('Created directories:', results.created.length);
    console.log('Existing directories:', results.existing.length);
    console.log('Errors:', results.errors.length);

    // Write detailed log file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logContent = [
      '=== Newly Created Project Directories ===',
      ...results.created,
      '\n=== Existing Project Directories ===',
      ...results.existing,
      '\n=== Errors ===',
      ...results.errors.map(e => `${e.name}: ${e.error}`)
    ].join('\n');

    const logPath = path.join(__dirname, `directory_creation_log_${timestamp}.txt`);
    await fs.writeFile(logPath, logContent);
    console.log(`\nDetailed log written to: ${logPath}`);

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
createProjectDirectories(); 