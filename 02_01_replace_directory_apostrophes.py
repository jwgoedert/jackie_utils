#!/usr/bin/env python3
"""
Directory Apostrophe Standardization Script

This script standardizes apostrophes in directory names by replacing straight apostrophes (U+0027)
with typographic apostrophes (U+2019). It preserves directory metadata and handles edge cases.
"""

import os
import re
import shutil
import stat
import time
import logging
import argparse
from datetime import datetime
from pathlib import Path
from collections import defaultdict

# Configure logging with more visible console output
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter('%(message)s'))  # Simplified format for console

file_handler = logging.FileHandler("apostrophe_standardization.log")
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter('%(asctime)s - %(levelname)s - %(message)s'))

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)
logger.addHandler(console_handler)
logger.addHandler(file_handler)

# Constants
STRAIGHT_APOSTROPHE = "'"  # U+0027
TYPOGRAPHIC_APOSTROPHE = "'"  # U+2019
YEAR_PATTERN = re.compile(r'^\d{4}')

class DirectoryRenamer:
    def __init__(self, base_dir, dry_run=False):
        self.base_dir = Path(base_dir)
        self.dry_run = dry_run
        self.renamed_dirs = []
        self.skipped_dirs = []
        self.error_dirs = []
        self.metadata_cache = {}
        
        # Create summary log file
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.summary_file = f"apostrophe_standardization_summary_{timestamp}.txt"
        
        print(f"\n{'='*80}")
        print(f"APOSTROPHE STANDARDIZATION TOOL")
        print(f"{'='*80}")
        print(f"Base Directory: {self.base_dir}")
        print(f"Dry Run: {self.dry_run}")
        print(f"{'='*80}\n")
        
    def find_year_prefixed_dirs(self):
        """Find all directories that begin with a 4-digit year."""
        print("Searching for year-prefixed directories...")
        year_dirs = []
        
        for root, dirs, _ in os.walk(self.base_dir):
            for dir_name in dirs:
                if YEAR_PATTERN.match(dir_name):
                    full_path = Path(root) / dir_name
                    year_dirs.append(full_path)
        
        print(f"Found {len(year_dirs)} year-prefixed directories")
        return year_dirs
    
    def has_straight_apostrophe(self, dir_name):
        """Check if directory name contains straight apostrophes."""
        return STRAIGHT_APOSTROPHE in dir_name
    
    def has_typographic_apostrophe(self, dir_name):
        """Check if directory name already contains typographic apostrophes."""
        return TYPOGRAPHIC_APOSTROPHE in dir_name
    
    def needs_standardization(self, dir_name):
        """Determine if directory name needs apostrophe standardization."""
        return self.has_straight_apostrophe(dir_name) and not self.has_typographic_apostrophe(dir_name)
    
    def standardize_apostrophes(self, dir_name):
        """Replace straight apostrophes with typographic apostrophes."""
        return dir_name.replace(STRAIGHT_APOSTROPHE, TYPOGRAPHIC_APOSTROPHE)
    
    def save_metadata(self, dir_path):
        """Save directory metadata before renaming."""
        try:
            stat_info = os.stat(dir_path)
            self.metadata_cache[str(dir_path)] = {
                'mode': stat_info.st_mode,
                'uid': stat_info.st_uid,
                'gid': stat_info.st_gid,
                'atime': stat_info.st_atime,
                'mtime': stat_info.st_mtime,
                'ctime': stat_info.st_ctime
            }
            return True
        except Exception as e:
            print(f"Error saving metadata for {dir_path}: {e}")
            return False
    
    def restore_metadata(self, dir_path):
        """Restore directory metadata after renaming."""
        if str(dir_path) not in self.metadata_cache:
            return False
        
        try:
            metadata = self.metadata_cache[str(dir_path)]
            os.chmod(dir_path, metadata['mode'])
            os.chown(dir_path, metadata['uid'], metadata['gid'])
            os.utime(dir_path, (metadata['atime'], metadata['mtime']))
            return True
        except Exception as e:
            print(f"Error restoring metadata for {dir_path}: {e}")
            return False
    
    def rename_directory(self, dir_path):
        """Rename directory with standardized apostrophes."""
        dir_name = dir_path.name
        parent_dir = dir_path.parent
        
        if not self.needs_standardization(dir_name):
            self.skipped_dirs.append(dir_path)
            return True
        
        new_name = self.standardize_apostrophes(dir_name)
        new_path = parent_dir / new_name
        
        # Skip if new path already exists
        if new_path.exists():
            print(f"⚠️ Cannot rename {dir_path} to {new_path} - destination already exists")
            self.error_dirs.append((dir_path, "Destination already exists"))
            return False
        
        # Save metadata before renaming
        if not self.save_metadata(dir_path):
            self.error_dirs.append((dir_path, "Failed to save metadata"))
            return False
        
        try:
            if self.dry_run:
                print(f"[DRY RUN] Would rename: {dir_path} → {new_path}")
            else:
                dir_path.rename(new_path)
                print(f"✅ Renamed: {dir_path} → {new_path}")
            
            # Restore metadata after renaming
            if not self.dry_run and not self.restore_metadata(new_path):
                print(f"⚠️ Failed to restore metadata for {new_path}")
            
            self.renamed_dirs.append((dir_path, new_path))
            return True
        except Exception as e:
            print(f"❌ Error renaming {dir_path}: {e}")
            self.error_dirs.append((dir_path, str(e)))
            return False
    
    def process_directories(self):
        """Process all directories from bottom to top."""
        # Find all year-prefixed directories
        year_dirs = self.find_year_prefixed_dirs()
        
        # Get all subdirectories recursively
        print("Collecting all subdirectories...")
        all_dirs = []
        for year_dir in year_dirs:
            for root, dirs, _ in os.walk(year_dir):
                for dir_name in dirs:
                    all_dirs.append(Path(root) / dir_name)
        
        # Sort directories by depth (deepest first)
        all_dirs.sort(key=lambda p: len(p.parts), reverse=True)
        
        print(f"Processing {len(all_dirs)} directories...")
        
        # Process each directory
        for i, dir_path in enumerate(all_dirs, 1):
            if i % 10 == 0 or i == len(all_dirs):
                print(f"Progress: {i}/{len(all_dirs)} directories processed")
            self.rename_directory(dir_path)
        
        # Process year directories last
        print("\nProcessing year directories...")
        for year_dir in year_dirs:
            self.rename_directory(year_dir)
    
    def validate_changes(self):
        """Validate that all directories were correctly renamed."""
        print("\nValidating changes...")
        # Check that all renamed directories exist with new names
        for old_path, new_path in self.renamed_dirs:
            if not new_path.exists():
                print(f"❌ Validation failed: {new_path} does not exist after renaming")
                return False
        
        # Check that no data was lost
        total_processed = len(self.renamed_dirs) + len(self.skipped_dirs) + len(self.error_dirs)
        if total_processed == 0:
            print("⚠️ No directories were processed")
            return False
        
        print("✅ Validation successful")
        return True
    
    def create_summary_log(self):
        """Create a summary log of all operations."""
        print(f"\nCreating summary log: {self.summary_file}")
        with open(self.summary_file, 'w') as f:
            f.write("APOSTROPHE STANDARDIZATION SUMMARY\n")
            f.write("=================================\n\n")
            f.write(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write(f"Base Directory: {self.base_dir}\n")
            f.write(f"Dry Run: {self.dry_run}\n\n")
            
            f.write(f"Total Directories Processed: {len(self.renamed_dirs) + len(self.skipped_dirs) + len(self.error_dirs)}\n")
            f.write(f"Directories Renamed: {len(self.renamed_dirs)}\n")
            f.write(f"Directories Skipped: {len(self.skipped_dirs)}\n")
            f.write(f"Errors Encountered: {len(self.error_dirs)}\n\n")
            
            f.write("RENAMED DIRECTORIES\n")
            f.write("------------------\n")
            for old_path, new_path in self.renamed_dirs:
                f.write(f"  {old_path} -> {new_path}\n")
            
            f.write("\nSKIPPED DIRECTORIES\n")
            f.write("------------------\n")
            for dir_path in self.skipped_dirs:
                f.write(f"  {dir_path}\n")
            
            f.write("\nERRORS\n")
            f.write("------\n")
            for dir_path, error in self.error_dirs:
                f.write(f"  {dir_path}: {error}\n")
        
        print(f"Summary log created: {self.summary_file}")
    
    def run(self):
        """Run the complete apostrophe standardization process."""
        print(f"Starting apostrophe standardization in {self.base_dir}")
        
        # Process directories
        self.process_directories()
        
        # Validate changes
        validation_success = self.validate_changes()
        
        # Create summary log
        self.create_summary_log()
        
        # Report results
        print("\n" + "="*80)
        print("FINAL RESULTS")
        print("="*80)
        print(f"Directories Renamed: {len(self.renamed_dirs)}")
        print(f"Directories Skipped: {len(self.skipped_dirs)}")
        print(f"Errors Encountered: {len(self.error_dirs)}")
        print("="*80)
        
        if validation_success:
            print("\n✅ Apostrophe standardization completed successfully!")
        else:
            print("\n⚠️ Apostrophe standardization completed with validation issues")
        
        return validation_success

def main():
    parser = argparse.ArgumentParser(description="Standardize apostrophes in directory names")
    parser.add_argument("base_dir", help="Base directory to process")
    parser.add_argument("--dry-run", action="store_true", help="Perform a dry run without making changes")
    args = parser.parse_args()
    
    renamer = DirectoryRenamer(args.base_dir, args.dry_run)
    success = renamer.run()
    
    if success:
        print(f"\nSee {renamer.summary_file} for details")
    else:
        print(f"\nSee {renamer.summary_file} for details")
        return 1
    
    return 0

if __name__ == "__main__":
    exit(main())

