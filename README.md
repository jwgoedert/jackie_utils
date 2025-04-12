# Jackie Sumell Migration Tool

A drag and drop web application for organizing Jackie Sumell project files.

## Features

- Drag and drop interface for selecting directories
- Real-time console output
- Detailed logs for project directories, collage images, and gallery images
- Simple and intuitive user interface

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Local backend running on port 1337 (for API access)

## Installation

1. Clone the repository
2. Navigate to the `jackie_utils` directory
3. Install dependencies:

```bash
npm install
```

## Usage

1. Start the server:

```bash
npm start
```

2. Open your browser and navigate to `http://localhost:3000`

3. Drag and drop directories or use the "Browse Files" button to select directories

4. Click "Run Migration" to start the migration process

5. View the console output and logs in real-time

## How It Works

1. The application fetches project data from the local API
2. It creates a directory structure for each project in the format `YYYY Projectname`
3. It creates subdirectories for each project with `_collage` and `_gallery` suffixes
4. It copies collage images from the source directory to the appropriate project directories
5. It copies gallery images from the source directory to the appropriate project directories
6. It generates detailed log files for each step of the process

## Directory Structure

The migration tool creates the following directory structure:

```
project-folders/
├── YYYY Projectname/
│   ├── YYYY Projectname_collage/
│   │   └── collage_image.jpg
│   └── YYYY Projectname_gallery/
│       ├── gallery_image1.jpg
│       ├── gallery_image2.jpg
│       └── ...
└── ...
```

## Log Files

The migration tool generates the following log files:

- `db_projects_list[timestamp].txt`: Lists all created/updated directories
- `collage_output[timestamp].txt`: Logs collage image copying results
- `gallery_output[timestamp].txt`: Logs gallery image copying results

## Troubleshooting

- If the migration fails, check the console output for error messages
- Ensure that the local backend is running on port 1337
- Check that the source directories (`collages_flattened` and `project_folders`) exist and contain the expected files 