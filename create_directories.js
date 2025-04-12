const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');

const API_URL = 'http://localhost:1337/api/projects/project-list';
const STRAPI_URL = 'http://localhost:1337';
const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || ''; // Get from environment variable or set directly
const DB_PATH = path.join(__dirname, '../jackie-summel/data/data.db');

// Set up axios defaults
axios.defaults.headers.common['Authorization'] = STRAPI_API_TOKEN ? `Bearer ${STRAPI_API_TOKEN}` : '';

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
    
    // Handle API response structure - expecting array of "YYYY Project Name" strings
    if (response.data && Array.isArray(response.data)) {
      return response.data.map(projectString => {
        // Validate that the string starts with a 4-digit year
        if (!/^\d{4}\s/.test(projectString)) {
          throw new Error(`Invalid project format - must start with year: ${projectString}`);
        }
        return projectString;
      });
    } else {
      throw new Error('Unexpected API response structure - expected array of project strings');
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

// Update findStrapiFolder to return all fields
async function findStrapiFolder(name, parentId = null) {
  try {
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    try {
      if (!parentId) {
        // Simple query for root folders
        const query = 'SELECT * FROM upload_folders WHERE name = ?';
        return await db.get(query, [name]);
      }

      // For folders with parents, we need to check the relationship table
      const query = `
        SELECT f.* 
        FROM upload_folders f
        LEFT JOIN upload_folders_parent_lnk r ON f.id = r.folder_id
        WHERE f.name = ? AND (r.inv_folder_id = ? OR r.inv_folder_id IS NULL)
      `;
      
      const folder = await db.get(query, [name, parentId]);
      return folder;
    } finally {
      await db.close();
    }
  } catch (error) {
    console.error(`  Error finding folder "${name}":`, error.message);
    return null;
  }
}

// Add this function to convert any timestamp to Unix format
function ensureUnixTimestamp(timestamp) {
  if (!timestamp) {
    return Date.now();
  }
  // If it's already a Unix timestamp (number or numeric string)
  if (!isNaN(timestamp) && timestamp > 1000000000000) {
    return timestamp;
  }
  // If it's an ISO string or any other date format
  return new Date(timestamp).getTime();
}

// Add this function to sync timestamps to Unix format
async function syncTimestamps(db) {
  try {
    await db.run('BEGIN TRANSACTION');
    
    // Get all records
    const folders = await db.all('SELECT id, created_at, updated_at, published_at FROM upload_folders');
    
    // Update each record with Unix timestamps
    for (const folder of folders) {
      const created = ensureUnixTimestamp(folder.created_at);
      const updated = ensureUnixTimestamp(folder.updated_at);
      const published = ensureUnixTimestamp(folder.published_at);
      
      await db.run(`
        UPDATE upload_folders 
        SET created_at = ?,
            updated_at = ?,
            published_at = ?
        WHERE id = ?
      `, [created, updated, published, folder.id]);
    }
    
    await db.run('COMMIT');
    console.log('  Synchronized timestamps to Unix format');
  } catch (error) {
    await db.run('ROLLBACK');
    console.error('  Error synchronizing timestamps:', error.message);
    throw error;
  }
}

// Helper function to create or update a folder in Strapi database
async function createStrapiFolder(name, parentId = null) {
  try {
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    try {
      // Check if folder already exists
      const existingFolder = await findStrapiFolder(name, parentId);
      
      if (existingFolder) {
        // Generate new path if current one doesn't match format
        let newPath = existingFolder.path;
        if (!newPath || !newPath.startsWith('/')) {
          newPath = parentId ? `/${parentId}/${existingFolder.id}` : `/${existingFolder.id}`;
        }

        // Generate new document_id if current one is null or invalid
        let newDocumentId = existingFolder.document_id;
        if (!newDocumentId || newDocumentId === 'NULL') {
          newDocumentId = uuidv4().replace(/-/g, '');
        }

        // Get current timestamp
        const now = Date.now();

        // Get the next available path_id if needed
        let newPathId = existingFolder.path_id;
        if (!newPathId) {
          const maxPathIdResult = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
          newPathId = (maxPathIdResult.maxPathId || 0) + 1;
        }

        // Update all fields except name to ensure correct format
        await db.run(`
          UPDATE upload_folders 
          SET document_id = ?,
              path_id = ?,
              path = ?,
              created_at = COALESCE(?, ?),
              updated_at = ?,
              published_at = ?,
              created_by_id = COALESCE(created_by_id, 2),
              updated_by_id = 2,
              locale = COALESCE(locale, NULL)
          WHERE id = ?
        `, [
          newDocumentId,
          newPathId,
          newPath,
          existingFolder.created_at ? ensureUnixTimestamp(existingFolder.created_at) : now,
          now,
          now,
          existingFolder.id
        ]);
        
        console.log(`  Updated folder "${name}" with ID: ${existingFolder.id}, path_id: ${newPathId}, path: ${newPath}`);
        return existingFolder.id;
      }
      
      // If folder doesn't exist, create new one
      // Get the next available ID and path_id
      const maxIdResult = await db.get('SELECT MAX(id) as maxId FROM upload_folders');
      const nextId = (maxIdResult.maxId || 0) + 1;
      
      const maxPathIdResult = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
      const nextPathId = (maxPathIdResult.maxPathId || 0) + 1;
      
      // Generate a UUID for document_id
      const documentId = uuidv4().replace(/-/g, '');
      
      // Determine the path - should be /{parent_id}/{id} or just /{id} for root
      const path = parentId ? `/${parentId}/${nextId}` : `/${nextId}`;

      // Get current timestamp
      const now = Date.now();
      
      // Insert the folder into the database
      await db.run(`
        INSERT INTO upload_folders (
          id, document_id, name, path_id, path, created_at, updated_at, published_at, created_by_id, updated_by_id, locale
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        nextId,
        documentId,
        name,
        nextPathId,  // Using unique path_id
        path,
        now,
        now,
        now,
        2,
        2,
        null
      ]);
      
      console.log(`  Created folder "${name}" with ID: ${nextId}, path_id: ${nextPathId}, path: ${path}`);
      
      // If this is a subfolder, update the parent-child relationship
      if (parentId) {
        // Check if the relationship table exists
        const tableExists = await db.get(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='upload_folders_parent_lnk'
        `);
        
        if (tableExists) {
          // Check if relationship already exists
          const existingRelation = await db.get(`
            SELECT * FROM upload_folders_parent_lnk 
            WHERE folder_id = ? AND inv_folder_id = ?
          `, [nextId, parentId]);
          
          if (!existingRelation) {
            // Insert the parent-child relationship
            await db.run(`
              INSERT INTO upload_folders_parent_lnk (folder_id, inv_folder_id, folder_ord)
              VALUES (?, ?, ?)
            `, [nextId, parentId, 1]);
            
            console.log(`  Created parent-child relationship: ${parentId} -> ${nextId}`);
          }
        }
      }
      
      return nextId;
    } finally {
      await db.close();
    }
  } catch (error) {
    console.error(`  Error creating/updating folder "${name}":`, error.message);
    throw error;
  }
}

// Add this function after the imports and before other functions
async function syncPathIds(db) {
  try {
    await db.run('BEGIN TRANSACTION');
    await db.run('UPDATE upload_folders SET path_id = NULL');
    await db.run('UPDATE upload_folders SET path_id = id');
    await db.run('COMMIT');
    console.log('  Synchronized path_ids with ids');
  } catch (error) {
    await db.run('ROLLBACK');
    console.error('  Error synchronizing path_ids:', error.message);
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
      updated: [],
      errors: []
    };

    // Open a single database connection for the entire operation
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });

    try {
      for (const projectName of projects) {
        const projectPath = path.join(OUTPUT_DIR, projectName);
        const collagePath = path.join(projectPath, `${projectName}_collage`);
        const galleryPath = path.join(projectPath, `${projectName}_gallery`);

        try {
          // Create physical directories if they don't exist
          await ensureDirectoryExists(projectPath);
          await ensureDirectoryExists(collagePath);
          await ensureDirectoryExists(galleryPath);
          
          // Always process Strapi folders
          console.log(`Processing Strapi folders for: ${projectName}`);
          
          // Create/update main project folder
          const mainFolderId = await createStrapiFolder(projectName);
          
          // Create/update collage subfolder
          const collageFolderId = await createStrapiFolder(`${projectName}_collage`, mainFolderId);
          
          // Create/update gallery subfolder
          const galleryFolderId = await createStrapiFolder(`${projectName}_gallery`, mainFolderId);
          
          // Check if directories existed before
          const existed = await fs.access(projectPath).then(() => true).catch(() => false);
          if (existed) {
            results.updated.push(projectName);
            console.log(`Updated Strapi folders for: ${projectName}`);
          } else {
            results.created.push(projectName);
            console.log(`Created directories and Strapi folders for: ${projectName}`);
          }
        } catch (error) {
          results.errors.push({ name: projectName, error: error.message });
          console.error(`Error processing ${projectName}:`, error.message);
        }
      }

      // Synchronize path_ids after all folders are created/updated
      console.log('\nSynchronizing path_ids with ids...');
      await syncPathIds(db);

      // Synchronize timestamps to Unix format
      console.log('\nSynchronizing timestamps to Unix format...');
      await syncTimestamps(db);

      // Print summary
      console.log('\nSummary:');
      console.log('Created new directories and folders:', results.created.length);
      console.log('Updated existing Strapi folders:', results.updated.length);
      console.log('Errors:', results.errors.length);

      // Write detailed log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const logContent = [
        '=== Newly Created Project Directories and Folders ===',
        ...results.created,
        '\n=== Updated Strapi Folders ===',
        ...results.updated,
        '\n=== Errors ===',
        ...results.errors.map(e => `${e.name}: ${e.error}`)
      ].join('\n');

      const logPath = path.join(__dirname, `directory_creation_log_${timestamp}.txt`);
      await fs.writeFile(logPath, logContent);
      console.log(`\nDetailed log written to: ${logPath}`);

    } finally {
      await db.close();
    }

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
createProjectDirectories(); 
