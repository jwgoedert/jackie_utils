const STRAPI_API_TOKEN = process.env.STRAPI_API_TOKEN || ''; // Get from environment variable or set directly
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

axios.defaults.headers.common['Authorization'] = STRAPI_API_TOKEN ? `Bearer ${STRAPI_API_TOKEN}` : '';

// Configuration
const API_URL = 'http://localhost:1337/api/projects/project-list';
const STRAPI_URL = 'http://localhost:1337';
const UPLOADS_DIR = path.join(__dirname, '../jackie-summel/public/uploads');
const DB_PATH = path.join(__dirname, '../jackie-summel/data/data.db');

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
  for (const projectName of projects) {
    const projectDir = path.join(UPLOADS_DIR, projectName);
    const collageDir = path.join(projectDir, `${projectName}_collage`);
    const galleryDir = path.join(projectDir, `${projectName}_gallery`);

    await fs.mkdir(projectDir, { recursive: true });
    await fs.mkdir(collageDir, { recursive: true });
    await fs.mkdir(galleryDir, { recursive: true });
  }
  console.log('Local folders created successfully');
}

async function verifyDatabase() {
  console.log('Verifying database...');
  try {
    // Check if database file exists
    await fs.access(DB_PATH);
    console.log('Database file exists at:', DB_PATH);
    
    // Try to open the database
    const db = await open({
      filename: DB_PATH,
      driver: sqlite3.Database
    });
    
    // Check if required tables exist
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const requiredTables = ['upload_folders', 'projects'];
    const missingTables = requiredTables.filter(table => 
      !tables.some(t => t.name === table)
    );
    
    if (missingTables.length > 0) {
      throw new Error(`Missing required tables: ${missingTables.join(', ')}`);
    }
    
    // Check table structure
    const folderColumns = await db.all("PRAGMA table_info(upload_folders)");
    console.log('Upload folders table columns:', folderColumns.map(col => col.name).join(', '));
    
    await db.close();
    console.log('Database verification successful');
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error('Database file not found at:', DB_PATH);
      console.error('Please make sure Strapi is running and the database is initialized.');
    } else {
      console.error('Database verification failed:', error.message);
    }
    return false;
  }
}

async function updateDatabase(projects) {
  console.log('Updating database...');
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  try {
    // First inspect both tables' structures
    const folderColumns = await db.all("PRAGMA table_info(upload_folders)");
    const projectColumns = await db.all("PRAGMA table_info(projects)");
    
    console.log('\nUpload folders table structure:');
    folderColumns.forEach(col => {
      console.log(`  - ${col.name} (${col.type})${col.pk ? ' PRIMARY KEY' : ''}${col.notnull ? ' NOT NULL' : ''}`);
    });

    console.log('\nProjects table structure:');
    projectColumns.forEach(col => {
      console.log(`  - ${col.name} (${col.type})${col.pk ? ' PRIMARY KEY' : ''}${col.notnull ? ' NOT NULL' : ''}`);
    });

    // Begin transaction
    await db.run('BEGIN TRANSACTION');

    for (const projectName of projects) {
      console.log(`Processing project: ${projectName}`);
      
      // Check if main project folder already exists
      const existingMainFolder = await db.get('SELECT id FROM upload_folders WHERE path = ?', [projectName]);
      
      let projectFolderId;
      if (existingMainFolder) {
        console.log(`  Main folder already exists with ID: ${existingMainFolder.id}`);
        projectFolderId = existingMainFolder.id;
      } else {
        // Create main project folder
        const result = await db.run(`
          INSERT INTO upload_folders (
            name, 
            path, 
            path_id,
            created_at, 
            updated_at,
            published_at,
            locale
          )
          VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 'en')
        `, [projectName, projectName, null]);
        projectFolderId = result.lastID;
        console.log(`  Created main folder with ID: ${projectFolderId}`);
      }

      // Check if collage folder already exists
      const collagePath = `${projectName}/${projectName}_collage`;
      const existingCollageFolder = await db.get('SELECT id FROM upload_folders WHERE path = ?', [collagePath]);
      
      let collageFolderId;
      if (existingCollageFolder) {
        console.log(`  Collage folder already exists with ID: ${existingCollageFolder.id}`);
        collageFolderId = existingCollageFolder.id;
      } else {
        // Get the next available path_id
        const { maxPathId } = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
        const nextPathId = (maxPathId || 0) + 1;
        
        // Create collage subfolder
        const result = await db.run(`
          INSERT INTO upload_folders (
            name, 
            path, 
            path_id,
            created_at, 
            updated_at,
            published_at,
            locale
          )
          VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 'en')
        `, [`${projectName}_collage`, collagePath, nextPathId]);
        collageFolderId = result.lastID;
        console.log(`  Created collage folder with ID: ${collageFolderId}`);
      }

      // Check if gallery folder already exists
      const galleryPath = `${projectName}/${projectName}_gallery`;
      const existingGalleryFolder = await db.get('SELECT id FROM upload_folders WHERE path = ?', [galleryPath]);
      
      let galleryFolderId;
      if (existingGalleryFolder) {
        console.log(`  Gallery folder already exists with ID: ${existingGalleryFolder.id}`);
        galleryFolderId = existingGalleryFolder.id;
      } else {
        // Get the next available path_id
        const { maxPathId } = await db.get('SELECT MAX(path_id) as maxPathId FROM upload_folders');
        const nextPathId = (maxPathId || 0) + 1;
        
        // Create gallery subfolder
        const result = await db.run(`
          INSERT INTO upload_folders (
            name, 
            path, 
            path_id,
            created_at, 
            updated_at,
            published_at,
            locale
          )
          VALUES (?, ?, ?, datetime('now'), datetime('now'), datetime('now'), 'en')
        `, [`${projectName}_gallery`, galleryPath, nextPathId]);
        galleryFolderId = result.lastID;
        console.log(`  Created gallery folder with ID: ${galleryFolderId}`);
      }

      // Check if folder relationships already exist
      const existingCollageLink = await db.get(
        'SELECT id FROM upload_folders_parent_lnk WHERE folder_id = ? AND inv_folder_id = ?', 
        [collageFolderId, projectFolderId]
      );
      
      if (!existingCollageLink) {
        // Link collage folder to main folder
        await db.run(`
          INSERT INTO upload_folders_parent_lnk (folder_id, inv_folder_id, folder_ord)
          VALUES (?, ?, ?)
        `, [collageFolderId, projectFolderId, 0]);
        console.log(`  Created link between collage folder and main folder`);
      }

      const existingGalleryLink = await db.get(
        'SELECT id FROM upload_folders_parent_lnk WHERE folder_id = ? AND inv_folder_id = ?', 
        [galleryFolderId, projectFolderId]
      );
      
      if (!existingGalleryLink) {
        // Link gallery folder to main folder
        await db.run(`
          INSERT INTO upload_folders_parent_lnk (folder_id, inv_folder_id, folder_ord)
          VALUES (?, ?, ?)
        `, [galleryFolderId, projectFolderId, 1]);
        console.log(`  Created link between gallery folder and main folder`);
      }

      // Find the project in the database
      const projectNameWithoutYear = projectName.split(' ').slice(1).join(' ');
      const project = await db.get('SELECT id FROM projects WHERE name = ?', [projectNameWithoutYear]);
      
      if (project) {
        console.log(`  Found project with ID: ${project.id}`);
        
        // Check if files already exist
        const existingCollageFile = await db.get(
          'SELECT id FROM files WHERE folder_path = ?', 
          [collagePath]
        );
        
        let collageFileId;
        if (existingCollageFile) {
          console.log(`  Collage file already exists with ID: ${existingCollageFile.id}`);
          collageFileId = existingCollageFile.id;
        } else {
          // Create placeholder file for collage folder
          const result = await db.run(`
            INSERT INTO files (
              name, 
              folder_path,
              created_at, 
              updated_at,
              published_at,
              locale
            )
            VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'), 'en')
          `, [`${projectName}_collage_placeholder`, collagePath]);
          collageFileId = result.lastID;
          console.log(`  Created collage file with ID: ${collageFileId}`);
        }
        
        const existingGalleryFile = await db.get(
          'SELECT id FROM files WHERE folder_path = ?', 
          [galleryPath]
        );
        
        let galleryFileId;
        if (existingGalleryFile) {
          console.log(`  Gallery file already exists with ID: ${existingGalleryFile.id}`);
          galleryFileId = existingGalleryFile.id;
        } else {
          // Create placeholder file for gallery folder
          const result = await db.run(`
            INSERT INTO files (
              name, 
              folder_path,
              created_at, 
              updated_at,
              published_at,
              locale
            )
            VALUES (?, ?, datetime('now'), datetime('now'), datetime('now'), 'en')
          `, [`${projectName}_gallery_placeholder`, galleryPath]);
          galleryFileId = result.lastID;
          console.log(`  Created gallery file with ID: ${galleryFileId}`);
        }

        // Check if file-folder links already exist
        const existingCollageFileLink = await db.get(
          'SELECT id FROM files_folder_lnk WHERE file_id = ? AND folder_id = ?', 
          [collageFileId, collageFolderId]
        );
        
        if (!existingCollageFileLink) {
          // Link collage file to collage folder
          await db.run(`
            INSERT INTO files_folder_lnk (file_id, folder_id, file_ord)
            VALUES (?, ?, ?)
          `, [collageFileId, collageFolderId, 0]);
          console.log(`  Created link between collage file and collage folder`);
        }
        
        const existingGalleryFileLink = await db.get(
          'SELECT id FROM files_folder_lnk WHERE file_id = ? AND folder_id = ?', 
          [galleryFileId, galleryFolderId]
        );
        
        if (!existingGalleryFileLink) {
          // Link gallery file to gallery folder
          await db.run(`
            INSERT INTO files_folder_lnk (file_id, folder_id, file_ord)
            VALUES (?, ?, ?)
          `, [galleryFileId, galleryFolderId, 0]);
          console.log(`  Created link between gallery file and gallery folder`);
        }

        // Check if project-file links already exist
        const existingCollageProjectLink = await db.get(
          'SELECT id FROM files_related_mph WHERE file_id = ? AND related_id = ? AND field = ?', 
          [collageFileId, project.id, 'vineImages']
        );
        
        if (!existingCollageProjectLink) {
          // Link collage file to project
          await db.run(`
            INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
            VALUES (?, ?, ?, ?, ?)
          `, [collageFileId, project.id, 'api::project.project', 'vineImages', 0]);
          console.log(`  Created link between collage file and project`);
        }
        
        const existingGalleryProjectLink = await db.get(
          'SELECT id FROM files_related_mph WHERE file_id = ? AND related_id = ? AND field = ?', 
          [galleryFileId, project.id, 'galleryImages']
        );
        
        if (!existingGalleryProjectLink) {
          // Link gallery file to project
          await db.run(`
            INSERT INTO files_related_mph (file_id, related_id, related_type, field, "order")
            VALUES (?, ?, ?, ?, ?)
          `, [galleryFileId, project.id, 'api::project.project', 'galleryImages', 0]);
          console.log(`  Created link between gallery file and project`);
        }
      } else {
        console.log(`  Warning: Project "${projectNameWithoutYear}" not found in database`);
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
