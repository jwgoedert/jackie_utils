const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const FormData = require('form-data');
const sharp = require('sharp');

// Configuration
const STRAPI_URL = 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || ''; // Get from environment variable or set directly
const COLLAGE_SOURCE_DIR = path.join(__dirname, '../jackie_collage_integration/data/collages_flattened');
const DB_PATH = path.join(__dirname, '../jackie-summel/data/data.db');

// Set up axios defaults
axios.defaults.headers.common['Authorization'] = STRAPI_API_TOKEN ? `Bearer ${STRAPI_API_TOKEN}` : '';

// Helper function to get Strapi API token
async function getStrapiToken() {
  // If token is already set in environment, use it
  if (STRAPI_API_TOKEN) {
    console.log('Using API token from environment variable');
    return STRAPI_API_TOKEN;
  }
  
  try {
    // Try to get token from Strapi admin login
    console.log('Attempting to get API token from Strapi...');
    
    // First, try to get a token using the admin login endpoint
    const loginResponse = await axios.post(`${STRAPI_URL}/admin/login`, {
      email: process.env.STRAPI_ADMIN_EMAIL || 'admin@strapi.io',
      password: process.env.STRAPI_ADMIN_PASSWORD || 'Admin123!'
    });
    
    if (loginResponse.data && loginResponse.data.data && loginResponse.data.data.token) {
      const token = loginResponse.data.data.token;
      console.log('Successfully obtained API token from Strapi admin login');
      return token;
    }
    
    // If that fails, try to create an API token
    console.log('Admin login failed, trying to create API token...');
    
    // This would require admin authentication first
    // For now, we'll just prompt the user to set the token
    console.error('Could not automatically obtain API token. Please set the STRAPI_API_TOKEN environment variable.');
    console.error('You can create an API token in the Strapi admin panel:');
    console.error('1. Go to Settings > API Tokens');
    console.error('2. Create a new API token with full access');
    console.error('3. Set the token as an environment variable:');
    console.error('   export STRAPI_API_TOKEN=your_token_here');
    
    process.exit(1);
  } catch (error) {
    console.error('Error getting Strapi API token:', error.message);
    console.error('Please set the STRAPI_API_TOKEN environment variable manually.');
    process.exit(1);
  }
}

// Helper function to check if Strapi is accessible
async function checkStrapiConnection() {
  try {
    const response = await axios.get(`${STRAPI_URL}/api/projects`);
    console.log('Successfully connected to Strapi');
    return true;
  } catch (error) {
    if (error.response) {
      console.error(`Error connecting to Strapi: ${error.response.status} - ${error.message}`);
      console.error('Is Strapi running at', STRAPI_URL, '?');
    } else {
      console.error(`Error connecting to Strapi: ${error.message}`);
      console.error('Is Strapi running at', STRAPI_URL, '?');
    }
    return false;
  }
}

// Helper function to convert image to PNG if needed
async function ensurePNG(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === '.png') {
    return imagePath;
  }
  
  const pngPath = imagePath.replace(/\.[^.]+$/, '.png');
  await sharp(imagePath).png().toFile(pngPath);
  return pngPath;
}

// Helper function to get project folder ID from database
async function getProjectFolderId(db, projectName, year) {
  // Construct the full folder path with year
  const fullPath = `${year} ${projectName}/${year} ${projectName}_collage`;
  
  console.log(`  Looking for folder with path: ${fullPath}`);
  
  // Try to find the folder with the exact path
  const folder = await db.get(
    'SELECT id FROM upload_folders WHERE path = ?', 
    [fullPath]
  );
  
  if (!folder) {
    // Log the available folders for debugging
    console.log(`  Available folders for project "${projectName}":`);
    const folders = await db.all(
      'SELECT id, name, path FROM upload_folders WHERE path LIKE ?',
      [`%${projectName}%`]
    );
    folders.forEach(f => console.log(`    - ${f.path} (ID: ${f.id})`));
    
    // Try to find the parent folder first
    const parentPath = `${year} ${projectName}`;
    const parentFolder = await db.get(
      'SELECT id FROM upload_folders WHERE path = ?', 
      [parentPath]
    );
    
    if (parentFolder) {
      console.log(`  Found parent folder with ID: ${parentFolder.id}`);
      
      // Try to find the collage subfolder
      const collageFolder = await db.get(
        'SELECT id FROM upload_folders WHERE name = ? AND parent_id = ?', 
        [`${year} ${projectName}_collage`, parentFolder.id]
      );
      
      if (collageFolder) {
        console.log(`  Found collage subfolder with ID: ${collageFolder.id}`);
        return collageFolder.id;
      } else {
        console.log(`  Collage subfolder not found under parent folder`);
      }
    } else {
      console.log(`  Parent folder not found with path: ${parentPath}`);
    }
  }
  
  return folder ? folder.id : null;
}

// Helper function to extract project name and year from filename
function extractProjectInfo(filename) {
  // Match pattern: YYYY Project Name_composite_collage-0.png
  const match = filename.match(/^(\d{4})\s+(.*)_composite_collage-0\.png$/);
  if (!match) {
    return null;
  }
  // Return both the year and project name
  return {
    year: match[1],
    projectName: match[2].trim()
  };
}

// Helper function to upload file to Strapi
async function uploadFileToStrapi(filePath, folderId) {
  try {
    const formData = new FormData();
    formData.append('files', await fs.readFile(filePath), {
      filename: path.basename(filePath),
      contentType: 'image/png'
    });
    
    if (folderId) {
      formData.append('folderId', folderId);
    }
    
    console.log(`  Uploading to folder ID: ${folderId}`);
    
    const response = await axios.post(`${STRAPI_URL}/api/upload`, formData, {
      headers: {
        ...formData.getHeaders(),
        'Authorization': `Bearer ${STRAPI_API_TOKEN}`
      }
    });
    
    if (response.data && response.data.length > 0) {
      console.log(`  Upload successful. File ID: ${response.data[0].id}`);
      return response.data[0].id;
    } else {
      console.error('  Upload response did not contain file data');
      throw new Error('Upload response did not contain file data');
    }
  } catch (error) {
    if (error.response) {
      console.error(`  Error uploading file: ${error.response.status} - ${error.message}`);
      console.error('  Response data:', JSON.stringify(error.response.data, null, 2));
      
      if (error.response.status === 403) {
        console.error('  Authentication error. Please check your API token.');
        console.error('  You can create an API token in the Strapi admin panel:');
        console.error('  1. Go to Settings > API Tokens');
        console.error('  2. Create a new API token with full access');
        console.error('  3. Set the token as an environment variable:');
        console.error('     export STRAPI_API_TOKEN=your_token_here');
      }
    } else {
      console.error(`  Error uploading file: ${error.message}`);
    }
    throw error;
  }
}

// Helper function to link file to project
async function linkFileToProject(db, fileId, projectId) {
  try {
    // Check if link already exists
    const existingLink = await db.get(
      'SELECT id FROM files_related_mph WHERE file_id = ? AND related_id = ? AND field = ?', 
      [fileId, projectId, 'vineImages']
    );
    
    if (!existingLink) {
      console.log(`  Creating link between file ${fileId} and project ${projectId}`);
      
      // Insert the link into the database
      await db.run(`
        INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
        VALUES (?, ?, ?, ?, ?)
      `, [fileId, projectId, 'api::project.project', 'vineImages', 0]);
      
      console.log(`  Successfully linked file ${fileId} to project ${projectId}`);
    } else {
      console.log(`  Link already exists between file ${fileId} and project ${projectId}`);
    }
    
    // Also update the project record to ensure the relationship is properly set
    try {
      // Get the current vineImages value
      const project = await db.get('SELECT vineImages FROM projects WHERE id = ?', [projectId]);
      
      if (project) {
        // Parse the current value or initialize as an empty array
        let vineImages = [];
        try {
          if (project.vineImages) {
            vineImages = JSON.parse(project.vineImages);
          }
        } catch (e) {
          console.log(`  Error parsing vineImages for project ${projectId}: ${e.message}`);
        }
        
        // Add the file ID if it's not already in the array
        if (!vineImages.includes(fileId)) {
          vineImages.push(fileId);
          
          // Update the project record
          await db.run('UPDATE projects SET vineImages = ? WHERE id = ?', 
            [JSON.stringify(vineImages), projectId]);
          
          console.log(`  Updated project ${projectId} vineImages field with file ${fileId}`);
        } else {
          console.log(`  File ${fileId} already in project ${projectId} vineImages field`);
        }
      }
    } catch (error) {
      console.error(`  Error updating project vineImages field: ${error.message}`);
    }
  } catch (error) {
    console.error(`  Error linking file to project: ${error.message}`);
    throw error;
  }
}

// Main function to process and upload collages
async function uploadCollages() {
  console.log('Starting collage upload process...');
  
  // Get Strapi API token
  const token = await getStrapiToken();
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }
  
  // Check Strapi connection
  const isConnected = await checkStrapiConnection();
  if (!isConnected) {
    console.error('Cannot connect to Strapi. Please ensure it is running and accessible.');
    process.exit(1);
  }
  
  // Open database connection
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });
  
  try {
    // Get list of files in the source directory
    const files = await fs.readdir(COLLAGE_SOURCE_DIR);
    console.log(`Found ${files.length} files in source directory`);
    
    // Filter for image files
    const imageFiles = files.filter(file => {
      const ext = path.extname(file).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext);
    });
    
    console.log(`Found ${imageFiles.length} image files`);
    
    // Process each image file
    for (const file of imageFiles) {
      console.log(`Processing file: ${file}`);
      
      // Extract project info from filename
      const projectInfo = extractProjectInfo(file);
      if (!projectInfo) {
        console.log(`  Skipping file ${file} - does not match expected naming pattern`);
        continue;
      }
      
      const { year, projectName } = projectInfo;
      console.log(`  Extracted project info - Year: ${year}, Name: ${projectName}`);
      
      // Find project in database
      const project = await db.get('SELECT id FROM projects WHERE name = ?', [projectName]);
      if (!project) {
        console.log(`  Project "${projectName}" not found in database, skipping`);
        continue;
      }
      
      console.log(`  Found project with ID: ${project.id}`);
      
      // Get folder ID for this project's collage folder
      const folderId = await getProjectFolderId(db, projectName, year);
      if (!folderId) {
        console.log(`  Collage folder not found for project "${projectName}", skipping`);
        continue;
      }
      
      console.log(`  Found collage folder with ID: ${folderId}`);
      
      // Ensure file is PNG
      const filePath = path.join(COLLAGE_SOURCE_DIR, file);
      const pngPath = await ensurePNG(filePath);
      
      // Upload file to Strapi
      console.log(`  Uploading file to Strapi...`);
      const fileId = await uploadFileToStrapi(pngPath, folderId);
      console.log(`  File uploaded with ID: ${fileId}`);
      
      // Link file to project
      await linkFileToProject(db, fileId, project.id);
      
      // Clean up temporary PNG file if it was converted
      if (pngPath !== filePath) {
        await fs.unlink(pngPath);
        console.log(`  Cleaned up temporary PNG file`);
      }
    }
    
    console.log('Collage upload process completed successfully');
  } catch (error) {
    console.error('Error during collage upload process:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

// Run the script
uploadCollages().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
}); 