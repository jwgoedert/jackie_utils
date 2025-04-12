document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const browseButton = document.getElementById('browse-button');
  const filesList = document.getElementById('files-list');
  const runMigrationButton = document.getElementById('run-migration');
  const clearSelectionButton = document.getElementById('clear-selection');
  const consoleText = document.getElementById('console-text');
  const projectsLog = document.getElementById('projects-log');
  const collageLog = document.getElementById('collage-log');
  const galleryLog = document.getElementById('gallery-log');
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  // State
  let selectedDirectories = [];

  // Event Listeners
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('dragleave', handleDragLeave);
  dropZone.addEventListener('drop', handleDrop);
  browseButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', handleFileSelect);
  runMigrationButton.addEventListener('click', runMigration);
  clearSelectionButton.addEventListener('click', clearSelection);

  // Tab switching
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.getAttribute('data-tab');
      
      // Update active tab button
      tabButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      
      // Update active tab content
      tabContents.forEach(content => content.classList.remove('active'));
      document.getElementById(`${tabName}-output`).classList.add('active');
    });
  });

  // Functions
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  }

  function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    
    const items = e.dataTransfer.items;
    
    if (items) {
      // Use DataTransferItemList interface
      for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
          const entry = items[i].webkitGetAsEntry();
          if (entry && entry.isDirectory) {
            addDirectory(entry.fullPath);
          }
        }
      }
    } else {
      // Fallback for browsers that don't support DataTransferItemList
      const files = e.dataTransfer.files;
      for (let i = 0; i < files.length; i++) {
        if (files[i].webkitRelativePath) {
          // This is a directory
          addDirectory(files[i].webkitRelativePath.split('/')[0]);
        }
      }
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files;
    if (files.length > 0) {
      // Get the directory name from the first file's path
      const directoryName = files[0].webkitRelativePath.split('/')[0];
      addDirectory(directoryName);
    }
  }

  function addDirectory(path) {
    // Check if directory is already in the list
    if (!selectedDirectories.includes(path)) {
      selectedDirectories.push(path);
      
      // Add to UI
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${path}</span>
        <button class="remove-file" data-path="${path}">×</button>
      `;
      filesList.appendChild(li);
      
      // Add event listener to remove button
      li.querySelector('.remove-file').addEventListener('click', (e) => {
        const pathToRemove = e.target.getAttribute('data-path');
        removeDirectory(pathToRemove);
        li.remove();
      });
      
      // Enable run button if we have directories
      runMigrationButton.disabled = false;
    }
  }

  function removeDirectory(path) {
    selectedDirectories = selectedDirectories.filter(dir => dir !== path);
    if (selectedDirectories.length === 0) {
      runMigrationButton.disabled = true;
    }
  }

  function clearSelection() {
    selectedDirectories = [];
    filesList.innerHTML = '';
    runMigrationButton.disabled = true;
  }

  function logToConsole(message) {
    const timestamp = new Date().toLocaleTimeString();
    consoleText.innerHTML += `[${timestamp}] ${message}\n`;
    consoleText.scrollTop = consoleText.scrollHeight;
  }

  async function runMigration() {
    if (selectedDirectories.length === 0) {
      logToConsole('No directories selected. Please select at least one directory.');
      return;
    }

    logToConsole('Starting migration process...');
    runMigrationButton.disabled = true;
    
    try {
      // Call the server API to run the migration
      logToConsole('Sending request to server...');
      
      const response = await fetch('/api/run-migration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ directories: selectedDirectories })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server error');
      }
      
      const data = await response.json();
      
      // Update log displays
      if (data.logs) {
        projectsLog.textContent = data.logs.projects || 'No project log available';
        collageLog.textContent = data.logs.collage || 'No collage log available';
        galleryLog.textContent = data.logs.gallery || 'No gallery log available';
      }
      
      // Log the output
      if (data.stdout) {
        logToConsole('Server output:');
        logToConsole(data.stdout);
      }
      
      logToConsole('Migration process completed successfully!');
    } catch (error) {
      logToConsole(`Migration failed: ${error.message}`);
    } finally {
      runMigrationButton.disabled = false;
    }
  }
}); 