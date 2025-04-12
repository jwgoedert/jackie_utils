const express = require('express');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs').promises;
const app = express();
const port = 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// API endpoint to run the migration
app.post('/api/run-migration', async (req, res) => {
  const { directories } = req.body;
  
  if (!directories || !Array.isArray(directories) || directories.length === 0) {
    return res.status(400).json({ error: 'No directories provided' });
  }
  
  try {
    // Create a temporary configuration file with the selected directories
    const configPath = path.join(__dirname, 'temp-config.json');
    await fs.writeFile(configPath, JSON.stringify({ directories }, null, 2));
    
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