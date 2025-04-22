# import necessary libraries
import os
import shutil
import difflib
from pathlib import Path

# === CONFIGURATION ===
SOURCE_DIR = Path("/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/collages_flattened")  # <-- Flattened Collages
PROJECT_ROOT = Path("/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders")  # <-- Project Folders
FILENAME_SUFFIX = "_composite_collage-0.png"
COLLAGE_FOLDER_SUFFIX = "_collage"
LOG_FILE = "collage_mover_log.txt"

# === COLLECTIONS FOR LOGGING ===
unmatched_files = []
used_collage_dirs = set()
all_collage_dirs = {}

# === STEP 1: Build a map of all _collage directories ===
for year_dir in PROJECT_ROOT.iterdir():
    if year_dir.is_dir() and year_dir.name[:4].isdigit():
        for sub in year_dir.iterdir():
            if sub.is_dir() and sub.name.endswith(COLLAGE_FOLDER_SUFFIX):
                all_collage_dirs[sub.name] = sub

# === STEP 2: Walk through source files and find best match ===
for file in SOURCE_DIR.glob(f"*{FILENAME_SUFFIX}"):
    base_name = file.stem.replace(FILENAME_SUFFIX.replace(".png", ""), "")
    expected_folder = f"{base_name}{COLLAGE_FOLDER_SUFFIX}"

    # Use difflib to allow for slight naming variations
    matches = difflib.get_close_matches(expected_folder, all_collage_dirs.keys(), n=1, cutoff=0.6)
    
    if matches:
        target_dir = all_collage_dirs[matches[0]]
        destination = target_dir / file.name
        try:
            shutil.copy(file, destination)
            print(f"✅ Copied {file.name} → {target_dir}")
            used_collage_dirs.add(matches[0])
        except Exception as e:
            print(f"❌ Failed to copy {file.name}: {e}")
    else:
        print(f"⚠️ No match found for: {file.name}")
        unmatched_files.append(file.name)

# === STEP 3: Detect unused collage directories ===
unused_dirs = [d for d in all_collage_dirs if d not in used_collage_dirs]

# === STEP 4: Write Log ===
with open(LOG_FILE, "w") as log:
    log.write("=== UNMATCHED FILES ===\n")
    for f in unmatched_files:
        log.write(f"- {f}\n")

    log.write("\n=== UNUSED COLLAGE DIRECTORIES ===\n")
    for d in unused_dirs:
        log.write(f"- {d}\n")

print(f"\n📝 Log written to {LOG_FILE}")

# create the target directory if it doesn't exist
# run 
