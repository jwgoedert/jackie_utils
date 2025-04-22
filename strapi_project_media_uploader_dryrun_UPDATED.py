import os
import requests
from pathlib import Path
from mimetypes import guess_type

# === CONFIGURATION ===
STRAPI_BASE_URL = "http://localhost:1337"
API_TOKEN = os.environ.get('STRAPI_API_TOKEN', '')
LOCAL_MEDIA_BASE = "/Users/jwgoedert_t2studio/work_hub/jackie_sumell/jackie_sumell_web/jackie_utils/project-folders"
UPLOAD_MODE = "gallery"  # "collage" or "gallery"
INCLUDE_VIDEOS = False
DRY_RUN = False

LOG_FILE = "strapi_upload_log.txt"
TOO_LARGE_LOG = "strapi_upload_too_large.txt"

HEADERS = {"Authorization": f"Bearer {API_TOKEN}"}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".webm"}
ALLOWED_EXTS = IMAGE_EXTS | VIDEO_EXTS if INCLUDE_VIDEOS else IMAGE_EXTS


def log(message, file=LOG_FILE):
    print(message)
    with open(file, "a") as f:
        f.write(message + "\n")


def fetch_projects():
    all_projects = []
    page = 1
    page_size = 100

    while True:
        url = f"{STRAPI_BASE_URL}/api/projects?pagination[page]={page}&pagination[pageSize]={page_size}&sort=Date:asc&publicationState=preview"
        response = requests.get(url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        page_projects = data.get("data", [])

        all_projects.extend(page_projects)

        pagination = data.get("meta", {}).get("pagination", {})
        if page >= pagination.get("pageCount", 1):
            break
        page += 1

    return all_projects


def upload_file(file_path):
    with open(file_path, 'rb') as f:
        file_name = file_path.name
        mime_type = guess_type(file_path)[0] or 'application/octet-stream'
        files = {'files': (file_name, f, mime_type)}
        try:
            response = requests.post(f"{STRAPI_BASE_URL}/api/upload", headers=HEADERS, files=files)
            response.raise_for_status()
            return response.json()[0]
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 413:
                log(f"[TOO_LARGE] {file_path}", file=TOO_LARGE_LOG)
            raise


def update_project_media(project_id, media_id, media_field):
    url = f"{STRAPI_BASE_URL}/api/projects/{project_id}?publicationState=preview"
    update_data = {"data": {media_field: [media_id]}}

    if DRY_RUN:
        log(f"[DRY_RUN] Would update project {project_id} with media ID {media_id} in field {media_field}")
        return

    response = requests.put(url, headers={**HEADERS, "Content-Type": "application/json"}, json=update_data)
    response.raise_for_status()
    log(f"[UPDATED] Project {project_id} with media {media_id}")


def main():
    base_path = Path(LOCAL_MEDIA_BASE)
    media_field = "vineImages" if UPLOAD_MODE == "collage" else "galleryImages"
    suffix = "_collage" if UPLOAD_MODE == "collage" else "_gallery"

    projects = fetch_projects()

    for proj in projects:
        proj_data = proj if isinstance(proj, dict) else proj.get("attributes", {})
        proj_id = proj.get("id")
        name = proj_data.get("Name", "").strip()
        year = str(proj_data.get("Date", "")).strip()

        folder_name = f"{year} {name}"
        media_subdir = f"{folder_name}{suffix}"
        project_folder = base_path / folder_name / media_subdir

        if not project_folder.exists():
            log(f"[MISSING_FOLDER] {project_folder}")
            continue

        media_files = [f for f in project_folder.iterdir() if f.suffix.lower() in ALLOWED_EXTS]

        for media_file in media_files:
            try:
                if DRY_RUN:
                    log(f"[DRY_RUN] Would upload {media_file}")
                    continue

                uploaded = upload_file(media_file)
                update_project_media(proj_id, uploaded["id"], media_field)
                log(f"[UPLOADED] {media_file} → Project {proj_id} ({media_field})")
            except requests.exceptions.HTTPError as e:
                log(f"[ERROR] {media_file} → Project {proj_id}: {str(e)}")
                if hasattr(e.response, 'text'):
                    log(f"[RESPONSE] {e.response.text}")


if __name__ == "__main__":
    main()
