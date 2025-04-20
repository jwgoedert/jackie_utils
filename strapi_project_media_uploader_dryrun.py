import os
import requests

# Toggle dry run mode
DRY_RUN = True  # Set to False to actually upload and link files
from pathlib import Path
from mimetypes import guess_type


# === CONFIGURATION ===
STRAPI_BASE_URL = "http://localhost:1337"
API_TOKEN = os.environ.get('STRAPI_API_TOKEN', '') # Get from environment variable or set directly
LOCAL_MEDIA_BASE = "/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders"
UPLOAD_MODE = "collage"  # "collage" or "gallery"
INCLUDE_VIDEOS = False
LOG_FILE = "strapi_upload_log.txt"

HEADERS = {
    "Authorization": f"Bearer {API_TOKEN}"
}

# === FILE EXTENSIONS ===
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm"}
ALLOWED_EXTS = IMAGE_EXTS | VIDEO_EXTS if INCLUDE_VIDEOS else IMAGE_EXTS

# === LOGGING ===
def log(message):
    print(message)
    with open(LOG_FILE, "a") as f:
        f.write(message + "\n")

# === MAIN SCRIPT ===
def fetch_projects():
    all_projects = []
    seen_ids = set()  # Keep track of project IDs we've already seen
    page = 1
    page_size = 100  # Strapi's default page size
    
    while True:
        url = f"{STRAPI_BASE_URL}/api/projects?pagination[page]={page}&pagination[pageSize]={page_size}&sort=Date:asc"
        log(f"[DEBUG] Fetching page {page} with page size {page_size}")
        
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        
        # Check if we have a data key in the response
        if "data" not in data:
            log(f"[ERROR] Unexpected API response structure: {list(data.keys())}")
            break
            
        # Get projects from this page, filtering out duplicates
        page_projects = data["data"]
        
        # Log the first project's structure on first page
        if page == 1 and page_projects:
            log(f"[DEBUG] Example project data structure:")
            log(f"Keys in project: {list(page_projects[0].keys())}")
            log(f"Project ID: {page_projects[0].get('id')}")
            log(f"Project Name: {page_projects[0].get('Name')}")
            log(f"Project Date: {page_projects[0].get('Date')}")
        
        # Filter and validate projects
        valid_projects = []
        for proj in page_projects:
            if proj['id'] in seen_ids:
                log(f"[DEBUG] Skipping duplicate project ID: {proj['id']} - {proj.get('Name', 'Unknown')} ({proj.get('Date', 'Unknown')})")
                continue
                
            # Validate this is a proper project
            if not all(key in proj for key in ['id', 'Name', 'Date']):
                log(f"[WARN] Skipping invalid project data: {proj}")
                continue
                
            seen_ids.add(proj['id'])
            valid_projects.append(proj)
            
        all_projects.extend(valid_projects)
        
        # Check pagination metadata
        if "meta" in data and "pagination" in data["meta"]:
            pagination = data["meta"]["pagination"]
            total_pages = pagination.get("pageCount", 0)
            total_items = pagination.get("total", 0)
            
            log(f"[DEBUG] Page {page}/{total_pages}: Retrieved {len(valid_projects)} new valid projects (Total unique so far: {len(all_projects)})")
            
            # Log pagination details
            log(f"[DEBUG] Pagination info - Page: {pagination.get('page')}, PageSize: {pagination.get('pageSize')}, Total: {total_items}")
            
            # If we've reached the last page, break
            if page >= total_pages:
                break
                
            page += 1
        else:
            # If no pagination metadata, assume this is the only page
            log(f"[DEBUG] No pagination metadata found, assuming single page")
            break
    
    # Log summary of unique projects by year
    projects_by_year = {}
    for proj in all_projects:
        year = proj.get('Date')
        if year:
            projects_by_year[year] = projects_by_year.get(year, 0) + 1
    
    log(f"[INFO] Projects by year:")
    for year in sorted(projects_by_year.keys()):
        log(f"  {year}: {projects_by_year[year]} projects")
    
    log(f"[INFO] Retrieved a total of {len(all_projects)} unique projects")
    return all_projects

def upload_file(file_path):
    with open(file_path, 'rb') as f:
        file_name = file_path.name
        mime_type = guess_type(file_path)[0] or 'application/octet-stream'
        files = {'files': (file_name, f, mime_type)}
        response = requests.post(f"{STRAPI_BASE_URL}/api/upload", headers=HEADERS, files=files)
        response.raise_for_status()
        return response.json()[0]

def update_project_media(project_id, media_id, media_field):
    url = f"{STRAPI_BASE_URL}/api/projects/{project_id}"
    data = {
        "data": {
            media_field: [media_id]
        }
    }
    response = requests.put(url, headers={**HEADERS, "Content-Type": "application/json"}, json=data)
    response.raise_for_status()

def find_media_folder(base_path, folder_name):
    folder = base_path / folder_name
    return folder if folder.exists() else None

def main():
    base_path = Path(LOCAL_MEDIA_BASE)
    media_field = "vineImages" if UPLOAD_MODE == "collage" else "galleryImages"
    suffix = "_collage" if UPLOAD_MODE == "collage" else "_gallery"

    try:
        projects = fetch_projects()
        log(f"[INFO] Retrieved {len(projects)} projects")
        
        # Debug: Print the structure of the first project
        if projects:
            log("[DEBUG] First project structure:")
            log(str(projects[0]))
        else:
            log("[WARNING] No projects found")
            return
    except Exception as e:
        log(f"[ERROR] Failed to fetch projects: {str(e)}")
        return

    # Keep track of processed projects to avoid duplicates
    processed_ids = set()
    unmatched = []

    for project in projects:
        try:
            # Skip if we've already processed this project
            if project['id'] in processed_ids:
                continue
            processed_ids.add(project['id'])
            
            # Debug the structure of the first project
            if project == projects[0]:
                log(f"[DEBUG] First project keys: {project.keys()}")
            
            # Access fields directly from project object (not from 'attributes')
            if 'Name' not in project or 'Date' not in project:
                log(f"[ERROR] Project missing required fields. Available fields: {list(project.keys())}")
                continue
                
            name = project['Name'].strip() if project['Name'] else "Unknown"
            year = str(project['Date']) if project['Date'] else "Unknown"
            folder_name = f"{year} {name}"
            media_subdir = f"{folder_name}{suffix}"
            media_folder = find_media_folder(base_path / folder_name, media_subdir)

            if not media_folder:
                log(f"[MISSING_FOLDER] {media_subdir}")
                continue

            media_files = [f for f in media_folder.iterdir() if f.suffix.lower() in ALLOWED_EXTS]

            if not media_files:
                log(f"[NO_MEDIA_FILES] {media_subdir}")
                continue

            for media_file in media_files:
                try:
                    if DRY_RUN:
                        log(f"[DRY_RUN] Would upload {media_file} → {folder_name} ({media_field})")
                    else:
                        uploaded = upload_file(media_file)
                        update_project_media(project["id"], uploaded["id"], media_field)
                        log(f"[UPLOADED] {media_file} → {folder_name} ({media_field})")
                except Exception as e:
                    log(f"[ERROR] {media_file} → {folder_name}: {str(e)}")
        except KeyError as e:
            log(f"[ERROR] Project data structure issue: Missing key {str(e)} in project")
            # Log only essential project info to avoid overwhelming the log
            project_info = {k: project[k] for k in ['id', 'Name', 'Date'] if k in project}
            log(f"[DEBUG] Project info: {project_info}")
if __name__ == "__main__":
    main()
