# Jackie Utils

This directory contains utility scripts for managing Jackie Sumell's project data and directories.

## Directory Creation Script

The `create_directories.js` script helps manage project directories by creating a standardized folder structure for each project.

### Features

- Fetches project list from the `/api/projects/project-list` endpoint
- Validates that each project name starts with a 4-digit year
- Creates directories in the format "YYYY Project Name"
- Creates subdirectories for collages and galleries
- Generates detailed operation logs

### Usage

```bash
node create_directories.js
```

### Directory Structure

For each project, the script creates:
```
YYYY Project Name/
├── YYYY Project Name_collage/
└── YYYY Project Name_gallery/
```

### Log Files

The script generates a log file with the format `directory_creation_log_YYYY-MM-DDTHH-mm-ss-mmmZ.txt` containing:
- List of newly created directories
- List of existing directories
- Any errors encountered during the process

### Configuration

The script uses the following configuration:
- API URL: `http://localhost:1337/api/projects/project-list`
- Output Directory: `../jackie_utils/project-folders`

## Strapi Folder Setup Script

The `setup_strapi_folders.js` script creates and links folders in the Strapi media library to their respective projects.

### Features

- Creates project folders in Strapi's media library
- Creates collage and gallery subfolders for each project
- Links folders to their respective projects in the database
- Generates detailed operation logs

### Usage

```bash
node setup_strapi_folders.js
```

### Process

1. Fetches project list from the API
2. For each project:
   - Creates a main folder in Strapi
   - Creates collage and gallery subfolders
   - Links the folders to the project in the database
3. Generates a log file of the operation

### Log Files

The script generates a log file with the format `strapi_folder_setup_log_YYYY-MM-DDTHH-mm-ss-mmmZ.txt` containing:
- List of successfully created and linked folders
- Any errors encountered during the process

### Configuration

The script uses the following configuration:
- API URL: `http://localhost:1337/api/projects/project-list`
- Strapi URL: `http://localhost:1337`

## Migration Script

The `migration.js` script handles data migration tasks.

### Usage

```bash
node migration.js --config <config-file-path>
```

### Configuration

Create a JSON configuration file with the following structure:
```json
{
  "source": {
    "type": "csv",
    "path": "path/to/source.csv"
  },
  "destination": {
    "type": "strapi",
    "url": "http://localhost:1337",
    "token": "your-api-token"
  },
  "mappings": {
    "field1": "destinationField1",
    "field2": "destinationField2"
  }
}
```

## Requirements

- Node.js
- npm or yarn
- Access to the Strapi backend API 