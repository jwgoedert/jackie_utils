document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  const selectedFiles = document.getElementById('selectedFiles');
  const clearButton = document.getElementById('clearButton');
  const runButton = document.getElementById('runButton');
  const output = document.getElementById('output');
  const destinationInput = document.getElementById('destinationPath');
  const browseButton = document.getElementById('browseButton');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');

  // State
  let selectedDirectories = new Set();

  // Event Listeners
  dropZone.addEventListener('dragover', handleDragOver);
  dropZone.addEventListener('drop', handleDrop);
  fileInput.addEventListener('change', handleFileSelect);
  clearButton.addEventListener('click', clearSelection);
  runButton.addEventListener('click', runMigration);
  browseButton.addEventListener('click', handleBrowse);

  // Tab switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tab.dataset.tab).classList.add('active');
    });
  });

  // Functions
  function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('dragover');
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('dragover');
    
    const items = e.dataTransfer.items;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry && entry.isDirectory) {
          addDirectory(entry.fullPath);
        }
      }
    }
  }

  function handleFileSelect(e) {
    const files = e.target.files;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.webkitRelativePath) {
        const path = file.webkitRelativePath.split('/')[0];
        addDirectory(path);
      }
    }
  }

  function handleBrowse() {
    // Simply focus the input field
    destinationInput.focus();
  }

  function addDirectory(path) {
    if (!selectedDirectories.has(path)) {
      selectedDirectories.add(path);
      updateSelectedFiles();
    }
  }

  function removeDirectory(path) {
    selectedDirectories.delete(path);
    updateSelectedFiles();
  }

  function clearSelection() {
    selectedDirectories.clear();
    updateSelectedFiles();
  }

  function updateSelectedFiles() {
    selectedFiles.innerHTML = '';
    selectedDirectories.forEach(dir => {
      const div = document.createElement('div');
      div.className = 'selected-file';
      div.innerHTML = `
        <span>${dir}</span>
        <button onclick="removeDirectory('${dir}')">&times;</button>
      `;
      selectedFiles.appendChild(div);
    });
  }

  async function runMigration() {
    if (selectedDirectories.size === 0) {
      alert('Please select at least one directory');
      return;
    }

    const destinationPath = destinationInput.value.trim();
    if (!destinationPath) {
      alert('Please select a destination directory');
      return;
    }
    
    try {
      const response = await fetch('/api/run-migration', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          directories: Array.from(selectedDirectories),
          destinationPath: destinationPath
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      
      // Clear previous output
      output.innerHTML = '';
      
      // Add new output
      const pre = document.createElement('pre');
      pre.textContent = result.output;
      output.appendChild(pre);
      
      // Switch to output tab
      document.querySelector('[data-tab="output"]').click();
      
    } catch (error) {
      console.error('Error:', error);
      alert('An error occurred while running the migration');
    }
  }

  // Make removeDirectory available globally
  window.removeDirectory = removeDirectory;
}); 