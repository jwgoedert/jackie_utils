import os
import requests
from pathlib import Path
from mimetypes import guess_type

# === CONFIGURATION ===
DRY_RUN = False  # Set to True for testing
STRAPI_BASE_URL = "http://localhost:1337"
API_TOKEN = os.environ.get('STRAPI_API_TOKEN', '')
LOCAL_MEDIA_BASE = "/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders"
UPLOAD_MODE = "gallery"  # or "collage"
INCLUDE_VIDEOS = False
LOG_FILE = "strapi_upload_log.txt"
SERVER_PROJECT_BASE = "uploads/project_folders"

HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}

# === FILE EXTENSIONS ===
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm"}
ALLOWED_EXTS = IMAGE_EXTS | VIDEO_EXTS if INCLUDE_VIDEOS else IMAGE_EXTS


def log(message):
    print(message)
    with open(LOG_FILE, "a") as f:
        f.write(message + "\n")


def fetch_projects():
    all_projects = []
    seen_ids = set()
    page = 1
    page_size = 100

    while True:
        url = f"{STRAPI_BASE_URL}/api/projects?pagination[page]={page}&pagination[pageSize]={page_size}&sort=Date:asc"
        log(f"[DEBUG] Fetching page {page} with page size {page_size}")

        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()

        if "data" not in data:
            log(f"[ERROR] Unexpected API response structure: {list(data.keys())}")
            break

        page_projects = data["data"]

        if page == 1 and page_projects:
            first = page_projects[0]
            log(f"[DEBUG] Example project data structure:")
            log(f"Keys in project: {list(first.keys())}")
            log(f"Project ID: {first.get('id')}")
            log(f"Project Name: {first.get('Name')}")
            log(f"Project Date: {first.get('Date')}")

        valid_projects = []
        for proj in page_projects:
            if proj['id'] in seen_ids:
                log(f"[DEBUG] Skipping duplicate project ID: {proj['id']} - {proj.get('Name')} ({proj.get('Date')})")
                continue
            if not all(key in proj for key in ['id', 'Name', 'Date']):
                log(f"[WARN] Skipping invalid project: {proj}")
                continue
            seen_ids.add(proj['id'])
            valid_projects.append(proj)

        all_projects.extend(valid_projects)

        pagination = data.get("meta", {}).get("pagination", {})
        total_pages = pagination.get("pageCount", 1)
        total_items = pagination.get("total", len(all_projects))

        log(f"[DEBUG] Page {page}/{total_pages}: Retrieved {len(valid_projects)} valid projects (Total so far: {len(all_projects)})")
        log(f"[DEBUG] Pagination info - Page: {pagination.get('page')}, PageSize: {pagination.get('pageSize')}, Total: {total_items}")

        if page >= total_pages:
            break
        page += 1

    # Summary
    projects_by_year = {}
    for proj in all_projects:
        year = proj.get("Date")
        if year:
            projects_by_year[year] = projects_by_year.get(year, 0) + 1

    log(f"[INFO] Projects by year:")
    for year in sorted(projects_by_year):
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


def update_project_media_bulk(project, media_ids, media_field, project_folder):
    project_id = project["id"]
    if project.get("published_at") is not None:
        log(f"[SKIPPED] Project {project_id} is published; skipping upload.")
        return

    url = f"{STRAPI_BASE_URL}/api/projects/{project_id}"
    update_data = {
        "data": {
            media_field: media_ids
        }
    }

    if DRY_RUN:
        log(f"[DRY_RUN] Would update project {project_id} with {media_field}: {media_ids}")
        return {"data": {"id": project_id}}

    try:
        response = requests.put(
            url,
            headers={**HEADERS, "Content-Type": "application/json"},
            json=update_data
        )
        response.raise_for_status()
        log(f"[SUCCESS] Updated project {project_id} with {media_field} (Total: {len(media_ids)})")
        return response.json()
    except requests.exceptions.RequestException as e:
        log(f"[ERROR] Failed to update project {project_id}: {str(e)}")
        if hasattr(e, 'response') and hasattr(e.response, 'text'):
            log(f"[ERROR] Response text: {e.response.text}")
        raise


def find_media_folder(base_path, folder_name):
    folder = base_path / folder_name
    return folder if folder.exists() else None


def main():
    base_path = Path(LOCAL_MEDIA_BASE)
    media_field = "vineImages" if UPLOAD_MODE == "collage" else "galleryImages"
    suffix = "_collage" if UPLOAD_MODE == "collage" else "_gallery"

    try:
        projects = fetch_projects()
    except Exception as e:
        log(f"[ERROR] Failed to fetch projects: {str(e)}")
        return

    processed_ids = set()

    for project in projects:
        try:
            if project["id"] in processed_ids:
                continue
            processed_ids.add(project["id"])

            if 'Name' not in project or 'Date' not in project:
                log(f"[ERROR] Project missing required fields. Keys: {list(project.keys())}")
                continue

            name = project["Name"].strip() if project["Name"] else "Unknown"
            year = str(project["Date"]) if project["Date"] else "Unknown"
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

            media_ids = []
            for media_file in media_files:
                try:
                    if DRY_RUN:
                        log(f"[DRY_RUN] Would upload {media_file} → {folder_name} ({media_field})")
                    else:
                        uploaded = upload_file(media_file)
                        media_ids.append(uploaded["id"])
                        log(f"[UPLOADED] {media_file} → {folder_name} ({media_field})")
                except Exception as e:
                    log(f"[ERROR] {media_file} → {folder_name}: {str(e)}")

            if media_ids and project.get("published_at") is None:
                update_project_media_bulk(project, media_ids, media_field, media_folder)

        except KeyError as e:
            log(f"[ERROR] Missing key {str(e)} in project")
            project_info = {k: project[k] for k in ['id', 'Name', 'Date'] if k in project}
            log(f"[DEBUG] Project info: {project_info}")
        except Exception as e:
            log(f"[ERROR] Unexpected failure for project {project.get('id')}: {str(e)}")


if __name__ == "__main__":
    main()