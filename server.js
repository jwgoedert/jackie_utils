const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;
const os = require('os');
const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint to get directory contents
app.get('/api/browse', async (req, res) => {
  try {
    // Start from home directory if no path provided
    let startPath = req.query.path || os.homedir();
    
    // Ensure the path exists and is a directory
    const stats = await fs.stat(startPath);
    if (!stats.isDirectory()) {
      throw new Error('Not a directory');
    }

    // Get directory contents
    const contents = await fs.readdir(startPath, { withFileTypes: true });
    
    // Get parent directory
    const parentDir = path.dirname(startPath);
    
    // Prepare response data
    const data = {
      currentPath: startPath,
      parentPath: parentDir !== startPath ? parentDir : null,
      directories: contents
        .filter(dirent => dirent.isDirectory())
        .map(dirent => ({
          name: dirent.name,
          path: path.join(startPath, dirent.name)
        }))
    };
    
    res.json(data);
  } catch (error) {
    console.error('Browse error:', error);
    res.status(500).json({ error: error.message });
  }
});

// API endpoint to run the migration
app.post('/api/run-migration', async (req, res) => {
  const { directories, destinationPath } = req.body;
  
  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    return res.status(400).json({ error: 'No directories provided' });
  }
  
  try {
    // Create a temporary configuration file with the selected directories and destination path
    const configPath = path.join(__dirname, 'temp-config.json');
    await fs.writeFile(configPath, JSON.stringify({ 
      directories,
      destinationPath: destinationPath || null
    }, null, 2));
    
    // Run the migration script
    exec(`node migration.js --config ${configPath}`, (error, stdout, stderr) => {
      // Clean up the temporary config file
      fs.unlink(configPath).catch(console.error);
      
      if (error) {
        console.error(`Error executing migration: ${error.message}`);
        return res.status(500).json({ error: error.message, stderr });
      }
      
      // Find the log files
      const findLogFiles = async () => {
        const files = await fs.readdir(__dirname);
        const logFiles = {
          projects: files.find(f => f.startsWith('db_projects_list')),
          collage: files.find(f => f.startsWith('collage_output')),
          gallery: files.find(f => f.startsWith('gallery_output'))
        };
        
        const logs = {};
        
        for (const [key, filename] of Object.entries(logFiles)) {
          if (filename) {
            const content = await fs.readFile(path.join(__dirname, filename), 'utf8');
            logs[key] = content;
          } else {
            logs[key] = 'Log file not found';
          }
        }
        
        return logs;
      };
      
      // Return the logs
      findLogFiles().then(logs => {
        res.json({ 
          success: true, 
          stdout,
          logs
        });
      });
    });
  } catch (error) {
    console.error('Error running migration:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
}); 