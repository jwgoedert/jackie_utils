const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || ''; // Get from environment variable or set directly
const fs = require('fs');  // Regular fs for sync operations
const fsPromises = require('fs').promises;  // Promises version for async operations
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

axios.defaults.headers.common['Authorization'] = STRAPI_API_TOKEN ? `Bearer ${STRAPI_API_TOKEN}` : '';

// Configuration
const STRAPI_BASE_URL = 'http://localhost:1337';
const API_URL = 'http://localhost:1337/api/projects/project-list';
const STRAPI_URL = 'http://localhost:1337';
const DB_PATH = '/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie-summel/data/data.db';
const PROJECT_FOLDERS_DIR = path.join(process.cwd(), 'jackie-summel', 'public', 'uploads', 'project_folders');
const UPLOADS_DIR = PROJECT_FOLDERS_DIR;  // Now points to the project_folders directory

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

async function getProjectsFromAPI() {
  try {
    const response = await axios.get(API_URL);
    if (response.data && Array.isArray(response.data)) {
      return response.data.map(projectString => {
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
      console.error('API Error Response:', error.response.data);
      console.error('API Error Status:', error.response.status);
    }
    throw error;
  }
}

async function createLocalFolders(projects) {
  console.log('Creating local folders...');
  
  // Ensure the project_folders directory exists
  try {
    await fsPromises.mkdir(PROJECT_FOLDERS_DIR, { recursive: true });
    console.log(`Created parent directory: ${PROJECT_FOLDERS_DIR}`);
  } catch (error) {
    console.error(`Error creating parent directory: ${error.message}`);
    throw error;
  }

  for (const projectName of projects) {
    const projectDir = path.join(UPLOADS_DIR, projectName);
    const collageDir = path.join(projectDir, `${projectName}_collage`);
    const galleryDir = path.join(projectDir, `${projectName}_gallery`);

    await fsPromises.mkdir(projectDir, { recursive: true });
    await fsPromises.mkdir(collageDir, { recursive: true });
    await fsPromises.mkdir(galleryDir, { recursive: true });
  }
  console.log('Local folders created successfully');
}

async function verifyDatabase() {
  try {
    // Check if file exists and is readable
    if (!fs.existsSync(DB_PATH)) {
      throw new Error(`Database file not found at ${DB_PATH}`);
    }

    // Check if file is writable
    try {
      fs.accessSync(DB_PATH, fs.constants.R_OK | fs.constants.W_OK);
    } catch (err) {
      console.error('Warning: Database file is not writable. Attempting to fix permissions...');
      try {
        fs.chmodSync(DB_PATH, 0o666);
        console.log('Successfully updated database file permissions');
      } catch (chmodErr) {
        console.error('Failed to update permissions:', chmodErr.message);
        console.error('Please run the script with appropriate permissions or manually update file permissions');
        process.exit(1);
      }
    }

    // Open database with write permissions
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    // Check if required tables exist
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const requiredTables = ['upload_folders', 'upload_folders_parent_lnk', 'projects'];
    const missingTables = requiredTables.filter(table => 
      !tables.some(t => t.name === table)
    );
    
    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }
    
    // Check table structure
    const folderColumns = await db.all("PRAGMA table_info(upload_folders)");
    console.log('Upload folders table columns:', folderColumns.map(col => col.name).join(', '));
    
    const linkColumns = await db.all("PRAGMA table_info(upload_folders_parent_lnk)");
    console.log('Upload folders parent link table columns:', linkColumns.map(col => col.name).join(', '));
    
    await db.close();
    console.log('Database verification successful');
    return true;
  } catch (error) {
    console.error('Database verification failed:', error.message);
    process.exit(1);
  }
}

async function updateDatabase(projects) {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  try {
    // Start transaction
    await db.run('BEGIN TRANSACTION');

    // Create parent "project_folders" directory in the database
    const parentFolderName = "project_folders";
    const parentFolderPath = "/1"; // Root path with ID 1
    
    // Check if parent folder already exists
    const existingParentFolder = await db.get('SELECT id FROM upload_folders WHERE path = ?', [parentFolderPath]);
    
    let parentFolderId;
    if (existingParentFolder) {
      console.log(`Parent folder already exists with ID: ${existingParentFolder.id}`);
      parentFolderId = existingParentFolder.id;
    } else {
      // Get the next available ID and path_id
      const maxIdResult = await db.get('SELECT MAX(id) as maxId FROM upload_folders');
      const nextId = (maxIdResult.maxId || 0) + 1;
      
      const maxPathIdResult = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
      const nextPathId = (maxPathIdResult.maxPathId || 0) + 1;
      
      // Generate a UUID for document_id
      const documentId = uuidv4().replace(/-/g, '');

      // Create parent folder
      await db.run(`
        INSERT INTO upload_folders (
          id,
          document_id,
          name, 
          path_id,
          path,
          created_at, 
          updated_at,
          published_at,
          created_by_id,
          updated_by_id,
          locale
        )
        VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), ?, ?, 'en')
      `, [nextId, documentId, parentFolderName, nextPathId, parentFolderPath, 1, 1]);
      parentFolderId = nextId;
      console.log(`Created parent folder with ID: ${parentFolderId}`);
    }

    // Get the next available path_id
    const { maxPathId } = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
    let nextPathId = (maxPathId || 0) + 1;

    // Track folder order for parent-child relationships
    let folderOrder = 1;
    
    // Get the initial next available ID for the link table
    const maxLinkIdResult = await db.get('SELECT MAX(id) as maxId FROM upload_folders_parent_lnk');
    let nextLinkId = (maxLinkIdResult.maxId || 0) + 1;
    console.log(`Starting with link ID: ${nextLinkId}`);

    for (const projectName of projects) {
      try {
        // Get the next available ID
        const maxIdResult = await db.get('SELECT MAX(id) as maxId FROM upload_folders');
        const nextId = (maxIdResult.maxId || 0) + 1;
        
        // Generate a UUID for document_id
        const documentId = uuidv4().replace(/-/g, '');
        
        // Create main project folder
        const projectPath = `/1/${nextId}`;
        const projectPathId = nextPathId++;

        // Check if main project folder already exists
        const existingProjectFolder = await db.get(
          'SELECT id FROM upload_folders WHERE name = ?',
          [projectName]
        );

        if (!existingProjectFolder) {
          // Create main project folder
          await db.run(
            `INSERT INTO upload_folders (
              id,
              document_id,
              name, 
              path_id,
              path,
              created_at, 
              updated_at,
              published_at,
              created_by_id, 
              updated_by_id,
              locale
            ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), ?, ?, 'en')`,
            [
              nextId,
              documentId,
              projectName,
              projectPathId,
              projectPath,
              1,
              1
            ]
          );
          console.log(`Created main project folder: ${projectName}`);

          // Link project folder to parent "project_folders" directory
          await db.run(
            'INSERT INTO upload_folders_parent_lnk (id, folder_id, inv_folder_id, folder_ord) VALUES (?, ?, ?, ?)',
            [nextLinkId, nextId, parentFolderId, folderOrder++]
          );
          console.log(`Linked project folder to parent directory: ${projectName} with link ID: ${nextLinkId}`);
          nextLinkId++; // Increment the link ID for the next use

          // Create collage folder
          const collageFolderId = nextId + 1;
          const collageDocumentId = uuidv4().replace(/-/g, '');
          const collagePath = `/1/${nextId}/${collageFolderId}`;
          const collagePathId = nextPathId++;

          await db.run(
            `INSERT INTO upload_folders (
              id,
              document_id,
              name, 
              path_id,
              path,
              created_at, 
              updated_at,
              published_at,
              created_by_id, 
              updated_by_id,
              locale
            ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), ?, ?, 'en')`,
            [
              collageFolderId,
              collageDocumentId,
              `${projectName}_collage`,
              collagePathId,
              collagePath,
              1,
              1
            ]
          );
          console.log(`Created collage folder: ${projectName}_collage`);

          // Create gallery folder
          const galleryFolderId = nextId + 2;
          const galleryDocumentId = uuidv4().replace(/-/g, '');
          const galleryPath = `/1/${nextId}/${galleryFolderId}`;
          const galleryPathId = nextPathId++;

          await db.run(
            `INSERT INTO upload_folders (
              id,
              document_id,
              name, 
              path_id,
              path,
              created_at, 
              updated_at,
              published_at,
              created_by_id, 
              updated_by_id,
              locale
            ) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), ?, ?, 'en')`,
            [
              galleryFolderId,
              galleryDocumentId,
              `${projectName}_gallery`,
              galleryPathId,
              galleryPath,
              1,
              1
            ]
          );
          console.log(`Created gallery folder: ${projectName}_gallery`);

          // Link collage folder to project folder
          await db.run(
            'INSERT INTO upload_folders_parent_lnk (id, folder_id, inv_folder_id, folder_ord) VALUES (?, ?, ?, ?)',
            [nextLinkId, collageFolderId, nextId, 1]
          );
          console.log(`Linked collage folder to project folder with link ID: ${nextLinkId}`);
          nextLinkId++; // Increment the link ID for the next use

          // Link gallery folder to project folder
          await db.run(
            'INSERT INTO upload_folders_parent_lnk (id, folder_id, inv_folder_id, folder_ord) VALUES (?, ?, ?, ?)',
            [nextLinkId, galleryFolderId, nextId, 2]
          );
          console.log(`Linked gallery folder to project folder with link ID: ${nextLinkId}`);
          nextLinkId++; // Increment the link ID for the next use
        }
      } catch (error) {
        console.error(`Error processing project ${projectName}:`, error);
        throw error;
      }
    }

    // Commit transaction
    await db.run('COMMIT');
    console.log('Database updated successfully');
  } catch (error) {
    // Rollback on error
    await db.run('ROLLBACK');
    console.error('Error details:', error);
    console.error('Error stack:', error.stack);
    throw error;
  } finally {
    await db.close();
  }
}

async function inspectDatabase() {
  console.log('\nInspecting database schema...');
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  try {
    // Get all tables
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    console.log('\nTables found:', tables.map(t => t.name).join(', '));

    // For each table, show its columns with detailed information
    for (const table of tables) {
      const columns = await db.all(`PRAGMA table_info(${table.name})`);
      console.log(`\nTable: ${table.name}`);
      console.log('Columns:');
      columns.forEach(col => {
        console.log(`  - ${col.name} (${col.type})${col.pk ? ' PRIMARY KEY' : ''}${col.notnull ? ' NOT NULL' : ''}`);
      });

      // Show sample data for the table
      try {
        const sampleData = await db.all(`SELECT * FROM ${table.name} LIMIT 1`);
        if (sampleData.length > 0) {
          console.log('Sample data structure:');
          console.log(JSON.stringify(sampleData[0], null, 2));
        }
      } catch (error) {
        console.log('Could not fetch sample data:', error.message);
      }
    }
    
    // Examine existing folder relationships
    console.log('\nExamining existing folder relationships:');
    const folders = await db.all('SELECT * FROM upload_folders LIMIT 5');
    console.log('Sample folders:');
    folders.forEach(folder => {
      console.log(`  - ID: ${folder.id}, Name: ${folder.name}, Path: ${folder.path}, Path ID: ${folder.path_id}`);
    });
    
    // Check for any existing folder-project relationships
    if (tables.some(t => t.name === 'projects')) {
      const projectColumns = await db.all("PRAGMA table_info(projects)");
      const imageColumns = projectColumns
        .filter(col => col.name.toLowerCase().includes('image'))
        .map(col => col.name);
      
      console.log('\nImage columns in projects table:', imageColumns);
      
      if (imageColumns.length > 0) {
        const sampleProject = await db.all(`SELECT ${imageColumns.join(', ')} FROM projects LIMIT 1`);
        if (sampleProject.length > 0) {
          console.log('Sample project image relationships:');
          console.log(JSON.stringify(sampleProject[0], null, 2));
        }
      }
    }
  } finally {
    await db.close();
  }
}

async function createStrapiFolders() {
  try {
    // First check if Strapi is accessible
    const isConnected = await checkStrapiConnection();
    if (!isConnected) {
      throw new Error('Cannot connect to Strapi. Please ensure it is running and accessible.');
    }

    // Verify database before proceeding
    const isDatabaseValid = await verifyDatabase();
    if (!isDatabaseValid) {
      throw new Error('Database verification failed. Please make sure Strapi is running and the database is initialized.');
    }

    console.log('Fetching projects from API...');
    const projects = await getProjectsFromAPI();
    
    if (!Array.isArray(projects)) {
      throw new Error(`Expected array of projects, got: ${typeof projects}`);
    }

    // Create local folders
    await createLocalFolders(projects);

    // Update database
    await updateDatabase(projects);

    console.log('\nFolders created and linked successfully!');
    console.log('Please restart your Strapi server to see the changes.');

  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script with connection check
async function main() {
  const isConnected = await checkStrapiConnection();
  if (isConnected) {
    // First inspect the database
    await inspectDatabase();
    
    // Ask for confirmation before proceeding
    console.log('\nWould you like to proceed with creating folders? (y/n)');
    process.stdin.once('data', async (data) => {
      const answer = data.toString().trim().toLowerCase();
      if (answer === 'y') {
        await createStrapiFolders();
      } else {
        console.log('Operation cancelled.');
        process.exit(0);
      }
    });
  } else {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
