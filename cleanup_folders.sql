-- Begin transaction for safety
BEGIN TRANSACTION;

-- First, save the API Uploads folder details
CREATE TEMPORARY TABLE temp_api_uploads AS
SELECT * FROM upload_folders WHERE name = 'API Uploads';

-- Delete all relationships
DELETE FROM upload_folders_parent_lnk;

-- Delete all folder records except API Uploads
DELETE FROM upload_folders WHERE name != 'API Uploads';

-- Update API Uploads to have ID 1 if it exists
UPDATE upload_folders 
SET id = 1,
    path = '/1',
    path_id = 1
WHERE name = 'API Uploads';

-- Delete any files_folder_lnk entries that point to deleted folders
DELETE FROM files_folder_lnk 
WHERE folder_id NOT IN (SELECT id FROM upload_folders);

-- Commit the transaction
COMMIT;

-- Vacuum the database to reclaim space and reset auto-increment
VACUUM; 